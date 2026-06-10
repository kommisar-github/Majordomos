#!/usr/bin/env node
'use strict';

/**
 * bin/app.js — Majordomus standalone app entrypoint.
 *
 * Default mode (safe alongside the VS Code extension):
 *   node mcp-task-router-app/bin/app.js
 *
 *   Attaches to the running Task Router on 3100 (no 409 — health-check first)
 *   and mounts the HA config-write executor on 127.0.0.1:3101. Does NOT spawn
 *   a PM terminal; the extension already supervises the fleet.
 *
 * Supervisor mode (headless launchd deployment — do NOT use alongside the extension):
 *   MAJORDOMUS_SUPERVISE=1 node mcp-task-router-app/bin/app.js
 *   OR: node mcp-task-router-app/bin/app.js --supervise
 *
 *   Also spawns the node-pty PM agent via supervisor.js (single agent, parity
 *   with extension terminals.ts spawn). The task-router is started in-process
 *   if not already up; the extension must NOT be running concurrently.
 */

const { startServerHost } = require('../src/serverHost');
const { spawnAgent }      = require('../src/supervisor');

/**
 * Start the Majordomus app.
 *
 * @param {{
 *   startServerHost?: () => Promise<{ haExecUrl: string|null, haConfigWriteUrl: string|null, shutdown: () => Promise<void> }>,
 *   spawnAgent?:      (name: string, opts?: object) => Promise<object>,
 *   supervise?:       boolean,       // override argv/env detection (for tests)
 *   noSignalHandlers?: boolean,      // skip SIGINT/SIGTERM wiring (for tests)
 * }} [opts]
 * @returns {Promise<{ shutdown: () => Promise<void>, superviseMode: boolean }>}
 */
async function main(opts = {}) {
  const _startServerHost = opts.startServerHost || startServerHost;
  const _spawnAgent      = opts.spawnAgent      || spawnAgent;

  const superviseMode =
    opts.supervise !== undefined ? opts.supervise :
    (process.argv.includes('--supervise') || process.env.MAJORDOMOS_SUPERVISE === '1');

  // 1. Server host: attach to 3100 (no 409 if already up) + mount 3101 HA executor.
  //    Whitelist load failure → executor not mounted, haExecUrl null (fail-closed).
  const host = await _startServerHost();

  // 2. Supervisor mode: spawn the PM agent via node-pty.
  //    Default (false): server-host-only — safe alongside the VS Code extension.
  let ptyProc = null;
  if (superviseMode) {
    console.log('[app] Supervisor mode — spawning PM agent...');
    ptyProc = await _spawnAgent('pm');
  }

  const shutdown = async () => {
    console.log('[app] Shutting down...');
    if (ptyProc) {
      try { ptyProc.kill(); } catch { /* already exited */ }
    }
    await host.shutdown();
  };

  if (!opts.noSignalHandlers) {
    const exit = (code) => () => shutdown().then(() => process.exit(code)).catch(() => process.exit(1));
    process.on('SIGINT',  exit(0));
    process.on('SIGTERM', exit(0));
  }

  return { shutdown, superviseMode };
}

if (require.main === module) {
  main().catch(err => {
    console.error('[app] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
