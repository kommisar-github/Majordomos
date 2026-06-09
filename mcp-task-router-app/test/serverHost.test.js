'use strict';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');

const { startServerHost, createHaExecutorServer } = require('../src/serverHost');

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
