# Majordomus Fleet — Task Router Bootstrap Plan

> Produced per the Task Router seed's `BOOTSTRAP_PROMPT.md`. This is the canonical
> bootstrap plan for the **Majordomos** project (`github.com/kommisar-github/Majordomos`).
> **Design source (the "project plan" input):** `doc/plans/MAJORDOMUS_FLEET_PLAN.md`
> — it owns *what/why*; this plan owns *how agents collaborate to build it*.
>
> **Project shape:** single-repo. **Bootstrap mode:** Fresh.
> **Output mode:** Monolithic — estimated ~19K tokens (7 agents, 4 interface
> contracts, single-repo → under the multi-file split threshold).
> Conventions per `PM.md` and `PM_TEMPLATES.md`; do not contradict them.

---

## 1. Project synthesis

- **What we are building:** *Majordomus* — a headless, always-on **Task Router app**
  (`majordomus-daemon`) on **macOS** that runs one long-lived **Majordomus PM** and
  acts as a household + cross-project orchestrator. It **federates to the PM of every
  project** over the LAN and integrates **bidirectionally with Home Assistant**;
  the operator drives it from **Telegram**.
- **Codebase under bootstrap:** the standalone app (`majordomus-daemon/`, currently
  **experimental v0.1.0**) plus a new **HA bridge** module. The Task Router **server is
  reused in-process** (`startServer()`) — no server logic is written here.
- **v1 boundary:** (a) the standalone-app MVP finished to "server-host + node-pty
  supervisor for one PM"; (b) federation **RW/RWE** to N project PMs over Tailscale/LAN;
  (c) HA **REST both directions** with a confirmation gate on the inbound path; (d)
  **Telegram** operator surface; (e) **launchd** always-on. Web UI is **deferred**
  (operator surface is Telegram).
- **Hard constraints:** macOS host; **headless `claude` non-interactively
  authenticated** (no human for a browser login — hard prerequisite, G1); **no internet
  exposure** — federation + HA inbound bind to **Tailscale/LAN only**, owner endpoints
  loopback-only (G3); destructive / cross-project-write actions require **operator
  confirmation** (H1).
- **Explicit non-goals:** no new Task Router **server** features; **not** a public or
  multi-tenant service; **no web UI** for v1; **not** a replacement for the IDE extension
  on dev projects (Majordomus federates to those projects' PMs, it does not host their
  specialists); **no node-pty roster** on the Mac beyond the single Majordomus PM.

**Prerequisite-question callout (gating §12):**
- §3/§7 depend on §12 Q-HA-TRANSPORT — REST-only vs REST+MCP changes the `ha` SKILL
  surface and the inbound contract.
- §6/§8 depend on §12 Q-FLEET-ROSTER — the concrete list of projects + per-project
  grant level (RW vs RWE) drives the matrix Quick-reference rows and the federation waves.
- §8/§11 depend on §12 Q-STATUS-COST — whether to build the G4 cached/server-direct RO
  status path in v1 (status polling burns one project-PM turn each without it).

---

## 2. Design principles

**Why specialists here (knowledge domains, not parallelism).** This is a solo,
single-operator deployment — parallelism is largely moot (one attention head). The
roster exists because each specialist is a **persistent knowledge hub** for a genuinely
distinct quirk-dense domain:

- **`app`** keeps warm the node-pty launch/nudge mechanics and the in-process
  server-host contract (start-or-attach, the project lock 409, bracket-paste timing).
- **`ha`** keeps warm the Home Assistant API surface (entity model, service schemas,
  REST vs WebSocket vs MCP, the inbound safety gate) — a large, vendor-specific domain.
- **`ops`** keeps warm federation wiring (token mint/grant ladder, `/api/federation/*`),
  Tailscale split-exposure, launchd, and headless-`claude` auth.

Each clears the 5-bullet hard qualifier with real API names / config keys / pitfalls
(see §3). Collapsing them would put HA's entity/service quirks, node-pty's timing, and
launchd/federation ops into one dumping-ground SKILL.md — slower loads, worse routing.

**Context economy via the matrix.** Abstracts (~50 tokens) + `Context docs:` citations
keep forks lean: an `ha` fork dispatched for a service-call task loads matrix +
`doc/ha_integration.md` (≈ 30–40K) — not `doc/app_runtime.md` or `FEDERATION_RULEBOOK.md`.
A `ops` fork wiring a new project loads matrix + `.claude/skills/ops/SKILL.md` (Federation wiring procedure) only.

**Relationship to default agents** (`PM.md` provides pm/arch/review/scm — kept
structurally identical, project context injected):

| Default | Injected for Majordomus |
|---|---|
| **pm** | The fleet topology + project registry; the **federation-as-delegation** model (its "specialists" include remote project PMs); the **HA inbound mediation + confirmation gate**; Telegram operator protocol. |
| **arch** | The four design docs (app runtime, HA integration, federation, host/ops); the reuse-not-rebuild constraint (in-process server). |
| **review** | A project-risk checklist: HA inbound safety (H1), token handling + network exposure (G3), headless-auth secrets, RW/RWE blast radius, launchd restart-loop safety. |
| **scm** | None — git is git. Owns the `majordomus` repo. |

---

## 3. Agent roster

7 agents: 4 defaults (pm, arch, review, scm) + 3 specialists (app, ha, ops). Reserved-name
check (`PM.md` → Reserved agent names): `app`/`ha`/`ops` are all clear.

#### pm — Majordomus orchestrator (coordinator)

**Role:** coordinator
**Model:** (omit from agents.json — 1M Opus)
**Capabilities:** planning, delegation, tracking, federation, ha-mediation, doc-updates

**Owns (files):**
- `doc/plans/ROADMAP.md`, `doc/NEXT_STEPS.md` — fleet roadmap + action items
- `fleet/fleet.config.json` — the project registry (name → LAN/Tailscale URL → grant level) *(co-owned conceptually; `ops` owns the secrets half — see §7)*
- `doc/design/DOC_OWNERSHIP_MATRIX.md` — PM owns the matrix

**Context (tiered):**
- `doc/design/DOC_OWNERSHIP_MATRIX.md` — always first
- **Dedicated terminal:** all Primary docs (roadmap, next-steps, the 4 design docs' abstracts, fleet.config)
- **Subagent fork:** matrix + `Context docs:` only (PM rarely runs as a fork)

**Never touches:**
- `majordomus-daemon/src/**` — `app` owns app code
- `majordomus-daemon/src/ha-bridge.js` — `ha` owns the HA module
- `host/launchd/*.plist`, federation token secrets — `ops` owns infra/secrets

**SKILL.md domain knowledge:**
- **Federation-as-delegation:** PM's "dispatch to a specialist" for cross-project work is `/api/federation/request` to that project's `pm` (RW/RWE), result via `/api/federation/wait`. Each project PM is the **second gate** — it may decline/re-scope.
- **HA inbound mediation (H1):** every HA-originated request is mediated. Read/status → immediate. **Destructive home actions or any cross-project write/execute → require Telegram confirmation before acting.** Default-deny anything not on the whitelist in `doc/ha_integration.md`.
- **Status aggregation:** a `fleet status` request fans federated RO reads across the registry; prefer the cached path (§12 Q-STATUS-COST) over a live PM turn per project when available.
- **Telegram is the operator channel** (not a project specialist) — replies + confirmations route there; the bridge forwards dispatch/result/timeout events at zero PM-token cost.
- Standard PM: memory recovery + dispatch-plan reconciliation on startup (`PM.md`); cites `Context docs:` in every payload.

#### arch — Fleet architect (coordinator)

**Role:** coordinator · **Model:** (omit — 1M Opus) · **Capabilities:** architecture, api-design, phase-planning

**Owns:** `doc/design/*.md` (authors/updates design docs: `app_runtime.md`, `ha_integration.md`, `host_ops.md`)
**Context:** matrix first; dedicated → all design docs; fork → matrix + cited docs.
**Never touches:** any `majordomus-daemon/src/**` (implementation is `app`/`ha`), `agents.json` (pm/ops), launchd plists (`ops`).
**SKILL.md domain knowledge:**
- **Reuse, don't rebuild:** Majordomus imports `startServer()` from `mcp-task-router/src/index.js` in-process; if a server is already live on the port, **attach** (don't double-start — the project lock returns 409). No server code changes are in scope.
- Boundary map: app-runtime (node-pty + supervisor) vs ha-bridge vs federation-client vs host/launchd — keep them separately ownable.
- The four federation/HA gaps that shape the design: G3 split exposure, G4 read-cost, H1 inbound safety, G1 headless auth.

#### review — Risk & safety auditor (coordinator)

**Role:** coordinator · **Model:** (omit — 1M Opus) · **Capabilities:** code-review, auditing, risk-analysis, security
**Owns:** no files (review is a lens). Owns the project-risk checklist in its SKILL.md.
**Never touches:** source/config (audits, never edits — surfaces findings to PM).
**SKILL.md domain knowledge (project-risk checklist):**
- **H1 — HA inbound gate:** confirm every inbound path is default-deny; destructive/cross-project actions require operator confirmation; no path lets HA fan out RWE silently.
- **G3 — exposure:** federation + HA-inbound bound to Tailscale/LAN only; owner endpoints (`grant_access`, etc.) + any web UI loopback-only; `TASK_ROUTER_API_KEY` set whenever a port is reachable.
- **Token/secret handling:** federation `trtok_…` tokens + HA long-lived token + `ANTHROPIC_API_KEY` live in a secrets file/env, never committed; audit `.gitignore`.
- **Blast radius:** RWE grants let Majordomus execute on a project — confirm each grant level is intentional per §12 Q-FLEET-ROSTER.
- **launchd safety:** restart policy must not hot-loop on a crashing PM (throttle); bounded periodic restart relies on compaction-resume being safe.

#### scm — Source control (specialist, mechanical)

**Role:** specialist · **Model:** `claude-haiku-4-5` · **Capabilities:** git, commits, branches, prs
**Owns:** git operations on the **`Majordomos`** repo. **Never touches:** source/config content (only commits already-made changes); never commits secrets.
**SKILL.md domain knowledge:** none — git is git. Canonical owner of the commit-message + secret-exclusion convention (other specialists link here).

**Key Facts (repo-specific):**
- **Repo:** `github.com/kommisar-github/Majordomos` · **Remote:** `origin` · **Default branch:** `main`.
- **Commit trailer:** `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **`.gitignore` — never commit:** `.env` / `*.env`, any `*token*` / `*secret*` file, the **resolved-token (secret) half** of the fleet config, the HA long-lived token store, `.claude/mcp/task-router/*.db`, `*.log`, `node_modules/`. The committed `fleet/fleet.config.json` carries only `name`/`url`/`grant`/`tokenRef` — `tokenRef` resolves from env at runtime, never the literal token.
- Branch + PR for non-trivial changes; commit/push only when asked (standard `/scm` rules).

#### app — Standalone-app runtime & supervisor (specialist)

**Role:** specialist · **Model:** `claude-sonnet-4-6` · **Capabilities:** node-pty, supervisor, server-host, web-ui

**Owns (files):**
- `majordomus-daemon/bin/app.js` — CLI entry
- `majordomus-daemon/src/serverHost.js` — start-or-attach the in-process server
- `majordomus-daemon/src/supervisor.js` — node-pty lifecycle + nudge loop
- `majordomus-daemon/src/launchCommand.js` — `claude …` argv/env builder
- `majordomus-daemon/test/supervisor.test.js`

**Context:** matrix first; dedicated → `doc/app_runtime.md` + `doc/design/…`; fork → matrix + cited.
**Never touches:** `src/ha-bridge.js` (`ha`), launchd plists / Tailscale (`ops`), the reused `mcp-task-router/` server source (out of scope — reuse only).
**SKILL.md domain knowledge:**
- **node-pty spawn parity** with the extension's `terminals.ts`: `pty.spawn(claude, [flags, '--model', m, '--agent', \`${name}_agent\`, \`/${name}\`], { cwd, env: { …, TASK_ROUTER_AGENT, TASK_ROUTER_PROJECT } })`. Majordomus spawns exactly **one** agent (the Majordomus PM).
- **Server host:** call `startServer()` in-process (it returns `{ shutdown }`); if `GET /health` already succeeds, **attach** — re-starting hits the tenant project-lock (409) and disrupts other tenants.
- **Nudge loop** (watchdog parity): every ~10s `GET /hook/check?agent&project`; on pending work write the directive to the pty + a delayed `\r` (the bracket-paste trick) — copy the timing verbatim from `watchdog.ts`; **never** `while true` poll.
- **Lifecycle:** pty `exit` → `POST /api/unregister`; on crash, restart per `ops`'s policy.
- **node-pty is the one native dep** — macOS prebuilds exist; pin a prebuilt-shipping version (pitfall: a Node-version bump can force a native rebuild).
- Pitfall: the Majordomus PM must come up **green** — its `Stop` hook drives the yellow→green transition; a missing hook (see seed v4.6/v4.8) leaves it "starting" forever.

#### ha — Home Assistant integration (specialist)

**Role:** specialist · **Model:** `claude-sonnet-4-6` · **Capabilities:** home-assistant, rest, websocket, mcp, safety-gate

**Owns (files):**
- `majordomus-daemon/src/ha-bridge.js` — bidirectional HA bridge
- `doc/ha_integration.md` — HA design + the inbound action whitelist
- `majordomus-daemon/test/ha-bridge.test.js`

**Context:** matrix first; dedicated → `doc/ha_integration.md`; fork → matrix + cited.
**Never touches:** supervisor/server-host (`app`), federation client (`ops`), launchd (`ops`).
**SKILL.md domain knowledge:**
- **HA REST (outbound):** `GET /api/states` / `GET /api/states/<entity_id>` to read; `POST /api/services/<domain>/<service>` with JSON `{ entity_id, …data }` to act; auth = `Authorization: Bearer <long-lived token>`. Base URL like `http://homeassistant.local:8123`.
- **entity_id convention:** `<domain>.<object_id>` (e.g., `light.office`, `climate.living_room`, `script.<name>`); services are `<domain>.<service>` (e.g., `light.turn_on`, `notify.mobile_app_<device>`).
- **WebSocket API** (`/api/websocket`) for live state subscriptions (`subscribe_events`, `state_changed`) when polling REST is too slow — auth handshake then JSON messages with incrementing `id`.
- **HA MCP** (optional, §12 Q-HA-TRANSPORT): HA's **MCP Server** integration exposes Assist intents as MCP tools over SSE (Majordomus → HA); HA's **MCP Client** integration connects HA to the app's `/mcp` (HA Assist → Majordomus). REST is the v1 path; MCP is the follow-up.
- **Inbound bridge (HA → Majordomus):** HA automation/Assist → `POST /api/dispatch` (to `pm`) or HA MCP-client → `/mcp`. Every inbound request carries an `[HA REQUEST]` header so PM applies the **H1 confirmation gate**.
- **Bridge tools exposed to PM:** `ha_get_state(entity_id)`, `ha_call_service(domain, service, data)` — the latter checks the action whitelist before executing.
- Pitfall: HA long-lived tokens don't expire but are revoked from HA's UI — a 401 means rotate, not retry. Pitfall: `entity_id` typos return 200 with no effect on some services — verify state after a call.
- Pitfall: never expose `ha_call_service` for destructive domains (locks, alarms, covers) without the confirmation gate, even on the outbound side.

#### ops — Federation, host & always-on (specialist)

**Role:** specialist · **Model:** `claude-sonnet-4-6` · **Capabilities:** federation, networking, launchd, secrets, provisioning

**Owns (files):**
- `.claude/skills/ops/SKILL.md` (Federation wiring procedure), `doc/host_ops.md` — federation wiring + macOS host runbook
- `host/launchd/com.majordomus.taskrouter.plist` — always-on
- `fleet/fleet.config.json` (secret half: tokens) + `.env` / secrets handling
- `host/provision.sh` — macOS preflight (node, claude auth check, Tailscale)

**Context:** matrix first; dedicated → `FEDERATION_RULEBOOK.md` + `.claude/skills/ops/SKILL.md` (Federation wiring procedure) + `doc/host_ops.md`; fork → matrix + cited.
**Never touches:** app runtime (`app`), HA bridge (`ha`), `doc/design/*` architecture (authored by `arch`).
**SKILL.md domain knowledge:**
- **Federation mint/grant:** on each **project**, `grant_access` mints `trtok_…` storing only its SHA-256 hash + a per-agent grant `{ pm: RO|RW|RWE }`; `list_access_grants` / `revoke_access` manage them; escalation-guarded, global-key gated.
- **Federation client endpoints** (Majordomus is the client): `/api/federation/list_agents` (discover), `/api/federation/request` (mints a `to=pm` task with `[FEDERATED REQUEST]`), `/api/federation/wait` (token-scoped result poll). Ladder **RO < RW < RWE** = read-guidelines < write < execute.
- **Per-project wiring:** each project's server must bind `/api/federation/*` to the Tailscale/LAN interface; **owner endpoints + web UI stay loopback-only** (G3). Register via `task-router add-federation <name> <url> <token>` → `fleet.config.json`.
- **Tailscale** (recommended) puts the fleet on a private mesh — no internet exposure; otherwise LAN-bind + `TASK_ROUTER_API_KEY` + TLS/SSH-tunnel.
- **launchd:** a `LaunchAgent` plist with `KeepAlive` (restart on crash) + `ThrottleInterval` (no hot-loop); load with `launchctl bootstrap gui/$(id -u) <plist>`. A **bounded periodic restart** caps PM context growth (safe: compaction-resume + DB-authoritative `pickup_next_task`).
- **G1 headless auth:** `claude` must be non-interactively authenticated (`ANTHROPIC_API_KEY` env or a stored credential) — `provision.sh` asserts `claude --version` runs unattended before launchd is enabled.
- Pitfall: a federated call uses the **token**, which bypasses the global key by design — so a leaked token == project access; treat `fleet.config.json` secret half like a credential (gitignored).

**Common specialist candidates — explicit decisions:**

| Candidate | Decision |
|---|---|
| **`/devops`** | **Declined as a separate agent — folded into `ops`.** Deploy here *is* the host/launchd/Tailscale/provisioning work `ops` already owns; a second devops agent would split one domain. |
| **`/db`** | **Declined.** No data layer of its own — the Task Router server (reused) owns its SQLite; Majordomus adds no schema. |
| **`/security`** | **Declined as an agent — folded into `review`'s checklist + `ops`'s secret handling.** Security here is cross-cutting (H1 gate, G3 exposure, token hygiene), not a standalone domain with 5+ unique API bullets. |
| **`/perf`** | **Declined.** No SLOs; the one real efficiency concern (G4 status read-cost) is a design choice tracked in §12, not a profiling domain. |
| **`/release`** | **Declined.** No external publishing cadence; `/scm` tag-and-push covers the `majordomus` repo. |
| **`/voice`** | **Declined for v1 — folded into `ha`.** Voice (HA Assist) is one inbound transport of the HA domain, covered by `ha`'s MCP/Assist bullets. Revisit if voice-intent mapping grows its own quirk surface. |

**Minimum vs nice-to-have:**
- **Strictly load-bearing for v1:** pm, app, ha, ops. Drop any and a v1 goal is lost (no orchestration / no app / no HA / no federation+always-on).
- **Earned-later / near-zero cost to keep:** arch, review, scm — defaults; keep them (cheap; retrofitting is friction).

---

## 4. `agents.json`

```json
{
  "pm":     { "capabilities": ["planning", "delegation", "tracking", "federation", "ha-mediation", "doc-updates"], "role": "coordinator" },
  "arch":   { "capabilities": ["architecture", "api-design", "phase-planning"], "role": "coordinator" },
  "review": { "capabilities": ["code-review", "auditing", "risk-analysis", "security"], "role": "coordinator" },
  "scm":    { "capabilities": ["git", "commits", "branches", "prs"], "role": "specialist", "model": "claude-haiku-4-5" },
  "app":    { "capabilities": ["node-pty", "supervisor", "server-host", "web-ui"], "role": "specialist", "model": "claude-sonnet-4-6" },
  "ha":     { "capabilities": ["home-assistant", "rest", "websocket", "mcp", "safety-gate"], "role": "specialist", "model": "claude-sonnet-4-6" },
  "ops":    { "capabilities": ["federation", "networking", "launchd", "secrets", "provisioning"], "role": "specialist", "model": "claude-sonnet-4-6" }
}
```

**Model resolution notes** (`PM.md` → "Model field — decision tree"):
- **pm / arch / review** — branch 1 (coordinator; **no `model`** → 1M Opus). The Majordomus PM mediates HA + federation reasoning; it needs the 1M window.
- **scm** — branch 3 (mechanical → `claude-haiku-4-5`).
- **app / ha / ops** — branch 4 (default specialist → `claude-sonnet-4-6`). None is decision-heavy enough to justify Opus (branch 2); `review` (Opus) provides the deep audit pass. When in doubt, Sonnet.

---

## 5. `SKILLS.md` roster table

| Skill | CLI | Cursor Globs | Domain | Model |
|---|---|---|---|---|
| pm | `/pm` | *(coordinator — manual)* | Fleet orchestration, federation, HA mediation, Telegram | 1M Opus (default) |
| arch | `/arch` | `doc/design/**` | Fleet architecture / design docs | 1M Opus (default) |
| review | `/review` | *(manual)* | Risk & safety audit (H1/G3/secrets) | 1M Opus (default) |
| scm | `/scm` | *(manual)* | Git for the majordomus repo | claude-haiku-4-5 |
| app | `/app` | `majordomus-daemon/src/{serverHost,supervisor,launchCommand}.js`, `majordomus-daemon/bin/**` | node-pty supervisor + in-process server host | claude-sonnet-4-6 |
| ha | `/ha` | `majordomus-daemon/src/ha-bridge.js`, `doc/ha_integration.md` | Home Assistant bidirectional bridge | claude-sonnet-4-6 |
| ops | `/ops` | `host/**`, `fleet/**`, `doc/{federation,host_ops}.md` | Federation wiring, launchd, Tailscale, secrets | claude-sonnet-4-6 |

---

## 6. Document Ownership Matrix

Paste into `doc/design/DOC_OWNERSHIP_MATRIX.md` per `PM_TEMPLATES.md → ## DOC_OWNERSHIP_MATRIX.md Template` (single-repo; stop at Section 4 — no appendices).

### §6.1 — matrix Section 1 (cross-cutting design + architecture table)

| Document | Type | Primary | Secondary | Notes (update trigger) |
|---|---|---|---|---|
| `doc/plans/ROADMAP.md` | roadmap | /pm | — | Update when a phase opens/closes or scope changes. |
| `doc/NEXT_STEPS.md` | roadmap | /pm | — | Update after each wave completes or a blocker appears. |
| `doc/design/DOC_OWNERSHIP_MATRIX.md` | matrix | /pm | — | Update when an agent is added/merged or doc ownership moves. |
| `doc/BOOTSTRAP_PLAN.md` | plan | /pm | /arch | Update if the roster or bootstrap sequence changes. |
| `doc/plans/MAJORDOMUS_FLEET_PLAN.md` | design brief | /arch | /pm | Update when the fleet topology / HA-direction / authority model changes. |
| `doc/design/app_runtime.md` | design | /app | /arch | Update when the supervisor/nudge/server-host contract changes. |
| `doc/design/ha_integration.md` | design | /ha | /review | Update when HA transport, tools, or the inbound whitelist change. |
| `doc/design/host_ops.md` | design | /ops | — | Update when the launchd policy, Tailscale topology, or preflight changes. |

### §6.2 — matrix Section 2 (cross-cutting load rules)

- **Dedicated terminal:** read every doc where you are **Primary** (plus the matrix) at startup; amortized across the session. (PM, being always-on, loads the roadmap + matrix + fleet.config + design-doc abstracts.)
- **Subagent fork:** read **only** the matrix + the docs PM cited in `Context docs:`.
  - *Worked example:* an `/ha` fork dispatched to add a `cover.*` service call reads matrix + `doc/ha_integration.md` ≈ 35K tokens; without the matrix it would load all four design docs ≈ 110K.
- **Ownership-transfer protocol:** copy **verbatim** from the matrix template (do not re-derive).

### §6.3 — Abstract payloads (destination: each design doc's own top, not the matrix)

```
## Abstract
**TL;DR:** node-pty supervisor + in-process Task Router server host for the Majordomus PM.
**Load when:** node-pty, pty, supervisor, nudge, watchdog, startServer, server-host, attach, 409, lock, bracket-paste, launchCommand, argv, unregister, green, Stop hook, claude spawn, majordomus-daemon, bin/app.js
**Key facts:** one PM agent only; reuse startServer() in-process; attach if /health up; nudge ~10s; never while-true.
**Owner:** /app   **Related:** doc/design/host_ops.md, FEDERATION_RULEBOOK.md
```
```
## Abstract
**TL;DR:** bidirectional Home Assistant bridge (REST/WS/MCP) with an inbound confirmation gate.
**Load when:** home assistant, HA, entity_id, states, call_service, light, climate, script, notify, bearer token, long-lived token, websocket, subscribe_events, MCP server, MCP client, Assist, ha_get_state, ha_call_service, inbound, whitelist, confirmation, H1
**Key facts:** REST first (states + services); WS for live state; MCP optional; inbound default-deny + Telegram confirm for destructive/cross-project.
**Owner:** /ha   **Related:** FEDERATION_RULEBOOK.md (inbound→dispatch), PM SKILL (mediation)
```
```
## Abstract
**TL;DR:** inter-PM federation client wiring to every project's PM over Tailscale/LAN.
**Load when:** federation, grant_access, revoke_access, trtok, token, RO, RW, RWE, /api/federation, list_agents, request, wait, add-federation, fleet.config, Tailscale, LAN, loopback, G3, second gate, project PM
**Key facts:** Majordomus is the client; each project mints a token granting {pm: RW|RWE}; project PM is the second gate; bind federation endpoints to Tailscale, owner endpoints loopback.
**Owner:** /ops   **Related:** doc/design/host_ops.md, PM SKILL (federation-as-delegation)
```
```
## Abstract
**TL;DR:** macOS always-on host runbook — provisioning, headless claude auth, launchd, Tailscale.
**Load when:** macOS, launchd, LaunchAgent, plist, KeepAlive, ThrottleInterval, launchctl, bootstrap, headless, ANTHROPIC_API_KEY, claude auth, provision, preflight, Tailscale, restart policy, bounded restart, G1, G2
**Key facts:** claude must be non-interactively authed (G1); launchd KeepAlive+Throttle; bounded periodic restart safe via compaction-resume.
**Owner:** /ops   **Related:** doc/design/app_runtime.md
```

### §6.4 — matrix Section 4 (Quick-reference: which agent for which topic)

| If the task is about… | Delegate | Context docs |
|---|---|---|
| Spawning/keeping the Majordomus PM alive, nudge loop, server attach | /app | `doc/design/app_runtime.md` |
| Reading HA state / calling an HA service / lights-climate-scripts | /ha | `doc/design/ha_integration.md` |
| HA-originated request / voice / Assist / inbound safety | /ha + /pm | `doc/design/ha_integration.md` |
| Adding/removing a project, minting/rotating a federation token, grant level | /ops | `.claude/skills/ops/SKILL.md` (Federation wiring procedure) |
| Dispatching work to a project's PM (status, run tests, etc.) | /pm | `FEDERATION_RULEBOOK.md` |
| launchd / always-on / Tailscale / macOS preflight | /ops | `doc/design/host_ops.md` |
| New design decision / cross-module boundary | /arch | the relevant `doc/design/*.md` |
| Security/safety audit (HA gate, exposure, secrets, blast radius) | /review | `doc/design/ha_integration.md`, `FEDERATION_RULEBOOK.md` |
| Commit / branch / PR | /scm | — |

---

## 7. Interface contracts

Four real boundaries (this is a solo single-repo deployment — most collaboration is via files/config, so contracts are few and concrete). Form: TypeScript-ish interfaces / JSON shapes.

**C1 — Fleet registry `fleet/fleet.config.json` (producer: /ops · consumer: /pm).**
The project registry PM reads to know who to federate with; `ops` owns it (incl. the secret token half — gitignored).
```jsonc
// fleet.config.json
{
  "projects": [
    { "name": "swarm", "url": "http://swarm-host.tailnet:3100", "grant": "RWE", "tokenRef": "env:TR_TOKEN_SWARM" },
    { "name": "dragon-vlm", "url": "http://jetson.tailnet:3100", "grant": "RO", "tokenRef": "env:TR_TOKEN_DRAGONVLM" }
  ],
  "ha": { "baseUrl": "http://homeassistant.local:8123", "tokenRef": "env:HA_TOKEN" }
}
```
Contract: `name`/`url`/`grant` are PM-readable; `tokenRef` resolves from env (secrets never in the file). Changing `grant` is an `ops` action reviewed by `/review`.

**C2 — Federated dispatch envelope (producer: /pm via the federation client · consumer: a project's PM).**
The shape PM sends through `/api/federation/request`; the project PM receives it as a `to=pm` task headed `[FEDERATED REQUEST]`.
```ts
interface FederatedRequest { op: "read" | "write" | "execute"; agent: "pm"; payload: string; /* token in header */ }
// result via /api/federation/wait → { status, result, ... }
```
Contract: `op` must be ⊆ the token's grant for `pm` (server hard-gates); the project PM is the second gate.

**C3 — HA bridge tool surface (producer: /ha · consumer: /pm).**
The two tools the HA bridge exposes to the Majordomus PM.
```ts
ha_get_state(entity_id: string): { entity_id, state, attributes }
ha_call_service(domain: string, service: string, data: object): { ok, verified_state? }
// ha_call_service consults the whitelist in doc/ha_integration.md; destructive domains require PM confirmation first.
```
Contract: PM calls these; `ha` owns their implementation + the whitelist. Adding a destructive domain to the whitelist is a `/review`-gated change.

**C4 — Inbound HA request → PM (producer: HA via /ha bridge · consumer: /pm).**
```ts
interface HaInbound { source: "ha"; intent: string; entities?: string[]; raw: string; }
// delivered as a pm task headed [HA REQUEST]; PM applies the H1 gate (read=immediate, destructive/cross-project=confirm).
```

*(No fifth contract: the app↔server boundary is the existing `startServer()` API, reused unchanged — documented in `doc/design/app_runtime.md`, not re-specified here.)*

---

## 8. Roadmap → wave dispatch mapping

**Parallelism is mostly Serial** — solo operator, one shared codebase + a phased deploy. Phases mirror `MAJORDOMUS_FLEET_PLAN.md`.

### Phase 0 — Host preflight (G1)
**Active agents:** pm, ops · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 0.1 | `provision.sh`: assert Node≥18, git, **headless `claude` auth**, Tailscale joined | ops | — |

### Phase 1 — Standalone-app MVP + Majordomus project
**Active agents:** pm, app, arch · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 1.1 | `serverHost.js` start-or-attach (reuse `startServer()`); prove server on :3100 | app | 0.1 |
| 1.2 | `supervisor.js` + `launchCommand.js`: spawn the Majordomus PM via node-pty; it registers **green** | app | 1.1 |
| 1.3 | Bootstrap the `majordomus` project (this plan) — skills/agents.json/matrix | pm | 1.2 |

### Phase 2 — Telegram operator surface
**Active agents:** pm, ops · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 2.1 | Configure the Telegram bridge `.env`; confirm two-way chat with the Majordomus PM | ops | 1.3 |

### Phase 3 — Majordomus PM skill (federation + HA mediation)
**Active agents:** pm, arch · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 3.1 | Author the PM SKILL: federation-as-delegation, HA inbound gate (H1), `fleet status` aggregation | pm (driving), arch | 2.1 |

### Phase 4 — Federate the projects (one at a time)
**Active agents:** pm, ops · **Parallelism:** Serial (per-project; file-disjoint but run serially by a solo operator)
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 4.1 | Per project: bind federation endpoints to Tailscale, mint token (RW/RWE per §12), `add-federation` → `fleet.config.json` | ops | 3.1 |
| 4.2 | Prove a federated **RO status** read, then a guarded **RWE dispatch** round-trip | pm | 4.1 |

### Phase 5 — Home Assistant (bidirectional)
**Active agents:** pm, ha, review · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 5.1 | `ha-bridge.js` outbound: `ha_get_state` + `ha_call_service`; prove a read + a safe service call | ha | 3.1 |
| 5.2 | Inbound: HA → `/api/dispatch` (or MCP); wire PM's H1 confirmation gate; `/review` audits | ha, pm, review | 5.1 |

### Phase 6 — Always-on
**Active agents:** ops, review · **Parallelism:** Serial
| Wave | Tasks | Agent(s) | Dependencies |
|---|---|---|---|
| 6.1 | launchd plist (KeepAlive + Throttle + bounded restart); `/review` checks no hot-loop | ops, review | 5.2 |

*All waves Serial: one operator, one shared codebase, a sequential deploy — honest, not a shortfall.*

---

## 9. Agent interaction map

```
                Telegram (operator)        Home Assistant
                       │                    ▲        │
                       ▼                    │(out)   │(in)
                     ┌────┐  C3/C4          │        ▼
        ┌─────arch   │ pm │◀───────────────/ha/─────┘
        │     review └─┬──┘
        │  (audit)     │ C1 fleet.config / C2 federated dispatch
        │              ├──────────────▶ /ops ──(mint tokens, launchd, Tailscale)
        │              ├──────────────▶ /app ──(supervise the PM, server host)
        │              └──(federation)──▶ remote project PMs (swarm, dragon-vlm, …)
        └─ scm (git, all)
```
Cross-specialist contracts are §7 C1–C4; everything else fans out through PM.

---

## 10. Bootstrap checklist (Fresh)

**Mode: Fresh** — no `.claude/skills/`, `.claude/mcp/`, `.claude/SKILLS.md`, or `.claude/rules/` exists in the `majordomus` project yet. All writes are `[FRESH]`.

1. **Prerequisites:** Task Router server available (bundled via the app), `.mcp.json` at the project root (`type: http` → `http://127.0.0.1:3100/mcp?project=majordomus`), the standalone app cloned/installed.
2. **Directories** (one `mkdir` each — portable):
   ```
   mkdir -p .claude/skills/pm .claude/skills/arch .claude/skills/review .claude/skills/scm
   mkdir -p .claude/skills/app .claude/skills/ha .claude/skills/ops
   mkdir -p .claude/tasks .claude/rules doc/design doc/plans fleet host/launchd
   ```
   (PowerShell: `New-Item -ItemType Directory -Force`.)
3. `CLAUDE.md` from `PM_TEMPLATES.md → CLAUDE.md Template`. Fills: `<PROJECT_NAME>`=`majordomus`, `<DOC_DIR>`=`doc`, `<SHARED_DOC_DIR>`=`doc`, `<DATE>`/`<YYYY-MM-DD>`=bootstrap date. **Includes the v4.9 `## Command Execution` rule** (macOS-native shell here). `[FRESH]`
4. `.claude/SKILLS.md` from §5. `[FRESH]`
5. `.claude/rules/INDEX.md` from `PM_TEMPLATES.md → Rules INDEX Template` (rows for app/ha/ops). `[FRESH]`
6. `doc/design/DOC_OWNERSHIP_MATRIX.md` from §6 (§6.1→Sec1, §6.2→Sec2, Abstract-standard from template, §6.4→Sec4). Single-repo — stop at Section 4. `[FRESH]`
7. Insert §6.3 Abstract blocks at the top of each `doc/design/*.md`. `[FRESH]`
8. Default skills from `PM_TEMPLATES.md`: `## PM Skill Template` → `/pm` (inject the fleet/federation/HA-mediation knowledge from §3), `## SCM Skill Template` → `/scm`, `## Architect Skill Template` → `/arch`, `## Architecture Review Skill Template` → `/review` (inject the §3 risk checklist). `[FRESH]`
9. Specialist skills `/app`, `/ha`, `/ops` — each with §3's Owns / Never-touches / SKILL.md domain knowledge / tiered-load, using the canonical `### Startup Sequence Template` (specialist, copy verbatim), `### Task Router Auto-Execute Template`, and `### Agent Design Principles` from `PM_TEMPLATES.md`. `[FRESH]`
10. Per-specialist rule files `.claude/rules/{app,ha,ops,scm}.md` (condensed rules + globs in frontmatter).
11. `.claude/mcp/task-router/agents.json` from §4. `[FRESH]`
12. *(Optional)* `taskRouter.modelByRole` — skip; `agents.json` carries explicit `model`.
13. **Static pre-flight:** every `agents.json` name has a `.claude/skills/<name>/SKILL.md`; every specialist has `.claude/rules/<name>.md`; every SKILL.md has `## Startup Sequence` + `## Task Router Auto-Execute`; coordinators have **no** `model`, specialists do; sorted-diff `agents.json` vs `skills/*/` vs `rules/*.md` — zero asymmetry.
14. **Runtime verify:** start the Majordomus PM (via the app supervisor) → `/pm` registers + lists agents → `/pm ping` healthy for app/ha/ops/scm → dispatch one `/ha` fork → confirm it reads only `Context docs:` (not all design docs).

---

## 11. Implementation notes

**Context token budget (PM session floor):**
| Component | Plan minimum | Practical floor |
|---|---|---|
| Project-specific SKILL.md injections (fleet/federation/HA mediation) | ~6–8K | ~6–8K |
| Default /pm SKILL.md (init.sh baseline) | — | ~4–6K |
| CLAUDE.md + rules INDEX.md | — | ~3–5K |
| Auto-memory load at startup | — | ~5–15K |
| Matrix + Abstract blocks (4 docs) | — | ~3–5K |
| **Total PM session floor** | ~6–8K | **~25–35K** |

7-agent single-repo → ~25–35K practical floor, in band. `1M − 35K ≈ 965K` headroom — comfortable for an always-on PM. Specialist floors ~10–18K.

- **Terminal vs fork:** **pm** = permanent dedicated terminal (always-on, the whole point). **app/ha/ops** = dedicated only during their build phase, one-shot forks afterward. **arch/review/scm** = forks (no persistent terminal) except during a heavy design/audit pass.
- **Scaling-down:** Phase 1 needs only pm + app; Phase 4 pm + ops; Phase 5 pm + ha. Don't run 7 terminals — run pm + the phase's lead.
- **Relationship to design docs:** `doc/design/*.md` + `MAJORDOMUS_FLEET_PLAN.md` are the source of truth for **what**; this plan + the SKILL.md files define **how agents collaborate to build it**.
- **Expected agent-system growth:**
  - *Coverage gap* — **possible**: a `/voice` specialist if HA-Assist intent mapping grows its own quirk surface (folded into `/ha` for now).
  - *New project domain* — **likely**: as you add federated projects, the per-project knowledge stays in *that project's* PM (not Majordomus) — so roster stays stable even as the fleet grows.
  - *Recurring cross-cutting concern* — **possible**: if status polling is heavy, the G4 cached-status path becomes real work (likely lands in `/ops` or a thin server-side change, not a new agent).
  - *Context overload / tech boundary / user friction* — **unlikely** at this scope.
  - **Expected new agents over lifetime: 0–1** (a `/voice` if Assist grows).
  - **Retraction path:** if `/app` work finishes and the app stabilizes, `/app` folds to fork-only (no merge needed); `/ops` and `/ha` are durable.
- **Canonical cross-cutting ownership:** secret-handling + commit conventions → **/scm** (canonical); HA action whitelist → **/ha**; federation grant policy → **/ops**; everyone links rather than restates.

---

## 12. Open gaps

- `Q-HA-TRANSPORT:` HA integration transport for v1 — **REST only** (simple, robust) or **REST + HA MCP** (richer, Assist-native)? Default assumed REST-first; MCP a Phase-5 follow-up. Changes the `/ha` SKILL surface + C4.
- `Q-FLEET-ROSTER:` The concrete list of projects to federate, each with **RW vs RWE** — needed for `fleet.config.json` (C1) and Phase 4 waves. (You chose "Read + dispatch" globally; confirm per-project: e.g. prod = RW, active-dev = RWE?)
- `Q-STATUS-COST:` Build the **G4 cached/server-direct RO status path** in v1 (so "fleet status" doesn't burn one project-PM LLM turn each), or accept live PM turns for v1 and optimize later?
- `Q-HA-WHITELIST:` Which HA actions are **immediate** vs **confirmation-required**? (Proposed default: reads + non-destructive `light`/`scene`/`notify` immediate; `lock`/`alarm_control_panel`/`cover`/`climate` setpoints + any cross-project write require Telegram confirm.)
- `Q-NETWORK:` **Tailscale** (recommended) vs LAN-bind + API key + TLS for the federation/HA-inbound mesh? Affects `host_ops.md` + G3 binding.
- `Q-MAJ-LOCATION:` **RESOLVED** — its own repo: **`github.com/kommisar-github/Majordomos`**. `/scm` owns that repo.
- `Q-APP-VENDORING:` **RESOLVED (v1): install-on-host, do not vendor.** The app imports the server via a sibling path (`../../mcp-task-router`) and is a *tool pointed at projects*; for v1 it's installed from a `claude-task-router` clone on the Mac (see `host/run-majordomus.sh` + `doc/design/host_ops.md`). Majordomos stays config-only. The Majordomus-specific **HA bridge** home is deferred to Phase 5 (likely a project-loaded module so it lives here without forking the shared app). *(Consequence: `/app`'s "Owns" paths under `majordomus-daemon/` refer to the seed-repo app it operates against; `/app` work on the MVP happens in the seed repo until/unless a project-loaded extension point is added.)*

---

**Pre-handoff checks: 7/7 pass.** (1) 7 agents across §3/§4/§5 ✓. (2) pm/arch/review carry no `model` ✓. (3) scm/app/ha/ops each have `model` ✓. (4) §8 covers Phases 0–6 = §1 scope ✓. (5) not Learning-First → no `(author, /learn reviews)` markers ✓. (6) app/ha/ops each have ≥5 concrete domain bullets ✓. (7) /devops, /db, /security, /perf, /release (+ /voice) each have an explicit include-or-decline ✓.
