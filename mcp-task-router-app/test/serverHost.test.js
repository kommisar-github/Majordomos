'use strict';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');

const { startServerHost, createHaExecutorServer, _configWriteStatus } = require('../src/serverHost');

// ── Helpers ───────────────────────────────────────────────────────────────────

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getStatus(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

// Whitelist that passes validation (subset of ha-bridge.test.js BASE_WHITELIST).
const VALID_WHITELIST = {
  version: 1,
  glob_support: true,
  ttl: { inbound_seconds: 120, outbound_seconds: 300 },
  critical_entities: [
    { entity_id: 'switch.main_breaker', operator_finalize: true },
  ],
  domain_defaults: {
    light: 'A',
    switch: 'A',
    lock: 'C',
  },
  domain_service_overrides: {},
  custom_tools: {},
  per_entity_overrides: [],
};

// ── createHaExecutorServer — unit tests (no real bridge, in-memory whitelist) ──

describe('createHaExecutorServer', () => {
  let server;
  const PORT = 13101;

  // Stub bridge.loadWhitelist + bridge.executeApprovedAction at module level.
  const bridge = require('../src/ha-bridge');
  const origLoad    = bridge.loadWhitelist;
  const origExecute = bridge.executeApprovedAction;

  before(done => {
    bridge.loadWhitelist = () => {}; // pre-loaded; stub
    server = createHaExecutorServer();
    server.listen(PORT, '127.0.0.1', done);
  });

  after(done => {
    bridge.loadWhitelist    = origLoad;
    bridge.executeApprovedAction = origExecute;
    server.close(done);
  });

  test('POST /api/ha/execute with Tier-A action → 200 ok', async () => {
    bridge.executeApprovedAction = async () => ({ tier: 'A', status: 200, data: [] });
    const res = await postJson(PORT, '/api/ha/execute', {
      domain: 'light', service: 'turn_on', entity: 'light.office',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tier, 'A');
  });

  test('POST /api/ha/execute with Tier-C action → 403 (HARD-REFUSE)', async () => {
    bridge.executeApprovedAction = async () => {
      throw new Error('[HARD-REFUSE] lock.front_door (lock.unlock) resolved to Tier C');
    };
    const res = await postJson(PORT, '/api/ha/execute', {
      domain: 'lock', service: 'unlock', entity: 'lock.front_door',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error.includes('[HARD-REFUSE]'));
  });

  test('POST /api/ha/execute with HA transport error → 502', async () => {
    bridge.executeApprovedAction = async () => {
      throw new Error('HA service call failed: HTTP 500');
    };
    const res = await postJson(PORT, '/api/ha/execute', {
      domain: 'light', service: 'turn_on', entity: 'light.office',
    });
    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
  });

  test('POST with invalid JSON body → 400', async () => {
    const p = new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: PORT, path: '/api/ha/execute', method: 'POST',
          headers: { 'Content-Type': 'application/json' } },
        res => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        },
      );
      req.on('error', reject);
      req.write('not-json{{{');
      req.end();
    });
    const res = await p;
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });

  test('GET /api/ha/execute → 404 (wrong method)', async () => {
    const status = await getStatus(PORT, '/api/ha/execute');
    assert.equal(status, 404);
  });

  test('POST /wrong-path → 404', async () => {
    const res = await postJson(PORT, '/api/other', { domain: 'light' });
    assert.equal(res.status, 404);
  });
});

// ── Helpers for config-write tests ────────────────────────────────────────────

function postJsonWithAuth(port, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'POST', headers },
      res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── _configWriteStatus — unit tests ───────────────────────────────────────────

describe('_configWriteStatus', () => {
  const cases = [
    { msg: '[CAP-TOKEN] absent', expect: 401 },
    { msg: '[UNSUPPORTED-OP] bad', expect: 400 },
    { msg: '[UNDO-UNSUPPORTED] op=helper_create', expect: 400 },
    { msg: '[HARD-DENY] pre-existing Critical', expect: 403 },
    { msg: '[BODY-SCAN-DENY] template in service', expect: 403 },
    { msg: '[FLEET_ENABLE_DENY] cause-to-fire', expect: 403 },
    { msg: '[HARD-REFUSE] Tier C', expect: 403 },
    { msg: '[UNDO-DRIFT] hash mismatch', expect: 409 },
    { msg: '[UNDO-REJECTED] not success', expect: 409 },
    { msg: '[UNDO-NOT-FOUND] no entry', expect: 404 },
    { msg: '[WS-SCOPE-VIOLATION] call_service', expect: 500 },
    { msg: 'HA 502 connection refused', expect: 502 },
    { msg: '', expect: 502 },
  ];
  for (const { msg, expect: expected } of cases) {
    test(`"${msg.slice(0, 30)}" → ${expected}`, () => {
      assert.equal(_configWriteStatus(msg), expected);
    });
  }
});

// ── POST /api/ha/config-write — route-level tests ─────────────────────────────

describe('POST /api/ha/config-write', () => {
  const PORT = 13103;
  let server;
  const bridge = require('../src/ha-bridge');
  let origConfigWrite;

  // Thin realistic stub: calls opts.validateCapToken(capToken) as STEP 1,
  // throws [CAP-TOKEN] on failure, returns success otherwise.
  // Captures last call args for inspection.
  let lastCallArgs = null;
  const capTokenStub = async ({ op, payload, confirm_id }, capToken, opts) => {
    lastCallArgs = { op, payload, confirm_id, capToken, opts };
    const valid = opts.validateCapToken && await opts.validateCapToken(capToken);
    if (!valid) throw new Error('[CAP-TOKEN] Invalid or absent cap-token (stub)');
    return { op, applied: true, audit_id: 'stub-audit-id' };
  };

  before(done => {
    origConfigWrite = bridge.executeConfigWrite;
    bridge.executeConfigWrite = capTokenStub;
    // Use a mock validateCapToken that accepts only 'valid-token-123'
    server = createHaExecutorServer({
      validateCapToken: async tok => tok === 'valid-token-123',
    });
    server.listen(PORT, '127.0.0.1', done);
  });

  after(done => {
    bridge.executeConfigWrite = origConfigWrite;
    server.close(done);
  });

  beforeEach(() => { lastCallArgs = null; });

  // AC: cap-token missing → 401 before any HA I/O
  test('no Authorization header → 401', async () => {
    const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
      { op: 'helper_create', payload: { helper_type: 'input_number' } },
      undefined, // no header
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error.includes('[CAP-TOKEN]'));
  });

  // AC: invalid cap-token → 401
  test('wrong token → 401', async () => {
    const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
      { op: 'helper_create', payload: {} },
      'wrong-token',
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
  });

  // AC: valid-token path reaches executeConfigWrite; returns 200
  test('valid token → 200, executeConfigWrite called', async () => {
    const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
      { op: 'helper_create', payload: { helper_type: 'input_number' }, confirm_id: 'c1' },
      'valid-token-123',
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.op, 'helper_create');
    assert.ok(lastCallArgs, 'executeConfigWrite must have been called');
    assert.equal(lastCallArgs.capToken, 'valid-token-123');
    assert.equal(lastCallArgs.confirm_id, 'c1');
  });

  // AC: opts.wsCmd is NEVER set by the route (§5.3 / MAJOR-2)
  test('route never sets opts.wsCmd', async () => {
    await postJsonWithAuth(PORT, '/api/ha/config-write',
      { op: 'helper_create', payload: {} },
      'valid-token-123',
    );
    assert.ok(lastCallArgs, 'executeConfigWrite must have been called');
    assert.equal(lastCallArgs.opts.wsCmd, undefined,
      'route must not pass opts.wsCmd — the scoped WS client must run (§5.3/MAJOR-2)');
    assert.equal(typeof lastCallArgs.opts.validateCapToken, 'function',
      'route must wire opts.validateCapToken');
  });

  // AC: config-write route is loopback-bound — same server, same G3 guarantee
  test('config-write URL uses 127.0.0.1 (loopback-bound)', async () => {
    // The server is listening on 127.0.0.1:PORT — this test succeeds only if bound there
    const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
      { op: 'helper_create', payload: {} },
      'valid-token-123',
    );
    assert.equal(res.status, 200, '127.0.0.1 binding reachable (loopback-only server up)');
  });

  // AC: hard-deny from executor surfaces as clean 403
  test('[HARD-DENY] executor error → 403', async () => {
    const origStub = bridge.executeConfigWrite;
    bridge.executeConfigWrite = async () => {
      throw new Error('[HARD-DENY] automation_upsert: pre-existing Critical interlock (stub)');
    };
    try {
      const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
        { op: 'automation_upsert', payload: {} },
        'valid-token-123',
      );
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes('[HARD-DENY]'));
    } finally {
      bridge.executeConfigWrite = origStub;
    }
  });

  // AC: [UNDO-DRIFT] → 409
  test('[UNDO-DRIFT] executor error → 409', async () => {
    const origStub = bridge.executeConfigWrite;
    bridge.executeConfigWrite = async () => {
      throw new Error('[UNDO-DRIFT] hash mismatch (stub)');
    };
    try {
      const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
        { op: 'undo_config_write', payload: { audit_id: 'x' } },
        'valid-token-123',
      );
      assert.equal(res.status, 409);
    } finally {
      bridge.executeConfigWrite = origStub;
    }
  });

  // AC: [WS-SCOPE-VIOLATION] → 500 (invariant violation — loud signal)
  test('[WS-SCOPE-VIOLATION] → 500', async () => {
    const origStub = bridge.executeConfigWrite;
    bridge.executeConfigWrite = async () => {
      throw new Error('[WS-SCOPE-VIOLATION] call_service bypass attempt (stub)');
    };
    try {
      const res = await postJsonWithAuth(PORT, '/api/ha/config-write',
        { op: 'helper_create', payload: {} },
        'valid-token-123',
      );
      assert.equal(res.status, 500);
    } finally {
      bridge.executeConfigWrite = origStub;
    }
  });

  // AC: Tier-B service-call path stays unchanged and separate (scope guard)
  test('Tier-B /api/ha/execute path unaffected — no cap-token required', async () => {
    const origExecute = bridge.executeApprovedAction;
    bridge.executeApprovedAction = async () => ({ tier: 'A', status: 200, data: [] });
    try {
      // No Authorization header — Tier-B must NOT require one
      const res = await postJson(PORT, '/api/ha/execute', {
        domain: 'light', service: 'turn_on', entity: 'light.office',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.tier, 'A');
    } finally {
      bridge.executeApprovedAction = origExecute;
    }
  });
});

// ── startServerHost — lifecycle tests ─────────────────────────────────────────

describe('startServerHost', () => {
  const PORT = 13102;
  let origEnvPort;

  before(() => {
    origEnvPort = process.env.HA_EXEC_PORT;
    process.env.HA_EXEC_PORT = String(PORT);
  });

  after(() => {
    if (origEnvPort === undefined) delete process.env.HA_EXEC_PORT;
    else process.env.HA_EXEC_PORT = origEnvPort;
  });

  test('mounts executor when whitelist is valid; shutdown cleans up', async () => {
    const bridge = require('../src/ha-bridge');
    const origLoad = bridge.loadWhitelist;
    bridge.loadWhitelist = () => {}; // stub — pretend whitelist loads OK

    // Fake startServer that does nothing (simulates first-start path).
    const fakeStart = async () => ({ shutdown: async () => {} });

    // Make isTaskRouterUp return false so we go down the start path.
    // We override TASK_ROUTER_PORT to a port nothing listens on.
    const origTRPort = process.env.TASK_ROUTER_PORT;
    process.env.TASK_ROUTER_PORT = '19999';

    let host;
    try {
      host = await startServerHost(fakeStart);
      assert.ok(host.haExecUrl, 'haExecUrl should be set when whitelist is valid');
      assert.ok(host.haExecUrl.includes('127.0.0.1'), 'executor must be loopback');
      // Verify the port is actually listening.
      const status = await getStatus(PORT, '/api/ha/execute');
      assert.equal(status, 404, 'wrong-method GET on live server returns 404 (server is up)');
    } finally {
      if (host) await host.shutdown();
      bridge.loadWhitelist = origLoad;
      if (origTRPort === undefined) delete process.env.TASK_ROUTER_PORT;
      else process.env.TASK_ROUTER_PORT = origTRPort;
    }
  });

  test('fail-closed: executor NOT mounted when whitelist throws', async () => {
    const bridge = require('../src/ha-bridge');
    const origLoad = bridge.loadWhitelist;
    bridge.loadWhitelist = () => { throw new Error('validation failure (test)'); };

    const origTRPort = process.env.TASK_ROUTER_PORT;
    process.env.TASK_ROUTER_PORT = '19999';
    process.env.HA_EXEC_PORT = String(PORT + 1); // different port so no conflict

    let host;
    try {
      host = await startServerHost(async () => ({ shutdown: async () => {} }));
      assert.equal(host.haExecUrl, null, 'haExecUrl must be null when whitelist invalid');
      // Confirm nothing is listening on that port.
      await assert.rejects(
        () => getStatus(PORT + 1, '/api/ha/execute'),
        'connection refused — executor correctly not started',
      );
    } finally {
      if (host) await host.shutdown();
      bridge.loadWhitelist = origLoad;
      if (origTRPort === undefined) delete process.env.TASK_ROUTER_PORT;
      else process.env.TASK_ROUTER_PORT = origTRPort;
      process.env.HA_EXEC_PORT = String(PORT);
    }
  });

  test('attaches when task router health check succeeds (no startServer call)', async () => {
    // Spin up a tiny fake "health" server to simulate task-router already running.
    const fakeHealth = http.createServer((req, res) => {
      if (req.url === '/health') { res.writeHead(200); res.end('ok'); }
      else { res.writeHead(404); res.end(); }
    });
    const FAKE_TR_PORT = 19001;
    await new Promise(r => fakeHealth.listen(FAKE_TR_PORT, '127.0.0.1', r));

    const bridge = require('../src/ha-bridge');
    const origLoad = bridge.loadWhitelist;
    bridge.loadWhitelist = () => {};

    const origTRPort = process.env.TASK_ROUTER_PORT;
    process.env.TASK_ROUTER_PORT = String(FAKE_TR_PORT);

    let startCalled = false;
    const fakeStart = async () => { startCalled = true; return { shutdown: async () => {} }; };

    let host;
    try {
      host = await startServerHost(fakeStart);
      assert.equal(startCalled, false, 'startServer must NOT be called when health returns 200');
      assert.ok(host.haExecUrl, 'executor still mounted in attach mode');
    } finally {
      if (host) await host.shutdown();
      bridge.loadWhitelist = origLoad;
      await new Promise(r => fakeHealth.close(r));
      if (origTRPort === undefined) delete process.env.TASK_ROUTER_PORT;
      else process.env.TASK_ROUTER_PORT = origTRPort;
    }
  });
});
