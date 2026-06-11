# Majordomus Fleet — bootstrap plan (headless Task Router on macOS, federated + Home Assistant)

> **Status: PLAN.** Canonical home: `doc/plans/MAJORDOMUS_FLEET_PLAN.md`. No code
> yet. Builds on `doc/plans/STANDALONE_APP_PLAN.md` (the headless app) and the
> v0.9.0 inter-PM federation. The standalone app is **experimental (v0.1.0)** —
> this plan finishes the MVP and adds two new pieces (Home Assistant bridge,
> Majordomus PM skill).

## Requirements (decided 2026-06-07)

| Decision | Choice |
|---|---|
| Host | **macOS**, headless Task Router **app** (`majordomus-daemon/`) |
| Talks to | **PMs of all my projects** + **Home Assistant** |
| HA direction | **Bidirectional** — Majordomus ↔ HA |
| Project-PM topology | **Across LAN machines** (Mac + Windows/Jetson/… on the home network) |
| Authority over fleets | **Read + dispatch work** (RW/RWE federation grants; each project PM still gates) |
| Operator surface | **Telegram** (existing bridge) |

## What Majordomus *is*

One always-on macOS process — the standalone Task Router app — running a single
long-lived **Majordomus PM** (`claude` session via node-pty) wired to:

```
                          ┌──────────────────── macOS host (always-on) ─────────────────────┐
   You (phone)            │  Task Router app (one Node process)                              │
      │ Telegram          │   • server in-process (:3100 MCP+REST, federation, telegram)     │
      ▼                   │   • node-pty supervisor → Majordomus PM (`claude`, long-lived)   │
  Telegram bridge ───────▶│   • HA bridge module (REST/WS + MCP)                             │
                          └───────┬───────────────────────────────┬─────────────────────────┘
                       federation │ (RW/RWE, per project)          │ bidirectional
                        over LAN  ▼                                ▼
        ┌──────────────┬──────────────┬─────────────┐      ┌──────────────────┐
        │ Win: swarm PM│ Jetson: X PM │  …other PMs  │      │  Home Assistant   │
        └──────────────┴──────────────┴─────────────┘      └──────────────────┘
```

The Majordomus PM's "specialists" are **the remote project PMs** (reached by
federation) plus **Home Assistant** (reached as a tool surface). You drive it from
Telegram; it dispatches across the house and the codebases.

## Reuse vs. new

**Reused as-is:**
- Task Router **server** (run in-process by the app — `startServer()`), incl. the
  v0.9.0 **federation** surface (`/api/federation/{list_agents,request,wait}`,
  `grant_access`/`revoke_access`, per-agent RO/RW/RWE, audit feed).
- **Telegram bridge** (operator I/O; zero PM-token cost for event forwarding).
- The **node-pty supervisor + launch/nudge loop** from STANDALONE_APP_PLAN (here it
  supervises just the one Majordomus PM, not a full local roster).
- `init.sh` seed to bootstrap the Majordomus project itself.

**New work:**
1. **HA bridge module** (`majordomus-daemon/src/ha-bridge.js`) — bidirectional.
2. **Majordomus PM skill** — a PM whose delegation targets are *federated project
   PMs* + *HA actions*, with safety gating on home/cross-project actions.
3. **Fleet config** — projects (LAN address + federation token) + HA (URL + token).
4. **macOS always-on** packaging — `launchd` plist + restart/health policy.
5. Finishing the **standalone-app MVP** (supervisor + server-host; web UI optional
   since the operator surface is Telegram).

## Federation across the LAN (Majordomus → project PMs)

v0.9.0 model: the **external PM (Majordomus) is the client**; each **project**
exposes its `pm` via a token. So per project:

1. On the project machine, the Task Router server binds its **`/api/federation/*`**
   endpoints to a LAN-routable interface (not just loopback). Owner endpoints
   (`grant_access`, etc.) and the web UI stay **loopback-only** (G3 split exposure).
2. The project owner mints a token granting Majordomus the chosen level:
   `grant_access` → `{ pm: RW }` or `{ pm: RWE }` (RW = ask PM to write/plan;
   RWE = ask PM to execute). Token = `trtok_…`; server stores only its hash.
3. Register the federation in Majordomus (`add-federation <name> <url> <token>`).
4. Majordomus dispatches via `/api/federation/request` (mints a `to=pm` task with a
   `[FEDERATED REQUEST]` header on the project; **the project PM is the second
   gate** — it can decline/re-scope), and collects via `/api/federation/wait`.

**Transport/security across the LAN:** tokens gate every federated call (they
bypass the global key by design). Put the federation traffic on **Tailscale** (or a
LAN-only bind + `TASK_ROUTER_API_KEY` + TLS/SSH-tunnel) so it isn't exposed beyond
the home network. Each project keeps its own DB/lock; Majordomus never touches
project files directly — it asks the project PM, which has the filesystem/git.

## Home Assistant — bidirectional

**Majordomus → HA (control + read):**
- Simplest/robust: **HA REST API** with a long-lived access token —
  `GET /api/states[/<entity>]` to read, `POST /api/services/<domain>/<service>` to
  act (lights/climate/scripts/notify). The HA bridge exposes these to the
  Majordomus PM as a small tool set (`ha_get_state`, `ha_call_service`).
- Optional richer path: connect to HA's **MCP Server** integration (Assist intents
  as MCP tools over SSE). REST first; MCP as a follow-up.

**HA → Majordomus (triggers):** two viable paths —
- **HA "MCP Client" integration** pointed at the app's MCP endpoint
  (`http://<mac>:3100/mcp?project=majordomus`) → HA Assist/voice can call
  Task Router tools (e.g. dispatch a status check). Cleanest, LLM-native.
- **HA automation → REST** (`POST /api/dispatch` to the Majordomus PM, or a
  webhook) for scripted triggers without Assist.

**Safety on the inbound path (important):** a voice/automation trigger must **not**
silently fan out RWE work across projects or fire destructive home actions. The
Majordomus PM mediates every inbound request and **requires confirmation (via
Telegram) for destructive or cross-project-write actions** — read/status and
explicitly whitelisted home actions can be immediate. This mirrors the
planning-only / confirm-before-destructive guardrails already in the seed.

## Auth & secrets (on the Mac, via env / a secrets file)
- **Per-project federation tokens** (RW/RWE) — one per project.
- **HA long-lived access token** + HA base URL.
- **`TASK_ROUTER_API_KEY`** — gates the REST surface (so HA's inbound REST calls
  and the bridge are authenticated).
- **`ANTHROPIC_API_KEY`** (or stored `claude` credential) for the headless PM (G1).
- Recommend **Tailscale** across the fleet so nothing is internet-exposed.

## Bootstrap sequence (phased)

**Phase 0 — host prep (G1).** macOS: Node ≥18, `git`, **`claude` CLI installed and
non-interactively authenticated** (no human to do a browser login on a headless
box), Tailscale joined. Verify `claude --version` runs unattended.

**Phase 1 — stand up the app + the Majordomus project.** Finish the
standalone-app MVP (server-host start/attach + supervisor). Bootstrap a
`majordomus` project with `init.sh`; customize the PM skill (Phase 3). Prove: app
boots, server on :3100, Majordomus PM launches via node-pty and registers green.

**Phase 2 — Telegram operator surface.** Configure the bridge (`.env`); confirm you
can talk to the Majordomus PM from your phone and get replies.

**Phase 3 — Majordomus PM skill.** Author the PM skill: delegation routes to
**federated project PMs** (not local specialists) + **HA tools**; inbound-request
mediation + confirmation gating; a "house status" / "fleet status" aggregation
command. (Plus the standard PM memory/reconciliation.)

**Phase 4 — federate the projects (one at a time).** For each project: bind its
server's federation endpoints to Tailscale/LAN, mint a token (RW or RWE per your
per-project choice), `add-federation` it into Majordomus. Prove: Majordomus asks a
project PM for status and gets it; then a guarded dispatch round-trip.

**Phase 5 — Home Assistant.** Outbound first (REST token → `ha_get_state` /
`ha_call_service`, prove a read + a safe service call). Then inbound (HA MCP Client
→ `/mcp`, or an automation → REST) with the confirmation gate. Prove both
directions end-to-end.

**Phase 6 — always-on (G2).** `launchd` plist to start the app on boot + restart on
crash; a **bounded periodic restart** to cap PM context growth over days (safe:
compaction-resume + DB-authoritative `pickup_next_task`). Document the runbook.

## Gaps / open questions (carried from STANDALONE_APP_PLAN + new)
- **G1 host prereqs** — headless `claude` auth on macOS is the critical prerequisite.
- **G2 always-on lifecycle** — restart/health policy; only the Majordomus PM must be
  always-on (it spawns nothing locally; it federates).
- **G3 split exposure** — federation/HA-inbound on Tailscale/LAN; owner + web UI
  loopback-only; API key required whenever a port is reachable.
- **G4 read cost** — every federated *read* currently spins a project-PM LLM turn.
  For frequent "fleet status" polls this is slow/expensive; consider a **cached or
  server-direct RO status path** (the v0.9.0 deferred read-direct option) so status
  aggregation doesn't burn a PM turn per project. Worth doing for a status-heavy hub.
- **G5 RW propagation** — when a project PM applies Majordomus-dispatched work, define
  commit/push attribution (audit feed = who/what/when).
- **NEW H1 — HA inbound safety** — the confirmation gate for destructive/cross-project
  actions must be airtight; default-deny anything not explicitly whitelisted.
- **NEW H2 — HA transport choice** — REST (simple, chosen for v1) vs HA MCP (richer,
  follow-up); pin one for the MVP.
- **NEW H3 — discovery** — how Majordomus learns project addresses/tokens (static
  fleet config file vs Tailscale service discovery). Static file for v1.

## Verification (end-to-end, once built)
1. From **Telegram**: "status of all projects" → Majordomus federates to each project
   PM, aggregates, replies.
2. From **Telegram**: "have swarm run its tests" → federated RWE dispatch → swarm PM
   gates + executes → result relayed back.
3. **Maj → HA**: "is the office light on? turn it off" → `ha_get_state` + guarded
   `ha_call_service`.
4. **HA → Maj** (voice/automation): "ask dragon-vlm for build status" → inbound →
   Majordomus mediates (read = immediate) → federated query → spoken/notified reply.
5. **Resilience**: kill the app → `launchd` restarts → Majordomus PM resumes (memory
   + reconciliation) with no lost in-flight federated tasks.

## Sequencing
0. Save this plan.
1. Phase 0–1 (host + app MVP + Majordomus project) — **stop for review** before federation.
2. Phase 2–3 (Telegram + PM skill).
3. Phase 4 (federate projects, one at a time).
4. Phase 5 (HA bidirectional).
5. Phase 6 (always-on) + the G4 cached-status refinement if status polling proves heavy.
