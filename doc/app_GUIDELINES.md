# /app — Agent Guidelines
**Last Updated:** 2026-06-11

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/app` agent
(standalone-app runtime & supervisor — node-pty agent supervision + in-process
Task Router server host for the headless Majordomus deployment). This file is
the agent's **only** sanctioned write target for notes that should survive
across sessions. The agent appends here **only when PM or the user explicitly
asks** — never as a side effect of doing work. Supervisor/nudge-loop
conventions, server start-vs-attach rules, and launch-argv parity notes live
here once formalised.

**Load when:** the `/app` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/app` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Condensed runtime rules (server attach on healthy /health, nudge-loop timing, node-pty pinning): `.claude/rules/app.md`.

**Owner:** `/app` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/app/SKILL.md`, `.claude/rules/app.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

### Cap-token validation (`serverHost.js`) — two independent sources, both required

- **Hash match alone is insufficient.** `_makeValidateCapToken` must confirm BOTH
  (1) `sha256(presented_token) === cap_token_hash` from the session FILE and (2)
  `ha_devops` is live in the Task Router registry via `_defaultIsAgentLive`. Hash-only
  passes when `ha_devops` was SIGKILLed and the session file was not cleaned up — the
  stale file + old hash together look valid even though the agent is gone.
- **"Live" = TTL-fresh in `/stats`.** `_defaultIsAgentLive` queries `GET /stats?project=…`,
  which excludes expired agents. A never-expiring DB row (e.g. if TTL were disabled) would
  reopen the SIGKILL window. Confirm the task-router TTL is non-zero in any deployment that
  relies on this gate.
- **One hash at a time — launcher MUST overwrite every relaunch.** The hash-then-liveness
  split is safe ONLY because each `ha_devops` launch writes a fresh
  `fleet/ha_devops_session.json` (overwriting the prior). Never append or retain a prior
  hash — a stale hash a new launch fails to overwrite would allow replay with the old token
  while the new agent is live.

### Injection seams are test-only

- `_makeValidateCapToken(opts)` and `createHaExecutorServer(serverOpts)` accept injectable
  `isAgentLive`/`validateCapToken` functions **for unit testing only**. Production
  `createHaExecutorServer()` must be called with NO override — it picks up the real
  `_makeValidateCapToken()` + `_defaultIsAgentLive` automatically. A stubbed-true liveness
  hook in production would silently hold the gate open regardless of whether `ha_devops` runs.
- Both `_makeValidateCapToken` and `_defaultIsAgentLive` are **exported and directly tested**.
  If you add a new fail-closed branch, add a test driving the real function (not just the seam mock).

### Route scope — cap-token is config-write only

- `POST /api/ha/config-write` requires `Authorization: Bearer <cap-token>`. `POST /api/ha/execute`
  (Tier-B service calls) takes NO cap-token and must never be changed to require one — the two
  routes are deliberately scope-separated (§2.2). Adding a token check to `/execute` would break
  every Tier-B service call when `ha_devops` is offline.

### Liveness query timeout is env-tunable

- `_defaultIsAgentLive` uses `AGENT_LIVE_TIMEOUT_MS` (default 2000 ms) for the `/stats` HTTP
  timeout; the timeout branch is fail-closed (returns false). Do not remove the env-override —
  it keeps the timeout unit test fast without waiting 2 s per run. 2000 ms is correct in production.

### Hash compare — timing-safe, length-guarded

- Use `crypto.timingSafeEqual(Buffer.from(presented,'hex'), Buffer.from(stored,'hex'))` wrapped in
  `try/catch → false`. Both inputs are SHA-256 hex (32 bytes) so lengths normally match, but a
  corrupted stored hash of unexpected length makes `timingSafeEqual` throw — the catch returns
  false (fail-closed). Do not replace with `===` string comparison (not constant-time — leaks via
  content early-exit).

## Decisions

- **2026-06-10 — `bin/app.js` default mode = server-host-only.** Default invocation
  (`node bin/app.js`) attaches to the running Task Router on 3100 (health-check first — no 409)
  and mounts the HA executor on 3101. It does NOT spawn a PM terminal. Full supervisor (spawns
  node-pty PM via `supervisor.js`) is opt-in via `--supervise` / `MAJORDOMOS_SUPERVISE=1` for
  headless launchd only. Rationale: running the supervisor alongside the VS Code extension
  double-spawns the PM, causing two competing agents on the same task-router project.

## Open Questions

(none yet)
