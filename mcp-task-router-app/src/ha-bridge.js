'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WHITELIST_PATH = path.resolve(__dirname, '../../fleet/ha_whitelist.json');
const VALID_TIERS = new Set(['A', 'B', 'C']);

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

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Classify (domain, service, entity) → tier ('A' | 'B' | 'C').
 *
 * Precedence (most specific wins):
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
  mintConfirmId,
  executeApprovedAction,
  // Internals exposed for testing
  _matchesGlob,
  _isCritical,
  _getCriticalEntry,
};
