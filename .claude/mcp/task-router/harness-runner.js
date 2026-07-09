#!/usr/bin/env node
/**
 * harness-runner.js — Task Router C-2 agentic-coding harness supervisor (seed v4.30+).
 *
 * The C-2 counterpart to local-runner.js (C-1). A local model drives a coding CLI
 * (Pi / OpenCode) per task: the supervisor is a resident TR agent that, for each
 * task, spawns a ONE-SHOT harness CLI in the task's workdir, pointed at a loopback
 * proxy this supervisor runs, and returns the CLI's result.
 *
 * Design + audit trail: doc/plans/LOCAL_MODEL_BACKEND_PLAN.md §2 C-HARNESS-*.
 * NOTE: agentic coding is a 31B-tier capability — a ~12B cannot drive the loop
 * (it hangs), so this is validated on plumbing/security against a 12B but is only
 * functionally usable on a 31B. Capability-scope harness agents accordingly.
 *
 * SECURITY (all controls live HERE — the CLI's own fetch follows redirects and we
 * can't change that inside it, so we interpose a proxy we fully own):
 *   - Loopback proxy resolves+PINS the upstream IP, H1-checks it (loopback/RFC-1918,
 *     metadata denied), and via node:http NEVER auto-follows a 3xx.
 *   - Per-spawn CLIENT TOKEN: the CLI config gets the token as its apiKey; the proxy
 *     serves only callers presenting it; the REAL model key is injected at the proxy
 *     and never written to the CLI config.
 *   - The child gets an ALLOWLIST env (PATH + OS basics + per-task config-homes only) —
 *     NO host secret (the model key, ANTHROPIC_ and other provider keys, tokens, AWS_) is
 *     inherited, and its config homes are redirected so it can't reach global creds.
 *   - The untrusted task payload is delivered on the child's STDIN, NEVER in argv — a .cmd
 *     needs shell:true on Windows and shell:true does not escape argv, so an untrusted argv
 *     element would be a command-injection vector. (Audit-fixed 2026-07-04.)
 *   - Hard timeout + cross-platform TREE-kill so a hung CLI can't hold the agent busy.
 *
 * VERIFIED on a 31B (qwen3.6-35b-a3b via LM Studio, 2026-07-08): pi DOES read the prompt from stdin in
 * one-shot mode (`-p --mode json --no-session`), and parseResult reduces pi v0.80's streamed JSON to the
 * assistant text (final `message.content` is an ARRAY of {type:'thinking'|'text'} — take the 'text' parts).
 * The 31B run caught + fixed the array-content schema (the 12B plumbing test had used a string-content mock).
 * OpenCode (v1.17) validated too (drop-in kind:'opencode'): reads the prompt from stdin, `run --model
 * local/<model> --dir <workdir>` drives the model — `--dir` is REQUIRED (a cmd.exe-spawn CWD-discovery
 * quirk: without it opencode ignores the workdir's opencode.json → the 'local' provider never registers
 * → "Model not found"). Verified end-to-end on gemma-4-31b-qat via LM Studio (agentic bug-fix, 2026-07-09).
 * Output parses clean via stdout.trim().
 *
 * Env (C-ENV-harness, set by the launcher):
 *   TASK_ROUTER_AGENT / _PROJECT / _BASE_URL / _API_KEY  (TR server, as C-1)
 *   TASK_ROUTER_HARNESS_KIND         "pi" | "opencode"
 *   TASK_ROUTER_HARNESS_ENDPOINT     the model's OpenAI-compatible base URL (H1-gated)
 *   TASK_ROUTER_HARNESS_MODEL        model id
 *   TASK_ROUTER_HARNESS_API_KEY_ENV  NAME of the env var holding the model key (H2)
 *   TASK_ROUTER_HARNESS_TIMEOUT_MS   per-task hard timeout, default 900000 (15 min)
 *   TASK_ROUTER_HARNESS_HOST_ALLOW   comma-list of extra allowed upstream hosts
 *   TASK_ROUTER_HARNESS_POLL_MS      idle poll interval, default 3000
 *   TASK_ROUTER_HARNESS_BIN          override the CLI binary (default: kind)
 */

import http from 'node:http';
import https from 'node:https';
import dnsp from 'node:dns/promises';
import { URL, fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = 'node/harness-runner-v1';
const DEFAULT_TR_BASE = 'http://127.0.0.1:3100';
const API_KEY_ENV_ALLOW = /^(LM_STUDIO_|TASK_ROUTER_HARNESS_|TASK_ROUTER_BACKEND_|LOCAL_)/;

function log(msg) { process.stderr.write(`[harness-runner] ${msg}\n`); }
function die(msg) { log(`FATAL: ${msg}`); process.exit(1); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// H1 — allow/deny on the RESOLVED IP (DNS-rebind safe), + H2 key-env allow-list.
// ---------------------------------------------------------------------------
function ipDenied(ip) {
  const b = ip.replace(/^::ffff:/i, '');
  if (/^169\.254\./.test(b)) return true;   // link-local incl. 169.254.169.254 (cloud metadata)
  if (/^fe80:/i.test(ip)) return true;       // IPv6 link-local
  return false;
}
function ipAllowed(ip) {
  if (ipDenied(ip)) return false;
  const b = ip.replace(/^::ffff:/i, '');
  if (ip === '::1') return true;
  const m = b.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], c = +m[2];
  if (a === 127 || a === 10) return true;
  if (a === 192 && c === 168) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  return false;
}
function resolveKey(name) {
  if (!name) return null;
  if (!API_KEY_ENV_ALLOW.test(name)) die(`harness api_key_env "${name}" not allow-listed (H2). Allowed prefixes: LM_STUDIO_, TASK_ROUTER_HARNESS_, TASK_ROUTER_BACKEND_, LOCAL_.`);
  return process.env[name] || null;
}

// ---------------------------------------------------------------------------
// The loopback proxy (validated 2026-07-04). Resolves+pins the upstream, injects
// the key, gates on a per-spawn client token + path, pipes (SSE-safe), no-redirect.
// ---------------------------------------------------------------------------
export async function startHarnessProxy({ upstream, apiKey = null, extraAllow = [] }) {
  const u = new URL(upstream);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') die(`upstream scheme must be http(s): ${u.protocol}`);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  let pinnedIp;
  try { ({ address: pinnedIp } = await dnsp.lookup(u.hostname)); } catch (e) { die(`cannot resolve upstream ${u.hostname}: ${e.message}`); }
  const allowedByName = extraAllow.map((s) => s.toLowerCase()).includes(u.hostname.toLowerCase());
  if (ipDenied(pinnedIp)) die(`H1: upstream ${u.hostname} → ${pinnedIp} is a denied (cloud-metadata / link-local) address`); // unconditional — HOST_ALLOW can never re-open metadata
  if (!ipAllowed(pinnedIp) && !allowedByName) die(`H1: upstream ${u.hostname} → ${pinnedIp} not allowed (loopback/RFC-1918 only; add hosts via TASK_ROUTER_HARNESS_HOST_ALLOW)`);
  const basePath = u.pathname.replace(/\/$/, '');
  const clientToken = crypto.randomBytes(24).toString('hex');
  const mod = u.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    if ((req.headers['authorization'] || '') !== `Bearer ${clientToken}`) { res.writeHead(401); return res.end('proxy: unauthorized'); }
    if (!/^\/(v1|health|models|chat|completions|embeddings)\b/.test(req.url) && req.url !== basePath && !req.url.startsWith(basePath + '/')) { res.writeHead(404); return res.end('proxy: path not allowed'); }
    const headers = { ...req.headers, host: `${u.hostname}:${port}` };
    delete headers['authorization'];
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
    const fwdPath = req.url.startsWith(basePath) ? req.url : basePath + req.url;
    const fwd = mod.request({ host: pinnedIp, port, path: fwdPath, method: req.method, headers }, (up) => {
      if (up.statusCode >= 300 && up.statusCode < 400) { up.resume(); up.destroy(); res.writeHead(502); return res.end('proxy: upstream redirect refused'); }
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    fwd.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(`proxy: upstream error ${e.message}`); });
    req.pipe(fwd);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}${basePath}`, clientToken, pinnedIp, close: () => server.close() };
}

// ---------------------------------------------------------------------------
// Child env SCRUB — the CLI must not inherit the model key or foreign base URLs.
// ---------------------------------------------------------------------------
// ALLOWLIST (not denylist): pass only what a coding CLI needs, so NO host secret reaches the child —
// ANTHROPIC_* and every other provider key / token / AWS_* on the host is simply absent — and redirect
// EVERY config-home the CLI (or its tool subprocesses) reads so it can't reach the real user's global creds.
function childEnv(homeDir) {
  const KEEP = ['PATH', 'Path', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'OS', 'LANG', 'LC_ALL', 'TZ'];
  const e = {};
  for (const k of KEEP) if (process.env[k] != null) e[k] = process.env[k];
  e.HOME = homeDir; e.USERPROFILE = homeDir;
  e.APPDATA = path.join(homeDir, 'AppData', 'Roaming');
  e.LOCALAPPDATA = path.join(homeDir, 'AppData', 'Local');
  e.XDG_CONFIG_HOME = path.join(homeDir, '.config');
  e.XDG_DATA_HOME = path.join(homeDir, '.local', 'share');
  return e;
}

// ---------------------------------------------------------------------------
// Cross-platform TREE-kill (grandchildren too — coding CLIs spawn tool procs).
// ---------------------------------------------------------------------------
function treeKill(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Per-harness adapters: argv() · materializeConfig() · parseResult().
// ---------------------------------------------------------------------------
const ADAPTERS = {
  pi: {
    bin: () => process.env.TASK_ROUTER_HARNESS_BIN || (process.platform === 'win32' ? 'pi.cmd' : 'pi'),
    materialize(dir, proxyUrl, token, model) {
      mkdirSync(path.join(dir, '.pi', 'agent'), { recursive: true });
      writeFileSync(path.join(dir, '.pi', 'agent', 'models.json'), JSON.stringify({
        providers: { local: { baseUrl: proxyUrl, api: 'openai-completions', apiKey: token, models: [{ id: model }] } },
      }));
    },
    // The untrusted prompt is delivered via STDIN, NOT argv (see runHarness). argv is controlled flags only.
    argv: (model, _dir) => ['-p', '--mode', 'json', '--provider', 'local', '--model', model, '--no-session'],
    parseResult(stdout, code) {
      // pi --mode json (v0.80+) streams JSON events; the assistant `message.content` is an ARRAY of
      // {type:'thinking'|'text', …}. Take the LAST assistant message and concatenate its 'text' parts
      // (dropping 'thinking'/reasoning). `agent_end.messages[]` is authoritative; message_end/turn_end/
      // the message_update partials carry the running `message` too. (Verified against qwen3.6-35b-a3b.)
      let contentArr = null;
      for (const line of stdout.split(/\r?\n/)) {
        const s = line.trim(); if (!s || s[0] !== '{') continue;
        let ev; try { ev = JSON.parse(s); } catch { continue; }
        if (ev.type === 'agent_end' && Array.isArray(ev.messages)) {
          for (let i = ev.messages.length - 1; i >= 0; i--) {
            const mm = ev.messages[i];
            if (mm && mm.role === 'assistant' && Array.isArray(mm.content)) { contentArr = mm.content; break; }
          }
        } else if (ev.message && ev.message.role === 'assistant' && Array.isArray(ev.message.content)) {
          contentArr = ev.message.content;
        }
      }
      let text = '';
      if (Array.isArray(contentArr)) {
        text = contentArr.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('').trim();
      }
      if (!text) {
        // Fallback: the older string-content schema (and single-field variants).
        for (const line of stdout.split(/\r?\n/)) {
          const s = line.trim(); if (!s || s[0] !== '{') continue;
          try { const ev = JSON.parse(s); const t = (typeof ev?.message?.content === 'string' && ev.message.content) || (typeof ev?.content === 'string' && ev.content) || ev?.delta?.content;
            if (typeof t === 'string' && t) text = t; } catch { /* skip */ }
        }
      }
      if (!text) text = stdout.trim();
      return { ok: code === 0, result: text };
    },
  },
  opencode: {
    bin: () => process.env.TASK_ROUTER_HARNESS_BIN || (process.platform === 'win32' ? 'opencode.cmd' : 'opencode'),
    materialize(dir, proxyUrl, token, model) {
      writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        provider: { local: { npm: '@ai-sdk/openai-compatible', name: 'Local', options: { baseURL: proxyUrl, apiKey: token }, models: { [model]: {} } } },
      }));
    },
    // --dir <workdir> is REQUIRED: when opencode's launcher is spawned via cmd.exe (shell:true on
    // Windows), opencode does NOT discover the project opencode.json from the process CWD, so the
    // 'local' provider never registers → "Model not found: local/<model>". --dir points it at the
    // workdir. `dir` is a harness-created temp path (trusted); quote on win32 for spaced-path safety.
    argv: (model, dir) => ['run', '--model', `local/${model}`, '--dir', process.platform === 'win32' ? `"${dir}"` : dir],
    parseResult: (stdout, code) => ({ ok: code === 0, result: stdout.trim() }),
  },
};

// ---------------------------------------------------------------------------
// TR loop helpers (same shape as local-runner.js / client.js).
// ---------------------------------------------------------------------------
function trHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-task-router-client': PROTOCOL_VERSION, ...extra };
  if (process.env.TASK_ROUTER_API_KEY) h['x-task-router-key'] = process.env.TASK_ROUTER_API_KEY;
  return h;
}
function trRequest(method, urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr); const mod = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const h = { ...headers }; if (data) h['Content-Length'] = data.length;
    const req = mod.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, timeout: 60000 }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('TR request timeout')));
    if (data) req.write(data); req.end();
  });
}
function parseMcp(raw) { for (const l of raw.split(/\r?\n/)) if (l.startsWith('data:')) { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } } try { return JSON.parse(raw); } catch { return null; } }
async function mcpSession(base, project, agent) {
  const r = await trRequest('POST', new URL(`/mcp?project=${encodeURIComponent(project)}`, base).href, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `${agent}-harness`, version: PROTOCOL_VERSION } } }, trHeaders());
  if (r.status !== 200) throw new Error(`TR initialize HTTP ${r.status}`);
  const sid = r.headers['mcp-session-id']; if (!sid) throw new Error('no mcp-session-id'); return sid;
}
async function mcpCall(base, project, sid, tool, args, id = 2) {
  const r = await trRequest('POST', new URL(`/mcp?project=${encodeURIComponent(project)}`, base).href, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }, trHeaders({ 'mcp-session-id': sid }));
  if (r.status !== 200) throw new Error(`${tool} HTTP ${r.status}: ${r.raw.slice(0, 160)}`);
  const p = parseMcp(r.raw); if (!p) throw new Error(`${tool}: unparseable`); if (p.error) throw new Error(`${tool}: ${JSON.stringify(p.error)}`);
  const content = p.result && p.result.content;
  if (Array.isArray(content) && content[0] && typeof content[0].text === 'string') { const t = content[0].text; try { return JSON.parse(t); } catch { const i = t.indexOf('{'); if (i >= 0) { try { return JSON.parse(t.slice(i)); } catch { /* */ } } return t; } }
  return p.result;
}
async function hookStop(base, project, agent) {
  try { await trRequest('POST', new URL('/hook/stop', base).href, {}, { 'Content-Type': 'application/json', 'X-Task-Router-Agent': agent, 'X-Task-Router-Project': project }); }
  catch (e) { log(`/hook/stop failed (non-fatal): ${e.message}`); }
}

// Run one harness CLI to completion for a task; returns { ok, result }.
async function runHarness(adapter, proxy, model, timeoutMs, payload) {
  // model comes from agents.json (semi-trusted) and DOES sit in argv under shell:true — restrict its charset.
  if (!/^[A-Za-z0-9._:/@\-]+$/.test(model)) return { ok: false, result: JSON.stringify({ error: `invalid model id "${model}" (charset)` }) };
  const dir = path.join(os.tmpdir(), `tr-harness-${crypto.randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  try {
    adapter.materialize(dir, proxy.url, proxy.clientToken, model);
    const env = childEnv(dir);
    const bin = adapter.bin();
    // CRITICAL: the untrusted task payload is delivered on STDIN, NEVER in argv. Spawning a .cmd needs
    // shell:true on Windows (Node 24 EINVALs shell:false for .cmd) and shell:true does NOT escape argv, so
    // any untrusted argv element is a command-injection vector. argv carries only controlled flags + a
    // charset-validated model.
    const child = spawn(bin, adapter.argv(model, dir), { cwd: dir, env, shell: process.platform === 'win32', detached: process.platform !== 'win32' });
    let out = '', err = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    try { child.stdin.write(String(payload ?? '')); child.stdin.end(); } catch { /* child may already be gone */ }
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { log(`harness timeout ${timeoutMs}ms — tree-killing pid ${child.pid}`); treeKill(child.pid); resolve('TIMEOUT'); }, timeoutMs);
      child.on('close', (c) => { clearTimeout(t); resolve(c); });
      child.on('error', (e) => { clearTimeout(t); log(`spawn error: ${e.message}`); resolve('SPAWN_ERR'); });
    });
    if (code === 'TIMEOUT') return { ok: false, result: JSON.stringify({ error: `harness timed out after ${timeoutMs}ms` }) };
    if (code === 'SPAWN_ERR') return { ok: false, result: JSON.stringify({ error: `harness could not spawn (${bin} on PATH?)` }) };
    const r = adapter.parseResult(out, code);
    if (!r.ok && err.trim()) r.result = `${r.result}\n[stderr] ${err.trim().slice(0, 400)}`;
    return r;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
// Main resident loop.
// ---------------------------------------------------------------------------
async function main() {
  const base = process.env.TASK_ROUTER_BASE_URL || DEFAULT_TR_BASE;
  const project = process.env.TASK_ROUTER_PROJECT || die('TASK_ROUTER_PROJECT not set');
  const agent = process.env.TASK_ROUTER_AGENT || die('TASK_ROUTER_AGENT not set');
  const kind = process.env.TASK_ROUTER_HARNESS_KIND || die('TASK_ROUTER_HARNESS_KIND not set (pi|opencode)');
  const adapter = ADAPTERS[kind]; if (!adapter) die(`unsupported harness kind: ${kind} (pi|opencode)`);
  const endpoint = process.env.TASK_ROUTER_HARNESS_ENDPOINT || die('TASK_ROUTER_HARNESS_ENDPOINT not set');
  const model = process.env.TASK_ROUTER_HARNESS_MODEL || die('TASK_ROUTER_HARNESS_MODEL not set');
  const apiKeyEnvName = process.env.TASK_ROUTER_HARNESS_API_KEY_ENV || '';
  const apiKey = resolveKey(apiKeyEnvName);
  const timeoutMs = Number(process.env.TASK_ROUTER_HARNESS_TIMEOUT_MS || 900000);
  const pollMs = Number(process.env.TASK_ROUTER_HARNESS_POLL_MS || 3000);
  const extraAllow = (process.env.TASK_ROUTER_HARNESS_HOST_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);

  const proxy = await startHarnessProxy({ upstream: endpoint, apiKey, extraAllow });
  log(`starting: agent=${agent} kind=${kind} model=${model} upstream=${new URL(endpoint).origin}→${proxy.pinnedIp} proxy=${proxy.url}`);

  let sid = null;
  while (!sid) { try { sid = await mcpSession(base, project, agent); } catch (e) { log(`initial TR session retry: ${e.message}`); await sleep(pollMs); } }
  try { await mcpCall(base, project, sid, 'register_agent', { name: agent, project, capabilities: (process.env.TASK_ROUTER_HARNESS_CAPABILITIES || 'code').split(',').map((s) => s.trim()).filter(Boolean), metadata: { harness: kind } }); }
  catch (e) { log(`register_agent (non-fatal): ${e.message}`); }
  await hookStop(base, project, agent);

  let idle = 0; const ttlEvery = Math.max(1, Math.round(30000 / pollMs));
  for (;;) {
    let pickup = null;
    try { pickup = await mcpCall(base, project, sid, 'pickup_next_task', { agent, project }); }
    catch (e) { log(`pickup failed, re-session: ${e.message}`); try { sid = await mcpSession(base, project, agent); } catch {} await sleep(pollMs); continue; }
    const t = pickup && pickup.task;
    const taskId = t && (t.task_id || t.id);
    const payload = t && (t.payload ?? t.prompt ?? t.text);
    if (!taskId) { if (++idle % ttlEvery === 0) await hookStop(base, project, agent); await sleep(pollMs); continue; }
    idle = 0;
    log(`task ${taskId}: spawning ${kind}`);
    let r; try { r = await runHarness(adapter, proxy, model, timeoutMs, payload); }
    catch (e) { r = { ok: false, result: JSON.stringify({ error: `harness-runner: ${e.message}` }) }; }
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await mcpCall(base, project, sid, 'complete_task', { task_id: taskId, agent, project, result: r.result }); log(`task ${taskId}: ${r.ok ? 'completed' : 'reported error'}`); break; }
      catch (e) { log(`complete_task failed (${attempt + 1}): ${e.message}`); if (attempt === 0) { try { sid = await mcpSession(base, project, agent); } catch {} } }
    }
    await hookStop(base, project, agent);
  }
}

// ---------------------------------------------------------------------------
// Self-tests (validate the pieces the 12B/mocks CAN prove; run offline).
// ---------------------------------------------------------------------------
const MODE = process.argv[2];
const isEntry = (() => { try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return true; } })();
if (!isEntry) {
  // imported as a module (e.g. a test) — export the functions above, run nothing.
} else if (MODE === '--selftest-scrub') {
  // allowlist: host secrets ABSENT; PATH present; config-homes redirected to the per-task dir.
  process.env.LM_STUDIO_API_KEY = 'CANARY'; process.env.ANTHROPIC_API_KEY = 'CANARY'; process.env.OPENAI_BASE_URL = 'http://evil';
  process.env.GITHUB_TOKEN = 'CANARY'; process.env.AWS_SECRET_ACCESS_KEY = 'CANARY'; process.env.TASK_ROUTER_API_KEY = 'trk';
  const d = path.join(os.tmpdir(), 'sctest'); const e = childEnv(d);
  const secretsGone = ['LM_STUDIO_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'TASK_ROUTER_API_KEY'].every((k) => e[k] === undefined);
  const usableAndIsolated = (e.PATH || e.Path) && e.HOME === d && e.APPDATA && e.APPDATA.startsWith(d) && e.LOCALAPPDATA.startsWith(d);
  const ok = secretsGone && usableAndIsolated;
  console.log(ok ? 'scrub OK — allowlist: all host secrets absent (ANTHROPIC/AWS/GITHUB/LM_STUDIO/…); PATH kept; HOME/APPDATA/LOCALAPPDATA redirected' : `scrub FAIL (secretsGone=${secretsGone} usable=${usableAndIsolated})`);
  process.exit(ok ? 0 : 1);
} else if (MODE === '--selftest-treekill') {
  // spawn a node that spawns a long grandchild; tree-kill; confirm the grandchild dies.
  const marker = path.join(os.tmpdir(), `tk-${crypto.randomBytes(4).toString('hex')}.js`);
  writeFileSync(marker, `const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{stdio:'ignore'}); console.log('GPID '+g.pid); setInterval(()=>{},1e9);`);
  const parent = spawn(process.execPath, [marker], { detached: process.platform !== 'win32' });
  let gpid = null; parent.stdout.on('data', (d) => { const m = /GPID (\d+)/.exec(String(d)); if (m) gpid = +m[1]; });
  setTimeout(() => {
    treeKill(parent.pid);
    setTimeout(() => {
      let alive = false; try { process.kill(gpid, 0); alive = true; } catch {}
      console.log(alive ? `treekill FAIL — grandchild ${gpid} still alive` : `treekill OK — grandchild ${gpid} reaped`);
      rmSync(marker, { force: true }); process.exit(alive ? 1 : 0);
    }, 1500);
  }, 1500);
} else if (MODE === '--selftest-adapter') {
  // parseResult against a representative pi --mode json stream + an opencode blob.
  // Real pi v0.80 --mode json shape: streamed message_update partials, then message_end + agent_end with
  // an ARRAY content ({type:'thinking'} + {type:'text'}); parseResult must return only the text, thinking dropped.
  const piStream = [
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta"},"message":{"role":"assistant","content":[{"type":"thinking","thinking":"reason"},{"type":"text","text":"function add(a,b){return a+b}"}]}}',
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"reason"},{"type":"text","text":"function add(a,b){return a+b}"}]}}',
    '{"type":"agent_end","messages":[{"role":"user","content":[{"type":"text","text":"q"}]},{"role":"assistant","content":[{"type":"thinking","thinking":"reason"},{"type":"text","text":"function add(a,b){return a+b}"}]}]}',
  ].join('\n');
  const pi = ADAPTERS.pi.parseResult(piStream, 0);
  const oc = ADAPTERS.opencode.parseResult('  final answer: done  \n', 0);
  const ok = pi.ok && pi.result === 'function add(a,b){return a+b}' && oc.ok && oc.result === 'final answer: done';
  console.log(ok ? `adapter OK — pi:"${pi.result}" opencode:"${oc.result}"` : `adapter FAIL — pi:${JSON.stringify(pi)} oc:${JSON.stringify(oc)}`);
  process.exit(ok ? 0 : 1);
} else if (MODE === '--selftest-proxy') {
  const upstream = process.env.TASK_ROUTER_HARNESS_ENDPOINT || 'http://127.0.0.1:1240/v1';
  const model = process.env.TASK_ROUTER_HARNESS_MODEL || 'google/gemma-4-12b-qat';
  startHarnessProxy({ upstream }).then(async (p) => {
    const body = JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with exactly: PROXY_OK' }] });
    const a = await fetch(p.url + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.clientToken}` }, body });
    const j = await a.json().catch(() => ({}));
    const b = await fetch(p.url + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    console.log(`proxy: authorized=${a.status} (${JSON.stringify(j.choices?.[0]?.message?.content || '').slice(0, 40)}) · no-token=${b.status}(exp 401) · pinned=${p.pinnedIp}`);
    p.close(); process.exit(a.status === 200 && b.status === 401 ? 0 : 1);
  }).catch((e) => { console.error('proxy selftest err:', e.message); process.exit(1); });
} else {
  main().catch((e) => die(e.message));
}
