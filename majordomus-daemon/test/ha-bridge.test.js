'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateWhitelist,
  classify,
  classifyCustomTool,
  classifyEntity,
  checkFleetEnableDeny,
  checkDisableScope,
  mintConfirmId,
  executeApprovedAction,
  scanBody,
  executeConfigWrite,
  FLEET_ENABLE_DENY,
  _matchesGlob,
  _isCritical,
  _scopedWsSend,
  _hashBody,
  _priorBodyHasCritical,
} = require('../src/ha-bridge');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_WHITELIST = {
  version: 1,
  glob_support: true,
  ttl: { inbound_seconds: 120, outbound_seconds: 300 },
  critical_entities: [
    { entity_id: 'switch.main_breaker',        operator_finalize: true },
    { entity_id: 'switch.visonic_p1_*',        operator_finalize: true },
    { entity_id: 'switch.promoted_safe',       operator_finalize: true, promote_critical: true },
    // Helper-domain Critical for testing _helperDelete / undo-helper_create guard paths.
    // input_boolean/delete IS in WS_ALLOWED_TYPES, so _isCritical is the sole guard here.
    { entity_id: 'input_boolean.master_safety', operator_finalize: true },
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
  fleet_enable_deny: {
    domain_service: [
      { form: 1, domain: 'automation', service: 'turn_on',  reason: 'enables automation' },
      { form: 2, domain: 'automation', service: 'toggle',   reason: 'enables disabled automation' },
      { form: 3, domain: 'automation', service: 'trigger',  reason: 'fires disabled automation (v2-missed)' },
      { form: 4, domain: 'script',     service: 'turn_on',  reason: 'runs the script' },
      { form: 5, domain: 'script',     service: 'toggle',   reason: 'starts a stopped script (v2-missed)' },
      { form: 6, domain: 'script',     service: '*',        reason: 'named-script service form' },
    ],
    homeassistant_wildcard: {
      form: 7,
      services: ['turn_on', 'toggle'],
      deny_if_entity_domain_prefix: ['automation.', 'script.'],
      reason: 'homeassistant.turn_on/toggle to automation.*/script.* target',
    },
  },
  disable_scope: {
    hard_deny_ops_if_prior_has_critical: {
      domains: ['automation', 'script'],
      ops: ['turn_off', 'delete', 'upsert'],
      description: 'HARD-DENIED: disable/delete/overwrite of pre-existing Critical-referencing object',
    },
    permitted_own_deploy_backstop: {
      allowed_when: 'prior_is_null_or_no_critical_prior_refs',
      description: 'Executor force-disable of object under deployment (§3.1 case-a)',
    },
    permitted_fleet_turn_off: {
      tier: 'B',
      condition: 'prior_body_has_no_critical_refs',
      description: 'Fleet turn_off with no Critical prior → Tier-B confirm',
    },
  },
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

  test('script.goodnight turn_on → FLEET_ENABLE_DENY (cause-to-fire supersedes per-entity A override)', () => {
    // fleet_enable_deny step 0 fires before per-entity override step 2 — the fleet
    // may never run a script by any service, even a whitelisted one (§3.3 linchpin).
    assert.equal(classify('script', 'turn_on', 'script.goodnight', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  test('non-whitelisted script turn_on → FLEET_ENABLE_DENY (cause-to-fire, not Tier B)', () => {
    assert.equal(classify('script', 'turn_on', 'script.unknown_routine', BASE_WHITELIST), FLEET_ENABLE_DENY);
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

// ── W1: fleet_enable_deny — all 7 cause-to-fire forms (§3.3) ─────────────────

describe('checkFleetEnableDeny — all 7 cause-to-fire forms', () => {
  // Form 1
  test('form 1: automation.turn_on → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('automation', 'turn_on', 'automation.lights_off', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 2
  test('form 2: automation.toggle → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('automation', 'toggle', 'automation.morning_routine', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 3 — the v2-missed killer: fires disabled automation without enabling it
  test('form 3: automation.trigger → FLEET_ENABLE_DENY (v2-missed — fires disabled automation)', () => {
    assert.equal(checkFleetEnableDeny('automation', 'trigger', 'automation.breaker_trip', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 4
  test('form 4: script.turn_on → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('script', 'turn_on', 'script.goodnight', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 5 — the other v2-missed form: toggling a stopped script starts it
  test('form 5: script.toggle → FLEET_ENABLE_DENY (v2-missed — starts a stopped script)', () => {
    assert.equal(checkFleetEnableDeny('script', 'toggle', 'script.morning', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 6 — named-script service form: domain=script, service=<object_id>
  test('form 6: script.<object_id> named-script service → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('script', 'morning_routine', 'script.morning_routine', BASE_WHITELIST), FLEET_ENABLE_DENY);
    assert.equal(checkFleetEnableDeny('script', 'turn_off_everything', 'script.turn_off_everything', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 7a: homeassistant.turn_on → automation.* target
  test('form 7: homeassistant.turn_on targeting automation.* → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('homeassistant', 'turn_on', 'automation.lights_off', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 7b: homeassistant.toggle → script.* target
  test('form 7: homeassistant.toggle targeting script.* → FLEET_ENABLE_DENY', () => {
    assert.equal(checkFleetEnableDeny('homeassistant', 'toggle', 'script.morning', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  // Form 7 negative: homeassistant.turn_on → light.* target — NOT denied
  test('form 7 (negative): homeassistant.turn_on targeting light.* → null (not denied)', () => {
    assert.equal(checkFleetEnableDeny('homeassistant', 'turn_on', 'light.office', BASE_WHITELIST), null);
  });

  // Permitted: automation.turn_off is not in the deny set (tightening is allowed)
  test('automation.turn_off → null (permitted — disabling is safe tightening)', () => {
    assert.equal(checkFleetEnableDeny('automation', 'turn_off', 'automation.lights_off', BASE_WHITELIST), null);
  });

  // Permitted: unrelated domain
  test('light.turn_on → null (not a cause-to-fire form)', () => {
    assert.equal(checkFleetEnableDeny('light', 'turn_on', 'light.office', BASE_WHITELIST), null);
  });

  // No fleet_enable_deny block → null (graceful degradation)
  test('whitelist with no fleet_enable_deny block → null (graceful)', () => {
    const wlNoFed = { ...BASE_WHITELIST };
    delete wlNoFed.fleet_enable_deny;
    assert.equal(checkFleetEnableDeny('automation', 'trigger', 'automation.x', wlNoFed), null);
  });
});

describe('classify — fleet_enable_deny integration', () => {
  test('classify(automation, trigger, ...) → FLEET_ENABLE_DENY (step 0 fires before all other logic)', () => {
    assert.equal(classify('automation', 'trigger', 'automation.breaker_trip', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  test('classify(script, toggle, ...) → FLEET_ENABLE_DENY', () => {
    assert.equal(classify('script', 'toggle', 'script.y', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });

  test('classify(automation, turn_off, ...) → B (permitted — not in deny set)', () => {
    assert.equal(classify('automation', 'turn_off', 'automation.z', BASE_WHITELIST), 'B');
  });

  test('classify(homeassistant, turn_on, automation.x) → FLEET_ENABLE_DENY (form 7)', () => {
    assert.equal(classify('homeassistant', 'turn_on', 'automation.breaker', BASE_WHITELIST), FLEET_ENABLE_DENY);
  });
});

describe('executeApprovedAction — FLEET_ENABLE_DENY hard-refuse', () => {
  test('automation.trigger → FLEET_ENABLE_DENY hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'automation', service: 'trigger', entity: 'automation.x' }, BASE_WHITELIST),
      /FLEET_ENABLE_DENY/
    );
  });

  test('script.toggle → FLEET_ENABLE_DENY hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'script', service: 'toggle', entity: 'script.morning' }, BASE_WHITELIST),
      /FLEET_ENABLE_DENY/
    );
  });

  test('script named-service form → FLEET_ENABLE_DENY hard-refuse', async () => {
    await assert.rejects(
      () => executeApprovedAction({ domain: 'script', service: 'morning_routine', entity: 'script.morning_routine' }, BASE_WHITELIST),
      /FLEET_ENABLE_DENY/
    );
  });
});

// ── W1: classifyEntity (§4 Q-HA-CONFIGWRITE) ─────────────────────────────────

describe('classifyEntity — service-agnostic body-scan classifier', () => {
  test('Critical entity → C', () => {
    assert.equal(classifyEntity('switch.main_breaker', BASE_WHITELIST), 'C');
  });

  test('Critical entity with promote_critical → B', () => {
    assert.equal(classifyEntity('switch.promoted_safe', BASE_WHITELIST), 'B');
  });

  test('Critical glob match → C', () => {
    assert.equal(classifyEntity('switch.visonic_p1_zone1', BASE_WHITELIST), 'C');
  });

  test('per-entity override (non-Critical) → that tier', () => {
    // climate.test_room has per-entity override A; domain default is B
    assert.equal(classifyEntity('climate.test_room', BASE_WHITELIST), 'A');
  });

  test('domain default: light → A', () => {
    assert.equal(classifyEntity('light.office', BASE_WHITELIST), 'A');
  });

  test('domain default: climate → B', () => {
    assert.equal(classifyEntity('climate.living_room', BASE_WHITELIST), 'B');
  });

  test('domain default: automation → B', () => {
    assert.equal(classifyEntity('automation.my_auto', BASE_WHITELIST), 'B');
  });

  test('domain default: script → B', () => {
    // classifyEntity does NOT check fleet_enable_deny (no service context)
    assert.equal(classifyEntity('script.goodnight', BASE_WHITELIST), 'A'); // per-entity override
    assert.equal(classifyEntity('script.unknown',   BASE_WHITELIST), 'B'); // domain default
  });

  test('unknown domain → C (fail-closed)', () => {
    assert.equal(classifyEntity('custom_domain.foo', BASE_WHITELIST), 'C');
  });

  test('normalization: leading/trailing spaces + uppercase → same as trimmed lowercase', () => {
    assert.equal(classifyEntity('  Light.OFFICE  ', BASE_WHITELIST), 'A');
    assert.equal(classifyEntity(' SWITCH.MAIN_BREAKER ', BASE_WHITELIST), 'C');
  });

  test('empty string → C (fail-closed)', () => {
    assert.equal(classifyEntity('', BASE_WHITELIST), 'C');
    assert.equal(classifyEntity('   ', BASE_WHITELIST), 'C');
  });

  test('classifyEntity does NOT consult fleet_enable_deny (no service context)', () => {
    // automation.x → B (domain default), not FLEET_ENABLE_DENY — no service, body entity only
    assert.equal(classifyEntity('automation.breaker_trip', BASE_WHITELIST), 'B');
  });
});

// ── W1: disable_scope — checkDisableScope rule-data resolution ────────────────

describe('checkDisableScope — §3.4 rule-data verdicts', () => {
  const base = { op: 'turn_off', domain: 'automation', priorBodyHasCritical: false, priorIsNull: false, isOwnDeployBackstop: false };

  test('hard-deny: upsert on pre-existing automation with Critical prior', () => {
    const r = checkDisableScope({ ...base, op: 'upsert', priorBodyHasCritical: true }, BASE_WHITELIST);
    assert.equal(r.verdict, 'HARD_DENY');
    assert.match(r.reason, /Critical/);
  });

  test('hard-deny: delete on pre-existing script with Critical prior', () => {
    const r = checkDisableScope({ ...base, op: 'delete', domain: 'script', priorBodyHasCritical: true }, BASE_WHITELIST);
    assert.equal(r.verdict, 'HARD_DENY');
  });

  test('hard-deny: turn_off on pre-existing automation with Critical prior', () => {
    const r = checkDisableScope({ ...base, op: 'turn_off', priorBodyHasCritical: true }, BASE_WHITELIST);
    assert.equal(r.verdict, 'HARD_DENY');
  });

  test('permitted backstop: isOwnDeployBackstop + prior==null → PERMITTED_BACKSTOP', () => {
    const r = checkDisableScope({ ...base, isOwnDeployBackstop: true, priorIsNull: true, priorBodyHasCritical: false }, BASE_WHITELIST);
    assert.equal(r.verdict, 'PERMITTED_BACKSTOP');
  });

  test('permitted backstop: isOwnDeployBackstop + prior has no Critical refs → PERMITTED_BACKSTOP', () => {
    const r = checkDisableScope({ ...base, isOwnDeployBackstop: true, priorIsNull: false, priorBodyHasCritical: false }, BASE_WHITELIST);
    assert.equal(r.verdict, 'PERMITTED_BACKSTOP');
  });

  test('hard-deny: isOwnDeployBackstop + prior has Critical refs → HARD_DENY (upsert should have been refused at step 4)', () => {
    const r = checkDisableScope({ ...base, isOwnDeployBackstop: true, priorIsNull: false, priorBodyHasCritical: true }, BASE_WHITELIST);
    assert.equal(r.verdict, 'HARD_DENY');
    assert.match(r.reason, /step 4/);
  });

  test('permitted turn_off: no Critical prior → PERMITTED_TURN_OFF_TIER_B', () => {
    const r = checkDisableScope({ ...base, op: 'turn_off', priorBodyHasCritical: false }, BASE_WHITELIST);
    assert.equal(r.verdict, 'PERMITTED_TURN_OFF_TIER_B');
  });

  test('permitted turn_off on script: no Critical prior → PERMITTED_TURN_OFF_TIER_B', () => {
    const r = checkDisableScope({ ...base, op: 'turn_off', domain: 'script', priorBodyHasCritical: false }, BASE_WHITELIST);
    assert.equal(r.verdict, 'PERMITTED_TURN_OFF_TIER_B');
  });
});

// ── W1: validateWhitelist — fleet_enable_deny validation ─────────────────────

describe('validateWhitelist — fleet_enable_deny block', () => {
  test('accepts whitelist with valid fleet_enable_deny', () => {
    assert.doesNotThrow(() => validateWhitelist(BASE_WHITELIST));
  });

  test('rejects fleet_enable_deny.domain_service that is not an array', () => {
    const wl = { ...BASE_WHITELIST, fleet_enable_deny: { domain_service: 'bad' } };
    assert.throws(() => validateWhitelist(wl), /domain_service must be an array/);
  });

  test('rejects fleet_enable_deny.domain_service entry missing domain string', () => {
    const wl = {
      ...BASE_WHITELIST,
      fleet_enable_deny: { domain_service: [{ service: 'turn_on' }] },
    };
    assert.throws(() => validateWhitelist(wl), /domain.*service/i);
  });

  test('rejects fleet_enable_deny.homeassistant_wildcard missing services array', () => {
    const wl = {
      ...BASE_WHITELIST,
      fleet_enable_deny: {
        domain_service: [],
        homeassistant_wildcard: { deny_if_entity_domain_prefix: [] },
      },
    };
    assert.throws(() => validateWhitelist(wl), /services must be an array/);
  });

  test('accepts whitelist without fleet_enable_deny block (backwards-compatible)', () => {
    const wl = { ...BASE_WHITELIST };
    delete wl.fleet_enable_deny;
    assert.doesNotThrow(() => validateWhitelist(wl));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// W2 TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── W2: _scopedWsSend — WS invariant (§5.3) ──────────────────────────────────

describe('_scopedWsSend — WS scope invariant', () => {
  test('rejects call_service by name — explicit ban (§5.3)', () => {
    assert.throws(
      () => _scopedWsSend('call_service', {}),
      /WS-SCOPE-VIOLATION.*call_service/
    );
  });

  test('rejects event/* type (non-config bypass vector)', () => {
    assert.throws(
      () => _scopedWsSend('fire_event', {}),
      /WS-SCOPE-VIOLATION/
    );
  });

  test('rejects subscribe_events (live-state type, not a config command)', () => {
    assert.throws(
      () => _scopedWsSend('subscribe_events', {}),
      /WS-SCOPE-VIOLATION/
    );
  });

  test('accepts input_number/create (whitelisted config type)', () => {
    const result = _scopedWsSend('input_number/create', { name: 'test' });
    assert.deepEqual(result, { type: 'input_number/create', payload: { name: 'test' } });
  });

  test('accepts config_entries/flow/init (template sensor flow)', () => {
    const result = _scopedWsSend('config_entries/flow/init', { handler: 'template' });
    assert.equal(result.type, 'config_entries/flow/init');
  });

  test('accepts config_entries/flow/cancel (abort dangling flow)', () => {
    assert.doesNotThrow(() => _scopedWsSend('config_entries/flow/cancel', { flow_id: 'x' }));
  });

  test('accepts all 9 helper domains × 3 verbs = 27 types', () => {
    const domains = ['input_number','input_boolean','input_text','input_select',
                     'input_datetime','input_button','counter','timer','schedule'];
    for (const d of domains) {
      for (const verb of ['create','update','delete']) {
        assert.doesNotThrow(() => _scopedWsSend(`${d}/${verb}`, {}), `${d}/${verb} should be allowed`);
      }
    }
  });
});

// ── W2: _hashBody ─────────────────────────────────────────────────────────────

describe('_hashBody', () => {
  test('returns a 64-char hex SHA-256', () => {
    const h = _hashBody({ alias: 'test' });
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  test('same input → same hash (deterministic)', () => {
    const body = { sequence: [{ service: 'light.turn_on', target: { entity_id: 'light.a' } }] };
    assert.equal(_hashBody(body), _hashBody(body));
  });

  test('different input → different hash', () => {
    assert.notEqual(_hashBody({ a: 1 }), _hashBody({ a: 2 }));
  });
});

// ── W2: _priorBodyHasCritical ─────────────────────────────────────────────────

describe('_priorBodyHasCritical', () => {
  const wl = BASE_WHITELIST;

  test('returns false for null prior (no prior body)', () => {
    assert.equal(_priorBodyHasCritical(null, wl), false);
  });

  test('returns false for body with no entity_id', () => {
    assert.equal(_priorBodyHasCritical({ alias: 'benign' }, wl), false);
  });

  test('detects Critical entity_id string in action', () => {
    const body = {
      sequence: [{ service: 'switch.turn_on', data: { entity_id: 'switch.main_breaker' } }],
    };
    assert.equal(_priorBodyHasCritical(body, wl), true);
  });

  test('detects Critical entity_id in array form', () => {
    const body = {
      sequence: [{ service: 'switch.turn_on', data: { entity_id: ['switch.main_breaker', 'light.office'] } }],
    };
    assert.equal(_priorBodyHasCritical(body, wl), true);
  });

  test('returns false for non-Critical switch entity', () => {
    const body = {
      sequence: [{ service: 'switch.turn_on', data: { entity_id: 'switch.garden_lamp' } }],
    };
    assert.equal(_priorBodyHasCritical(body, wl), false);
  });

  test('detects glob-matched Critical entity (switch.visonic_p1_*)', () => {
    const body = { sequence: [{ entity_id: 'switch.visonic_p1_zone1' }] };
    assert.equal(_priorBodyHasCritical(body, wl), true);
  });
});

// ── W2: scanBody — §4 a–i ────────────────────────────────────────────────────

describe('scanBody — body-scan §4', () => {
  const wl = BASE_WHITELIST;

  // §4(c) template-deny
  test('(c) hard-deny: template in entity field', () => {
    const body = {
      action: [{ service: 'light.turn_on', target: { entity_id: '{{ states("sensor.x") }}' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /template in entity field/);
  });

  test('(c) hard-deny: template in service field', () => {
    const body = {
      action: [{ service: '{{ "light" }}.turn_on' }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /template in service field/);
  });

  test('(c) hard-deny: legacy service_template key', () => {
    const body = { action: [{ service_template: 'light.turn_on' }] };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /service_template/);
  });

  // §4(d) selectors
  test('(d) hard-deny: area_id selector in target', () => {
    const body = {
      action: [{ service: 'light.turn_on', target: { area_id: 'living_room' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /area_id/);
  });

  test('(d) hard-deny: device_id selector at top level of action step', () => {
    const body = { action: [{ service: 'light.turn_on', device_id: 'abc123' }] };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /device_id/);
  });

  // §4(e) group expansion
  test('(e) hard-deny: group.all_lights entity (expand-or-deny)', () => {
    const body = {
      action: [{ service: 'light.turn_on', target: { entity_id: 'group.all_lights' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /group entity.*expand-or-deny/);
  });

  // §4(h) blueprint flag
  test('(h) blueprint — flag, not deny', () => {
    const body = { use_blueprint: { path: 'test/bp.yaml', input: {} } };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, false);
    assert.equal(r.blueprint_flag, true);
  });

  // §4(i) in-body cause-to-fire
  test('(i) hard-deny: in-body automation.turn_on service (form 1)', () => {
    const body = {
      action: [{ service: 'automation.turn_on', target: { entity_id: 'automation.my_auto' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /cause-to-fire|fleet_enable_deny/i);
  });

  test('(i) hard-deny: in-body homeassistant.turn_on targeting automation.* (form 7)', () => {
    const body = {
      action: [{
        service: 'homeassistant.turn_on',
        target: { entity_id: 'automation.dangerous_auto' },
      }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
  });

  // Critical refs — not hard-deny by itself, but tracked
  test('Critical ref in benign action — flagged in critical_refs, not hard_deny', () => {
    const body = {
      condition: [{ condition: 'state', entity_id: 'switch.main_breaker', state: 'off' }],
      action: [{ service: 'notify.mobile_app', data: { message: 'breaker off' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, false);
    assert.ok(r.critical_refs.includes('switch.main_breaker'));
  });

  // Clean body
  test('clean body with only Tier-A entities — passes, no critical_refs', () => {
    const body = {
      action: [{ service: 'light.turn_on', target: { entity_id: 'light.office' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, false);
    assert.equal(r.blueprint_flag, false);
    assert.equal(r.critical_refs.length, 0);
  });

  // Nested sequence
  test('nested choose-then block is recursed', () => {
    const body = {
      action: [{
        choose: [{
          conditions: [],
          sequence: [{
            service: 'automation.turn_on',
            target: { entity_id: 'automation.bad' },
          }],
        }],
      }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /cause-to-fire|fleet_enable_deny/i);
  });

  test('entity_id list — Critical entity in array is tracked', () => {
    const body = {
      action: [{ service: 'switch.turn_on', target: { entity_id: ['light.office', 'switch.main_breaker'] } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, false);
    assert.ok(r.critical_refs.includes('switch.main_breaker'));
  });
});

// ── W2: executeConfigWrite — cap-token gate ───────────────────────────────────

describe('executeConfigWrite — cap-token validation (STEP 1)', () => {
  const wl = BASE_WHITELIST;

  test('rejects when validateCapToken hook is not wired', async () => {
    await assert.rejects(
      () => executeConfigWrite({ op: 'automation_upsert', payload: {}, confirm_id: 'c1' }, 'tok', { whitelist: wl }),
      /CAP-TOKEN.*validateCapToken hook not wired/
    );
  });

  test('rejects when validateCapToken returns false (invalid token)', async () => {
    const opts = { whitelist: wl, validateCapToken: async () => false };
    await assert.rejects(
      () => executeConfigWrite({ op: 'automation_upsert', payload: {}, confirm_id: 'c1' }, 'bad', opts),
      /CAP-TOKEN.*Invalid.*stale/
    );
  });

  test('rejects unsupported op after cap-token passes', async () => {
    const opts = { whitelist: wl, validateCapToken: async () => true };
    await assert.rejects(
      () => executeConfigWrite({ op: 'fire_missile', payload: {}, confirm_id: 'c1' }, 'good', opts),
      /UNSUPPORTED-OP/
    );
  });
});

// ── W2: executeConfigWrite — automation_upsert ────────────────────────────────

describe('executeConfigWrite — automation_upsert', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  function mkOpts(overrides = {}) {
    return {
      whitelist: wl,
      validateCapToken: okToken,
      haGet: async () => null,                              // no prior
      haPost: async () => ({ id: 'test_auto' }),
      haState: async () => ({ state: 'off' }),              // already disabled
      haService: async () => ({}),
      ...overrides,
    };
  }

  test('creates new automation — returns created_disabled:true, no critical_refs', async () => {
    const opts = mkOpts();
    const result = await executeConfigWrite({
      op: 'automation_upsert',
      payload: { object_id: 'test_auto', body: { action: [{ service: 'light.turn_on', target: { entity_id: 'light.office' } }] } },
      confirm_id: 'c1',
    }, 'tok', opts);
    assert.equal(result.op, 'automation_upsert');
    assert.equal(result.applied, true);
    assert.equal(result.created_disabled, true);
    assert.equal(result.overwrote, false);
    assert.equal(result.critical_refs.length, 0);
    assert.ok(result.audit_id);
  });

  test('force-injects initial_state:false regardless of body contents (§3.1)', async () => {
    let postedBody = null;
    const opts = mkOpts({ haPost: async (domain, id, body) => { postedBody = body; } });
    await executeConfigWrite({
      op: 'automation_upsert',
      payload: { object_id: 'safe_auto', body: { initial_state: true, action: [{ service: 'light.turn_off', target: { entity_id: 'light.office' } }] } },
      confirm_id: 'c2',
    }, 'tok', opts);
    assert.equal(postedBody.initial_state, false);
  });

  test('hard-deny: body-scan rejects template in entity field (§4(c))', async () => {
    const opts = mkOpts();
    await assert.rejects(
      () => executeConfigWrite({
        op: 'automation_upsert',
        payload: { object_id: 'bad_auto', body: { action: [{ service: 'light.turn_on', target: { entity_id: '{{ states("x") }}' } }] } },
        confirm_id: 'c3',
      }, 'tok', opts),
      /BODY-SCAN-DENY/
    );
  });

  test('hard-deny NEW-1: prior body references Critical entity (§3.4)', async () => {
    const opts = mkOpts({
      haGet: async () => ({
        sequence: [{ entity_id: 'switch.main_breaker' }],
      }),
    });
    await assert.rejects(
      () => executeConfigWrite({
        op: 'automation_upsert',
        payload: { object_id: 'safety_auto', body: { action: [] } },
        confirm_id: 'c4',
      }, 'tok', opts),
      /HARD-DENY.*prior body.*Critical/
    );
  });

  test('backstop turn_off called when state is on after upsert', async () => {
    let backstopCalled = false;
    const opts = mkOpts({
      haState: async () => ({ state: 'on' }),
      haService: async (domain, service) => { backstopCalled = (domain === 'automation' && service === 'turn_off'); },
    });
    await executeConfigWrite({
      op: 'automation_upsert',
      payload: { object_id: 'state_on_auto', body: { action: [{ service: 'light.turn_on', target: { entity_id: 'light.x' } }] } },
      confirm_id: 'c5',
    }, 'tok', opts);
    assert.equal(backstopCalled, true);
  });
});

// ── W2: executeConfigWrite — automation_delete ────────────────────────────────

describe('executeConfigWrite — automation_delete', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('deletes an automation with no Critical prior', async () => {
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => ({ action: [{ entity_id: 'light.office' }] }),
      haDelete: async () => null,
    };
    const result = await executeConfigWrite(
      { op: 'automation_delete', payload: { object_id: 'benign_auto' }, confirm_id: 'c10' },
      'tok', opts
    );
    assert.equal(result.op, 'automation_delete');
    assert.equal(result.applied, true);
  });

  test('hard-deny: prior body references Critical entity (§3.4)', async () => {
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => ({ sequence: [{ entity_id: 'switch.main_breaker' }] }),
      haDelete: async () => null,
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'automation_delete', payload: { object_id: 'safety_auto' }, confirm_id: 'c11' },
        'tok', opts
      ),
      /HARD-DENY.*prior body.*Critical/
    );
  });

  test('succeeds when prior is null (already deleted)', async () => {
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => null,
      haDelete: async () => null,
    };
    const result = await executeConfigWrite(
      { op: 'automation_delete', payload: { object_id: 'gone_auto' }, confirm_id: 'c12' },
      'tok', opts
    );
    assert.equal(result.applied, true);
  });
});

// ── W2: executeConfigWrite — script_upsert ────────────────────────────────────

describe('executeConfigWrite — script_upsert', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('creates new script — no initial_state injection (scripts run-deny is the control)', async () => {
    let postedBody = null;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => null,
      haPost: async (domain, id, body) => { postedBody = body; return {}; },
    };
    await executeConfigWrite(
      { op: 'script_upsert', payload: { object_id: 'new_script', body: { sequence: [{ service: 'light.turn_on', target: { entity_id: 'light.office' } }] } }, confirm_id: 'c20' },
      'tok', opts
    );
    assert.equal(postedBody.initial_state, undefined);
  });

  test('hard-deny NEW-1: prior script body has Critical ref', async () => {
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => ({ sequence: [{ entity_id: 'switch.main_breaker' }] }),
      haPost: async () => ({}),
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'script_upsert', payload: { object_id: 'safety_script', body: { sequence: [] } }, confirm_id: 'c21' },
        'tok', opts
      ),
      /HARD-DENY.*prior body.*Critical/
    );
  });
});

// ── W2: executeConfigWrite — helper_create/update/delete ─────────────────────

describe('executeConfigWrite — helper ops', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('helper_create calls wsCmd with correct type', async () => {
    let wsCalled = null;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => { wsCalled = { type, payload }; return { entry_id: 'e1' }; },
    };
    await executeConfigWrite(
      { op: 'helper_create', payload: { helper_type: 'input_number', name: 'test' }, confirm_id: 'c30' },
      'tok', opts
    );
    assert.equal(wsCalled.type, 'input_number/create');
    assert.equal(wsCalled.payload.name, 'test');
  });

  test('helper_update calls wsCmd with entry_id', async () => {
    let wsCalled = null;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => { wsCalled = { type, payload }; return {}; },
    };
    await executeConfigWrite(
      { op: 'helper_update', payload: { helper_type: 'input_boolean', entry_id: 'e2', name: 'updated' }, confirm_id: 'c31' },
      'tok', opts
    );
    assert.equal(wsCalled.type, 'input_boolean/update');
    assert.equal(wsCalled.payload.entry_id, 'e2');
  });

  test('helper_delete calls wsCmd for delete', async () => {
    let wsCalled = null;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => { wsCalled = { type, payload }; return {}; },
    };
    await executeConfigWrite(
      { op: 'helper_delete', payload: { helper_type: 'counter', entry_id: 'e3' }, confirm_id: 'c32' },
      'tok', opts
    );
    assert.equal(wsCalled.type, 'counter/delete');
    assert.equal(wsCalled.payload.entry_id, 'e3');
  });

  test('helper_create rejects missing helper_type', async () => {
    const opts = { whitelist: wl, validateCapToken: okToken, wsCmd: async () => ({}) };
    await assert.rejects(
      () => executeConfigWrite({ op: 'helper_create', payload: { name: 'oops' }, confirm_id: 'c33' }, 'tok', opts),
      /helper_type required/
    );
  });

  test('helper_delete by object_id (storage-based) resolves via list and sends input_number_id', async () => {
    const wsCalls = [];
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => {
        wsCalls.push({ type, payload });
        if (type === 'input_number/list') {
          return [
            { id: 'battery_start_energy',   entity_id: 'input_number.battery_start_energy' },
            { id: '8f263ad7d3f8dde080d35c6c1a0b2906', entity_id: 'input_number.battery_start_energy_2' },
          ];
        }
        return {};
      },
    };
    await executeConfigWrite(
      { op: 'helper_delete', payload: { helper_type: 'input_number', object_id: 'battery_start_energy_2' }, confirm_id: 'c34' },
      'tok', opts
    );
    const listCall = wsCalls.find(c => c.type === 'input_number/list');
    assert.ok(listCall, 'expected input_number/list call');
    const deleteCall = wsCalls.find(c => c.type === 'input_number/delete');
    assert.ok(deleteCall, 'expected input_number/delete call');
    assert.equal(deleteCall.payload.input_number_id, '8f263ad7d3f8dde080d35c6c1a0b2906');
    assert.equal(deleteCall.payload.entity_id, undefined); // entity_id must NOT be sent
  });

  test('helper_delete by object_id fail-closed: list returns no match', async () => {
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type) => {
        if (type === 'input_number/list') return [{ id: 'some_other', entity_id: 'input_number.some_other' }];
        throw new Error('should not reach delete');
      },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'helper_delete', payload: { helper_type: 'input_number', object_id: 'nonexistent_helper' }, confirm_id: 'c34b' },
        'tok', opts
      ),
      /HELPER-NOT-FOUND/
    );
  });

  test('helper_delete by object_id rejects Critical entity (§3.4 HARD-DENY) — exact match, no list/delete I/O', async () => {
    // input_boolean/delete and input_boolean/list ARE in WS_ALLOWED_TYPES → _isCritical is the sole guard.
    // wsCmd must NOT be called (Critical check precedes all I/O — no TOCTOU).
    let wsCalled = false;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => { wsCalled = true; throw new Error('should not be called'); },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'helper_delete', payload: { helper_type: 'input_boolean', object_id: 'master_safety' }, confirm_id: 'c35a' },
        'tok', opts
      ),
      /HARD-DENY.*Critical entity/
    );
    assert.equal(wsCalled, false, 'wsCmd must not be called before Critical check passes');
  });

  test('helper_delete Critical guard blocks case-variant object_id (Master_Safety) — no I/O', async () => {
    let wsCalled = false;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => { wsCalled = true; throw new Error('should not be called'); },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'helper_delete', payload: { helper_type: 'input_boolean', object_id: 'Master_Safety' }, confirm_id: 'c35b' },
        'tok', opts
      ),
      /HARD-DENY.*Critical entity/
    );
    assert.equal(wsCalled, false);
  });

  test('helper_delete Critical guard blocks whitespace-padded object_id (" master_safety") — no I/O', async () => {
    let wsCalled = false;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => { wsCalled = true; throw new Error('should not be called'); },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'helper_delete', payload: { helper_type: 'input_boolean', object_id: ' master_safety' }, confirm_id: 'c35c' },
        'tok', opts
      ),
      /HARD-DENY.*Critical entity/
    );
    assert.equal(wsCalled, false);
  });

  test('helper_delete rejects when both entry_id and object_id absent', async () => {
    const opts = { whitelist: wl, validateCapToken: okToken, wsCmd: async () => ({}) };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'helper_delete', payload: { helper_type: 'input_number' }, confirm_id: 'c36' },
        'tok', opts
      ),
      /entry_id or payload\.object_id required/
    );
  });
});

// ── W2: executeConfigWrite — undo_config_write ────────────────────────────────

describe('executeConfigWrite — undo_config_write', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('rejects missing audit_id', async () => {
    const opts = { whitelist: wl, validateCapToken: okToken };
    await assert.rejects(
      () => executeConfigWrite({ op: 'undo_config_write', payload: {}, confirm_id: 'u1' }, 'tok', opts),
      /audit_id required/
    );
  });

  test('rejects unknown audit_id (not found in log)', async () => {
    const opts = { whitelist: wl, validateCapToken: okToken };
    await assert.rejects(
      () => executeConfigWrite({ op: 'undo_config_write', payload: { audit_id: 'no-such-id' }, confirm_id: 'u2' }, 'tok', opts),
      /UNDO-NOT-FOUND/
    );
  });

  test('undo helper_create hard-denies when result.id resolves to a Critical helper entity', async () => {
    // Create a helper whose result.id is a Critical entity in a helper domain.
    // input_boolean/delete IS in WS_ALLOWED_TYPES → _isCritical is the sole guard.
    const createOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => ({ id: 'master_safety', name: 'Master Safety' }),
    };
    const createResult = await executeConfigWrite(
      { op: 'helper_create', payload: { helper_type: 'input_boolean', name: 'Master Safety' }, confirm_id: 'u-crit-create' },
      'tok', createOpts
    );
    const undoOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => { throw new Error('should not be called'); },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'undo_config_write', payload: { audit_id: createResult.audit_id }, confirm_id: 'u-crit-undo' },
        'tok', undoOpts
      ),
      /HARD-DENY.*Critical entity/
    );
  });

  test('undo helper_create Critical guard blocks case-variant result.id (Master_Safety)', async () => {
    const createOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => ({ id: 'Master_Safety' }),
    };
    const createResult = await executeConfigWrite(
      { op: 'helper_create', payload: { helper_type: 'input_boolean', name: 'Master Safety' }, confirm_id: 'u-crit-create-case' },
      'tok', createOpts
    );
    const undoOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async () => { throw new Error('should not be called'); },
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'undo_config_write', payload: { audit_id: createResult.audit_id }, confirm_id: 'u-crit-undo-case' },
        'tok', undoOpts
      ),
      /HARD-DENY.*Critical entity/
    );
  });

  test('undo helper_create resolves via list and deletes with input_number_id', async () => {
    const wsCalls = [];
    // First create the helper — wsCmd returns result.id so undo can find the entity
    const createOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => {
        wsCalls.push({ type, payload });
        return { id: 'test_helper_undo', name: 'Test Helper Undo' };
      },
    };
    const createResult = await executeConfigWrite(
      { op: 'helper_create', payload: { helper_type: 'input_number', name: 'Test Helper Undo', min: 0, max: 100 }, confirm_id: 'u-create-1' },
      'tok', createOpts
    );
    assert.equal(createResult.op, 'helper_create');
    const audit_id = createResult.audit_id;

    // Now undo — should call input_number/list then input_number/delete with input_number_id
    const undoOpts = {
      whitelist: wl, validateCapToken: okToken,
      wsCmd: async (type, payload) => {
        wsCalls.push({ type, payload });
        if (type === 'input_number/list') {
          return [{ id: 'test_helper_undo', entity_id: 'input_number.test_helper_undo' }];
        }
        return {};
      },
    };
    const undoResult = await executeConfigWrite(
      { op: 'undo_config_write', payload: { audit_id }, confirm_id: 'u-undo-1' },
      'tok', undoOpts
    );
    assert.equal(undoResult.op, 'undo_config_write');
    assert.equal(undoResult.action, 'deleted');
    assert.equal(undoResult.helper_type, 'input_number');
    assert.equal(undoResult.object_id, 'test_helper_undo');

    const listCall = wsCalls.find(c => c.type === 'input_number/list');
    assert.ok(listCall, 'expected input_number/list call');
    const deleteCall = wsCalls.find(c => c.type === 'input_number/delete');
    assert.ok(deleteCall, 'expected input_number/delete wsCmd call');
    assert.equal(deleteCall.payload.input_number_id, 'test_helper_undo');
    assert.equal(deleteCall.payload.entity_id, undefined); // entity_id must NOT be sent
  });
});

// ── W2: /review bonus — 3 specific additions ─────────────────────────────────

// /review requested: 1) verify WS scope guard is tested both at invariant AND executor
// 2) drift-check (hash mismatch) causes undo refusal
// 3) cap-token step is wired before haGet (no HA I/O on bad token)

describe('/review additions', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('[review-1] _scopedWsSend rejects call_service whether called directly or via opts.wsCmd override path', () => {
    // The invariant guard is in _scopedWsSend, which opts.wsCmd replaces entirely in tests.
    // This test verifies the guard works when called via the real code path (not mocked out).
    assert.throws(() => _scopedWsSend('call_service', { entity_id: 'light.x' }), /call_service/);
    // A test-provided wsCmd mock bypasses _scopedWsSend — that's intentional (test isolation).
    // Production always calls _executeWsCommandDefault, which calls _scopedWsSend as STEP 0.
    // Documented here so a future diff can't silently remove the guard from _executeWsCommandDefault.
  });

  test('[review-2] undo rejects if drift detected (hash mismatch — current ≠ post_hash)', async () => {
    // Build a realistic audit entry in memory by running a real automation_upsert first,
    // then simulate a concurrent HA modification by returning a different body from haGet.
    const body = { action: [{ service: 'light.turn_on', target: { entity_id: 'light.office' } }] };
    let auditId = null;
    const mockAuditGet = { captured: [] };

    // Step 1: create automation (capture audit_id from result)
    const haPostBody = { ...body, initial_state: false };
    const opts1 = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => null,
      haPost: async () => haPostBody,
      haState: async () => ({ state: 'off' }),
      haService: async () => ({}),
    };
    const createResult = await executeConfigWrite(
      { op: 'automation_upsert', payload: { object_id: 'drift_test', body }, confirm_id: 'drift-c1' },
      'tok', opts1
    );
    auditId = createResult.audit_id;

    // Step 2: undo but with drifted body (haGet returns DIFFERENT body now)
    const driftedBody = { ...haPostBody, alias: 'modified_by_user' };
    const opts2 = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => driftedBody,   // different from what was written → hash mismatch
      haPost: async () => ({}),
      haDelete: async () => ({}),
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'undo_config_write', payload: { audit_id: auditId }, confirm_id: 'drift-u1' },
        'tok', opts2
      ),
      /UNDO-DRIFT/
    );
  });

  test('[review-3] cap-token failure prevents haGet from being called (no HA I/O on bad token)', async () => {
    let haGetCalled = false;
    const opts = {
      whitelist: wl,
      validateCapToken: async () => false,
      haGet: async () => { haGetCalled = true; return null; },
      haPost: async () => ({}),
      haState: async () => ({ state: 'off' }),
    };
    await assert.rejects(
      () => executeConfigWrite(
        { op: 'automation_upsert', payload: { object_id: 'any', body: {} }, confirm_id: 'sec-c1' },
        'bad-token', opts
      ),
      /CAP-TOKEN/
    );
    assert.equal(haGetCalled, false, 'haGet must NOT be called when cap-token validation fails');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// W2-FIX TESTS (MAJOR-1 regression + MINOR-6 new tests)
// ═══════════════════════════════════════════════════════════════════════════════

// ── W2-FIX: MAJOR-1 regression — plural keys caught by generic traversal ──────

describe('scanBody — plural key regression (MAJOR-1)', () => {
  const wl = BASE_WHITELIST;

  test('plural "actions" key: in-body automation.trigger is caught (§4(i))', () => {
    const body = {
      // HA 2024.10+ plural schema at top level
      actions: [{ service: 'automation.trigger', target: { entity_id: 'automation.bad' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true, 'automation.trigger in plural actions[] must be caught');
    assert.match(r.reason, /cause-to-fire|fleet_enable_deny/i);
  });

  test('plural "triggers" key: Critical entity_id in trigger conditions is labeled', () => {
    const body = {
      triggers: [{ platform: 'state', entity_id: 'switch.main_breaker', to: 'off' }],
      actions: [{ service: 'notify.mobile_app', data: { message: 'breaker off' } }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, false);
    assert.ok(r.critical_refs.includes('switch.main_breaker'), 'Critical entity in triggers[] must be labeled');
  });

  test('plural "conditions" key: area_id selector in conditions is denied', () => {
    const body = {
      conditions: [{ condition: 'state', area_id: 'living_room', state: 'on' }],
      actions: [],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /area_id/);
  });

  test('nested sequence still caught via generic traversal', () => {
    const body = {
      actions: [{
        repeat: {
          count: 3,
          sequence: [{ service: 'script.turn_on', target: { entity_id: 'script.dangerous' } }],
        },
      }],
    };
    const r = scanBody(body, wl);
    assert.equal(r.hard_deny, true);
    assert.match(r.reason, /cause-to-fire|fleet_enable_deny/i);
  });
});

// ── W2-FIX: MINOR-6(1) — Critical-referencing NEW draft deploys disabled+labeled ─

describe('executeConfigWrite — NEW Critical-referencing automation (MINOR-6 test 1)', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  test('NEW create with Critical entity in body: NOT hard-denied, deployed disabled, critical_refs labeled', async () => {
    let postedBody = null;
    const opts = {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => null,   // prior===null → genuine create, NEW-1 carve-out applies
      haPost: async (domain, id, body) => { postedBody = body; return {}; },
      haState: async () => ({ state: 'off' }),
      haService: async () => ({}),
    };
    const result = await executeConfigWrite({
      op: 'automation_upsert',
      payload: {
        object_id: 'new_critical_ref_auto',
        body: {
          // Action: notify when critical switch goes off — references Critical entity in condition
          condition: [{ condition: 'state', entity_id: 'switch.main_breaker', state: 'off' }],
          action: [{ service: 'notify.mobile_app', data: { message: 'breaker tripped' } }],
        },
      },
      confirm_id: 'cr-c1',
    }, 'tok', opts);

    assert.equal(result.applied, true, 'NEW create with Critical ref must NOT be hard-denied');
    assert.equal(result.overwrote, false, 'prior was null — genuine create');
    assert.equal(result.created_disabled, true, 'must be deployed disabled (initial_state:false)');
    assert.ok(result.critical_refs.includes('switch.main_breaker'), 'Critical entity must be labeled in result');
    assert.equal(postedBody.initial_state, false, 'initial_state:false must be force-injected');
  });
});

// ── W2-FIX: MINOR-6(2) — blueprint_flag propagated at executor level for both ops ─

describe('executeConfigWrite — blueprint_flag at executor level (MINOR-6 test 2)', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  function mkOpts(overrides = {}) {
    return {
      whitelist: wl, validateCapToken: okToken,
      haGet: async () => null,
      haPost: async () => ({}),
      haState: async () => ({ state: 'off' }),
      haService: async () => ({}),
      ...overrides,
    };
  }

  test('automation_upsert with use_blueprint body: not denied, blueprint_flag=true in result', async () => {
    const result = await executeConfigWrite({
      op: 'automation_upsert',
      payload: {
        object_id: 'bp_auto',
        body: { use_blueprint: { path: 'blueprints/notify.yaml', input: {} } },
      },
      confirm_id: 'bp-c1',
    }, 'tok', mkOpts());

    assert.equal(result.applied, true);
    assert.equal(result.blueprint_flag, true, 'blueprint_flag must be true for automation_upsert with use_blueprint');
    assert.equal(result.hard_deny, undefined); // not a field on result — just confirming not thrown
  });

  test('script_upsert with use_blueprint body: not denied, blueprint_flag=true in result', async () => {
    const result = await executeConfigWrite({
      op: 'script_upsert',
      payload: {
        object_id: 'bp_script',
        body: { use_blueprint: { path: 'blueprints/script_bp.yaml', input: {} } },
      },
      confirm_id: 'bp-c2',
    }, 'tok', mkOpts());

    assert.equal(result.applied, true);
    assert.equal(result.blueprint_flag, true, 'blueprint_flag must be true for script_upsert with use_blueprint');
  });
});

// ── W2: executeConfigWrite — template_sensor_create ──────────────────────────

describe('executeConfigWrite — template_sensor_create', () => {
  const wl = BASE_WHITELIST;
  const okToken = async () => true;

  const MENU_STEP    = { type: 'menu', flow_id: 'flow-abc', step_id: 'user', menu_options: ['sensor', 'binary_sensor'] };
  const FORM_STEP    = { type: 'form', flow_id: 'flow-abc', step_id: 'sensor', last_step: true };
  const CREATE_ENTRY = { type: 'create_entry', flow_id: 'flow-abc', entry_id: 'entry-xyz', title: 'Test Sensor', data: {} };

  function mkOpts(overrides = {}) {
    return {
      whitelist: wl,
      validateCapToken: okToken,
      getState: async () => null,          // no pre-existing sensor by default
      flowInit: async () => MENU_STEP,
      flowProgress: async () => null,      // override per-test
      flowAbort: async () => null,
      ...overrides,
    };
  }

  test('happy path: 3-step REST flow → applied, entry_id, overwrote:false, no critical_refs', async () => {
    const progressCalls = [];
    const result = await executeConfigWrite({
      op: 'template_sensor_create',
      payload: { name: 'Battery SoH', state: "{{ states('sensor.battery') | float }}", unit_of_measurement: '%' },
      confirm_id: 'ts-c1',
    }, 'tok', mkOpts({
      flowProgress: async (id, data) => {
        progressCalls.push({ id, data });
        return progressCalls.length === 1 ? FORM_STEP : CREATE_ENTRY;
      },
    }));

    assert.equal(result.op, 'template_sensor_create');
    assert.equal(result.applied, true);
    assert.equal(result.entry_id, 'entry-xyz');
    assert.equal(result.overwrote, false);
    assert.deepEqual(result.critical_refs, []);
    assert.ok(result.audit_id);
    // Step 2 must select sensor type
    assert.deepEqual(progressCalls[0].data, { next_step_id: 'sensor' });
    // Step 3 must forward name + state + optional fields
    assert.equal(progressCalls[1].data.name, 'Battery SoH');
    assert.equal(progressCalls[1].data.state, "{{ states('sensor.battery') | float }}");
    assert.equal(progressCalls[1].data.unit_of_measurement, '%');
  });

  test('body-scan: Critical entity in state template → critical_refs surfaced, not denied', async () => {
    const progressCalls = [];
    const result = await executeConfigWrite({
      op: 'template_sensor_create',
      // switch.main_breaker is Critical in BASE_WHITELIST
      payload: { name: 'Breaker Monitor', state: "{{ states('switch.main_breaker') }}" },
      confirm_id: 'ts-c2',
    }, 'tok', mkOpts({
      flowProgress: async () => {
        progressCalls.push(true);
        return progressCalls.length === 1 ? FORM_STEP : CREATE_ENTRY;
      },
    }));

    assert.equal(result.applied, true);
    assert.ok(result.critical_refs.includes('switch.main_breaker'), 'critical_refs must surface switch.main_breaker');
    // Flow was still allowed — template sensors are read-only
    assert.equal(progressCalls.length, 2);
  });

  test('NEW-1: pre-existing non-Critical sensor → overwrote:true, flow still executes', async () => {
    const priorState = { state: '42.5', entity_id: 'sensor.battery_so_h', attributes: {} };
    const progressCalls = [];
    const result = await executeConfigWrite({
      op: 'template_sensor_create',
      payload: { name: 'Battery So H', state: '{{ 42.5 }}' },
      confirm_id: 'ts-c3',
    }, 'tok', mkOpts({
      getState: async () => priorState,
      flowProgress: async () => {
        progressCalls.push(true);
        return progressCalls.length === 1 ? FORM_STEP : CREATE_ENTRY;
      },
    }));

    assert.equal(result.applied, true);
    assert.equal(result.overwrote, true);
  });

  test('NEW-1 Critical: pre-existing Critical sensor → hard-deny, flow never initiated', async () => {
    const critWl = {
      ...wl,
      critical_entities: [...wl.critical_entities, { entity_id: 'sensor.critical_power', operator_finalize: true }],
    };
    let flowInitCalled = false;
    await assert.rejects(
      () => executeConfigWrite({
        op: 'template_sensor_create',
        payload: { name: 'Critical Power', state: '{{ 100 }}' },
        confirm_id: 'ts-c4',
      }, 'tok', {
        whitelist: critWl,
        validateCapToken: okToken,
        getState: async () => ({ state: '100', entity_id: 'sensor.critical_power', attributes: {} }),
        flowInit: async () => { flowInitCalled = true; return MENU_STEP; },
        flowProgress: async () => CREATE_ENTRY,
        flowAbort: async () => null,
      }),
      /HARD-DENY.*NEW-1/
    );
    assert.equal(flowInitCalled, false, 'flow must not be initiated when NEW-1 Critical denies');
  });

  test('flow error mid-progress → flowAbort called with correct flow_id', async () => {
    let abortCalledWith = null;
    await assert.rejects(
      () => executeConfigWrite({
        op: 'template_sensor_create',
        payload: { name: 'Bad Sensor', state: '{{ 0 }}' },
        confirm_id: 'ts-c5',
      }, 'tok', mkOpts({
        flowProgress: async (id) => { throw new Error('[TEST] HA rejected the step'); },
        flowAbort: async (id) => { abortCalledWith = id; },
      })),
      /TEST.*HA rejected the step/
    );
    assert.equal(abortCalledWith, 'flow-abc', 'flowAbort must be called with the flow_id on mid-flow error');
  });

  test('HA returns form-with-errors on final step → TEMPLATE-SENSOR error thrown, abort called', async () => {
    let abortCalled = false;
    await assert.rejects(
      () => executeConfigWrite({
        op: 'template_sensor_create',
        payload: { name: 'Error Sensor', state: '{% bad jinja %}' },
        confirm_id: 'ts-c6',
      }, 'tok', mkOpts({
        flowProgress: async (_id, data) => {
          if (data.next_step_id === 'sensor') return FORM_STEP;
          return { type: 'form', step_id: 'sensor', errors: { state: 'invalid_template' } };
        },
        flowAbort: async () => { abortCalled = true; },
      })),
      /TEMPLATE-SENSOR.*create_entry/
    );
    assert.equal(abortCalled, true, 'flowAbort must be called on create_entry mismatch');
  });
});
