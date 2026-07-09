#!/usr/bin/env node
/**
 * Task Router seeded client (v4.0).
 *
 * Deterministic, zero-dep Node.js helper for talking to the task-router
 * MCP/REST server. Ships into every consumer project's
 * .claude/mcp/task-router/client.js via init.sh. Agents invoke it as a
 * subprocess; output is JSON on stdout.
 *
 * Why this exists: agents without native mcp__task-router__* tool
 * injection were rolling their own HTTP clients and tripping on the
 * 406-without-text/event-stream-Accept and session-init handshake.
 * One canonical client eliminates the failure class.
 *
 * Usage:
 *   node client.js pickup
 *   node client.js complete --task-id=<id> (--result='<text>' | --result-file=<path> | --result-ref=<path> --result-description='<text>') [--state-brief='<json>']
 *     # --result      inline text result
 *     # --result-file inline a file's CONTENT into the DB (awkward markdown that should travel)
 *     # --result-ref  the deliverable IS a file: store a REFERENCE (path + description); content stays on disk
 *   node client.js dispatch --to=<agent> --payload='<text>' [--from=<agent>]
 *   node client.js collect-results
 *   node client.js list-agents
 *   node client.js save-memory --key=<k> --value='<v>'
 *   node client.js load-memory [--key=<k>]
 *   node client.js audit-report --json='<{...}>'    # convenience: complete with JSON payload
 *   node client.js --protocol-version              # prints "node/v4.6"
 *
 *   # v4.2 inter-PM federation (caller side; needs an owner-issued trtok_ token):
 *   node client.js remote-list-agents --url=<remote> --project=<proj> --token-env=FED_TOK
 *   node client.js remote-read-guidelines  --url=<remote> --project=<proj> --agent=<a> --token-env=FED_TOK
 *   node client.js remote-write-guidelines --url=<remote> --project=<proj> --agent=<a> --file=<path> --token-env=FED_TOK
 *   node client.js remote-execute --url=<remote> --project=<proj> --agent=<a> --payload='<text>' --token-env=FED_TOK [--no-wait]
 *
 * Env (defaults from launcher):
 *   TASK_ROUTER_AGENT     agent name
 *   TASK_ROUTER_PROJECT   project slug
 *   TASK_ROUTER_BASE_URL  default http://127.0.0.1:3100
 *   TASK_ROUTER_API_KEY   optional bearer key for gated servers
 *
 * Stdout schema (always):
 *   {"ok": true|false, "result": <object|null>, "error": <string|null>}
 *
 * Exit code 0 on ok=true, 1 on ok=false.
 */

import http from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Enterprise Phase 0: this fleet's identity, written at bootstrap to fleet.json
// beside this client. Sent on every federated call so the remote (SoT) records
// us in its fleet registry. Absent file → plain federation (back-compat).
function loadFleetIdentity() {
  try {
    const p = path.join(__dirname, 'fleet.json');
    if (existsSync(p)) {
      const f = JSON.parse(readFileSync(p, 'utf8'));
      const out = {};
      if (f.fleet_id) out.fleet_id = f.fleet_id;
      if (f.enterprise_project_id) out.enterprise_project_id = f.enterprise_project_id;
      if (f.role) out.fleet_role = f.role;
      return out;
    }
  } catch { /* fleet.json is optional */ }
  return {};
}

// A1: the fleet registry (`fleet/fleet.config.json`) — an array of
// { name, url, grant, project, tokenRef } entries. `--fleet=<name>` resolves a
// single entry into --url/--project/--token-env so federation calls don't repeat
// three flags. Looked up relative to cwd first (calls run from the project root),
// then relative to this client (.claude/mcp/task-router → ../../../fleet). The file
// is descriptive-only otherwise; this is the one place the client consumes it.
function loadFleetConfig() {
  const candidates = [
    path.join(process.cwd(), 'fleet', 'fleet.config.json'),
    path.join(__dirname, '..', '..', '..', 'fleet', 'fleet.config.json'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        // Accept either a bare array or { fleets: [...] }.
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.fleets) ? parsed.fleets : []);
        if (list.length) return { path: p, fleets: list };
      }
    } catch { /* malformed config → fall through to next candidate */ }
  }
  return { path: null, fleets: [] };
}

// Strip the documentary `env:` prefix some tokenRef values carry. The CLI wants the
// BARE env-var name; `--token-env=env:FOO` would look up process.env['env:FOO'] →
// undefined → silent 401. Tolerate both forms here so the gotcha can't happen.
function stripEnvPrefix(name) {
  const s = String(name || '');
  return s.startsWith('env:') ? s.slice(4) : s;
}

// A1: if --fleet=<name> is given, fill in any unset --url/--project/--token-env from
// the matching fleet.config.json entry. Explicit flags always win over the registry.
function applyFleetAlias(args) {
  if (!args.fleet) return;
  const { path: cfgPath, fleets } = loadFleetConfig();
  if (!fleets.length) {
    throw new Error(`--fleet=${args.fleet} given but no fleet/fleet.config.json found (looked in ./fleet and the seed dir)`);
  }
  const want = String(args.fleet).toLowerCase();
  const entry = fleets.find((f) => String(f.name || '').toLowerCase() === want
    || String(f.project || '').toLowerCase() === want);
  if (!entry) {
    const names = fleets.map((f) => f.name || f.project).filter(Boolean).join(', ');
    throw new Error(`--fleet=${args.fleet} not found in ${cfgPath}. Known fleets: ${names || '(none)'}`);
  }
  if (args.url === undefined && entry.url) args.url = entry.url;
  if (args.project === undefined && entry.project) args.project = entry.project;
  // tokenRef carries the env-var name (often prefixed `env:`); map to --token-env
  // only when the caller hasn't already supplied a token.
  if (args.token === undefined && args['token-env'] === undefined && entry.tokenRef) {
    args['token-env'] = stripEnvPrefix(entry.tokenRef);
  }
}

const PROTOCOL_VERSION = 'node/v4.6';
const DEFAULT_BASE = 'http://127.0.0.1:3100';

function parseArgs(argv) {
  const out = { _: [] };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
      else out[arg.slice(2)] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function emit(ok, result, error) {
  process.stdout.write(JSON.stringify({ ok, result: ok ? result : null, error: ok ? null : error }) + '\n');
  process.exit(ok ? 0 : 1);
}

function postJson(baseUrl, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': data.length,
      'x-task-router-client': PROTOCOL_VERSION,
    }, extraHeaders);
    if (process.env.TASK_ROUTER_API_KEY) headers['x-task-router-key'] = process.env.TASK_ROUTER_API_KEY;
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(baseUrl, path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const headers = { 'Accept': 'application/json', 'x-task-router-client': PROTOCOL_VERSION };
    if (process.env.TASK_ROUTER_API_KEY) headers['x-task-router-key'] = process.env.TASK_ROUTER_API_KEY;
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// MCP Streamable HTTP returns SSE-framed responses with a single "data: <json>" line.
function parseMcpResponse(raw) {
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const body = line.slice(5).trim();
      try { return JSON.parse(body); } catch (e) { return null; }
    }
  }
  // Fall back: some servers reply with a plain JSON body (no SSE framing) for simple POSTs.
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function mcpSession(baseUrl, project, agent) {
  const path = `/mcp?project=${encodeURIComponent(project)}`;
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: `${agent || 'client'}-cli`, version: PROTOCOL_VERSION },
    },
  };
  const res = await postJson(baseUrl, path, initBody);
  if (res.status !== 200) throw new Error(`initialize HTTP ${res.status}: ${res.raw.slice(0, 200)}`);
  const sid = res.headers['mcp-session-id'];
  if (!sid) throw new Error('initialize: server returned no mcp-session-id header');
  return sid;
}

async function mcpCall(baseUrl, project, sid, toolName, args, reqId) {
  const path = `/mcp?project=${encodeURIComponent(project)}`;
  const body = {
    jsonrpc: '2.0',
    id: reqId,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const res = await postJson(baseUrl, path, body, { 'mcp-session-id': sid });
  if (res.status !== 200) throw new Error(`${toolName} HTTP ${res.status}: ${res.raw.slice(0, 200)}`);
  const parsed = parseMcpResponse(res.raw);
  if (!parsed) throw new Error(`${toolName}: unparseable response: ${res.raw.slice(0, 200)}`);
  if (parsed.error) throw new Error(`${toolName} error: ${JSON.stringify(parsed.error)}`);
  // Tool results are wrapped: { result: { content: [{ type: 'text', text: '<text>' }] } }
  // Tools often return a human headline followed by a JSON object; isolate
  // the trailing JSON block when present, otherwise return the raw text.
  const content = parsed.result && parsed.result.content;
  if (Array.isArray(content) && content[0] && typeof content[0].text === 'string') {
    const text = content[0].text;
    try { return JSON.parse(text); } catch (e) { /* fall through */ }
    const braceIdx = text.indexOf('{');
    if (braceIdx >= 0) {
      try { return JSON.parse(text.slice(braceIdx)); } catch (e) { /* fall through */ }
    }
    return text;
  }
  return parsed.result;
}

// --- v4.2 inter-PM federation (caller side) ---
// These talk to a REMOTE server's /api/federation/* endpoints directly, using
// an owner-issued `trtok_` token (NOT the local global key, NOT an MCP session).

function fedResolveToken(args) {
  if (args.token) return String(args.token);
  // M2: tolerate a leading `env:` (the tokenRef convention) so --token-env=env:FOO
  // and --token-env=FOO both resolve process.env.FOO instead of silently 401-ing.
  const envName = stripEnvPrefix(args['token-env'] || 'TASK_ROUTER_FED_TOKEN');
  const v = process.env[envName];
  if (!v) throw new Error(`federation token not found in env var "${envName}" — pass --token=<trtok_...>, or --token-env=<ENV> (default TASK_ROUTER_FED_TOKEN). Note: pass the BARE var name, not the "env:" prefix.`);
  return v;
}

function fedPost(baseUrl, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': data.length,
      'x-task-router-client': PROTOCOL_VERSION,
      'x-task-router-fed-token': token,
    };
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(raw); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fedGet(baseUrl, path, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const headers = {
      'Accept': 'application/json',
      'x-task-router-client': PROTOCOL_VERSION,
      'x-task-router-fed-token': token,
    };
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(raw); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Issue one federated request and, unless --no-wait, long-poll the PM's result.
async function fedRequestAndMaybeWait(args, operation, payloadText) {
  const url = args.url;
  const project = args.project;
  const agent = args.agent;
  if (!url) throw new Error('--url=<remote base url> required');
  if (!project) throw new Error('--project=<remote project> required');
  if (!agent) throw new Error('--agent=<remote agent> required');
  const token = fedResolveToken(args);
  const r = await fedPost(url, `/api/federation/request?project=${encodeURIComponent(project)}`, { project, agent, operation, payload: payloadText || '', ...loadFleetIdentity() }, token);
  if (r.status !== 200) return emit(false, null, `federation request HTTP ${r.status}: ${JSON.stringify(r.json || r.raw).slice(0, 300)}`);
  const taskId = r.json && r.json.task_id;
  if (!taskId) return emit(false, null, `no task_id in response: ${r.raw.slice(0, 200)}`);
  if (args['no-wait']) return emit(true, { task_id: taskId, routed_to: r.json.routed_to });
  const timeoutMs = parseInt(args['timeout-ms'] || '600000', 10);
  const wr = await fedPost(url, `/api/federation/wait?project=${encodeURIComponent(project)}`, { project, task_id: taskId, timeout_ms: timeoutMs }, token);
  if (wr.status !== 200) return emit(false, null, `federation wait HTTP ${wr.status}: ${JSON.stringify(wr.json || wr.raw).slice(0, 300)}`);
  return emit(true, { task_id: taskId, ...wr.json });
}

async function runTool(toolName, args) {
  const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
  const project = process.env.TASK_ROUTER_PROJECT;
  const agent = process.env.TASK_ROUTER_AGENT;
  if (!project) throw new Error('TASK_ROUTER_PROJECT env var not set');
  const sid = await mcpSession(baseUrl, project, agent);
  return await mcpCall(baseUrl, project, sid, toolName, args, 2);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`Task Router client ${PROTOCOL_VERSION}\nCommands: pickup, complete, dispatch, collect-results, list-agents, save-memory, load-memory, audit-report, stats\nEnterprise/SoT (owner): fleet-registry, set-topic-owner, list-topic-owners, analyze-demand\nFederation (caller): remote-list-agents, remote-projects, remote-read-guidelines, remote-write-guidelines, remote-execute\n  (need --url=<remote> --project=<remote-proj> [--agent=<agent>] and a token via --token / --token-env / TASK_ROUTER_FED_TOKEN)\n  remote-projects needs only --url + token (lists the remote's slugs to fix a project_not_registered 404)\n  shorthand: --fleet=<name> resolves --url/--project/--token-env from fleet/fleet.config.json\n`);
    process.exit(0);
  }
  if (cmd === '--protocol-version') {
    process.stdout.write(PROTOCOL_VERSION + '\n');
    process.exit(0);
  }

  try {
    const project = process.env.TASK_ROUTER_PROJECT;
    const agent = args.agent || process.env.TASK_ROUTER_AGENT;
    // A1: resolve a --fleet=<name> alias into --url/--project/--token-env before any
    // command runs (no-op when --fleet is absent; throws cleanly on an unknown name).
    applyFleetAlias(args);

    switch (cmd) {
      case 'pickup': {
        if (!agent) throw new Error('agent required (--agent=... or TASK_ROUTER_AGENT env)');
        const r = await runTool('pickup_next_task', { agent, project });
        return emit(true, r);
      }
      case 'complete': {
        if (!agent) throw new Error('agent required');
        if (!args['task-id']) throw new Error('--task-id required');
        // v4.6: the result may be passed inline (--result='<text>') OR read from
        // a file (--result-file=<path>). The file form avoids shell-quoting
        // hazards for markdown results (backticks trigger command substitution;
        // quotes/newlines break inline args). Before v4.6, an unrecognized
        // --result-file was SILENTLY IGNORED and an empty result submitted — a
        // successful-looking call that delivered nothing. Now it is read, and an
        // empty submission warns on stderr.
        // v4.6 file-result reference (FILE_RESULT_PLAN): when the deliverable IS a
        // file, the result stored in the DB is a REFERENCE — the path + a
        // substantive description — not the inlined content. The file stays on
        // disk; the description is what consumers (dashboard / Telegram / remote
        // PM) see. `--result-ref` takes precedence over `--result-file` (inline
        // content) and `--result` (inline text).
        let result;
        if (args['result-ref'] !== undefined) {
          const refPath = args['result-ref'];
          if (typeof refPath !== 'string' || !refPath) {
            throw new Error('--result-ref requires a path');
          }
          const desc = args['result-description'];
          if (typeof desc !== 'string' || !desc.trim()) {
            throw new Error('--result-ref requires a substantive --result-description (the file content stays on disk; the description is what consumers see)');
          }
          if (!existsSync(refPath)) {
            process.stderr.write(`[client] warning: --result-ref path "${refPath}" does not exist (typo?); submitting the reference anyway.\n`);
          }
          result = `[FILE RESULT]\npath: ${refPath}\ndescription: ${desc.trim()}\n[/FILE RESULT]`;
        } else if (args['result-file'] !== undefined) {
          if (typeof args['result-file'] !== 'string' || !args['result-file']) {
            throw new Error('--result-file requires a path');
          }
          try { result = readFileSync(args['result-file'], 'utf8'); }
          catch (e) { throw new Error(`--result-file could not be read: ${e.message}`); }
        } else {
          result = args.result || '';
        }
        if (!result) {
          process.stderr.write('[client] warning: submitting an EMPTY result (no --result text and no --result-file content).\n');
        }
        const callArgs = {
          task_id: args['task-id'],
          agent,
          project,
          result,
        };
        // v4.4: optional state brief, passed as a JSON string
        // (e.g. --state-brief='{"warm_on":["auth"],"context":"~68% window","flags":["consider-consolidation"]}').
        // It is a routing hint only; the server caches it in memory (never persisted).
        if (args['state-brief'] !== undefined) {
          let brief;
          try { brief = JSON.parse(args['state-brief']); }
          catch (e) { throw new Error(`--state-brief must be valid JSON: ${e.message}`); }
          callArgs.state_brief = brief;
        }
        const r = await runTool('complete_task', callArgs);
        if (r && typeof r === 'object' && typeof r.error === 'string') return emit(false, null, r.error);
        return emit(true, r);
      }
      case 'dispatch': {
        if (!args.to) throw new Error('--to=<agent> required');
        const r = await runTool('dispatch_task', {
          to: args.to,
          from: args.from || agent || 'pm',
          payload: args.payload || '',
          project,
        });
        return emit(true, r);
      }
      case 'collect-results': {
        const dispatcher = args.dispatcher || agent || 'pm';
        const r = await runTool('collect_results', { dispatcher, project });
        return emit(true, r);
      }
      case 'list-agents': {
        const r = await runTool('list_agents', { project });
        return emit(true, r);
      }
      case 'save-memory': {
        if (!agent) throw new Error('agent required');
        if (!args.key) throw new Error('--key required');
        const r = await runTool('save_memory', {
          agent,
          project,
          key: args.key,
          value: args.value || '',
        });
        return emit(true, r);
      }
      case 'load-memory': {
        if (!agent) throw new Error('agent required');
        const params = { agent, project };
        if (args.key) params.key = args.key;
        const r = await runTool('load_memory', params);
        return emit(true, r);
      }
      case 'audit-report': {
        if (!agent) throw new Error('agent required');
        if (!args['task-id']) throw new Error('--task-id required');
        if (!args.json) throw new Error('--json=<{...}> required');
        const r = await runTool('complete_task', {
          task_id: args['task-id'],
          agent,
          project,
          result: args.json,
        });
        return emit(true, r);
      }
      case 'stats': {
        const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
        const r = await getJson(baseUrl, `/stats?project=${encodeURIComponent(project || '')}`);
        if (r.status !== 200) throw new Error(`/stats HTTP ${r.status}`);
        try { return emit(true, JSON.parse(r.raw)); } catch (e) { return emit(true, r.raw); }
      }

      // --- Enterprise SoT-side (Phase 0/3): local owner ops against THIS server ---
      case 'fleet-registry': {  // fleets that have federated into this SoT
        const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
        const r = await getJson(baseUrl, `/api/fleet_registry?project=${encodeURIComponent(project || '')}`);
        if (r.status !== 200) throw new Error(`/api/fleet_registry HTTP ${r.status}`);
        try { return emit(true, JSON.parse(r.raw)); } catch (e) { return emit(true, r.raw); }
      }
      case 'analyze-demand': {  // recurring read topics -> candidates for active pull
        const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
        const qs = `project=${encodeURIComponent(project || '')}&min=${encodeURIComponent(args.min || '3')}&since_ms=${encodeURIComponent(args['since-ms'] || '0')}`;
        const r = await getJson(baseUrl, `/api/fleet_demand?${qs}`);
        if (r.status !== 200) throw new Error(`/api/fleet_demand HTTP ${r.status}`);
        try { return emit(true, JSON.parse(r.raw)); } catch (e) { return emit(true, r.raw); }
      }
      case 'list-topic-owners': {
        const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
        const r = await getJson(baseUrl, `/api/topic_ownership?project=${encodeURIComponent(project || '')}`);
        if (r.status !== 200) throw new Error(`/api/topic_ownership HTTP ${r.status}`);
        try { return emit(true, JSON.parse(r.raw)); } catch (e) { return emit(true, r.raw); }
      }
      case 'set-topic-owner': {  // --topic=X --fleet-id=Y [--role=Z]
        if (!args.topic) throw new Error('--topic=<topic> required');
        const baseUrl = process.env.TASK_ROUTER_BASE_URL || DEFAULT_BASE;
        const r = await postJson(baseUrl, '/api/topic_ownership', { project, topic: args.topic, fleet_id: args['fleet-id'] || null, role: args.role || null });
        if (r.status !== 200) throw new Error(`set-topic-owner HTTP ${r.status}: ${r.raw.slice(0, 200)}`);
        try { return emit(true, JSON.parse(r.raw)); } catch (e) { return emit(true, r.raw); }
      }

      // --- v4.2 inter-PM federation (caller side) ---
      case 'remote-list-agents': {
        if (!args.url) throw new Error('--url=<remote base url> required');
        if (!args.project) throw new Error('--project=<remote project> required');
        const token = fedResolveToken(args);
        const r = await fedPost(args.url, `/api/federation/list_agents?project=${encodeURIComponent(args.project)}`, { project: args.project, ...loadFleetIdentity() }, token);
        if (r.status !== 200) return emit(false, null, `HTTP ${r.status}: ${JSON.stringify(r.json || r.raw).slice(0, 300)}`);
        return emit(true, r.json);
      }
      // A2: discover the remote's registered project slugs (no --project needed —
      // this is how you find the correct lowercase slug after a 404).
      case 'remote-projects': {
        if (!args.url) throw new Error('--url=<remote base url> required');
        const token = fedResolveToken(args);
        const r = await fedGet(args.url, '/api/federation/projects', token);
        if (r.status !== 200) return emit(false, null, `HTTP ${r.status}: ${JSON.stringify(r.json || r.raw).slice(0, 300)}`);
        return emit(true, r.json);
      }
      case 'remote-read-guidelines': {
        return await fedRequestAndMaybeWait(args, 'read_guidelines', '');
      }
      case 'remote-write-guidelines': {
        let content = args.content;
        if (content === undefined && args.file) content = readFileSync(args.file, 'utf8');
        if (content === undefined) throw new Error('--content=<text> or --file=<path> required');
        return await fedRequestAndMaybeWait(args, 'write_guidelines', String(content));
      }
      case 'remote-execute': {
        if (args.payload === undefined) throw new Error('--payload=<text> required');
        return await fedRequestAndMaybeWait(args, 'execute', String(args.payload));
      }

      default:
        return emit(false, null, `unknown command: ${cmd}`);
    }
  } catch (e) {
    return emit(false, null, e.message || String(e));
  }
}

main();
