# Server API Reference

The MCP server exposes 20 tools via the Model Context Protocol, plus HTTP endpoints for health checks, polling, export, purge, and (v0.4.0) tenant registration.

---

## v0.4.0: Multi-tenancy via `?project=<name>`

Every request that touches per-project state — MCP tool calls, REST endpoints other than `/health` (without project) and the OAuth surface — must carry a `?project=<name>` query parameter on the URL. The server's `tenantLoader` middleware reads it, validates against `[A-Za-z0-9_.-]{1,64}` (also rejects `..`), looks up the tenant, and routes the request to that tenant's per-project `task-router.db`. Every project must be registered first via **`POST /projects/register`** (extension does this on activate; `start.sh` does it for CLI consumers). Requests to unregistered projects return **404**; missing `?project=` returns **400** with a structured `{ error: "missing_project_param", migration: "..." }` body.

**MCP sessions are bound to a tenant by URL** — the `?project=` value at session-create time becomes the session's immutable project. Tool calls' explicit `project` arg must match (M1). To work in a different project, open a new MCP session at `?project=<other>`. The deprecated `switch_project` MCP tool now always returns an error.

See **[`doc/design/MULTI_PROJECT_ROUTING.md`](MULTI_PROJECT_ROUTING.md)** for the full design.

### Body/query truth table for `project` (M5, v0.4.2)

The contract is "project on the URL only" — but several routes also accept `project` in the JSON body for legacy callers, and the rules differ. Consolidated reference:

| Surface | Where `project` is read from | Behavior on missing | Behavior on mismatch |
|---|---|---|---|
| `/mcp` (POST, session create) | URL `?project=<name>` (required) | 400 `missing_project_param` | n/a — session is bound to the URL value |
| MCP tool calls (after session create) | Session-bound (set at URL) | n/a (already bound) | M1: explicit `project` arg in tool call must match the session's URL-bound project; mismatch throws |
| `/health?project=` | URL only | falls through to server-global liveness (200 with `version` / `tenants`) | n/a |
| `/health` (no project) | n/a | server-global liveness (200) | n/a |
| `/stats`, `/tasks`, `/metrics`, `/export`, `/agents`, `/agents/:agent`, `/memory`, `/hook/check`, `/tasks/purge`, `/inbox/:agent` | URL `?project=<name>` (required) | 400 `missing_project_param` with `migration` pointer | 404 if project not registered |
| `POST /projects/register` | JSON body `{ name, root, dbPath }` (required) | 400 `Missing name or dbPath` | 409 `tenant_conflict` if `dbPath` differs from existing registration (S1) |
| `GET /projects` | n/a (server-global) | n/a | n/a |
| `DELETE /projects/:name` (v0.4.2) | URL path | 404 if unknown | 409 `in_flight` without `?force=true`; 400 `invalid_project_name` for bad chars |
| `/api/*` (Telegram bridge REST) | Body field (`/api/register`, `/api/unregister`, `/api/dispatch`, `/api/deliver`) **or** URL query (`/api/inbox/:agent`, `/api/accept/:taskId`, `/api/complete/:taskId`) | 400 `missing_project_param` (uniform since v0.4.8) | 404 if not registered |
| OAuth (`/.well-known/*`, `/authorize`, `/token`) | n/a | n/a (no tenancy) | n/a |

**Rule of thumb:** for every per-tenant route, `project` lives on the URL as `?project=<name>`. Body-field usage is only for `/projects/register` (genuine config payload) and the legacy `/api/*` bridge surface. Future endpoints should follow the URL-query convention.

---

## MCP Tools

All tools are available via the MCP Streamable HTTP transport at `POST /mcp?project=<name>` (v0.4.0).

### Discovery & Registration

#### `ping()`
Server health check.
- **Returns:** `{ status, uptime_ms, agents_online, timestamp }`

#### `register_agent(name, capabilities?, metadata?, project)`
Register or refresh an agent. Idempotent — safe to call repeatedly (acts as heartbeat).
- **Params:**
  - `name` (string, required) — Agent identifier
  - `capabilities` (string[], optional) — e.g., `["planning", "delegation"]`
  - `metadata` (Record<string, string>, optional) — Arbitrary key-value pairs
  - `project` (string, **required**) — Project scope. Binds the MCP session. Must match `$TASK_ROUTER_PROJECT`.
- **Returns:** `{ registered: true, agent: { name, capabilities, status, last_seen } }`

#### `unregister_agent(name)`
Remove an agent. Cascades: cancels pending tasks, times out accepted tasks.
- **Returns:** `{ unregistered: true|false, name }`

#### `list_agents(status?, project?)`
List agents within TTL.
- **Params:**
  - `status` (enum: `idle` | `busy` | `all`, default: `all`)
  - `project` (string, optional)
- **Returns:** `{ agents: [...], count }`. **v0.9.2:** each agent is enriched at read time with `state_brief` (+ `state_brief_at` ISO timestamp) from the in-memory cache when a live brief exists; agents without one are unchanged.

---

### Task Dispatch & Execution

#### `dispatch_task(to, payload, from?, priority?, project?)`
Create a task for an agent. Validates agent is registered and within TTL.
- **Params:**
  - `to` (string, required) — Target agent name
  - `payload` (string, required) — Task content (markdown, JSON, etc.)
  - `from` (string, optional) — Dispatcher agent name (for result routing)
  - `priority` (integer, optional, default: 0) — Higher = dispatched first
  - `project` (string, optional)
- **Returns:** `{ dispatched: true, task_id, to, status: "pending" }`
- **Side effect:** If `"telegram"` agent is registered in the same project and `to !== "telegram"`, auto-creates a notification task in telegram's inbox (`[Dispatched] Task ... to /agent: summary`)
- **Errors:** Agent not registered; agent TTL expired

#### `check_inbox(agent, project?)`
Check for pending tasks. Refreshes agent TTL. Runs task timeout maintenance.
- **Returns:** `{ agent, pending_tasks, tasks: [{ id, payload, from, priority, created_at }] }`

#### `accept_task(task_id)`
Claim a pending task **for the MCP session’s registered agent** (`register_agent`). Sets agent status to `busy`.
- **Returns:** `{ accepted: true, task_id, payload, from }`
- **Error if:** No prior `register_agent`; task not assigned to this session’s agent; task not found or not `pending` (prevents double-pickup)

#### `submit_result(task_id, result, agent)`
Submit work output for a task **owned by `agent`** (v0.7.0+: explicit `agent` parameter required; pre-v0.7.0 used session binding). Sets agent status back to `idle`.
- **Params:**
  - `task_id` (string, required)
  - `result` (string, required) — Result content
  - `agent` (string, required, v0.7.0+) — Name of the submitting agent; must match the task's `to_agent`
- **Accepted task states (v0.7.16+):** `accepted` (normal path) **and** `timed_out` (compaction-resume recovery — the originally-assigned agent comes back after the dispatch lease expired). Pre-v0.7.16 only `accepted` was permitted.
- **Returns:** `{ submitted: true, task_id, status, completed_at }`. When the submitted task was in `timed_out` state, the response additionally carries `recovered_from_timeout: true` so callers can surface "took longer than expected" in user-facing summaries.
- **Error if:** task not found, task in a terminal non-`timed_out` state (`cancelled`, `completed`), or `agent` parameter doesn't match `to_agent`.
- **Side effect:** If `"telegram"` agent is registered and the completing agent is not telegram, auto-creates a notification task (`[Result] /agent completed task ...`)

#### `cancel_task(task_id)`
Cancel a pending or accepted task **only if** this session's agent is the **`to_agent`** assignee **or** the **`from_agent`** dispatcher.
- **Returns:** `{ cancelled: true, task_id }`
- **v0.8.0:** also clears the assignee's `_in_progress_task` reserved memory key (used by `pickup_next_task` resume semantics).

#### `pickup_next_task(agent, project?)` — v0.8.0
Take the next pending task assigned to me and start working on it. Auto-resumes any in-progress task on session restart (including tasks that timed out between sessions).

Composes `check_inbox` + `accept_task` + reserved-memory-write into one call. See [REGISTRATION_FLOW.md](../design/REGISTRATION_FLOW.md) and [V0_8_0_PLAN.md](../plans/V0_8_0_PLAN.md) for the full design.

- **Params:**
  - `agent` (string, required) — My agent name.
  - `project` (string, optional) — Project scope; defaults to session-bound project.
- **Returns:** `{ task: { task_id, from_agent, payload, priority, created_at, resumed, recovered_from_timeout } | null, remaining_inbox }`
- **Resume semantics:** DB is the source of truth. If the agent already has any task in `accepted` or `timed_out` state for this project, that task is returned with `resumed: true`. If the task was `timed_out`, it's flipped back to `accepted` and `recovered_from_timeout: true` is set. Otherwise, the highest-priority oldest pending task is accepted and returned with `resumed: false`.
- **Cache pointer:** writes the chosen task_id to the agent's `_in_progress_task` reserved memory key. The cache is rebuilt from the DB on every call — agents should never rely on the cache alone.
- **Empty case:** `{ task: null, remaining_inbox: 0 }` when nothing is pending AND no in-progress task exists.
- **Polished first line of result content** (rendered by Claude Code): `"Picked up task <8-char-id> from <dispatcher> — priority N. M more waiting."` or `"Resumed task ..."` or `"Inbox empty. Wait for next dispatch."`

#### `complete_task(task_id, result, agent, project?)` — v0.8.0
Submit the result for my in-progress task and clear it.

Composes `submit_result` + `delete_memory("_in_progress_task")` into one call. Same validation + side effects as `submit_result` (v0.7.16 timed_out tolerance, `autoForwardToTelegram` on non-telegram completions).

- **Params:**
  - `task_id` (string, required) — Task I'm completing.
  - `result` (string, required) — Result content. **Never empty** (v4.7 Result Discipline). When the deliverable is a **file**, the result should be a reference, not inlined content — a `[FILE RESULT]` block carrying `path:` + a substantive `description:` (the file stays on disk; the description is what consumers see). The seeded `client.js` emits this via `complete --result-ref=<path> --result-description='…'` (**v0.9.6 / node/v4.6**); `--result-file=<path>` instead inlines a file's content. The block is a convention in the `result` string — no special server handling.
  - `agent` (string, required) — My agent name; must match the task's `to_agent`.
  - `project` (string, optional) — Project scope; defaults to session-bound.
  - `state_brief` (object, optional, **v0.9.2**) — a compact state brief: `{ warm_on?: string|string[], context?: string, in_flight?: string, flags?: string|string[] }`. Captured into an **in-memory, TTL-expiring** cache keyed `project:agent` and surfaced (with an `at` timestamp) in `list_agents` / `/stats` — **never persisted to the DB**. A routing hint only; absent or malformed → ignored. `submit_result` and the REST `POST /api/complete/:taskId` accept the same param.
- **Returns:** `{ completed: true, task_id, delivered_to, recovered_from_timeout }`
- **Polished first line:** `"Completed task <8-char-id>. Result delivered to <dispatcher> (N KB)."`

#### `collect_results(dispatcher, project?)` — v0.8.0
Get all completed results for me as the dispatcher; they're marked acknowledged in the same call.

Composes `get_pending_results` + `acknowledge_results` into one atomic call. The read+ack is a single DB transaction — no race window where results are visible but unacknowledged.

- **Params:**
  - `dispatcher` (string, required) — My agent name (the one who dispatched the tasks, e.g. `"pm"`).
  - `project` (string, optional) — Project scope; defaults to session-bound.
- **Returns:** `{ results: [{ task_id, from_agent, result, completed_at }], count }`
- **Polished first line:** `"N results ready: <agent>·<8-char-id> (size), ..."` or `"No new results."`
- **Caveat:** if the caller dies between receiving this response and processing the results, the results are marked delivered server-side but never actioned. PM SKILL guidance should save results to memory before processing if durability matters.

#### `purge_tasks(project, before, status?)`
Delete old completed/cancelled/timed_out tasks. Never deletes pending or accepted tasks. (v0.3.4+)
- **Params:** `project` (required), `before` (ISO date string — purge tasks created before this), `status` (optional — only purge this status)
- **Returns:** `{ purged: <count>, project, before }`

---

### Result Delivery

#### `check_results(task_id?, from?)`
Check completed tasks. Marks returned results as `delivered`.
- **Params:** At least one of `task_id` or `from` required
- **Returns:** `{ completed_tasks, results: [{ id, to, from, payload, result, status, timestamps }] }`

#### `get_pending_results(dispatcher, project?)`
Preview undelivered results without marking them as delivered.
- **Returns:** `{ undelivered_count, results: [...] }`

#### `acknowledge_results(task_ids)`
Mark results as delivered. Stops hook notifications for these tasks.
- **Params:** `task_ids` (string[], required)
- **Returns:** `{ acknowledged: true, count }`

---

### Agent Memory

Persistent key-value storage per agent, scoped by project. Survives server restarts.

#### `save_memory(agent, key, value, project?)`
Upsert a memory entry.
- **Returns:** `{ saved: true, agent, key, updated_at }`

#### `load_memory(agent, key?, project?)`
Load memories. If `key` omitted, returns all memories for the agent.
- **Returns:** `{ agent, memories: [{ agent, key, value, updated_at }] }`

#### `list_memories(agent, project?)`
List memory keys without values (lightweight).
- **Returns:** `{ agent, count, keys: [{ key, updated_at }] }`

#### `delete_memory(agent, key, project?)`
Delete a specific memory entry.
- **Returns:** `{ deleted: true|false, agent, key }`

---

### Project Management

#### `list_projects()`
List all known projects.
- **Returns:** `{ projects: [{ id, name, metadata, created_at, agents_online, task_counts }] }`

#### `switch_project(project)`
Change the session's project binding.
- **Returns:** `{ switched: true, project }`

#### `update_project(project, name?, metadata?)`
Update project name or metadata.
- **Returns:** `{ updated: true, project }`

---

## HTTP Endpoints

These are non-MCP endpoints for scripts, hooks, and monitoring.

### `GET /health` or `GET /health?project=PROJECT`

Server health check. Without `?project=`, returns a basic liveness response. With `?project=`, returns full project stats.

```bash
# Basic liveness check (no project required)
curl "http://127.0.0.1:3100/health"
# → { "status": "ok", "version": "0.4.1", "serverPath": "...", "uptime_s": 3600, "active_sessions": 3, "tenants": 2 }

# Full project health (project required)
curl "http://127.0.0.1:3100/health?project=my-project"
```

**Response (no project — server-global liveness):**
```json
{
  "status": "ok",
  "version": "0.4.2",
  "serverPath": "/path/to/extension/server/bin/cli.js",
  "pid": 12345,
  "uptime_s": 3600,
  "active_sessions": 3,
  "tenants": 2,
  "expected_client_protocol": "node/v4.4",
  "stale_clients": []
}
```

- **`expected_client_protocol`** (v0.9.4) — the seeded-client protocol this server *bundles* (the canonical "current"). The seeded `client.js` declares its own version via the `x-task-router-client` header on every request.
- **`stale_clients`** (v0.9.4) — seeded clients seen this server lifetime whose protocol is **older** than `expected_client_protocol`, i.e. their bundle-delivered `client.js` has drifted behind their errata-delivered SKILLs: `[{ protocol, expected, count, projects, first_seen, last_seen }]`. `start.sh`, `/pm audit`, and (future) the extension use these to detect drift. See `doc/plans/SEED_ARTIFACT_SYNC_PLAN.md`.

**Response (with project):**
```json
{
  "status": "ok",
  "version": "0.4.2",
  "serverPath": "/path/to/extension/server/bin/cli.js",
  "pid": 12345,
  "project": "my-project",
  "uptime_s": 3600,
  "agents_online": 5,
  "active_sessions": 3,
  "tasks": {
    "pending": 2,
    "active": 1,
    "completed": 45,
    "cancelled": 3,
    "timed_out": 1
  }
}
```

> **`version`** (v0.4.1+) — server's reported version, single source of truth at `mcp-task-router/src/server.js: SERVER_VERSION`. Clients use this to detect drift (e.g. extension's hard version gate, dashboard `MCP v…` indicator).
>
> **`serverPath`** (v0.4.1+) — `process.argv[1]` of the running server. Doctor compares this against the extension's bundled CLI path to confirm the server was spawned from the bundle (vs from a stale consumer-repo copy).
>
> **`pid`** (v0.4.2+) — `process.pid` of the running server. Doctor's "Kill stale server" remediation uses this to `taskkill /PID <pid> /F` (Windows) or `kill -9 <pid>` (Unix) when the server was spawned from outside the bundle.
>
> **`last_seen`** + **`last_human_seen`** (v0.4.5+) — wall-clock timestamps for the resolved tenant. `last_seen` is touched by every per-tenant request (including bridge `/api/*` polls); `last_human_seen` is touched by everything *except* `/api/*`. The split lets `--idle-shutdown` distinguish "nobody is using this" from "the bridge keeps polling". Idle-shutdown decisions compare against the monotonic counterpart of `last_human_seen` so PC sleep is transparent.

### `GET /hook/check?agent=NAME&project=PROJECT`

Lightweight polling endpoint for hooks and watchdogs. **Both `agent` and `project` are required.** Refreshes `last_seen` for registered agents only — does NOT resurrect expired/deleted agents (v0.3.1+). Registration only happens via the `register_agent` MCP tool.

- **When idle:** Returns JSON `{ agent, pending: 0, completed: 0 }`
- **When tasks pending:** Returns `text/plain` instruction for Claude to process
- **When results ready:** Returns `text/plain` notification

### `GET /stats?project=PROJECT`

Agent statistics with per-agent task counts and token estimates. **Project parameter is required.** Used by the extension dashboard. Filters agents by TTL — expired agents are excluded (v0.3.1+).
- Returns project-level: `total_est_input_tokens`, `total_est_output_tokens` (v0.3.4+)
- Returns per-agent: `est_input_tokens`, `est_output_tokens` (v0.3.4+)
- **v0.9.2:** each agent is enriched with `state_brief` (+ `state_brief_at`) from the in-memory state-brief cache when present (never persisted).

### `GET /metrics?project=PROJECT[&since=session|TIMESTAMP]`

Throughput and performance metrics. Used by the extension dashboard.
- `since=session` — scope to current server session only
- `since=<ms timestamp>` — scope to tasks created after this time
- Returns: `{ throughput: {1h, 6h, 24h}, duration: {min_ms, max_ms, median_ms}, error_rate_pct, avg_tokens_per_task, server_started_at, uptime_ms }`

### `GET /tasks?project=PROJECT`

List tasks with optional filters. **Project parameter is required.** Returns `{ tasks, count, total, offset, project }`.
- `?status=pending` — Filter by status
- `?to_agent=devops` — Only tasks assigned **to** this agent (narrower than `agent=`)
- `?from_agent=pm` — Only tasks whose dispatcher/sender **from_agent** equals this value
- `?agent=devops` — Legacy shorthand: matches **either** `to_agent` OR `from_agent`. When **`to_agent`** or **`from_agent`** is present, `agent=` is ignored (the narrower filters win).
- `?exclude_agents=telegram,scm` — Exclude agents (comma-separated, matches to_agent) (v0.3.4+)
- `?limit=50&offset=0` — Pagination
- `?since=<ms timestamp>` — Tasks created after this time (v0.3.4+)
- `?until=<ms timestamp>` — Tasks created before this time (v0.3.4+)
- `?search=<text>` — Substring search in payload or result (v0.3.4+)

**PM reconciliation usage (v0.3.8+):** PM queries `?to_agent=X&status=accepted` before every `dispatch_task` and once at session startup to detect tasks stuck in `accepted` state. Any task older than the agent's newest `completed_at` is definitively stale (the agent moved on without submitting a result) and must be reconciled via a `# RECONCILE <task_id>` prompt. See `doc/design/ARCHITECTURE.md` → Task State Machine → Stuck `accepted` state for the full protocol.

### `GET /export?project=PROJECT`

Export full task history as JSON with ISO timestamps. **Project parameter is required.** (v0.3.4+)
- `?status=completed` — Filter by status
- `?agent=devops` — Legacy OR filter (`to_agent` OR `from_agent`), same precedence as `GET /tasks`
- `?to_agent=` / `?from_agent=` — Same semantics as `GET /tasks`
- `?exclude_agents=telegram,scm` — Comma-separated list of `to_agent` names to exclude (v0.4.3+)
- `?search=keyword` — Substring match against payload + result (v0.4.3+)
- `?since=<ms timestamp>` — Tasks created after this time
- `?until=<ms timestamp>` — Tasks created before this time
- Returns: JSON array with `Content-Disposition: attachment` header. Each task includes computed `duration_ms` field.

### `DELETE /agents/:agent?project=PROJECT`

Unregister a single agent. Cancels pending tasks and times out accepted tasks for the agent. (v0.3.2+)
- `?cancel_pending=false` — Skip task cleanup
- Returns: `{ unregistered: boolean, agent, project }`

### `DELETE /agents?project=PROJECT`

Bulk-clear all agent registrations for a project. Used by the extension on startup when the server is already running, to clear stale registrations from a previous session. Project-scoped — does not affect other projects. (v0.3.4+)
- Calls `unregisterAgent()` for each agent (cancels pending, times out accepted)
- Returns: `{ cleared: <count>, project }`

### `DELETE /tasks/purge?project=PROJECT&before=TIMESTAMP`

Filter-driven task purge. **Project and before parameters are required.** (v0.3.4+, generalized in v0.4.3)

**Default behavior (no `status` passed):** deletes tasks with status `completed`, `cancelled`, or `timed_out` only — the v0.4.0 safety floor. Pending and accepted tasks are skipped.

**With explicit `status` (v0.4.3+):** the safety floor is replaced by the caller's choice. Honors any of `pending`, `accepted`, `completed`, `cancelled`, `timed_out` — single value or comma-separated list. Use case: drain a stuck queue (e.g., `status=pending` for a backlog of undelivered telegram results).

Filter parameters (all optional, mirror `GET /tasks` exactly):
- `?status=pending` or `?status=pending,accepted` — Status whitelist for the purge. Returns 400 `invalid_status` for unknown values.
- `?to_agent=`, `?from_agent=`, `?agent=` (legacy OR) — Agent filtering, same semantics as `GET /tasks`.
- `?exclude_agents=telegram,scm` — Comma-separated list of `to_agent` names to exclude (v0.4.3+).
- `?search=keyword` — Substring match against payload + result (v0.4.3+).
- `?since=<ms timestamp>` / `?until=<ms timestamp>` — Time range. Note `before` is the cutoff; `since`/`until` are additive to it.

Returns: `{ purged: <count>, project, before }`. The dashboard's Purge button drives this with the active table filter, so what the user sees is what gets deleted.

### `GET /projects` (server-global, v0.4.0)

List all registered tenants. Returns `{ projects: ProjectInfo[], count }`.

Each `ProjectInfo` has: `name`, `root`, `dbPath`, `loaded` (boolean — DB currently mounted in memory), `registered_at` (ms), `last_seen` (ms), `last_human_seen` (ms, v0.4.5+ — bridge polls don't update this). Used by the extension project picker; replaces the v0.3.x semantic where this endpoint queried the SQL `projects` table on the single shared DB.

### `POST /projects/register` (server-global, v0.4.0)

Register a workspace as a tenant. Body: `{ name, root?, dbPath }`.

- **201 Created** — new registration, or idempotent re-register with the same `dbPath` and `root`.
- **400 Bad Request** — missing fields, or `name` fails the `[A-Za-z0-9_.-]{1,64}` charset whitelist (also rejects `..`).
- **409 Conflict** — first-register-wins semantics (S1): a different `dbPath` is already registered for this `name`. Body includes the registered tenant's `dbPath` and a hint. The server does NOT silently swap a loaded DB to a different file. Caller should either pick a different name, use the registered path, or restart the server to clear the in-memory registry.

Idempotent. Extension calls on activate before any per-tenant request; `start.sh` (SessionStart hook) calls for CLI consumers.

### `DELETE /projects/:name` (server-global, v0.4.2)

Forcibly drop a tenant from the registry. Closes its DB and removes the entry; subsequent `?project=<name>` requests 404 until re-registered. Use case: swap a tenant's `dbPath` (clone the repo to a new location, kill the old registration, re-register from the new path) without restarting the server.

- **200 OK** — `{ unregistered: true, project, forced: <bool> }`.
- **404 Not Found** — unknown `name`.
- **409 Conflict** — `inFlight > 0` and `?force=true` not set. Body: `{ error: "in_flight", hint: "Stop agents and retry, or pass ?force=true to evict regardless." }`.
- **400 Bad Request** — `name` fails the charset whitelist.

Query params:
- `?force=true` — close even if `inFlight > 0`. Default false.

### Bridge token-claim lease (server-global, v0.4.6)

Enforces single-poller-per-bot for the telegram bridge: bridges hash their `TELEGRAM_BOT_TOKEN` (sha256) and claim it before opening a polling session. Second claimant for the same `tokenHash` gets 409 and exits cleanly, eliminating the duplicate-poller bombardment that occurred when two IDEs (or one IDE with a multi-root workspace, or an orphaned detached bridge from a closed IDE) spawned bridges sharing the same bot token.

#### `POST /bridge/claim`

- Body: `{ "tokenHash": "<sha256-hex>", "project": "<name>", "pid": <int>, "host": "<string>" }`. Only `tokenHash` and `project` are required.
- **201 Created** — `{ "leaseId": "<uuid>", "claimedAt": <ms-epoch>, "ttlSeconds": 90 }`.
- **409 Conflict** — `{ "error": "token_in_use", "holder": { "project", "pid", "host", "claimedAt", "lastHeartbeat" }, "hint": "..." }`. Caller is expected to log the holder info and exit cleanly with code 0.
- **400 Bad Request** — invalid `tokenHash` (must be 64-char hex) or missing `project`.

#### `PUT /bridge/claim/:leaseId`

Heartbeat. Bridge sends every ~30s. Lease auto-expires after 90s of no heartbeat (configurable via `BRIDGE_CLAIM_TTL_MS` constant) — covers the bridge-crashed-without-DELETE case.

- **200 OK** — `{ "ok": true, "lastHeartbeat": <ms-epoch> }`.
- **404 Not Found** — lease unknown / expired. Caller should re-claim via `POST /bridge/claim` (which may itself 409 if another bridge took the token).

#### `DELETE /bridge/claim/:leaseId`

Graceful release. Bridge sends on `SIGINT`/`SIGTERM` shutdown.

- **200 OK** — `{ "released": true, "leaseId" }`.
- **404 Not Found** — lease unknown.

#### `GET /bridge/claims`

Debug endpoint — list all active leases. No auth.

- **200 OK** — `{ "claims": [{ "tokenHashPrefix": "<8 hex chars>", "project", "pid", "host", "leaseId", "claimedAt", "lastHeartbeat" }, ...], "count": N }`. Full token hashes are NOT exposed; only the leading 8 chars for diagnostics.

---

### Inter-PM federation (v0.9.0)

Authorized PM-to-PM access across projects on a server. The owner mints opaque,
revocable, per-agent tokens; external PMs use them to act on a project **through
its `pm`** (the only externally-reachable agent).

**Owner endpoints — global-key gated** (`x-task-router-key`; a federated `trtok_`
caller is rejected with 403):

#### `POST /api/grant_access?project=PROJECT`

Body `{ project, grants: { <agent>: "RO"|"RW"|"RWE" }, label?, expires_at? }`.
Mints a token. **200 OK** — `{ token, grant_id, project, grants, label, expires_at, note }`.
The `token` plaintext is returned **once** (only its SHA-256 is stored).

#### `POST /api/list_grants?project=PROJECT`

**200 OK** — `{ project, grants: [{ grant_id, token_prefix, label, grants, created_at, expires_at, revoked, expired, last_used_at }], count }`. Never returns token plaintext.

#### `POST /api/revoke_grant?project=PROJECT`

Body `{ grant_id }`. **200 OK** — `{ revoked: true, grant_id }` / **404** if unknown.

#### `GET /api/federation_audit?project=PROJECT[&limit=N]`

**200 OK** — `{ project, audit: [{ token_prefix, label, agent, operation, outcome, detail, at }, ...] }`. Inbound-federation activity feed (allow + deny).

**Federation endpoints — token gated** (`x-task-router-fed-token: trtok_…`, or
`Authorization: Bearer trtok_…`; **exempt from the global key**):

#### `POST /api/federation/list_agents?project=PROJECT`

**200 OK** — `{ project, agents: { <agent>: "RO"|"RW"|"RWE" } }` (only the granted agents). **401** no token / **403** invalid/revoked/expired.

#### `POST /api/federation/request?project=PROJECT`

Body `{ agent, operation, payload }` where `operation ∈ {read_guidelines, write_guidelines, execute}` (require RO / RW / RWE on `agent`). On pass, mints a `to=pm` task carrying a `[FEDERATED REQUEST]` header. **200 OK** — `{ task_id, status, routed_to: "pm" }`. **403** insufficient permission / **400** unknown operation / **503** `pm` not registered.

#### `POST /api/federation/wait?project=PROJECT`

Body `{ task_id, timeout_ms? }`. Long-polls the PM's result, but **only for a task this token created**. **200 OK** — `{ status: "completed", result, … }` / `{ status: "failed", … }` / `{ status: "task_not_found" }`. **403** `task_not_owned_by_token`.

---

## CLI Flags

```bash
node bin/cli.js [options]
```

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `TASK_ROUTER_PORT` | `3100` | HTTP listen port (binds **`127.0.0.1`** only) |
| `--bootstrap-tenant <name=path>` | — | — | **(v0.4.0)** Pre-register a tenant at startup (repeatable). Used primarily by tests for `:memory:` DBs. Production extensions register tenants via `POST /projects/register` on activate. |
| `--db <path>` | `TASK_ROUTER_DB` | — | **DEPRECATED v0.4.0**: registers a single `default` tenant at the given path with a deprecation warning. Use `--bootstrap-tenant` or `POST /projects/register` instead. |
| `--ttl` | `TASK_ROUTER_TTL` | `300` | Agent TTL in seconds (0 = no expiry) |
| `--task-timeout` | `TASK_ROUTER_TASK_TIMEOUT` | `3600` | Auto-cancel accepted tasks after N seconds |
| `--tenant-idle-evict` | `TASK_ROUTER_TENANT_IDLE_EVICT` | `1800` | **(v0.4.2)** Close idle tenant DBs after N seconds (0 = disable). Registry entries persist; subsequent requests transparently reopen. Skips tenants with `inFlight > 0`. v0.4.5+ uses monotonic time so PC sleep is transparent. |
| `--tenant-sweep-interval` | `TASK_ROUTER_TENANT_SWEEP_INTERVAL` | `300` | **(v0.4.2)** How often the eviction sweeper runs (seconds). |
| `--idle-shutdown` | `TASK_ROUTER_IDLE_SHUTDOWN` | `0` | **(v0.4.5)** Server self-exits after N seconds of human-side idle: no MCP sessions, all tenants' `lastHumanSeen` ≥ N, no in-flight requests. Bridge `/api/*` polling does NOT count as activity. Monotonic-time-based, so PC sleep is transparent. `0` = disable. Extension's bundled spawn passes `600` by default (configurable via `taskRouter.idleShutdownSeconds`). |
| `--idle-shutdown-check-interval` | `TASK_ROUTER_IDLE_SHUTDOWN_CHECK_INTERVAL` | `60` | **(v0.4.5)** How often to check for idle shutdown (seconds). |
| `--log-level` | `TASK_ROUTER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

### `TASK_ROUTER_API_KEY`

If set, **`/api/*`** requires the same value. Transport preference (most robust first):

1. **Header `X-Task-Router-Key: <key>`** — preferred.
2. **Header `Authorization: Bearer <key>`** — standard MCP/HTTP form.
3. **Query `?api_key=<key>`** — last resort; leaks into access logs, shell history, and browser URL bars. Use only when headers are awkward (e.g., image tags).

Comparison is constant-time. Covers the JSON bridge routes only; **MCP** (`/mcp`), **extension** routes (`/health`, `/tasks`, …), and **OAuth** metadata are unchanged. Implementations: `POST /api/register`, `POST /api/dispatch`, `GET /api/inbox/:agent`, `POST /api/accept/:taskId`, `POST /api/complete/:taskId`, `POST /api/deliver` — see `mcp-task-router/src/index.js`.

**Impersonation caveat.** The `/api/*` plane has **no per-caller identity binding** — the caller chooses the agent name on every request. Any holder of the API key can act as any agent. If that matters for your deployment, keep high-trust work on the MCP plane (which enforces session identity after `register_agent`) and use `/api/*` only for bridges you already trust.

---

## MCP session identity

After **`register_agent`**, the MCP session is that **agent**. **`accept_task`** and **`submit_result`** apply only when the task’s **`to_agent`** matches. **`cancel_task`** is allowed for the **`to_agent`** or the **`from_agent`** dispatcher. **`switch_project`** clears the bound agent until the next **`register_agent`**.
