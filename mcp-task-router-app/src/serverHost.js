'use strict';

/**
 * serverHost.js — Majordomus in-process server host.
 *
 * Starts or attaches to the Task Router server, then mounts the HA executor
 * on a dedicated loopback-only mini-server (default 127.0.0.1:3101, overridden
 * via HA_EXEC_PORT).
 *
 * G3 owner-tier enforcement: the HA executor server binds exclusively to
 * 127.0.0.1 — physically unreachable from Tailscale/LAN interfaces. This is
 * stronger than middleware-only filtering and requires no access to the
 * task-router's internal Express app instance.
 *
 * Attach-don't-restart: if GET /health already returns 200, the Task Router is
 * live and startServer() is skipped — calling it again would hit the tenant
 * project-lock (409) and disrupt other tenants.
 */

const crypto = require('crypto');
const fs     = require('fs');
const http   = require('http');
const path   = require('path');
const bridge = require('./ha-bridge');

const HA_EXEC_HOST = '127.0.0.1';

// Read ports at call time so tests can override via process.env.
function taskRouterPort() { return parseInt(process.env.TASK_ROUTER_PORT || '3100', 10); }
function haExecPort()     { return parseInt(process.env.HA_EXEC_PORT      || '3101', 10); }

// Cap-token session file written by /ops W4 at ha_devops launch.
// Env-var-overridable so tests can provide a temp path without touching fleet/.
function haDevopsSessionPath() {
  return process.env.HA_DEVOPS_SESSION_PATH ||
    path.resolve(__dirname, '../../fleet/ha_devops_session.json');
}

// ── Health probe ──────────────────────────────────────────────────────────────

async function isTaskRouterUp() {
  const port = taskRouterPort();
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/health`, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// ── Cap-token validation (W3) ─────────────────────────────────────────────────

/**
 * Build the validateCapToken hook wired into executeConfigWrite opts.
 *
 * Storage contract for /ops W4:
 *   fleet/ha_devops_session.json  ← written at ha_devops launch, deleted on pty exit
 *   { "cap_token_hash": "<sha256-hex>", "agent": "ha_devops", "registered_at": "<ISO>" }
 *
 * Token format: trha_<32 hex chars>  (trha_ prefix + 16 CSPRNG bytes hex-encoded)
 *
 * Fail-closed invariants:
 *   - file absent or unparseable (pre-W4)  → false
 *   - agent field !== "ha_devops"          → false
 *   - hash mismatch                        → false
 *   - presented token null/non-string      → false
 *
 * Session-binding: /ops W4 overwrites the file on every relaunch, so a stale
 * prior-session token's hash will not match the current session's hash → false.
 * On pty exit /ops deletes the file → all tokens fail closed.
 */
function _makeValidateCapToken() {
  return async function validateCapToken(capToken) {
    if (!capToken || typeof capToken !== 'string') return false;
    let stored;
    try {
      const raw = fs.readFileSync(haDevopsSessionPath(), 'utf8');
      stored = JSON.parse(raw);
    } catch {
      return false; // file absent or corrupt — fail-closed (pre-W4)
    }
    if (!stored || stored.agent !== 'ha_devops') return false;
    const { cap_token_hash } = stored;
    if (typeof cap_token_hash !== 'string' || !cap_token_hash) return false;
    const presented = crypto.createHash('sha256').update(capToken).digest('hex');
    return presented === cap_token_hash;
  };
}

// ── HA executor mini-server (127.0.0.1-only) ─────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/**
 * Map an executeConfigWrite error message to an HTTP status code.
 *   [CAP-TOKEN]            → 401  missing / invalid / stale token
 *   [UNSUPPORTED-OP]       → 400  op not in supported set
 *   [UNDO-UNSUPPORTED]     → 400  undo not implemented for this op
 *   [HARD-DENY]            → 403  NEW-1 overwrite / disable-scope denial
 *   [BODY-SCAN-DENY]       → 403  body-scan hard-deny
 *   [FLEET_ENABLE_DENY]    → 403  cause-to-fire denial
 *   [HARD-REFUSE]          → 403  executor hard-refuse
 *   [UNDO-DRIFT]           → 409  drift detected — current state changed since write
 *   [UNDO-REJECTED]        → 409  audit entry is not a success entry
 *   [UNDO-NOT-FOUND]       → 404  audit_id unknown
 *   [WS-SCOPE-VIOLATION]   → 500  internal invariant violated (should never reach prod)
 *   all others             → 502  HA transport error / unknown
 */
function _configWriteStatus(msg) {
  if (msg.includes('[CAP-TOKEN]'))             return 401;
  if (msg.includes('[UNSUPPORTED-OP]') ||
      msg.includes('[UNDO-UNSUPPORTED]'))      return 400;
  if (msg.includes('[HARD-DENY]') ||
      msg.includes('[BODY-SCAN-DENY]') ||
      msg.includes('[FLEET_ENABLE_DENY]') ||
      msg.includes('[HARD-REFUSE]'))           return 403;
  if (msg.includes('[UNDO-DRIFT]') ||
      msg.includes('[UNDO-REJECTED]'))         return 409;
  if (msg.includes('[UNDO-NOT-FOUND]'))        return 404;
  if (msg.includes('[WS-SCOPE-VIOLATION]'))    return 500;
  return 502;
}

/**
 * Create the loopback HA executor mini-server.
 *
 * Routes (both loopback-only by virtue of the server binding to 127.0.0.1):
 *   POST /api/ha/execute       — Tier-B service calls; no cap-token required
 *   POST /api/ha/config-write  — Gated config writes; cap-token in Authorization header
 *
 * The two paths are deliberately separate (§2.2 config-writes-only scope):
 * Tier-B service calls keep their existing path with no cap-token requirement.
 *
 * @param {{ validateCapToken?: (tok: string) => Promise<boolean> }} [serverOpts]
 *   serverOpts.validateCapToken — override for testing; production uses _makeValidateCapToken().
 *   NEVER pass wsCmd here or forward it to executeConfigWrite — the scoped WS client
 *   inside ha-bridge must run directly (§5.3 / MAJOR-2).
 */
function createHaExecutorServer(serverOpts = {}) {
  const validateCapToken = serverOpts.validateCapToken || _makeValidateCapToken();

  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const isTierB       = req.method === 'POST' && req.url === '/api/ha/execute';
    const isConfigWrite = req.method === 'POST' && req.url === '/api/ha/config-write';

    if (!isTierB && !isConfigWrite) {
      res.writeHead(404);
      return res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400);
      return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }

    if (isTierB) {
      // ── Tier-B service-call path (unchanged, no cap-token) ────────────────
      try {
        const result = await bridge.executeApprovedAction(body);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        // [HARD-REFUSE] = Tier C / Critical / unknown — executor refused before any HA call.
        const status = err.message.includes('[HARD-REFUSE]') ? 403 : 502;
        res.writeHead(status);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // ── Config-write path (cap-token required) ────────────────────────────
    // Extract cap-token from Authorization: Bearer <token> header.
    // A null capToken causes validateCapToken to return false → [CAP-TOKEN] at STEP 1.
    const authHeader = (req.headers['authorization'] || '').trim();
    const capToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const { op, payload, confirm_id } = body;
    try {
      // Wire validateCapToken into opts.
      // MUST NOT set opts.wsCmd — the scoped WS client in ha-bridge must run (§5.3/MAJOR-2).
      const result = await bridge.executeConfigWrite(
        { op, payload, confirm_id },
        capToken,
        { validateCapToken },  // wsCmd intentionally absent
      );
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      const msg = err.message || '';
      res.writeHead(_configWriteStatus(msg));
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
  });
}

function listenHaServer(server, port, host) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Start the Majordomus server host.
 *
 * @param {Function} [startServerFn] - The task-router's startServer() function.
 *   Called with `opts` only when the server is not already up. Must return
 *   { shutdown: () => Promise<void> }. Defaults to lazy-requiring
 *   'mcp-task-router/src/index' (resolved inside the extension bundle).
 * @param {object}   [opts]          - Forwarded to startServerFn as-is.
 * @returns {{ haExecUrl: string|null, haConfigWriteUrl: string|null, shutdown: () => Promise<void> }}
 */
async function startServerHost(startServerFn, opts = {}) {
  // 1. Start or attach to the Task Router server.
  const alreadyUp = await isTaskRouterUp();
  let taskRouterShutdown = null;

  if (!alreadyUp) {
    const fn = startServerFn || require('mcp-task-router/src/index').startServer;
    const { shutdown } = await fn(opts);
    taskRouterShutdown = shutdown;
    console.log('[serverHost] Task Router server started in-process.');
  } else {
    console.log('[serverHost] Task Router server already up — attaching (no restart).');
  }

  // 2. Load HA whitelist once. Fail-closed: skip executor if validation fails.
  let whitelistLoaded = false;
  try {
    bridge.loadWhitelist();
    whitelistLoaded = true;
    console.log('[serverHost] HA whitelist loaded.');
  } catch (err) {
    console.error(
      '[serverHost] HA whitelist failed — executor NOT started (fail-closed):',
      err.message,
    );
  }

  // 3. Mount HA executor loopback-only. Not started when whitelist is invalid.
  let haServer = null;
  let haExecUrl = null;
  let haConfigWriteUrl = null;

  if (whitelistLoaded) {
    const port = haExecPort();
    haServer = createHaExecutorServer();
    await listenHaServer(haServer, port, HA_EXEC_HOST);
    haExecUrl        = `http://${HA_EXEC_HOST}:${port}/api/ha/execute`;
    haConfigWriteUrl = `http://${HA_EXEC_HOST}:${port}/api/ha/config-write`;
    console.log(`[serverHost] POST /api/ha/execute      → ${haExecUrl} (loopback-only, G3)`);
    console.log(`[serverHost] POST /api/ha/config-write → ${haConfigWriteUrl} (loopback-only, G3, cap-token required)`);
  }

  return {
    haExecUrl,
    haConfigWriteUrl,
    shutdown: async () => {
      if (haServer) await new Promise(r => haServer.close(r));
      if (taskRouterShutdown) await taskRouterShutdown();
    },
  };
}

module.exports = {
  startServerHost,
  isTaskRouterUp,
  createHaExecutorServer,
  // Exported for testing (env-var override pattern)
  haDevopsSessionPath,
  _configWriteStatus,
};
