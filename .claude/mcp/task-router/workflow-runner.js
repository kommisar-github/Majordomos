#!/usr/bin/env node
/**
 * workflow-runner.js — TR's portable dynamic-workflow backend (seed v4.25+).
 *
 * The portable half of the hybrid workflow model (see
 * doc/design/CAPABILITY_ESCALATION_AND_WORKFLOWS.md §2): when a specialist's `claude` session does NOT
 * expose Claude Code's native `Workflow` tool, it drives a fan-out through THIS runner instead. The API
 * deliberately MIRRORS the native tool (`meta`, `agent()`, `parallel()`, `pipeline()`, `log()`, `phase()`,
 * per-agent `model`, a shared `budget`) so a workflow ports between backends with near-mechanical edits —
 * see WORKFLOW_CONVERSION.md.
 *
 * Each `agent()` is one isolated headless child:
 *     claude --bare -p --permission-mode bypassPermissions --model <m>
 *            --output-format json --disallowedTools "Agent" "<prompt>"
 *   --bare              → no hooks / MCP / memory / CLAUDE.md discovery (no phantom registrations, no
 *                         hook storms against the TR server) — the isolation guarantee.
 *   --disallowedTools Agent → recursion guard: a child can't spawn its own fan-out.
 *   --permission-mode bypassPermissions → never hangs on a prompt.
 *   --output-format json → structured result + token usage (for the budget).
 *
 * A workflow script imports this module and is run with `node <script>.js`:
 *     import { agent, parallel, pipeline, log, phase, budget } from
 *       '../../.claude/mcp/task-router/workflow-runner.js';
 *
 * GUARDS (always on):
 *   - Model CEILING — sub-agents run at the specialist's tier or LOWER, never higher
 *     (env TASK_ROUTER_WORKFLOW_MODEL is the ceiling/default; a per-agent model is clamped to it).
 *   - Token BUDGET — env TASK_ROUTER_WORKFLOW_BUDGET (output tokens, default 200k); agent() throws past it.
 *   - CONCURRENCY cap — min(16, cpus-2).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const run = promisify(execFile);

// --- tier ceiling (low → high). A per-agent model is clamped to the ceiling. ---
const TIER = { haiku: 1, sonnet: 2, opus: 3, fable: 3 };
const tierOf = (m) => { const k = Object.keys(TIER).find((t) => String(m || '').includes(t)); return k ? TIER[k] : 2; };
const CEILING = process.env.TASK_ROUTER_WORKFLOW_MODEL || 'claude-haiku-4-5';
function clampModel(requested) {
  if (!requested) return CEILING;
  return tierOf(requested) > tierOf(CEILING) ? CEILING : requested;
}

// --- shared budget (output tokens) ---
const BUDGET_TOTAL = Number(process.env.TASK_ROUTER_WORKFLOW_BUDGET || 200_000);
let spent = 0;
export const budget = {
  total: BUDGET_TOTAL,
  spent: () => spent,
  remaining: () => Math.max(0, BUDGET_TOTAL - spent),
};

// --- concurrency limiter ---
const CAP = Math.max(1, Math.min(16, (os.cpus()?.length || 4) - 2));
let active = 0;
const waiters = [];
async function slot() {
  if (active < CAP) { active++; return; }
  await new Promise((res) => waiters.push(res));
  active++;
}
function release() { active--; const w = waiters.shift(); if (w) w(); }

export function log(msg) { process.stderr.write(`[workflow] ${msg}\n`); }
let _phase = null;
export function phase(title) { _phase = title; log(`▶ phase: ${title}`); }

/**
 * Run ONE isolated headless child. Returns the final assistant text (default) or the parsed
 * `{ text, usage }` when opts.raw. Throws if the budget is exhausted or the child fails.
 */
export async function agent(prompt, opts = {}) {
  if (budget.total && budget.remaining() <= 0) throw new Error(`workflow budget exhausted (${BUDGET_TOTAL} tok)`);
  const model = clampModel(opts.model);
  const label = opts.label || (_phase ? `${_phase}:agent` : 'agent');
  await slot();
  const t0 = Date.now();
  try {
    const env = { ...process.env };
    delete env.TASK_ROUTER_AGENT; delete env.TASK_ROUTER_PROJECT; // belt-and-suspenders; --bare already isolates
    // Isolation: `--setting-sources user` loads ONLY user-scope settings (auth + global config) and
    // ignores the project's `.claude/settings*.json` — so the TR SessionStart/UserPromptSubmit hooks
    // never fire in the child (no phantom registrations, no hook storms) WITHOUT losing the login
    // (`--bare` would skip OAuth discovery too and break auth). `--disallowedTools <tools...>` is
    // VARIADIC — it must come LAST, and the positional prompt must sit right after `-p`.
    const { stdout } = await run('claude', [
      '-p', String(prompt),
      '--setting-sources', 'user',
      '--permission-mode', 'bypassPermissions',
      '--model', model,
      '--output-format', 'json',
      '--disallowedTools', 'Agent',
    ], { env, timeout: Number(opts.timeoutMs || 600_000), maxBuffer: 32 << 20 });
    // `--output-format json` emits a JSON ARRAY of events; the `type:"result"` element carries the
    // final text, `is_error`, and token usage.
    let text = stdout, usage = null, isErr = false;
    try {
      let j = JSON.parse(stdout);
      if (Array.isArray(j)) j = j.find((e) => e && e.type === 'result') || j[j.length - 1];
      text = j.result ?? j.text ?? j.content ?? stdout;
      usage = j.usage || (j.message && j.message.usage) || null;
      isErr = j.is_error === true;
    } catch { /* plain-text fallback */ }
    if (isErr) throw new Error(`child reported error: ${String(text).slice(0, 200)}`);
    const out = (usage && (usage.output_tokens ?? usage.output)) || Math.ceil(String(text).length / 4);
    spent += out;
    log(`✓ ${label} (${model}, ${out} tok, ${Date.now() - t0}ms)`);
    return opts.raw ? { text, usage } : text;
  } catch (e) {
    log(`✗ ${label} FAILED: ${e.code || e.message}`);
    throw e;
  } finally { release(); }
}

/** Run thunks concurrently (barrier). A thunk that throws resolves to null — filter(Boolean). */
export async function parallel(thunks) {
  return Promise.all(thunks.map((t) => Promise.resolve().then(t).catch((e) => { log(`parallel item failed: ${e.message}`); return null; })));
}

/** Run each item through stage1, stage2, … independently (no barrier between stages). */
export async function pipeline(items, ...stages) {
  return Promise.all(items.map(async (item, i) => {
    let v = item;
    for (let s = 0; s < stages.length; s++) {
      try { v = await stages[s](v, item, i); }
      catch (e) { log(`pipeline item ${i} dropped at stage ${s}: ${e.message}`); return null; }
    }
    return v;
  }));
}

/** Declarative banner — informational only (mirrors the native `meta`). */
export function defineMeta(meta) { if (meta && meta.name) log(`workflow: ${meta.name} — ${meta.description || ''}`); return meta; }

// CLI: `node workflow-runner.js --selfcheck` confirms the child-spawn path works.
if (process.argv[2] === '--selfcheck') {
  agent('Reply with exactly the word READY and nothing else.')
    .then((t) => { console.log('selfcheck:', String(t).trim().slice(0, 40)); process.exit(0); })
    .catch((e) => { console.error('selfcheck failed:', e.message); process.exit(1); });
}
