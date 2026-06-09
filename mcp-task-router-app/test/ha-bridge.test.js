'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateWhitelist,
  classify,
  classifyCustomTool,
  mintConfirmId,
  executeApprovedAction,
  _matchesGlob,
  _isCritical,
} = require('../src/ha-bridge');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_WHITELIST = {
  version: 1,
  glob_support: true,
  ttl: { inbound_seconds: 120, outbound_seconds: 300 },
  critical_entities: [
    { entity_id: 'switch.main_breaker',   operator_finalize: true },
    { entity_id: 'switch.visonic_p1_*',   operator_finalize: true },
    { entity_id: 'switch.promoted_safe',  operator_finalize: true, promote_critical: true },
  ],
  domain_defaults: {
    light:               'A',
    scene:               'A',
    input_boolean:       'A',
    fan:                 'A',
    media_player:        'A',
    switch:              'A',
    cover:               'B',
    climate:             'B',
    vacuum:              'B',
    script:              'B',
    automation:          'B',
    lock:                'C',
    alarm_control_panel: 'C',
  },
  domain_service_overrides: {
    cover: { stop_cover: 'A' },
  },
  custom_tools: {
    set_shutters_to_min_light: 'B',
  },
  per_entity_overrides: [
    { entity_id: 'script.goodnight',  tier: 'A' },
    { entity_id: 'climate.test_room', tier: 'A' },
  ],
};

// ── validateWhitelist (loader) ────────────────────────────────────────────────

describe('validateWhitelist', () => {
  test('accepts a valid whitelist', () => {
    assert.doesNotThrow(() => validateWhitelist(BASE_WHITELIST));
  });

  test('rejects a * critical entry when glob_support is false (M5)', () => {
    const wl = {
      ...BASE_WHITELIST,
      glob_support: false,
      critical_entities: [
        { entity_id: 'switch.visonic_p1_*', operator_finalize: true },
      ],
    };
    assert.throws(() => validateWhitelist(wl), /M5/);
  });

  test('rejects a * per-entity-override entry when glob_support is false (M5)', () => {
    const wl = {
      ...BASE_WHITELIST,
      glob_support: false,
      critical_entities: [],
      per_entity_overrides: [{ entity_id: 'switch.foo_*', tier: 'A' }],
    };
    assert.throws(() => validateWhitelist(wl), /M5/);
  });

  test('accepts exact entity_ids when glob_support is false', () => {
    const wl = {
      ...BASE_WHITELIST,
      glob_support: false,
      critical_entities: [{ entity_id: 'switch.main_breaker', operator_finalize: true }],
      per_entity_overrides: [],
    };
    assert.doesNotThrow(() => validateWhitelist(wl));
  });

  test('rejects unknown version', () => {
    assert.throws(() => validateWhitelist({ ...BASE_WHITELIST, version: 99 }), /version/);
  });

  test('rejects invalid tier in domain_defaults', () => {
    const wl = { ...BASE_WHITELIST, domain_defaults: { light: 'X' } };
    assert.throws(() => validateWhitelist(wl), /tier/i);
  });
});

// ── classify — precedence ordering ───────────────────────────────────────────

describe('classify — precedence', () => {
  test('Critical entity (exact) → Tier C, hard floor', () => {
    assert.equal(classify('switch', 'turn_on', 'switch.main_breaker', BASE_WHITELIST), 'C');
  });

  test('Critical entity with promote_critical → Tier B (never A)', () => {
    assert.equal(classify('switch', 'turn_on', 'switch.promoted_safe', BASE_WHITELIST), 'B');
  });

  test('M7: per-entity allow override cannot lift a Critical entity below Tier C', () => {
    const wl = {
      ...BASE_WHITELIST,
      critical_entities: [{ entity_id: 'switch.main_breaker', operator_finalize: true }],
      per_entity_overrides: [{ entity_id: 'switch.main_breaker', tier: 'A' }],
    };
    assert.equal(classify('switch', 'turn_on', 'switch.main_breaker', wl), 'C');
  });

  test('per-entity override beats domain default (non-Critical)', () => {
    // climate domain default = B, per-entity override = A
    assert.equal(classify('climate', 'set_temperature', 'climate.test_room', BASE_WHITELIST), 'A');
  });

  test('whitelisted script.goodnight → A (overrides B domain default)', () => {
    assert.equal(classify('script', 'turn_on', 'script.goodnight', BASE_WHITELIST), 'A');
  });

  test('non-whitelisted script → Tier B (domain default)', () => {
    assert.equal(classify('script', 'turn_on', 'script.unknown_routine', BASE_WHITELIST), 'B');
  });

  test('domain+service override: cover.stop_cover → A (not the domain default B)', () => {
    assert.equal(classify('cover', 'stop_cover', 'cover.garage_door', BASE_WHITELIST), 'A');
  });

  test('cover non-stop service → Tier B (domain default)', () => {
    assert.equal(classify('cover', 'set_position', 'cover.garage_door', BASE_WHITELIST), 'B');
    assert.equal(classify('cover', 'open_cover',   'cover.shutter',     BASE_WHITELIST), 'B');
  });

  test('domain defaults: light → A, climate → B, lock → C', () => {
    assert.equal(classify('light',   'turn_on',     'light.office',       BASE_WHITELIST), 'A');
    assert.equal(classify('climate', 'set_temp',    'climate.living',     BASE_WHITELIST), 'B');
    assert.equal(classify('lock',    'unlock',      'lock.front_door',    BASE_WHITELIST), 'C');
  });

  test('alarm_control_panel → Tier C', () => {
    assert.equal(classify('alarm_control_panel', 'disarm', 'alarm_control_panel.home', BASE_WHITELIST), 'C');
  });

  test('vacuum → Tier B (operator default)', () => {
    assert.equal(classify('vacuum', 'start', 'vacuum.roomba', BASE_WHITELIST), 'B');
  });

  test('media_player → Tier A', () => {
    assert.equal(classify('media_player', 'media_play', 'media_player.living_room', BASE_WHITELIST), 'A');
  });

  test('unknown domain → fail-closed Tier C', () => {
    assert.equal(classify('totally_unknown', 'do_thing', 'custom.entity', BASE_WHITELIST), 'C');
  });
});

// ── Glob matching ─────────────────────────────────────────────────────────────

describe('glob matching', () => {
  test('trailing-* glob matches prefix', () => {
    assert.equal(_matchesGlob('switch.visonic_p1_*', 'switch.visonic_p1_zone1',  true), true);
    assert.equal(_matchesGlob('switch.visonic_p1_*', 'switch.visonic_p1_sensor', true), true);
  });

  test('trailing-* glob does not match wrong prefix', () => {
    assert.equal(_matchesGlob('switch.visonic_p1_*', 'switch.visonic_p2_zone1', true), false);
    assert.equal(_matchesGlob('switch.visonic_p1_*', 'light.visonic_p1_zone1',  true), false);
  });

  test('exact pattern requires exact match', () => {
    assert.equal(_matchesGlob('switch.main_breaker', 'switch.main_breaker',   false), true);
    assert.equal(_matchesGlob('switch.main_breaker', 'switch.main_breaker_2', false), false);
  });

  test('Critical glob: all matching entities → Tier C', () => {
    assert.equal(classify('switch', 'turn_on',  'switch.visonic_p1_zone1',  BASE_WHITELIST), 'C');
    assert.equal(classify('switch', 'turn_off', 'switch.visonic_p1_sensor', BASE_WHITELIST), 'C');
  });

  test('non-matching switch entities are Tier A (domain default)', () => {
    assert.equal(classify('switch', 'turn_on', 'switch.desk_lamp', BASE_WHITELIST), 'A');
    assert.equal(classify('switch', 'turn_on', 'switch.kitchen_plug', BASE_WHITELIST), 'A');
  });

  test('glob: _isCritical returns false for non-matching entity', () => {
    assert.equal(_isCritical('switch.visonic_p2_zone1', BASE_WHITELIST), false);
    assert.equal(_isCritical('light.office', BASE_WHITELIST), false);
  });
});

// ── Executor: Tier C / Critical hard-refuse ───────────────────────────────────

describe('executeApprovedAction — hard-refuse (no HTTP call needed)', () => {
  test('lock → Tier C → hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'lock', service: 'unlock', entity: 'lock.front_door' }, BASE_WHITELIST),
      /HARD-REFUSE/
    );
  });

  test('alarm_control_panel → Tier C → hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'alarm_control_panel', service: 'disarm', entity: 'alarm_control_panel.home' }, BASE_WHITELIST),
      /HARD-REFUSE/
    );
  });

  test('Critical switch (exact) → hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'switch', service: 'turn_on', entity: 'switch.main_breaker' }, BASE_WHITELIST),
      /HARD-REFUSE/
    );
  });

  test('Critical switch (glob) → hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'switch', service: 'turn_on', entity: 'switch.visonic_p1_zone3' }, BASE_WHITELIST),
      /HARD-REFUSE/
    );
  });

  test('unknown domain → fail-closed → hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'unknown_domain', service: 'do_thing', entity: 'unknown.entity' }, BASE_WHITELIST),
      /HARD-REFUSE/
    );
  });

  test('missing entity → throws (not hard-refuse label, but still rejects)', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'light', service: 'turn_on', entity: '' }, BASE_WHITELIST),
      /required/
    );
  });
});

// ── confirm_id minting (N1) ───────────────────────────────────────────────────

describe('mintConfirmId — entropy and format (N1)', () => {
  test('returns UUIDv4 format string', () => {
    const id = mintConfirmId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('UUIDv4 has ≥64-bit entropy (122 bits of randomness)', () => {
    // UUIDv4: 128 bits total, 6 fixed (version + variant) → 122 random bits >> 64
    const id = mintConfirmId();
    const hexOnly = id.replace(/-/g, '');
    assert.equal(hexOnly.length, 32, '32 hex chars = 128 bit field');
    assert.equal(id[14], '4', 'version nibble must be 4');
    assert.ok('89ab'.includes(id[19]), 'variant nibble must be 8/9/a/b');
  });

  test('each mint produces a unique id (100 samples)', () => {
    const ids = new Set(Array.from({ length: 100 }, () => mintConfirmId()));
    assert.equal(ids.size, 100);
  });
});

// ── Custom tool classification ────────────────────────────────────────────────

describe('classifyCustomTool', () => {
  test('set_shutters_to_min_light → Tier B (operator default)', () => {
    assert.equal(classifyCustomTool('set_shutters_to_min_light', BASE_WHITELIST), 'B');
  });

  test('unknown custom tool → Tier C (fail-closed)', () => {
    assert.equal(classifyCustomTool('totally_unknown_tool', BASE_WHITELIST), 'C');
  });
});
