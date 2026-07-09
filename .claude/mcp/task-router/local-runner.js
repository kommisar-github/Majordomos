#!/usr/bin/env node
/**
 * local-runner.js — Task Router local-model agent backend (seed v4.29+).
 *
 * A local (OpenAI-compatible / LM Studio) model *is* the agent: this runner
 * registers as a normal TR agent, then RESIDENT-POLLS its inbox and fulfils each
 * task with ONE forced-`json_schema` `/v1/chat/completions` call. It is the
 * `backend` axis of doc/plans/LOCAL_MODEL_BACKEND_PLAN.md (C-RUNNER) — NOT a
 * Claude proxy; the model never sees Claude Code, hooks, or MCP tools.
 *
 * Ships into every consumer project's .claude/mcp/task-router/local-runner.js
 * via init.sh (the 18th seed file). A launcher pre-registers the agent and sets
 * the env below, then spawns `node local-runner.js`. In C-0 an operator places
 * the file and env by hand.
 *
 * AUTONOMY (audit CRITICAL): this RESIDENT-polls — it does NOT exit after one
 * task. A one-shot that exits is never relaunched (the nudge loops only inject
 * into live sessions; nothing spawns a dead runner), so tasks would pile against
 * a dead process. Idle cost is ~nil (HTTP polls, no model call on an empty inbox).
 *
 * Env (C-ENV, set by the launcher; individual vars, never a JSON blob):
 *   TASK_ROUTER_AGENT              agent name (required)
 *   TASK_ROUTER_PROJECT           project slug (required)
 *   TASK_ROUTER_BASE_URL          TR server, default http://127.0.0.1:3100
 *   TASK_ROUTER_API_KEY           optional bearer key for a gated TR server
 *   TASK_ROUTER_BACKEND_KIND      "openai-compatible" (only supported kind)
 *   TASK_ROUTER_BACKEND_ENDPOINT  e.g. http://127.0.0.1:1234/v1  (H1-gated)
 *   TASK_ROUTER_BACKEND_MODEL     model id, else TASK_ROUTER_MODEL
 *   TASK_ROUTER_BACKEND_API_KEY_ENV  NAME of the env var holding the model key (H2)
 *   TASK_ROUTER_BACKEND_DRIVER    "minimal" (default; only supported driver)
 *   TASK_ROUTER_BACKEND_HOST_ALLOW comma-list of extra allowed backend hosts
 *   TASK_ROUTER_BACKEND_POLL_MS   idle poll interval, default 3000
 *
 * SECURITY:
 *   H1 (SSRF) — the backend endpoint host is allow-listed (loopback + RFC-1918
 *      private + TASK_ROUTER_BACKEND_HOST_ALLOW) and cloud-metadata IPs
 *      (169.254.0.0/16, incl. 169.254.169.254) are DENIED. Scheme must be http(s).
 *   H2 (secret exfil) — the model key is read ONLY from an env var whose NAME
 *      matches the allow-list (^LM_STUDIO_ | ^TASK_ROUTER_BACKEND_ | ^LOCAL_), and
 *      is transmitted ONLY to an H1-approved (hence non-public) endpoint.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PROTOCOL_VERSION = 'node/local-runner-v1';
const DEFAULT_TR_BASE = 'http://127.0.0.1:3100';
const API_KEY_ENV_ALLOW = /^(LM_STUDIO_|TASK_ROUTER_BACKEND_|LOCAL_)/;

function log(msg) { process.stderr.write(`[local-runner] ${msg}\n`); }
function die(msg) { log(`FATAL: ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------
// H1 — endpoint allow-list + cloud-metadata deny (SSRF control lives HERE, the
// request issuer, because agents.json values are attacker-influenceable).
// ---------------------------------------------------------------------------
function isPrivateHost(host) {
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 169 && b === 254) return false;              // link-local incl. 169.254.169.254 metadata → DENY
  if (a === 127) return true;                            // loopback
  if (a === 10) return true;                             // 10.0.0.0/8
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  return false;
}
function assertEndpointAllowed(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { die(`backend endpoint is not a valid URL: ${endpoint}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') die(`backend endpoint scheme must be http(s): ${u.protocol}`);
  const host = u.hostname;
  const extra = (process.env.TASK_ROUTER_BACKEND_HOST_ALLOW || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (isPrivateHost(host) || extra.includes(host.toLowerCase())) return u;
  die(`backend endpoint host not allowed (SSRF guard H1): ${host}. Loopback/RFC-1918 are allowed by default; add others via TASK_ROUTER_BACKEND_HOST_ALLOW. Cloud-metadata (169.254.*) is always denied.`);
}
// ---------------------------------------------------------------------------
// H2 — read the model key ONLY from an allow-listed env-var NAME.
// ---------------------------------------------------------------------------
function resolveBackendKey(apiKeyEnvName) {
  if (!apiKeyEnvName) return null;
  if (!API_KEY_ENV_ALLOW.test(apiKeyEnvName)) {
    die(`backend api_key_env "${apiKeyEnvName}" not allow-listed (secret-exfil guard H2). Allowed name prefixes: LM_STUDIO_, TASK_ROUTER_BACKEND_, LOCAL_.`);
  }
  return process.env[apiKeyEnvName] || null;
}

// ---------------------------------------------------------------------------
// Tiny HTTP helpers (zero-dep, mirror client.js).
// ---------------------------------------------------------------------------
function request(method, urlStr, { headers = {}, body = null, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const h = { ...headers };
    if (data) h['Content-Length'] = data.length;
    const req = mod.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`request timeout after ${timeoutMs}ms`)); });
    if (data) req.write(data);
    req.end();
  });
}

// --- TR MCP session (verbatim shape from client.js: initialize → tools/call) ---
function trHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'x-task-router-client': PROTOCOL_VERSION, ...extra };
  if (process.env.TASK_ROUTER_API_KEY) h['x-task-router-key'] = process.env.TASK_ROUTER_API_KEY;
  return h;
}
function parseMcp(raw) {
  for (const line of raw.split(/\r?\n/)) if (line.startsWith('data:')) { try { return JSON.parse(line.slice(5).trim()); } catch { return null; } }
  try { return JSON.parse(raw); } catch { return null; }
}
async function mcpSession(base, project, agent) {
  const path = `/mcp?project=${encodeURIComponent(project)}`;
  const res = await request('POST', new URL(path, base).href, { headers: trHeaders(), body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `${agent}-local-runner`, version: PROTOCOL_VERSION } } } });
  if (res.status !== 200) throw new Error(`TR initialize HTTP ${res.status}: ${res.raw.slice(0, 200)}`);
  const sid = res.headers['mcp-session-id'];
  if (!sid) throw new Error('TR initialize: no mcp-session-id header');
  return sid;
}
async function mcpCall(base, project, sid, tool, args, id = 2) {
  const path = `/mcp?project=${encodeURIComponent(project)}`;
  const res = await request('POST', new URL(path, base).href, { headers: trHeaders({ 'mcp-session-id': sid }), body: { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } } });
  if (res.status !== 200) throw new Error(`${tool} HTTP ${res.status}: ${res.raw.slice(0, 200)}`);
  const parsed = parseMcp(res.raw);
  if (!parsed) throw new Error(`${tool}: unparseable response`);
  if (parsed.error) throw new Error(`${tool} error: ${JSON.stringify(parsed.error)}`);
  const content = parsed.result && parsed.result.content;
  if (Array.isArray(content) && content[0] && typeof content[0].text === 'string') {
    const t = content[0].text;
    try { return JSON.parse(t); } catch { /* fall through */ }
    const i = t.indexOf('{'); if (i >= 0) { try { return JSON.parse(t.slice(i)); } catch { /* */ } }
    return t;
  }
  return parsed.result;
}
// State honesty: header-only POST /hook/stop (flip yellow→green + refresh TTL).
async function hookStop(base, project, agent) {
  try { await request('POST', new URL('/hook/stop', base).href, { headers: { 'Content-Type': 'application/json', 'X-Task-Router-Agent': agent, 'X-Task-Router-Project': project }, body: {}, timeoutMs: 8000 }); }
  catch (e) { log(`/hook/stop failed (non-fatal): ${e.message}`); }
}

// ---------------------------------------------------------------------------
// The local model call — ONE forced-json_schema completion (the reliability MUST).
// ---------------------------------------------------------------------------
const DEFAULT_SCHEMA = { type: 'object', additionalProperties: false, properties: { result: { type: 'string' } }, required: ['result'] };

// A task payload is either plain text (→ DEFAULT_SCHEMA {result}) or a JSON object
// { system?, prompt|user, schema? } that supplies its own bounded json_schema.
function buildCompletion(payload, model) {
  let system = 'You are a Task Router local specialist. Respond ONLY with JSON matching the provided schema.';
  let user = String(payload ?? '');
  let schema = DEFAULT_SCHEMA;
  const trimmed = user.trim();
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed);
      if (o && typeof o === 'object') {
        if (typeof o.system === 'string') system = o.system;
        if (typeof o.prompt === 'string') user = o.prompt; else if (typeof o.user === 'string') user = o.user;
        if (o.schema && typeof o.schema === 'object') schema = o.schema;
      }
    } catch { /* not JSON → treat as plain text */ }
  }
  return {
    model,
    temperature: Number(process.env.TASK_ROUTER_BACKEND_TEMPERATURE || 0.2),
    max_tokens: Number(process.env.TASK_ROUTER_BACKEND_MAX_TOKENS || 800),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'tr_result', strict: true, schema } },
  };
}
async function callModel(endpointUrl, apiKey, payload, model) {
  const url = new URL('chat/completions', endpointUrl.href.endsWith('/') ? endpointUrl.href : endpointUrl.href + '/').href;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`; // H2: only reached after H1 approved the host
  const res = await request('POST', url, { headers, body: buildCompletion(payload, model), timeoutMs: Number(process.env.TASK_ROUTER_BACKEND_TIMEOUT_MS || 600000) });
  if (res.status !== 200) throw new Error(`model HTTP ${res.status}: ${res.raw.slice(0, 300)}`);
  let j; try { j = JSON.parse(res.raw); } catch { throw new Error(`model returned non-JSON: ${res.raw.slice(0, 200)}`); }
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof content !== 'string') throw new Error('model response missing choices[0].message.content');
  return content; // already a json_schema-valid JSON string
}

// ---------------------------------------------------------------------------
// Main resident-poll loop.
// ---------------------------------------------------------------------------
async function main() {
  const base = process.env.TASK_ROUTER_BASE_URL || DEFAULT_TR_BASE;
  const project = process.env.TASK_ROUTER_PROJECT || die('TASK_ROUTER_PROJECT not set');
  const agent = process.env.TASK_ROUTER_AGENT || die('TASK_ROUTER_AGENT not set');
  const kind = process.env.TASK_ROUTER_BACKEND_KIND || 'openai-compatible';
  if (kind !== 'openai-compatible') die(`unsupported backend kind: ${kind} (only "openai-compatible")`);
  const driver = process.env.TASK_ROUTER_BACKEND_DRIVER || 'minimal';
  if (driver !== 'minimal') die(`unsupported backend driver: ${driver} (C-1 ships "minimal" only)`);
  const endpoint = assertEndpointAllowed(process.env.TASK_ROUTER_BACKEND_ENDPOINT || die('TASK_ROUTER_BACKEND_ENDPOINT not set')); // H1
  const model = process.env.TASK_ROUTER_BACKEND_MODEL || process.env.TASK_ROUTER_MODEL || die('TASK_ROUTER_BACKEND_MODEL not set');
  const apiKey = resolveBackendKey(process.env.TASK_ROUTER_BACKEND_API_KEY_ENV); // H2
  const pollMs = Number(process.env.TASK_ROUTER_BACKEND_POLL_MS || 3000);

  log(`starting: agent=${agent} project=${project} model=${model} endpoint=${endpoint.origin} driver=${driver}`);

  // Initial TR session WITH RETRY — a TR-down-at-startup race must NOT exit the process (that would
  // violate the never-relaunched autonomy invariant; the launcher/server may still be coming up).
  let sid = null;
  while (!sid) {
    try { sid = await mcpSession(base, project, agent); }
    catch (e) { log(`initial TR session failed, retrying in ${pollMs}ms: ${e.message}`); await sleep(pollMs); }
  }
  // Self-register (idempotent) so C-0 (operator-placed, no launcher pre-register) works too.
  // The tool's required identity param is `name` (server.js register schema), NOT `agent`.
  try { await mcpCall(base, project, sid, 'register_agent', { name: agent, project, capabilities: (process.env.TASK_ROUTER_BACKEND_CAPABILITIES || '').split(',').map((s) => s.trim()).filter(Boolean), metadata: { backend: true } }); }
  catch (e) { log(`register_agent (non-fatal, launcher may have pre-registered): ${e.message}`); }
  await hookStop(base, project, agent); // yellow→green + TTL

  // Resident poll loop — drain the inbox, then idle-poll. Never exits on empty.
  let idlePolls = 0;
  const TTL_REFRESH_EVERY = Math.max(1, Math.round(30000 / pollMs)); // refresh terminal-state TTL ~every 30s idle
  for (;;) {
    let pickup = null;
    try { pickup = await mcpCall(base, project, sid, 'pickup_next_task', { agent, project }); }
    catch (e) {
      log(`pickup failed, re-establishing session: ${e.message}`);
      try { sid = await mcpSession(base, project, agent); } catch (e2) { log(`re-init failed: ${e2.message}`); }
      await sleep(pollMs); continue;
    }
    // pickup_next_task returns { task: { task_id, payload, ... }, remaining_inbox } — read the NESTED task.
    const t = pickup && pickup.task;
    const taskId = t && (t.task_id || t.id);
    const payload = t && (t.payload ?? t.prompt ?? t.text);
    if (!taskId) {
      // empty inbox → idle poll (no model call). Refresh TTL periodically so a long idle stretch
      // doesn't let the server expire the agent (pickup touches liveness; this covers terminal state).
      if (++idlePolls % TTL_REFRESH_EVERY === 0) await hookStop(base, project, agent);
      await sleep(pollMs); continue;
    }
    idlePolls = 0;

    log(`task ${taskId}: calling model`);
    let result, modelOk = false;
    try { result = await callModel(endpoint, apiKey, payload, model); modelOk = true; }
    catch (e) { log(`task ${taskId} model FAILED: ${e.message}`); result = JSON.stringify({ error: `local-runner: ${e.message}` }); }
    // Complete with a one-shot session-refresh retry so a computed model result is not lost to MCP
    // session eviction between pickup and complete.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await mcpCall(base, project, sid, 'complete_task', { task_id: taskId, agent, project, result }); log(`task ${taskId}: ${modelOk ? 'completed' : 'reported error'}`); break; }
      catch (e) {
        log(`complete_task failed (attempt ${attempt + 1}): ${e.message}`);
        if (attempt === 0) { try { sid = await mcpSession(base, project, agent); } catch { /* keep stale sid as last resort */ } }
        else log(`could not report result for ${taskId} — server timeout will recover it`);
      }
    }
    await hookStop(base, project, agent); // honest state + TTL after each task
    // loop immediately to drain the inbox; sleep only happens on an empty pickup
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// CLI: `node local-runner.js --selfcheck` validates H1/H2 + a single model call
// WITHOUT touching the TR server (for build/smoke tests against a live endpoint).
if (process.argv[2] === '--selfcheck') {
  (async () => {
    const endpoint = assertEndpointAllowed(process.env.TASK_ROUTER_BACKEND_ENDPOINT || die('set TASK_ROUTER_BACKEND_ENDPOINT'));
    const model = process.env.TASK_ROUTER_BACKEND_MODEL || die('set TASK_ROUTER_BACKEND_MODEL');
    const apiKey = resolveBackendKey(process.env.TASK_ROUTER_BACKEND_API_KEY_ENV);
    const out = await callModel(endpoint, apiKey, 'Reply with a JSON object {"result":"READY"}.', model);
    console.log('selfcheck OK:', out.slice(0, 200));
    process.exit(0);
  })().catch((e) => { console.error('selfcheck FAILED:', e.message); process.exit(1); });
} else {
  main().catch((e) => die(e.message));
}
