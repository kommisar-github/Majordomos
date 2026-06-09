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

const http = require('http');
const bridge = require('./ha-bridge');

const HA_EXEC_HOST = '127.0.0.1';

// Read ports at call time so tests can override via process.env.
function taskRouterPort() { return parseInt(process.env.TASK_ROUTER_PORT || '3100', 10); }
function haExecPort()     { return parseInt(process.env.HA_EXEC_PORT      || '3101', 10); }

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

function createHaExecutorServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST' || req.url !== '/api/ha/execute') {
      res.writeHead(404);
      return res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    }

    let action;
    try {
      action = await readBody(req);
    } catch {
      res.writeHead(400);
      return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }

    try {
      const result = await bridge.executeApprovedAction(action);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      // [HARD-REFUSE] = Tier C / Critical / unknown — executor refused before any HA call.
      const status = err.message.includes('[HARD-REFUSE]') ? 403 : 502;
      res.writeHead(status);
      res.end(JSON.stringify({ ok: false, error: err.message }));
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
 * @returns {{ haExecUrl: string|null, shutdown: () => Promise<void> }}
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

  if (whitelistLoaded) {
    const port = haExecPort();
    haServer = createHaExecutorServer();
    await listenHaServer(haServer, port, HA_EXEC_HOST);
    haExecUrl = `http://${HA_EXEC_HOST}:${port}/api/ha/execute`;
    console.log(`[serverHost] POST /api/ha/execute → ${haExecUrl} (loopback-only, G3)`);
  }

  return {
    haExecUrl,
    shutdown: async () => {
      if (haServer) await new Promise(r => haServer.close(r));
      if (taskRouterShutdown) await taskRouterShutdown();
    },
  };
}

module.exports = { startServerHost, isTaskRouterUp, createHaExecutorServer };
