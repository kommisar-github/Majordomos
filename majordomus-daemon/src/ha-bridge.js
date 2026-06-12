'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws'); // pure-JS, Node 18-compatible (MAJOR-5: no globalThis.WebSocket)

const WHITELIST_PATH = path.resolve(__dirname, '../../fleet/ha_whitelist.json');
const VALID_TIERS = new Set(['A', 'B', 'C']);

// Sentinel returned by classify() / checkFleetEnableDeny() for §3.3 cause-to-fire denials.
// Distinct from 'C' so the executor can emit a precise audit reason.
const FLEET_ENABLE_DENY = 'FLEET_ENABLE_DENY';

// ── W2 constants ─────────────────────────────────────────────────────────────

// Append-only HA config mutation audit log.
// Detective-only — not tamper-proof (a host-compromised actor could edit it).
// Intentionally gitignored (holds confirm_ids); use HA's own .storage backups for DR.
const AUDIT_PATH = path.resolve(__dirname, '../../fleet/ha_config_audit.jsonl');

const CONFIG_WRITE_OPS = new Set([
  'helper_create', 'helper_update', 'helper_delete',
  'template_sensor_create', 'template_sensor_delete',
  'automation_upsert', 'automation_delete',
  'script_upsert', 'script_delete',
  'undo_config_write',
]);

// WS command types the scoped WS client is permitted to send (§5.3).
// 'call_service' and all non-config types are explicitly BANNED — they would
// bypass fleet_enable_deny and classify() gates entirely (§5.5 invariant).
const WS_ALLOWED_TYPES = new Set([
  'input_number/create',   'input_number/update',   'input_number/delete',
  'input_boolean/create',  'input_boolean/update',  'input_boolean/delete',
  'input_text/create',     'input_text/update',     'input_text/delete',
  'input_select/create',   'input_select/update',   'input_select/delete',
  'input_datetime/create', 'input_datetime/update', 'input_datetime/delete',
  'input_button/create',   'input_button/update',   'input_button/delete',
  'counter/create',        'counter/update',        'counter/delete',
  'timer/create',          'timer/update',          'timer/delete',
  'schedule/create',       'schedule/update',       'schedule/delete',
  'config_entries/flow/init', 'config_entries/flow/progress',
  'config_entries/flow/cancel', 'config_entries/remove',
]);

const DENIED_SELECTORS = ['area_id', 'device_id', 'label_id', 'floor_id'];

// Keys already fully processed at the current node level in _scanBodyNode —
// skip in generic recursion to avoid duplicate deny-reason strings.
// NOTE: 'action' is intentionally NOT here. At action-step level it is a string
// (never recursed by generic traversal). At automation top-level it is the array
// of action steps — must not be skipped or the whole body goes unchecked.
const _SCAN_SKIP_GENERIC = new Set([
  'use_blueprint',              // early-exit branch — don't re-enter
  'service',                    // string service-key (already parsed for cause-to-fire; strings never recursed)
  'service_template', 'data_template', // already flagged at current level
  'entity_id',                  // already classified (string/array)
  'target',                     // already checked (selectors + entity_id within)
]);

let _whitelist = null;

// ── Validation ──────────────────────────────────────────────────────────────

function validateWhitelist(w) {
  if (!w || typeof w !== 'object') throw new Error('Invalid whitelist: not an object');
  if (w.version !== 1) throw new Error(`Unsupported whitelist version: ${w.version}`);

  const globSupport = w.glob_support === true;

  // M5: reject any entry containing '*' when glob support is off — a non-glob resolver
  // fed a '*' pattern silently matches nothing, de-classifying Critical entities.
  const allEntityIds = [
    ...(w.critical_entities || []).map(e => e.entity_id),
    ...(w.per_entity_overrides || []).map(e => e.entity_id),
  ];
  for (const id of allEntityIds) {
    if (id.includes('*') && !globSupport) {
      throw new Error(
        `Whitelist loader (M5): glob entry "${id}" found but glob_support is false — ` +
        'refusing to load (would silently match nothing and silently de-classify Critical entities).'
      );
    }
  }

  for (const [domain, tier] of Object.entries(w.domain_defaults || {})) {
    if (!VALID_TIERS.has(tier)) throw new Error(`Invalid tier "${tier}" for domain "${domain}"`);
  }

  for (const entry of (w.per_entity_overrides || [])) {
    if (!VALID_TIERS.has(entry.tier)) {
      throw new Error(`Invalid tier "${entry.tier}" for entity override "${entry.entity_id}"`);
    }
  }

  // Validate fleet_enable_deny block if present (§3.3 Q-HA-CONFIGWRITE)
  const fed = w.fleet_enable_deny;
  if (fed !== undefined) {
    if (!Array.isArray(fed.domain_service)) {
      throw new Error('fleet_enable_deny.domain_service must be an array');
    }
    for (const entry of fed.domain_service) {
      if (typeof entry.domain !== 'string' || typeof entry.service !== 'string') {
        throw new Error(
          `fleet_enable_deny.domain_service entry missing string domain/service: ${JSON.stringify(entry)}`
        );
      }
    }
    const hw = fed.homeassistant_wildcard;
    if (hw !== undefined) {
      if (!Array.isArray(hw.services)) throw new Error('fleet_enable_deny.homeassistant_wildcard.services must be an array');
      if (!Array.isArray(hw.deny_if_entity_domain_prefix)) {
        throw new Error('fleet_enable_deny.homeassistant_wildcard.deny_if_entity_domain_prefix must be an array');
      }
    }
  }
}

// ── Loader ───────────────────────────────────────────────────────────────────

function loadWhitelist(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath || WHITELIST_PATH, 'utf8'));
  validateWhitelist(raw);
  _whitelist = raw;
  return raw;
}

// ── Glob helpers ─────────────────────────────────────────────────────────────

function _matchesGlob(pattern, entityId, globSupport) {
  if (pattern.endsWith('*')) {
    if (!globSupport) {
      throw new Error(`Glob pattern "${pattern}" used but glob_support is false (M5)`);
    }
    return entityId.startsWith(pattern.slice(0, -1));
  }
  return pattern === entityId;
}

function _isCritical(entityId, whitelist) {
  const gs = whitelist.glob_support === true;
  return (whitelist.critical_entities || []).some(e => _matchesGlob(e.entity_id, entityId, gs));
}

function _getCriticalEntry(entityId, whitelist) {
  const gs = whitelist.glob_support === true;
  return (whitelist.critical_entities || []).find(e => _matchesGlob(e.entity_id, entityId, gs));
}

// ── Fleet-enable-deny (§3.3 Q-HA-CONFIGWRITE) ────────────────────────────────

/**
 * Check if (domain, service, entity) matches the fleet_enable_deny cause-to-fire set.
 *
 * Returns FLEET_ENABLE_DENY if the call is denied; null if not.
 * Consulted by classify() (service-call path) and the body-scan (W2, §4(i)).
 *
 * Forms 1–6 are matched via domain_service entries (service '*' = any service).
 * Form 7: homeassistant domain + service in allowed set + entity prefix matches.
 *
 * Graceful: if whitelist has no fleet_enable_deny block, returns null.
 *
 * @param {string} domain
 * @param {string} service
 * @param {string} entity - needed for form 7 (homeassistant target domain check)
 * @param {object?} whitelist
 * @returns {typeof FLEET_ENABLE_DENY | null}
 */
function checkFleetEnableDeny(domain, service, entity, whitelist) {
  const wl = whitelist || _whitelist;
  const fed = (wl || {}).fleet_enable_deny;
  if (!fed) return null;

  // Forms 1–6: exact (domain,service) or wildcard service '*'
  for (const entry of (fed.domain_service || [])) {
    if (entry.domain !== domain) continue;
    if (entry.service === '*' || entry.service === service) return FLEET_ENABLE_DENY;
  }

  // Form 7: homeassistant domain, turn_on/toggle, entity target is automation.*/script.*
  const hw = fed.homeassistant_wildcard;
  if (hw && domain === 'homeassistant') {
    if ((hw.services || []).includes(service)) {
      const entityLower = (entity || '').trim().toLowerCase();
      if ((hw.deny_if_entity_domain_prefix || []).some(prefix => entityLower.startsWith(prefix))) {
        return FLEET_ENABLE_DENY;
      }
    }
  }

  return null;
}

// ── classifyEntity (§4 Q-HA-CONFIGWRITE) ────────────────────────────────────

/**
 * Service-agnostic entity classifier for the body-scan (§4 Q-HA-CONFIGWRITE).
 *
 * Body entities have no `service` argument — do NOT call the 3-arg classify() here.
 * Use this to classify bare entity_ids extracted from an automation/script body.
 *
 * Normalizes entity_id (trim + lowercase) before matching (§4(f)).
 *
 * Precedence (mirrors classify(), minus the service-dependent steps):
 *   1. Critical floor (_isCritical → C, or B if promote_critical)
 *   2. Per-entity override (non-Critical only)
 *   3. Domain-default (prefix before first '.')
 *   4. Fail-closed → C
 *
 * Does NOT consult fleet_enable_deny (no service context; in-body cause-to-fire
 * is checked separately via checkFleetEnableDeny() per action in the body-scan §4(i)).
 *
 * @param {string} entity - bare entity_id (e.g. "switch.main_breaker")
 * @param {object?} whitelist
 * @returns {'A'|'B'|'C'}
 */
function classifyEntity(entity, whitelist) {
  const wl = whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded — call loadWhitelist() first');

  // Normalize: trim + lowercase (§4(f))
  const e = (entity || '').trim().toLowerCase();
  if (!e) return 'C'; // fail-closed on empty

  const gs = wl.glob_support === true;

  // 1. Critical floor
  if (_isCritical(e, wl)) {
    const entry = _getCriticalEntry(e, wl);
    if (entry && entry.promote_critical === true) return 'B';
    return 'C';
  }

  // 2. Per-entity override (non-Critical only)
  const override = (wl.per_entity_overrides || []).find(o => _matchesGlob(o.entity_id, e, gs));
  if (override) return override.tier;

  // 3. Domain-default (prefix before first '.')
  const domain = e.split('.')[0];
  const domainTier = (wl.domain_defaults || {})[domain];
  if (domainTier) return domainTier;

  // 4. Fail-closed
  return 'C';
}

// ── Disable-scope (§3.4 Q-HA-CONFIGWRITE) ────────────────────────────────────

/**
 * Evaluate disable-scope rules (§3.4) for a proposed fleet operation.
 *
 * W1 = this rule-evaluation helper driven by the whitelist data.
 * W2 = the executor wires this into the validation sequence.
 *
 * @param {{
 *   op: 'turn_off'|'delete'|'upsert',
 *   domain: string,
 *   priorBodyHasCritical: boolean,
 *   priorIsNull: boolean,
 *   isOwnDeployBackstop: boolean
 * }} params
 * @param {object?} whitelist
 * @returns {{ verdict: 'PERMITTED_BACKSTOP'|'PERMITTED_TURN_OFF_TIER_B'|'HARD_DENY', reason: string }}
 */
function checkDisableScope(params, whitelist) {
  const wl = whitelist || _whitelist;
  const ds = ((wl || {}).disable_scope) || {};
  const { op, domain, priorBodyHasCritical, priorIsNull, isOwnDeployBackstop } = params;

  // Case (a): executor's own deploy backstop — force-disable of object under deployment
  if (isOwnDeployBackstop) {
    if (priorIsNull || !priorBodyHasCritical) {
      return {
        verdict: 'PERMITTED_BACKSTOP',
        reason: 'executor own-deploy backstop permitted (§3.1 case-a): prior==null or no Critical prior refs',
      };
    }
    // Defensive: W2 must refuse the upsert itself at step 4 before ever reaching the backstop
    return {
      verdict: 'HARD_DENY',
      reason: 'own-deploy backstop attempted against a pre-existing Critical interlock — upsert must have been refused at step 4 before backstop runs (§3.4 NEW-1)',
    };
  }

  const hd = ds.hard_deny_ops_if_prior_has_critical || {};
  const hdDomains = hd.domains || ['automation', 'script'];
  const hdOps = hd.ops || ['turn_off', 'delete', 'upsert'];

  // Hard-deny: pre-existing object with Critical-referencing prior body
  if (!priorIsNull && priorBodyHasCritical && hdDomains.includes(domain) && hdOps.includes(op)) {
    return {
      verdict: 'HARD_DENY',
      reason: `${op} on pre-existing ${domain} whose prior body references a Critical entity — hard-denied (§3.4 disable-scope)`,
    };
  }

  // Case (b): fleet turn_off / other permitted ops with no Critical prior → Tier-B confirm
  const permTier = (ds.permitted_fleet_turn_off || {}).tier || 'B';
  return {
    verdict: 'PERMITTED_TURN_OFF_TIER_B',
    reason: `${op} on ${domain} with no Critical prior refs — Tier-${permTier} confirm required`,
  };
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Classify (domain, service, entity) → tier ('A' | 'B' | 'C').
 *
 * Precedence (most specific wins):
 *   0. Fleet-enable-deny (§3.3 Q-HA-CONFIGWRITE) — returns FLEET_ENABLE_DENY sentinel before
 *      all other checks; supersedes per-entity overrides for the 7 cause-to-fire forms.
 *   1. Critical entity list — hard Tier-C floor (M7: never lifted by per-entity allow;
 *      only promote_critical raises it to B, never A)
 *   2. Per-entity override (non-Critical entities only)
 *   3. Domain+service override (e.g. cover.stop_cover → A)
 *   4. Domain default
 *   5. Fail-closed → Tier C (unknown domain/entity)
 */
function classify(domain, service, entity, whitelist) {
  const wl = whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded — call loadWhitelist() first');
  const gs = wl.glob_support === true;

  // 0. Fleet-enable-deny — cause-to-fire hard-deny supersedes all tier logic (§3.3)
  const fedResult = checkFleetEnableDeny(domain, service, entity, wl);
  if (fedResult) return fedResult;

  // 1. Critical floor — M7: per-entity allow overrides cannot lift a Critical entity below C
  if (_isCritical(entity, wl)) {
    const entry = _getCriticalEntry(entity, wl);
    if (entry && entry.promote_critical === true) return 'B';
    return 'C';
  }

  // 2. Per-entity override (non-Critical only)
  const override = (wl.per_entity_overrides || []).find(
    e => _matchesGlob(e.entity_id, entity, gs)
  );
  if (override) return override.tier;

  // 3. Domain+service override (e.g. cover STOP is always safe → A)
  const svcOverride = ((wl.domain_service_overrides || {})[domain] || {})[service];
  if (svcOverride && VALID_TIERS.has(svcOverride)) return svcOverride;

  // 4. Domain default
  const domainTier = (wl.domain_defaults || {})[domain];
  if (domainTier) return domainTier;

  // 5. Fail-closed: unknown → Tier C
  return 'C';
}

/**
 * Classify a custom (non-standard-HA-domain) MCP tool by name.
 * Returns tier from custom_tools map or 'C' (fail-closed).
 */
function classifyCustomTool(toolName, whitelist) {
  const wl = whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded');
  return (wl.custom_tools || {})[toolName] || 'C';
}

// ── Confirmation helper ───────────────────────────────────────────────────────

/**
 * Mint a confirm_id with ≥64-bit CSPRNG entropy (N1).
 * UUIDv4 = 122 bits of randomness — satisfies the unguessability requirement.
 */
function mintConfirmId() {
  return crypto.randomUUID();
}

// ── HA REST transport ─────────────────────────────────────────────────────────

async function _callHaService(domain, service, data) {
  const baseUrl = process.env.HA_BASE_URL;
  const token = process.env.HA_TOKEN;
  if (!baseUrl || !token) throw new Error('HA_BASE_URL and HA_TOKEN env vars must be set');

  const url = new URL(`/api/services/${domain}/${service}`, baseUrl);
  const body = JSON.stringify(data);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode === 401) {
          return reject(new Error('HA 401 Unauthorized — rotate the long-lived token'));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`HA service call failed: HTTP ${res.statusCode}: ${text}`));
        }
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Audit helpers (W2) ───────────────────────────────────────────────────────

function _appendAudit(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(AUDIT_PATH, line, 'utf8');
}

function _findAuditEntry(auditId) {
  if (!fs.existsSync(AUDIT_PATH)) return null;
  const lines = fs.readFileSync(AUDIT_PATH, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try { const e = JSON.parse(line); if (e.audit_id === auditId) return e; } catch { /* skip */ }
  }
  return null;
}

function _hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

// ── Body-scan (§4 a–i, W2) ───────────────────────────────────────────────────

function _checkSelectorsInObj(obj, acc, prefix) {
  for (const sel of DENIED_SELECTORS) {
    if (obj[sel] !== undefined) {
      acc.deny_reasons.push(`${prefix}${sel} selector not permitted in v1 (§4(d) — unbounded set)`);
    }
  }
}

function _classifyEntityValue(val, wl, acc, svDomain, svService) {
  if (!val) return;
  const vals = Array.isArray(val) ? val : [val]; // (g) string OR list
  for (const v of vals) {
    if (typeof v !== 'string') continue;
    // (c) template in entity position
    if (v.includes('{{') || v.includes('{%')) {
      acc.deny_reasons.push(`template in entity field: "${v.slice(0, 50)}" (§4(c))`);
      continue;
    }
    const e = v.trim().toLowerCase(); // (f) normalize
    if (!e || !e.includes('.')) continue;
    // (e) group.* — expand-or-deny (groups not supported in v1)
    if (e.startsWith('group.')) {
      acc.deny_reasons.push(`group entity "${e}" — expand-or-deny not supported in v1 (§4(e))`);
      continue;
    }
    // (i) form 7: homeassistant.turn_on/toggle + automation/script entity
    if (svDomain && svService) {
      if (checkFleetEnableDeny(svDomain, svService, e, wl) === FLEET_ENABLE_DENY) {
        acc.deny_reasons.push(`in-body cause-to-fire (form 7): ${svDomain}.${svService} → ${e} (§4(i))`);
      }
    }
    // (b) classify every entity by its OWN domain prefix, not the service's domain
    const tier = classifyEntity(e, wl);
    if (tier === 'C' && !acc.critical_refs.includes(e)) acc.critical_refs.push(e);
  }
}

function _scanBodyNode(node, wl, acc) {
  if (Array.isArray(node)) { for (const item of node) _scanBodyNode(item, wl, acc); return; }
  if (!node || typeof node !== 'object') return;

  // (h) use_blueprint: FLAG, do not deny — blueprint body is opaque (§4(h))
  if ('use_blueprint' in node) {
    acc.blueprint_flag = true;
    const inp = node.use_blueprint && node.use_blueprint.input;
    if (inp && typeof inp === 'object') {
      for (const v of Object.values(inp)) {
        if (typeof v === 'string') _classifyEntityValue(v, wl, acc, null, null);
      }
    }
    return; // don't recurse — blueprint actions are host-side and not visible
  }

  // (c) legacy template keys — hard-deny
  if (node.service_template !== undefined) {
    acc.deny_reasons.push('legacy service_template key present (§4(c) — cannot statically evaluate Jinja)');
  }
  if (node.data_template !== undefined) {
    acc.deny_reasons.push('legacy data_template key present (§4(c))');
  }

  // Service/action field: (c) template check + (i) in-body cause-to-fire
  let svDomain = null, svService = null;
  const rawSvc = node.service !== undefined ? node.service : node.action;
  if (rawSvc !== undefined && typeof rawSvc === 'string') {
    if (rawSvc.includes('{{') || rawSvc.includes('{%')) {
      acc.deny_reasons.push(`template in service field: "${rawSvc.slice(0, 60)}" (§4(c))`);
    } else {
      const dot = rawSvc.indexOf('.');
      if (dot > 0) {
        const d = rawSvc.slice(0, dot);
        const s = rawSvc.slice(dot + 1);
        // (i) forms 1–6: entity-independent fleet_enable_deny check
        if (checkFleetEnableDeny(d, s, '', wl) === FLEET_ENABLE_DENY) {
          acc.deny_reasons.push(`in-body cause-to-fire: service "${rawSvc}" is in fleet_enable_deny (§4(i))`);
        } else {
          svDomain = d; svService = s; // propagate for form-7 entity check below
        }
      }
    }
  }

  // target field: (c) templated target, entity extraction, selectors
  if (node.target !== undefined) {
    if (typeof node.target === 'string' && (node.target.includes('{{') || node.target.includes('{%'))) {
      acc.deny_reasons.push(`templated target field (§4(c))`);
    } else if (node.target && typeof node.target === 'object') {
      _checkSelectorsInObj(node.target, acc, 'target.');
      _classifyEntityValue(node.target.entity_id, wl, acc, svDomain, svService);
    }
  }

  // (d) selectors in this node
  _checkSelectorsInObj(node, acc, '');

  // entity_id and data.entity_id
  _classifyEntityValue(node.entity_id, wl, acc, svDomain, svService);
  if (node.data && typeof node.data === 'object') {
    _classifyEntityValue(node.data.entity_id, wl, acc, svDomain, svService);
  }

  // Generic recursion over all remaining container values (MAJOR-1 fix).
  // Covers HA 2024.10+ plural keys (triggers/conditions/actions), repeat.while/until,
  // if-conditions, nested data objects, and any future schema container.
  // Keys already fully processed at this node level are skipped to avoid
  // duplicate deny-reason strings.
  for (const [k, v] of Object.entries(node)) {
    if (_SCAN_SKIP_GENERIC.has(k)) continue;
    if (Array.isArray(v)) _scanBodyNode(v, wl, acc);
    else if (v && typeof v === 'object') _scanBodyNode(v, wl, acc);
  }
}

/**
 * Scan an automation/script config for security constraints (§4 a–i).
 * Run on the FULLY-RESOLVED config (after force-injecting initial_state:false).
 *
 * @returns {{ critical_refs: string[], hard_deny: boolean, blueprint_flag: boolean, reason: string }}
 */
function scanBody(body, whitelist) {
  const wl = whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded — call loadWhitelist() first');
  const acc = { critical_refs: [], deny_reasons: [], blueprint_flag: false };
  _scanBodyNode(body, wl, acc);
  return {
    critical_refs: [...new Set(acc.critical_refs)],
    hard_deny: acc.deny_reasons.length > 0,
    blueprint_flag: acc.blueprint_flag,
    reason: acc.deny_reasons.join('; '),
  };
}

// ── Prior-body Critical check (§3.4 GET-first NEW-1) ─────────────────────────

function _priorBodyHasCritical(body, wl) {
  if (!body) return false;
  // Conservative: use the full hardened body-scan so Critical refs hidden behind
  // selectors, templates, or group.* in the PRIOR body also trigger hard-deny.
  // Any critical_refs OR any hard_deny reason (selector/template/group) → protected.
  const scan = scanBody(body, wl);
  return scan.critical_refs.length > 0 || scan.hard_deny;
}

// ── Scoped WS client — invariant enforcer (§5.3) ─────────────────────────────

/**
 * Enforce the WS scoped-command invariant (§5.3).
 * MUST be called first in any WS send path. Exported for direct unit testing
 * without a live WS connection — the invariant is provable at the type level.
 *
 * 'call_service' would bypass fleet_enable_deny + classify() entirely if it
 * reached HA over WS. It is explicitly banned and listed by name.
 */
function _scopedWsSend(type, payload) {
  if (type === 'call_service') {
    throw new Error(
      '[WS-SCOPE-VIOLATION] WS client explicitly rejects "call_service" — ' +
      'all service calls must go through executeApprovedAction/classify (§5.3). ' +
      'A call_service WS message bypasses fleet_enable_deny and the classify() gate entirely.'
    );
  }
  if (!WS_ALLOWED_TYPES.has(type)) {
    throw new Error(
      `[WS-SCOPE-VIOLATION] WS client rejects type="${type}" — ` +
      'only helper-collection and config-flow command types are permitted (§5.3). ' +
      'Non-config types could trip automations via event/trigger paths, bypassing all gates.'
    );
  }
  return { type, payload }; // validated; actual network send handled by caller
}

/**
 * One-shot HA WebSocket command (Node 22+ native WebSocket).
 * auth_required → auth(token) → auth_ok → send command → receive result → close.
 * Handles: auth_invalid (reject, do not retry), mid-command socket drop (reject),
 * 15-second timeout (abort + reject).
 * Partial multi-step flows (template config-flow): caller aborts on failure.
 */
async function _executeWsCommandDefault(type, commandPayload) {
  _scopedWsSend(type, commandPayload); // INVARIANT: checked BEFORE any network I/O

  const baseUrl = process.env.HA_BASE_URL;
  const token = process.env.HA_TOKEN;
  if (!baseUrl || !token) throw new Error('HA_BASE_URL and HA_TOKEN must be set for WS commands');

  const wsUrl = baseUrl.replace(/^https?/, m => m === 'https' ? 'wss' : 'ws') + '/api/websocket';

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); // `ws` npm package — Node 18+ compatible (no globalThis.WebSocket)
    const TIMEOUT_MS = 15000;
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error(`[WS-TIMEOUT] No response within ${TIMEOUT_MS}ms for type="${type}"`));
    }, TIMEOUT_MS);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ id: 1, type, ...commandPayload }));
      } else if (msg.type === 'auth_invalid') {
        clearTimeout(timer);
        try { ws.terminate(); } catch {}
        reject(new Error('[WS-AUTH-INVALID] HA rejected the token — rotate HA_TOKEN'));
      } else if (msg.type === 'result' && msg.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (msg.success) resolve(msg.result);
        else reject(new Error(`[WS-COMMAND-FAILED] type="${type}": ${JSON.stringify(msg.error)}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`[WS-ERROR] WebSocket error connecting to ${wsUrl}: ${err.message}`));
    });

    ws.on('close', () => {
      clearTimeout(timer);
      // If we get here without resolving/rejecting, the connection closed unexpectedly
    });
  });
}

// ── HA REST helpers for config API ────────────────────────────────────────────

async function _haRestRequest(method, urlPath, body) {
  const baseUrl = process.env.HA_BASE_URL;
  const token = process.env.HA_TOKEN;
  if (!baseUrl || !token) throw new Error('HA_BASE_URL and HA_TOKEN env vars must be set');
  const url = new URL(urlPath, baseUrl);
  const mod = url.protocol === 'https:' ? https : http;
  const bodyStr = body != null ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = mod.request(url, opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode === 401) return reject(new Error('HA 401 — rotate HA_TOKEN'));
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`HA ${method} ${urlPath}: HTTP ${res.statusCode}: ${text}`));
        try { resolve(JSON.parse(text)); } catch { resolve(text || null); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const _getHaConfigRest    = (domain, id)       => _haRestRequest('GET',    `/api/config/${domain}/config/${id}`);
const _postHaConfigRest   = (domain, id, body) => _haRestRequest('POST',   `/api/config/${domain}/config/${id}`, body);
const _deleteHaConfigRest = (domain, id)       => _haRestRequest('DELETE', `/api/config/${domain}/config/${id}`);
const _getHaStateRest     = entityId           => _haRestRequest('GET',    `/api/states/${entityId}`);

// ── executeConfigWrite — main executor (§5, W2) ───────────────────────────────

async function _validateCapToken(capToken, opts) {
  const validate = opts.validateCapToken;
  if (!validate) {
    throw new Error(
      '[CAP-TOKEN] validateCapToken hook not wired — executeConfigWrite requires this (W3 wires it). ' +
      'Hard-refuse (§2.3 STEP 1, before any HA I/O).'
    );
  }
  const ok = await validate(capToken);
  if (!ok) {
    throw new Error('[CAP-TOKEN] Invalid, absent, or stale cap-token — hard-refuse (§2.3 STEP 1).');
  }
}

async function _automationUpsert(payload, confirm_id, wl, opts) {
  const { object_id, body } = payload || {};
  if (!object_id || !body) throw new Error('automation_upsert: payload.object_id and payload.body required');

  const haGet    = opts.haGet    || _getHaConfigRest;
  const haPost   = opts.haPost   || _postHaConfigRest;
  const haState  = opts.haState  || _getHaStateRest;
  const haService = opts.haService || _callHaService;

  // STEP 4: GET-first — prior body + NEW-1 overwrite protection (§5.2-4)
  const prior = await haGet('automation', object_id);
  const priorBodyHasCritical = prior !== null && _priorBodyHasCritical(prior, wl);
  if (prior !== null && priorBodyHasCritical) {
    throw new Error(
      `[HARD-DENY] automation_upsert: pre-existing "automation.${object_id}" has a prior body ` +
      'referencing a Critical entity — overwrite of a safety interlock is denied (§3.4 NEW-1).'
    );
  }

  // STEP 5: Body-scan on RESOLVED body (after force-injecting initial_state:false)
  const resolvedBody = { ...body, initial_state: false }; // §3.1 non-overridable injection
  const scan = scanBody(resolvedBody, wl);
  if (scan.hard_deny) throw new Error(`[BODY-SCAN-DENY] ${scan.reason}`);

  // STEP 7: Capture prior hash at EXECUTE-TIME (§5.2-7)
  const prior_hash = prior ? _hashBody(prior) : null;

  // STEP 8–10: Apply + verify + audit (failure audit on any HA rejection, §5.2-10)
  try {
    await haPost('automation', object_id, resolvedBody);

    // STEP 9: Verify disabled; issue backstop turn_off if HA reports state=on
    let stateAnomaly = false;
    const stateObj = await haState(`automation.${object_id}`);
    if (stateObj && stateObj.state === 'on') {
      stateAnomaly = true;
      const dsResult = checkDisableScope(
        { op: 'turn_off', domain: 'automation', priorBodyHasCritical, priorIsNull: prior === null, isOwnDeployBackstop: true },
        wl
      );
      if (dsResult.verdict === 'PERMITTED_BACKSTOP') {
        await haService('automation', 'turn_off', { entity_id: `automation.${object_id}` });
      }
    }

    // STEP 10: Audit success
    const postObj = await haGet('automation', object_id);
    const post_hash = postObj ? _hashBody(postObj) : null;
    const audit_id = crypto.randomUUID();
    _appendAudit({
      audit_id, confirm_id, op: 'automation_upsert', object_id,
      prior, prior_hash, post_hash,
      critical_refs: scan.critical_refs, blueprint_flag: scan.blueprint_flag,
      state_anomaly: stateAnomaly, overwrote: prior !== null, outcome: 'success',
    });

    return {
      op: 'automation_upsert', applied: true, audit_id,
      created_disabled: true, overwrote: prior !== null,
      critical_refs: scan.critical_refs, blueprint_flag: scan.blueprint_flag,
    };
  } catch (err) {
    _appendAudit({
      op: 'automation_upsert', confirm_id, object_id,
      prior_hash, critical_refs: scan.critical_refs, outcome: 'failure', error: err.message,
    });
    throw err;
  }
}

async function _automationOrScriptDelete(domain, payload, confirm_id, wl, opts) {
  const { object_id } = payload || {};
  if (!object_id) throw new Error(`${domain}_delete: payload.object_id required`);

  const haGet    = opts.haGet    || _getHaConfigRest;
  const haDelete = opts.haDelete || _deleteHaConfigRest;

  // STEP 4: GET-first — disable-scope check (§3.4)
  const prior = await haGet(domain, object_id);
  if (prior !== null && _priorBodyHasCritical(prior, wl)) {
    throw new Error(
      `[HARD-DENY] ${domain}_delete: pre-existing "${domain}.${object_id}" prior body ` +
      'references a Critical entity — cannot delete a safety interlock (§3.4).'
    );
  }

  const prior_hash = prior ? _hashBody(prior) : null;
  try {
    await haDelete(domain, object_id);
  } catch (err) {
    _appendAudit({ op: `${domain}_delete`, confirm_id, object_id, prior_hash, outcome: 'failure', error: err.message });
    throw err;
  }
  const audit_id = crypto.randomUUID();
  _appendAudit({ audit_id, confirm_id, op: `${domain}_delete`, object_id, prior, prior_hash, post_hash: null, outcome: 'success' });
  return { op: `${domain}_delete`, applied: true, audit_id };
}

async function _scriptUpsert(payload, confirm_id, wl, opts) {
  const { object_id, body } = payload || {};
  if (!object_id || !body) throw new Error('script_upsert: payload.object_id and payload.body required');

  const haGet  = opts.haGet  || _getHaConfigRest;
  const haPost = opts.haPost || _postHaConfigRest;

  // STEP 4: GET-first + NEW-1 (same as automation)
  const prior = await haGet('script', object_id);
  if (prior !== null && _priorBodyHasCritical(prior, wl)) {
    throw new Error(
      `[HARD-DENY] script_upsert: pre-existing "script.${object_id}" prior body ` +
      'references a Critical entity — overwrite of a safety interlock is denied (§3.4 NEW-1).'
    );
  }

  // STEP 5: Body-scan (no initial_state injection for scripts — run-deny is the control, §3.1)
  const scan = scanBody(body, wl);
  if (scan.hard_deny) throw new Error(`[BODY-SCAN-DENY] ${scan.reason}`);

  const prior_hash = prior ? _hashBody(prior) : null;
  try {
    await haPost('script', object_id, body);
    const postObj = await haGet('script', object_id);
    const post_hash = postObj ? _hashBody(postObj) : null;
    const audit_id = crypto.randomUUID();
    _appendAudit({
      audit_id, confirm_id, op: 'script_upsert', object_id,
      prior, prior_hash, post_hash,
      critical_refs: scan.critical_refs, blueprint_flag: scan.blueprint_flag,
      overwrote: prior !== null, outcome: 'success',
    });
    return {
      op: 'script_upsert', applied: true, audit_id,
      created_disabled: false, overwrote: prior !== null,
      critical_refs: scan.critical_refs, blueprint_flag: scan.blueprint_flag,
    };
  } catch (err) {
    _appendAudit({
      op: 'script_upsert', confirm_id, object_id,
      prior_hash, critical_refs: scan.critical_refs, outcome: 'failure', error: err.message,
    });
    throw err;
  }
}

async function _helperCreate(payload, confirm_id, wl, opts) {
  const { helper_type, ...config } = payload || {};
  if (!helper_type) throw new Error('helper_create: payload.helper_type required');
  const type = `${helper_type}/create`;
  _scopedWsSend(type, config); // MAJOR-2: structural scope-guard — validates even when opts.wsCmd is injected
  const wsCmd = opts.wsCmd || _executeWsCommandDefault;
  let result;
  try {
    result = await wsCmd(type, config);
  } catch (err) {
    _appendAudit({ op: 'helper_create', confirm_id, payload, outcome: 'failure', error: err.message });
    throw err;
  }
  const audit_id = crypto.randomUUID();
  _appendAudit({ audit_id, confirm_id, op: 'helper_create', payload, result, outcome: 'success' });
  return { op: 'helper_create', applied: true, audit_id, result };
}

async function _helperUpdate(payload, confirm_id, wl, opts) {
  const { helper_type, entry_id, ...config } = payload || {};
  if (!helper_type || !entry_id) throw new Error('helper_update: payload.helper_type and entry_id required');
  const type = `${helper_type}/update`;
  const cmdPayload = { entry_id, ...config };
  _scopedWsSend(type, cmdPayload); // structural scope-guard
  const wsCmd = opts.wsCmd || _executeWsCommandDefault;
  let result;
  try {
    result = await wsCmd(type, cmdPayload);
  } catch (err) {
    _appendAudit({ op: 'helper_update', confirm_id, payload, outcome: 'failure', error: err.message });
    throw err;
  }
  const audit_id = crypto.randomUUID();
  _appendAudit({ audit_id, confirm_id, op: 'helper_update', payload, result, outcome: 'success' });
  return { op: 'helper_update', applied: true, audit_id, result };
}

async function _helperDelete(payload, confirm_id, wl, opts) {
  const { helper_type, entry_id, object_id } = payload || {};
  if (!helper_type) throw new Error('helper_delete: payload.helper_type required');
  if (!entry_id && !object_id) throw new Error('helper_delete: payload.entry_id or payload.object_id required');

  const type = `${helper_type}/delete`;
  let cmdPayload;
  if (object_id) {
    // Storage-based helpers have no config-entry UUID — HA delete command uses entity_id.
    // Normalize (trim+lowercase) before _isCritical — mirrors classifyEntity §4(f) to close
    // the case/whitespace bypass (object_id="Master_Safety" / " master_safety" must hit the guard).
    // Trim object_id BEFORE concatenation so interior whitespace (e.g. " master") is removed.
    const entityId = `${helper_type}.${(object_id || '').trim()}`.toLowerCase();
    if (_isCritical(entityId, wl)) {
      throw new Error(
        `[HARD-DENY] helper_delete: "${entityId}" is a Critical entity — cannot delete a safety interlock (§3.4).`
      );
    }
    cmdPayload = { entity_id: entityId };
  } else {
    // Config-entry-based helper (config_entry_id is not null): use entry_id
    cmdPayload = { entry_id };
  }

  // §6 limitation: helper_delete is irreversible via undo_config_write. Storage-based helpers
  // carry no `prior` config retrievable by REST — there is no undo branch for this op.
  // The audit record below is detective-only; manual re-creation is the recovery path.
  _scopedWsSend(type, cmdPayload); // structural scope-guard
  const wsCmd = opts.wsCmd || _executeWsCommandDefault;
  let result;
  try {
    result = await wsCmd(type, cmdPayload);
  } catch (err) {
    _appendAudit({ op: 'helper_delete', confirm_id, payload, outcome: 'failure', error: err.message });
    throw err;
  }
  const audit_id = crypto.randomUUID();
  _appendAudit({ audit_id, confirm_id, op: 'helper_delete', payload, result, outcome: 'success' });
  return { op: 'helper_delete', applied: true, audit_id, result };
}

async function _templateSensorCreate(payload, confirm_id, wl, opts) {
  _scopedWsSend('config_entries/flow/init', {}); // structural scope-guard (checked for all flow types used)
  const wsCmd = opts.wsCmd || _executeWsCommandDefault;
  // Multi-step config-flow: init → submit → create entry
  let flowId = null;
  try {
    const initResult = await wsCmd('config_entries/flow/init', { handler: 'template' });
    flowId = initResult && initResult.flow_id;
    if (!flowId) throw new Error('[TEMPLATE-SENSOR] config-flow init did not return a flow_id');
    const createResult = await wsCmd('config_entries/flow/progress', { flow_id: flowId, user_input: payload });
    const audit_id = crypto.randomUUID();
    _appendAudit({ audit_id, confirm_id, op: 'template_sensor_create', payload, result: createResult, outcome: 'success' });
    return { op: 'template_sensor_create', applied: true, audit_id, result: createResult };
  } catch (err) {
    // Partial-write atomicity: abort dangling flow to avoid orphan config entries (§5.3)
    if (flowId) {
      try { await wsCmd('config_entries/flow/cancel', { flow_id: flowId }); } catch { /* best-effort */ }
    }
    _appendAudit({ op: 'template_sensor_create', confirm_id, payload, outcome: 'failure', error: err.message });
    throw err;
  }
}

async function _templateSensorDelete(payload, confirm_id, wl, opts) {
  const { entry_id } = payload || {};
  if (!entry_id) throw new Error('template_sensor_delete: payload.entry_id required');
  _scopedWsSend('config_entries/remove', { entry_id }); // structural scope-guard
  const wsCmd = opts.wsCmd || _executeWsCommandDefault;
  let result;
  try {
    result = await wsCmd('config_entries/remove', { entry_id });
  } catch (err) {
    _appendAudit({ op: 'template_sensor_delete', confirm_id, payload, outcome: 'failure', error: err.message });
    throw err;
  }
  const audit_id = crypto.randomUUID();
  _appendAudit({ audit_id, confirm_id, op: 'template_sensor_delete', payload, result, outcome: 'success' });
  return { op: 'template_sensor_delete', applied: true, audit_id, result };
}

async function _executeUndo({ payload, confirm_id }, capToken, opts) {
  const { audit_id } = payload || {};
  if (!audit_id) throw new Error('undo_config_write: payload.audit_id required');

  const entry = _findAuditEntry(audit_id);
  if (!entry) throw new Error(`[UNDO-NOT-FOUND] No audit entry found for audit_id="${audit_id}"`);
  if (entry.outcome !== 'success') {
    throw new Error(`[UNDO-REJECTED] Audit entry "${audit_id}" outcome="${entry.outcome}" — only success entries can be undone`);
  }

  const wl = opts.whitelist || _whitelist;
  const haGet    = opts.haGet    || _getHaConfigRest;
  const haPost   = opts.haPost   || _postHaConfigRest;
  const haDelete = opts.haDelete || _deleteHaConfigRest;

  const { op: originalOp, object_id, post_hash, prior } = entry;
  const domain = originalOp.startsWith('automation') ? 'automation' : 'script';

  // Drift check: ensure HA hasn't changed since we wrote (§6)
  if (object_id) {
    const current = await haGet(domain, object_id);
    const currentHash = current ? _hashBody(current) : null;
    if (currentHash !== post_hash) {
      throw new Error(
        `[UNDO-DRIFT] Current state of "${domain}.${object_id}" hash differs from post_hash recorded at write-time ` +
        `(expected ${post_hash?.slice(0, 8)}, got ${currentHash?.slice(0, 8)}) — drift detected, refusing undo (§6).`
      );
    }

    // Apply inverse
    let undoResult;
    if (originalOp.endsWith('_upsert')) {
      if (prior === null) {
        // Was a create → inverse is delete
        await haDelete(domain, object_id);
        undoResult = { action: 'deleted', object_id };
      } else {
        // Was an update → inverse is re-apply prior (deployed disabled)
        const priorRestoredBody = domain === 'automation' ? { ...prior, initial_state: false } : prior;
        await haPost(domain, object_id, priorRestoredBody);
        undoResult = { action: 'restored_prior', object_id };
      }
    } else if (originalOp.endsWith('_delete')) {
      // Was a delete → inverse is re-create from prior
      if (!prior) throw new Error(`[UNDO-REJECTED] Cannot undo delete of "${domain}.${object_id}" — prior body was not captured`);
      const priorBody = domain === 'automation' ? { ...prior, initial_state: false } : prior;
      await haPost(domain, object_id, priorBody);
      undoResult = { action: 'recreated', object_id };
    } else {
      throw new Error(`[UNDO-UNSUPPORTED] Undo not implemented for op="${originalOp}"`);
    }

    const undoAuditId = crypto.randomUUID();
    _appendAudit({
      audit_id: undoAuditId, confirm_id, op: 'undo_config_write',
      undoes_audit_id: audit_id, result: undoResult, outcome: 'success',
    });
    return { op: 'undo_config_write', applied: true, audit_id: undoAuditId, undoes: audit_id, ...undoResult };
  }

  // helper_create undo: delete the created storage-based helper by entity_id
  if (originalOp === 'helper_create') {
    const helper_type = entry.payload && entry.payload.helper_type;
    // HA's storage create response includes `id` = the object_id of the created helper
    const created_object_id = entry.result && (
      entry.result.id ||
      (entry.result.entity_id && entry.result.entity_id.split('.')[1])
    );
    if (!helper_type || !created_object_id) {
      throw new Error(
        `[UNDO-UNSUPPORTED] helper_create undo: audit entry missing helper_type or created entity id ` +
        `(result.id="${entry.result && entry.result.id}") — cannot determine which helper to delete.`
      );
    }
    // Normalize (trim+lowercase) before _isCritical — same §4(f) invariant as classifyEntity
    // and _helperDelete: closes case/whitespace bypass (result.id="Master_Safety"/" master_safety").
    // Trim created_object_id BEFORE concatenation so interior whitespace is removed.
    const entityId = `${helper_type}.${(created_object_id || '').trim()}`.toLowerCase();
    if (_isCritical(entityId, wl)) {
      throw new Error(
        `[HARD-DENY] undo helper_create: "${entityId}" is a Critical entity — delete is denied (§3.4).`
      );
    }
    // §6 limitation: helper_create undo has no drift check. Storage-based helpers have no
    // REST-readable `post_hash` equivalent — we cannot verify HA state matches what we wrote.
    // Recorded in the audit below; operator should verify entity state in HA before undoing
    // if concurrent edits are possible.
    const wsCmd = opts.wsCmd || _executeWsCommandDefault;
    const deleteType = `${helper_type}/delete`;
    const cmdPayload = { entity_id: entityId };
    _scopedWsSend(deleteType, cmdPayload);
    let deleteResult;
    try {
      deleteResult = await wsCmd(deleteType, cmdPayload);
    } catch (err) {
      _appendAudit({ op: 'undo_config_write', confirm_id, undoes_audit_id: audit_id, outcome: 'failure', error: err.message });
      throw err;
    }
    const undoAuditId = crypto.randomUUID();
    _appendAudit({
      audit_id: undoAuditId, confirm_id, op: 'undo_config_write',
      undoes_audit_id: audit_id, result: { action: 'deleted', helper_type, object_id: created_object_id }, outcome: 'success',
    });
    return { op: 'undo_config_write', applied: true, audit_id: undoAuditId, undoes: audit_id, action: 'deleted', helper_type, object_id: created_object_id };
  }

  throw new Error(`[UNDO-UNSUPPORTED] Undo for op="${originalOp}" without object_id not implemented`);
}

/**
 * Gated HA config-write executor (§5, W2). Sibling to executeApprovedAction.
 * Callable ONLY with a valid ha_devops cap-token (W3 wires validateCapToken).
 *
 * Cap-token validation is STEP 1 — BEFORE any HA I/O (§2.3 / §5.2-1).
 *
 * @param {{ op: string, payload: object, confirm_id: string }} req
 * @param {string} capToken  - ha_devops session cap-token (W3/W4 mints+injects it)
 * @param {{
 *   validateCapToken?: (tok: string) => Promise<boolean>,
 *   whitelist?: object,
 *   wsCmd?: (type: string, payload: object) => Promise<any>,
 *   haGet?: (domain: string, id: string) => Promise<object|null>,
 *   haPost?: (domain: string, id: string, body: object) => Promise<any>,
 *   haDelete?: (domain: string, id: string) => Promise<any>,
 *   haState?: (entityId: string) => Promise<object|null>,
 *   haService?: (domain: string, service: string, data: object) => Promise<any>,
 * }} opts  - inject mock implementations for testing; W3 wires validateCapToken in prod
 */
async function executeConfigWrite({ op, payload, confirm_id }, capToken, opts = {}) {
  const wl = opts.whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded — call loadWhitelist() first');

  // ── STEP 1: Cap-token validation — BEFORE any HA I/O (§5.2-1) ─────────────
  await _validateCapToken(capToken, opts);

  // ── STEP 2: Supported-op set, fail-closed (§5.1) ──────────────────────────
  if (!CONFIG_WRITE_OPS.has(op)) {
    throw new Error(`[UNSUPPORTED-OP] op="${op}" not in supported set — fail-closed (§5.1).`);
  }

  if (op === 'undo_config_write') return _executeUndo({ payload, confirm_id }, capToken, opts);

  switch (op) {
    case 'automation_upsert':      return _automationUpsert(payload, confirm_id, wl, opts);
    case 'automation_delete':      return _automationOrScriptDelete('automation', payload, confirm_id, wl, opts);
    case 'script_upsert':          return _scriptUpsert(payload, confirm_id, wl, opts);
    case 'script_delete':          return _automationOrScriptDelete('script', payload, confirm_id, wl, opts);
    case 'helper_create':          return _helperCreate(payload, confirm_id, wl, opts);
    case 'helper_update':          return _helperUpdate(payload, confirm_id, wl, opts);
    case 'helper_delete':          return _helperDelete(payload, confirm_id, wl, opts);
    case 'template_sensor_create': return _templateSensorCreate(payload, confirm_id, wl, opts);
    case 'template_sensor_delete': return _templateSensorDelete(payload, confirm_id, wl, opts);
    default: throw new Error(`[UNSUPPORTED-OP] unreachable — "${op}"`);
  }
}

// ── Loopback executor ─────────────────────────────────────────────────────────

/**
 * Loopback executor — PM calls this after delete-before-execute (N4) on a valid
 * in-window APPROVE (for Tier B), or directly for Tier A (no confirmation needed).
 *
 * Re-checks the whitelist independently (defense-in-depth, N5).
 *
 * Hard-refuses:
 *   - Tier C (default-deny, unknown domain/entity, lock, alarm)
 *   - Critical-listed entity without promote_critical (M7)
 *   - Any action not reachable by policy
 *
 * For Tier B: trusts PM's loopback invocation (G3: only the local PM process can
 * reach this function; executor cannot independently verify operator approval, N5).
 *
 * Entry-point signature for /app to wire as a loopback-only route:
 *   async executeApprovedAction({ domain, service, entity, data? }) → { tier, status, data }
 *
 * @param {{ domain: string, service: string, entity: string, data?: object }} action
 * @param {object?} whitelist — override for testing; uses module-loaded whitelist if omitted
 */
async function executeApprovedAction(action, whitelist) {
  const wl = whitelist || _whitelist;
  if (!wl) throw new Error('Whitelist not loaded — call loadWhitelist() first');

  const { domain, service, entity, data = {} } = action || {};
  if (!domain || !service || !entity) {
    throw new Error('executeApprovedAction: domain, service, and entity are all required');
  }

  const tier = classify(domain, service, entity, wl);

  if (tier === FLEET_ENABLE_DENY) {
    throw new Error(
      `[FLEET_ENABLE_DENY] ${entity} (${domain}.${service}) is a cause-to-fire service — ` +
      'the fleet may never cause an automation/script to fire by any service (§3.3 linchpin). ' +
      'Rejected by ha-bridge executor regardless of any "approved" claim.'
    );
  }

  if (tier === 'C') {
    throw new Error(
      `[HARD-REFUSE] ${entity} (${domain}.${service}) resolved to Tier C — ` +
      'no execution path exists. Rejected by ha-bridge executor regardless of any "approved" claim (N5).'
    );
  }

  // Defense-in-depth: if Critical without promotion, refuse even if classify returned B
  // (unreachable given classify logic, but guards against future whitelist bugs)
  if (_isCritical(entity, wl)) {
    const critEntry = _getCriticalEntry(entity, wl);
    if (!critEntry || critEntry.promote_critical !== true) {
      throw new Error(
        `[HARD-REFUSE] ${entity} is a Critical entity without promote_critical — ` +
        'executor hard-refuses regardless of any "approved" claim (M7/N5).'
      );
    }
  }

  // Tier A: execute directly. Tier B: execute trusting PM's approval (G3/N5).
  const result = await _callHaService(domain, service, { entity_id: entity, ...data });
  return { tier, ...result };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  loadWhitelist,
  validateWhitelist,
  classify,
  classifyCustomTool,
  classifyEntity,
  checkFleetEnableDeny,
  checkDisableScope,
  mintConfirmId,
  executeApprovedAction,
  // W2
  scanBody,
  executeConfigWrite,
  // Constants
  FLEET_ENABLE_DENY,
  // Internals exposed for testing
  _matchesGlob,
  _isCritical,
  _getCriticalEntry,
  _scopedWsSend,
  _hashBody,
  _priorBodyHasCritical,
  _appendAudit,
  _findAuditEntry,
};
