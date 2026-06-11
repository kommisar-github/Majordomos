'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

// Requiring the module (not as the main entry) so main() does not auto-execute.
const app = require('../bin/app');

// ── bin/app — main() unit tests ───────────────────────────────────────────────

describe('bin/app — main()', () => {
  // Minimal fake host returned by a stubbed startServerHost.
  function fakeHost(extra = {}) {
    let shut = false;
    return {
      haExecUrl: 'http://127.0.0.1:3101/api/ha/execute',
      haConfigWriteUrl: 'http://127.0.0.1:3101/api/ha/config-write',
      shutdown: async () => { shut = true; },
      didShutdown: () => shut,
      ...extra,
    };
  }

  test('default mode: calls startServerHost, does NOT invoke spawnAgent', async () => {
    let serverHostCalled = false;
    let spawnCalled = false;
    const host = fakeHost();

    const { shutdown, superviseMode } = await app.main({
      startServerHost: async () => { serverHostCalled = true; return host; },
      spawnAgent:      async () => { spawnCalled = true; return {}; },
      supervise: false,
      noSignalHandlers: true,
    });

    assert.equal(serverHostCalled, true,  'startServerHost must be called');
    assert.equal(spawnCalled,      false, 'spawnAgent must NOT be called in default mode');
    assert.equal(superviseMode,    false);
    await shutdown();
  });

  test('supervise mode: calls startServerHost AND spawnAgent("pm")', async () => {
    let spawnCalled = false;
    let spawnedName = null;
    const host = fakeHost();
    const pty  = { kill: () => {} };

    const { shutdown, superviseMode } = await app.main({
      startServerHost: async () => host,
      spawnAgent: async name => { spawnCalled = true; spawnedName = name; return pty; },
      supervise: true,
      noSignalHandlers: true,
    });

    assert.equal(spawnCalled,   true,  'spawnAgent must be called in supervise mode');
    assert.equal(spawnedName,   'pm',  'must spawn the PM agent');
    assert.equal(superviseMode, true);
    await shutdown();
  });

  test('shutdown() calls host.shutdown() and kills pty in supervise mode', async () => {
    let hostShut = false;
    let ptyKilled = false;

    const { shutdown } = await app.main({
      startServerHost: async () => ({ shutdown: async () => { hostShut = true; } }),
      spawnAgent:      async () => ({ kill: () => { ptyKilled = true; } }),
      supervise: true,
      noSignalHandlers: true,
    });

    await shutdown();
    assert.equal(hostShut,   true, 'host.shutdown() must be called');
    assert.equal(ptyKilled,  true, 'pty.kill() must be called in supervise mode');
  });

  test('shutdown() calls host.shutdown() even with no pty (default mode)', async () => {
    let hostShut = false;

    const { shutdown } = await app.main({
      startServerHost: async () => ({ shutdown: async () => { hostShut = true; } }),
      spawnAgent:      async () => { throw new Error('should not be called'); },
      supervise: false,
      noSignalHandlers: true,
    });

    await shutdown();
    assert.equal(hostShut, true, 'host.shutdown() must always be called');
  });

  test('pty.kill() error in shutdown is swallowed (does not reject)', async () => {
    const { shutdown } = await app.main({
      startServerHost: async () => ({ shutdown: async () => {} }),
      spawnAgent:      async () => ({ kill: () => { throw new Error('already exited'); } }),
      supervise: true,
      noSignalHandlers: true,
    });

    // Must not throw even if pty.kill() throws.
    await assert.doesNotReject(() => shutdown());
  });
});
