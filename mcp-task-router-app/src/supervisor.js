'use strict';

/**
 * supervisor.js — node-pty lifecycle manager for Majordomos agents.
 *
 * Spawns agent terminals via node-pty with spawn parity to the extension's
 * terminals.ts. For ha_devops only: mints the per-session cap-token, writes
 * fleet/ha_devops_session.json (hash only, never the raw token), registers with
 * the Task Router — all before pty.spawn() — then cleans up on pty exit.
 *
 * Cap-token mint ordering (§2.3 write-before-register):
 *   1. write fleet/ha_devops_session.json (hash only, mode 0600)
 *   2. POST /api/register  ha_devops + capabilities:[ha-config-deploy]
 *   3. inject HA_DEVOPS_CAP_TOKEN into pty env → pty.spawn()
 *   4. on exit: delete session file + POST /api/unregister
 *
 * All other agents are spawned with no mint; their own Startup Sequence handles
 * Task Router registration (TASK_ROUTER_AGENT env var set, agent calls register_agent).
 */

const crypto = require('crypto');
const fs     = require('fs');
const http   = require('http');
const path   = require('path');
const { buildLaunchCommand } = require('./launchCommand');

// Default session file path — env-var-overridable for tests.
function haDevopsSessionPath() {
  return process.env.HA_DEVOPS_SESSION_PATH ||
    path.resolve(__dirname, '../../fleet/ha_devops_session.json');
}

function _taskRouterPort() {
  return parseInt(process.env.TASK_ROUTER_PORT || '3100', 10);
}

// ── Task Router HTTP helpers ───────────────────────────────────────────────────

function _trPost(urlPath, body, port) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (process.env.TASK_ROUTER_API_KEY) {
      headers['X-Task-Router-Key'] = process.env.TASK_ROUTER_API_KEY;
    }
    const req = http.request(
      { hostname: '127.0.0.1', port: port || _taskRouterPort(), path: urlPath, method: 'POST', headers },
      res => { res.resume(); resolve(res.statusCode); },
    );
    req.on('error', err => {
      // Best-effort: log but do not throw — unregister errors on exit must not crash.
      console.error(`[supervisor] Task Router ${urlPath} error: ${err.message}`);
      resolve(null);
    });
    req.write(data);
    req.end();
  });
}

// ── node-pty lazy default ─────────────────────────────────────────────────────

function _defaultPtySpawn(bin, args, spawnOpts) {
  return require('node-pty').spawn(bin, args, spawnOpts);
}

// ── ha_devops cap-token mint (§2.3 / ha_deploy.md §8) ────────────────────────

/**
 * Mint the ha_devops cap-token, write the session file, and register.
 *
 * Write-before-register ordering: session file is on disk before the HTTP
 * /api/register call completes — avoids a registered-but-unvalidatable window.
 *
 * @param {{
 *   project?:         string,
 *   trPort?:          number,
 *   sessionFilePath?: string,
 * }} opts
 * @returns {Promise<{ capToken: string }>}  raw token — inject into pty env only
 */
async function _mintAndRegisterHaDevops(opts = {}) {
  const project     = opts.project         || process.env.TASK_ROUTER_PROJECT || 'Majordomos';
  const port        = opts.trPort          || _taskRouterPort();
  const sessionFile = opts.sessionFilePath || haDevopsSessionPath();

  // 1. Mint: trha_ + 128-bit CSPRNG (parity with launch-ha-devops.sh)
  const rawHex   = crypto.randomBytes(16).toString('hex');
  const capToken = `trha_${rawHex}`;

  // 2. Hash — only this goes to disk; raw token never touches the filesystem
  const cap_token_hash = crypto.createHash('sha256').update(capToken).digest('hex');
  const registered_at  = new Date().toISOString();

  // 3. Write session file BEFORE POST /api/register (§2.3 ordering)
  //    Mode 0600: owner read/write only — session secret hash.
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(
    sessionFile,
    JSON.stringify({ cap_token_hash, agent: 'ha_devops', registered_at }),
    { mode: 0o600 },
  );

  // 4. Register ha_devops with the Task Router
  await _trPost(
    `/api/register?project=${encodeURIComponent(project)}`,
    { name: 'ha_devops', project, capabilities: ['ha-config-deploy'] },
    port,
  );

  return { capToken };
}

/**
 * Clean up the ha_devops session: delete the session file and unregister.
 * Best-effort — errors are logged, not thrown (called from pty exit handlers).
 *
 * @param {{ project?: string, trPort?: number, sessionFilePath?: string }} opts
 */
async function _cleanupHaDevops(opts = {}) {
  const project     = opts.project         || process.env.TASK_ROUTER_PROJECT || 'Majordomos';
  const port        = opts.trPort          || _taskRouterPort();
  const sessionFile = opts.sessionFilePath || haDevopsSessionPath();

  try { fs.unlinkSync(sessionFile); } catch { /* already deleted — ok */ }

  await _trPost(
    `/api/unregister?project=${encodeURIComponent(project)}`,
    { name: 'ha_devops', project },
    port,
  );
}

// ── Main spawn entry ──────────────────────────────────────────────────────────

/**
 * Spawn an agent terminal via node-pty.
 *
 * For ha_devops only: mints + writes session file (write-before-register) →
 * registers → spawns with HA_DEVOPS_CAP_TOKEN → on exit deletes file + unregisters.
 *
 * For all other agents: straight spawn; their Startup Sequence handles registration.
 *
 * @param {string} agentName
 * @param {{
 *   model?:           string,
 *   project?:         string,
 *   cwd?:             string,
 *   claudeBin?:       string,
 *   trPort?:          number,
 *   sessionFilePath?: string,   // ha_devops session file path override (testing)
 *   ptySpawn?:        Function, // node-pty-compatible spawn override (testing)
 * }} opts
 * @returns {Promise<object>} node-pty process instance
 */
async function spawnAgent(agentName, opts = {}) {
  let capToken = null;

  // ha_devops ONLY: mint + write + register before spawn
  if (agentName === 'ha_devops') {
    ({ capToken } = await _mintAndRegisterHaDevops(opts));
  }

  const { claudeBin, args, env, cwd } = buildLaunchCommand(agentName, {
    model:    opts.model,
    project:  opts.project,
    cwd:      opts.cwd,
    claudeBin: opts.claudeBin,
    capToken,
  });

  const ptySpawnFn = opts.ptySpawn || _defaultPtySpawn;
  const ptyProc = ptySpawnFn(claudeBin, args, { cwd, env, cols: 220, rows: 50 });

  // ha_devops ONLY: on pty exit, close the gate
  ptyProc.on('exit', () => {
    if (agentName === 'ha_devops') {
      _cleanupHaDevops(opts).catch(err => {
        console.error('[supervisor] ha_devops cleanup error on exit:', err.message);
      });
    }
  });

  return ptyProc;
}

module.exports = {
  spawnAgent,
  // Exported for testing
  _mintAndRegisterHaDevops,
  _cleanupHaDevops,
  haDevopsSessionPath,
};
