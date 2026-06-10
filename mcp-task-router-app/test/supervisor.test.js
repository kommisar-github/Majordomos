'use strict';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const path   = require('path');

const { spawnAgent, _mintAndRegisterHaDevops, _cleanupHaDevops } = require('../src/supervisor');
const { buildLaunchCommand } = require('../src/launchCommand');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpFile() {
  return path.join(os.tmpdir(),
    `ha-devops-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

function readSession(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Minimal mock pty factory. Returns a pty-like object with a stored env,
// an `on` registrar, and a `_fire(event)` helper for tests.
function makeMockPty() {
  const handlers = {};
  return {
    spawn: (claudeBin, args, spawnOpts) => ({
      spawnedWith: { claudeBin, args, env: spawnOpts.env, cwd: spawnOpts.cwd },
      on: (ev, fn) => { handlers[ev] = fn; },
      _fire: (ev, ...a) => handlers[ev] && handlers[ev](...a),
    }),
    captureHandlers: handlers,
  };
}

// Build a standard mock request handler that pushes to `calls`.
// Returned as a named function so the ordering test can restore it after
// temporarily replacing it (removeAllListeners + restore avoids a hang).
function makeMockHandler(calls) {
  return function defaultMockHandler(req, res) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, body: JSON.parse(body || '{}') });
      res.writeHead(200);
      res.end('{}');
    });
  };
}

// ── buildLaunchCommand — unit tests ───────────────────────────────────────────

describe('buildLaunchCommand', () => {
  test('pm: sets TASK_ROUTER_AGENT, no HA_DEVOPS_CAP_TOKEN', () => {
    const { args, env } = buildLaunchCommand('pm', { project: 'T', model: 'claude-sonnet-4-6' });
    assert.ok(args.includes('pm_agent'));
    assert.ok(args.includes('/pm'));
    assert.equal(env.TASK_ROUTER_AGENT, 'pm');
    assert.equal(env.HA_DEVOPS_CAP_TOKEN, undefined);
  });

  test('ha_devops + capToken: HA_DEVOPS_CAP_TOKEN injected', () => {
    const { env } = buildLaunchCommand('ha_devops', { project: 'T', capToken: 'trha_abc' });
    assert.equal(env.HA_DEVOPS_CAP_TOKEN, 'trha_abc');
  });

  test('ha_devops without capToken: HA_DEVOPS_CAP_TOKEN not set', () => {
    const { env } = buildLaunchCommand('ha_devops', { project: 'T' });
    assert.equal(env.HA_DEVOPS_CAP_TOKEN, undefined);
  });

  test('args parity: --model, --agent <name>_agent, /<name>', () => {
    const { args } = buildLaunchCommand('arch', { model: 'claude-opus-4-8', project: 'T' });
    assert.deepEqual(args, ['--model', 'claude-opus-4-8', '--agent', 'arch_agent', '/arch']);
  });
});

// ── _mintAndRegisterHaDevops — unit tests ─────────────────────────────────────

describe('_mintAndRegisterHaDevops', () => {
  let mockServer;
  let mockPort;
  const calls = [];

  before(async () => {
    await new Promise(resolve => {
      mockServer = http.createServer(makeMockHandler(calls));
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(async () => new Promise(resolve => mockServer.close(resolve)));
  beforeEach(() => calls.length = 0);

  test('writes session file BEFORE POST /api/register (§2.3 ordering)', async () => {
    const sessionFile = tmpFile();
    let fileExistedAtRegister = false;

    // Temporarily replace the handler to capture file-existence at register time.
    // Restore the default handler in finally — leaving the server without a handler
    // would cause all subsequent tests in this describe to hang on HTTP requests.
    const restoreHandler = makeMockHandler(calls);
    mockServer.removeAllListeners('request');
    mockServer.on('request', (req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        calls.push({ url: req.url, body: JSON.parse(body || '{}') });
        if (req.url.includes('/api/register')) {
          fileExistedAtRegister = fs.existsSync(sessionFile);
        }
        res.writeHead(200);
        res.end('{}');
      });
    });

    try {
      await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: sessionFile });
      assert.ok(fileExistedAtRegister, 'session file must exist at the time /api/register is called');
    } finally {
      try { fs.unlinkSync(sessionFile); } catch {}
      mockServer.removeAllListeners('request');
      mockServer.on('request', restoreHandler);
    }
  });

  test('session file: hash only — raw token NEVER in file', async () => {
    const sessionFile = tmpFile();
    let capToken;
    try {
      ({ capToken } = await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: sessionFile }));

      assert.ok(fs.existsSync(sessionFile), 'session file must be written');
      const stored = readSession(sessionFile);

      // Raw token not in file
      assert.ok(!JSON.stringify(stored).includes(capToken),
        'raw cap-token must NOT appear in the session file (hash only)');

      // Hash is correct SHA-256 of the raw token
      const expectedHash = crypto.createHash('sha256').update(capToken).digest('hex');
      assert.equal(stored.cap_token_hash, expectedHash);

      // Structural fields
      assert.equal(stored.agent, 'ha_devops');
      assert.ok(typeof stored.registered_at === 'string' && stored.registered_at.length > 0);
    } finally {
      try { fs.unlinkSync(sessionFile); } catch {}
    }
  });

  test('cap-token format: trha_ prefix + 32 hex chars (128-bit)', async () => {
    const sessionFile = tmpFile();
    let capToken;
    try {
      ({ capToken } = await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: sessionFile }));
      assert.ok(capToken.startsWith('trha_'), `expected trha_ prefix, got ${capToken.slice(0, 10)}`);
      assert.equal(capToken.length, 37, 'trha_ (5) + 32 hex chars = 37 total');
      assert.match(capToken.slice(5), /^[0-9a-f]{32}$/, 'suffix must be 32 lowercase hex chars');
    } finally {
      try { fs.unlinkSync(sessionFile); } catch {}
    }
  });

  test('register call: name=ha_devops, capabilities=[ha-config-deploy]', async () => {
    const sessionFile = tmpFile();
    try {
      await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: sessionFile });
      const reg = calls.find(c => c.url.includes('/api/register'));
      assert.ok(reg, '/api/register must be called');
      assert.equal(reg.body.name, 'ha_devops');
      assert.deepEqual(reg.body.capabilities, ['ha-config-deploy']);
    } finally {
      try { fs.unlinkSync(sessionFile); } catch {}
    }
  });

  test('each mint produces a unique token and hash', async () => {
    const f1 = tmpFile();
    const f2 = tmpFile();
    try {
      const { capToken: t1 } = await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: f1 });
      const { capToken: t2 } = await _mintAndRegisterHaDevops({ trPort: mockPort, sessionFilePath: f2 });
      assert.notEqual(t1, t2, 'each mint must produce a unique token');
      assert.notEqual(readSession(f1).cap_token_hash, readSession(f2).cap_token_hash);
    } finally {
      for (const f of [f1, f2]) try { fs.unlinkSync(f); } catch {}
    }
  });
});

// ── _cleanupHaDevops — unit tests ─────────────────────────────────────────────

describe('_cleanupHaDevops', () => {
  let mockServer;
  let mockPort;
  const calls = [];

  before(async () => {
    await new Promise(resolve => {
      mockServer = http.createServer(makeMockHandler(calls));
      mockServer.listen(0, '127.0.0.1', () => { mockPort = mockServer.address().port; resolve(); });
    });
  });

  after(async () => new Promise(resolve => mockServer.close(resolve)));
  beforeEach(() => calls.length = 0);

  test('deletes session file and calls /api/unregister', async () => {
    const sessionFile = tmpFile();
    fs.writeFileSync(sessionFile, JSON.stringify({ cap_token_hash: 'x', agent: 'ha_devops', registered_at: 't' }));

    await _cleanupHaDevops({ trPort: mockPort, sessionFilePath: sessionFile });

    assert.ok(!fs.existsSync(sessionFile), 'session file must be deleted on cleanup');
    const unreg = calls.find(c => c.url.includes('/api/unregister'));
    assert.ok(unreg, '/api/unregister must be called');
    assert.equal(unreg.body.name, 'ha_devops');
  });

  test('does not throw if session file already absent', async () => {
    const sessionFile = tmpFile(); // does not exist
    await assert.doesNotReject(() => _cleanupHaDevops({ trPort: mockPort, sessionFilePath: sessionFile }));
  });
});

// ── spawnAgent — ha_devops path ───────────────────────────────────────────────

describe('spawnAgent — ha_devops', () => {
  let mockServer;
  let mockPort;
  const calls = [];

  before(async () => {
    await new Promise(resolve => {
      mockServer = http.createServer(makeMockHandler(calls));
      mockServer.listen(0, '127.0.0.1', () => { mockPort = mockServer.address().port; resolve(); });
    });
  });

  after(async () => new Promise(resolve => mockServer.close(resolve)));
  beforeEach(() => calls.length = 0);

  test('session file written, HA_DEVOPS_CAP_TOKEN in pty env, raw token not in file', async () => {
    const sessionFile = tmpFile();
    const mock = makeMockPty();

    const ptyProc = await spawnAgent('ha_devops', {
      trPort: mockPort, sessionFilePath: sessionFile, ptySpawn: mock.spawn, project: 'T',
    });

    // Session file exists after spawn
    assert.ok(fs.existsSync(sessionFile), 'session file must exist after spawn');

    // HA_DEVOPS_CAP_TOKEN injected into pty env
    const capToken = ptyProc.spawnedWith.env.HA_DEVOPS_CAP_TOKEN;
    assert.ok(capToken && capToken.startsWith('trha_'),
      'HA_DEVOPS_CAP_TOKEN must be set and start with trha_');

    // Raw token NOT in the session file
    const stored = readSession(sessionFile);
    assert.ok(!JSON.stringify(stored).includes(capToken),
      'raw token must NOT appear in session file');

    // TASK_ROUTER_AGENT set
    assert.equal(ptyProc.spawnedWith.env.TASK_ROUTER_AGENT, 'ha_devops');

    // Cleanup: fire exit → session file deleted + /api/unregister called
    ptyProc._fire('exit');
    await new Promise(r => setTimeout(r, 80)); // allow async cleanup to complete

    assert.ok(!fs.existsSync(sessionFile), 'session file must be deleted on pty exit');
    const unreg = calls.find(c => c.url.includes('/api/unregister'));
    assert.ok(unreg, '/api/unregister must be called on pty exit');
  });

  test('opts.wsCmd never forwarded to executeConfigWrite (opts contain only what supervisor passes)', async () => {
    // This test confirms no foreign keys leak into the pty env
    const sessionFile = tmpFile();
    const mock = makeMockPty();
    const ptyProc = await spawnAgent('ha_devops', {
      trPort: mockPort, sessionFilePath: sessionFile, ptySpawn: mock.spawn, project: 'T',
    });
    // wsCmd must not be in the pty env
    assert.equal(ptyProc.spawnedWith.env.wsCmd, undefined);
    try { fs.unlinkSync(sessionFile); } catch {}
  });
});

// ── spawnAgent — non-ha_devops agents (no mint) ───────────────────────────────

describe('spawnAgent — non-ha_devops (pm)', () => {
  let mockServer;
  let mockPort;
  const calls = [];

  before(async () => {
    await new Promise(resolve => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          calls.push({ url: req.url });
          res.writeHead(200);
          res.end('{}');
        });
      });
      mockServer.listen(0, '127.0.0.1', () => { mockPort = mockServer.address().port; resolve(); });
    });
  });

  after(async () => new Promise(resolve => mockServer.close(resolve)));
  beforeEach(() => calls.length = 0);

  test('no session file written, no /api/register called by supervisor', async () => {
    const sessionFile = tmpFile();
    const mock = makeMockPty();

    await spawnAgent('pm', {
      trPort: mockPort, sessionFilePath: sessionFile, ptySpawn: mock.spawn,
    });

    assert.ok(!fs.existsSync(sessionFile),
      'session file must NOT be written for non-ha_devops agents');
    assert.ok(!calls.some(c => c.url.includes('/api/register')),
      'supervisor must NOT call /api/register for pm (agent registers itself)');
  });

  test('HA_DEVOPS_CAP_TOKEN absent from pm pty env', async () => {
    const mock = makeMockPty();
    const ptyProc = await spawnAgent('pm', { trPort: mockPort, ptySpawn: mock.spawn });
    assert.equal(ptyProc.spawnedWith.env.HA_DEVOPS_CAP_TOKEN, undefined,
      'HA_DEVOPS_CAP_TOKEN must not be set for the pm agent');
    assert.equal(ptyProc.spawnedWith.env.TASK_ROUTER_AGENT, 'pm');
  });

  test('pm exit handler does not call /api/unregister via supervisor', async () => {
    const mock = makeMockPty();
    const ptyProc = await spawnAgent('pm', { trPort: mockPort, ptySpawn: mock.spawn });
    ptyProc._fire('exit');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(!calls.some(c => c.url.includes('/api/unregister')),
      'supervisor must not call /api/unregister on pm exit (agent handles its own lifecycle)');
  });
});
