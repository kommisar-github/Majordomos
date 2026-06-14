# Consumer feedback — Task Router federation + enterprise SoT bootstrap

**Date:** 2026-06-14
**Source artifacts:** `ENTERPRISE_GUIDEBOOK.md` (local, matches v1.4.9 seed bundle); `client.js` `PROTOCOL_VERSION = 'node/v4.6'` (`.claude/mcp/task-router/client.js:51`); server v1.4.10 (`/health` → `version`); seed v4.13 (`.claude/mcp/task-router/seed-state.json`). Extension: claude-task-router v1.4.10 (IDE extension, macOS).
**Produced:** Home-automation SoT fleet (role=sot, `ent:home`, seed v4.13) federating to 3 dev fleets (Swarm, Dragon-VLM, Jetson-Protect) via a shared multi-tenant Task Router at a single LAN IP. Agent roster: 3 coordinators + 5 specialists = 8 total. Session scope: inter-fleet federation wiring + enterprise identity bootstrap; NOT a first-seed bootstrap round.
**Signal classification:** **Additive** on all items — have NOT read `CONSUMER_FEEDBACK.md` prior to writing; maintainer should re-classify on ingestion using the five-way protocol.

---

## What worked — please keep / reinforce

- **Grant token (`trtok_`) roundtrip worked first-try.** All 3 dev fleets had minted and delivered tokens out-of-band; `remote-list-agents` returned `{"ok":true,"result":{"project":"<id>","agents":{"pm":"RWE"}}}` on the first call with no auth debugging needed. The trtok scheme is simple and the 401/403 vs 404 error discrimination is clean enough to diagnose in seconds. **Additive-preservation.**

- **`remote-list-agents` / `remote-execute` caller verbs are solid.** All four caller-side federation verbs (`remote-list-agents`, `remote-read-guidelines`, `remote-write-guidelines`, `remote-execute`) are exposed in `client.js` and function reliably. The `--token / --token-env / TASK_ROUTER_FED_TOKEN` resolution chain (`client.js:196`) is clear and predictable. **Reinforcing.**

- **`fleet/fleet.config.json` registry shape is intuitive.** The `{ name, url, grant, project, tokenRef }` schema is clean — each field has an obvious role, the human-readable display name is decoupled from the server-side project slug, and the tokenRef convention keeps the committed file free of secrets by design. **Additive-preservation.**

- **Loopback active-pull needs zero network changes.** Majordomus calling OUT to the 3 dev fleets required no inbound firewall rule or bind-address change — the SoT calls the consumers, not the other way. This is the right default for a home-automation SoT where inbound exposure is a safety consideration. Passive-direction (consumers reading from SoT) is a separate, opt-in decision requiring operator sign-off. The clear separation prevented accidental exposure. **Reinforcing.**

- **Gitignore secrets design (`*secret*` / `*.env` + tokenRef split) is exactly right.** Tokens go in `fleet/fleet.secrets.env` (gitignored via `*.env`); the committed file holds only env-var names. This required no ceremony — the pattern "just worked" with no risk of accidental token commit. The tokenRef `"env:VAR_NAME"` convention is a useful human pointer even if the client doesn't consume it. **Additive-preservation.**

- **`/health` returning `"tenants": N` is genuinely useful.** When three `remote-list-agents` calls returned 404 `project_not_registered`, checking `/health` (which showed `tenants: 3`) immediately confirmed the server was up and the 3 expected projects existed — narrowing the issue to project-ID casing rather than connectivity. A small detail that saved a debugging round-trip. **Additive-preservation.**

- **The federation second-gate model (remote PM can decline).** The `remote-execute → /api/federation/request → remote PM reviews → /api/federation/wait → result` path means the remote fleet's PM is a real gating principal, not just a passthrough. This is architecturally correct for a multi-fleet home SoT where individual fleet PMs should retain veto over requests from the SoT. **Reinforcing.**

---

## Friction — severity-rated and actionable

### HIGH — blocks or materially slows a producer agent

**H1. `register_agent` `remote:` block documented in seeded PM skill but unimplemented in v4.13.** The seeded PM SKILL.md (`.claude/skills/pm/SKILL.md:88–89`, extracted from PM_TEMPLATES.md) documents `register_agent` with a `remote: { url, project, target_agent, api_key_env }` block and points to `doc/runbooks/MAJORDOMUS_RUNBOOK.md` for the schema. Neither ships in v4.13: (a) the `register_agent` MCP tool schema has no `remote:` key (`mcp__task-router__register_agent` accepts only `name`, `capabilities`, `metadata`, `project`); (b) `MAJORDOMUS_RUNBOOK.md` is absent from both the seed bundle and the project tree (verified: `find . -name MAJORDOMUS_RUNBOOK.md` returns nothing). Result: federated PMs cannot be registered as true MCP roster agents. Every cross-fleet dispatch requires an explicit `client.js remote-execute --url … --project … --token-env …` call with manual result polling — no `dispatch_task` / `collect_results` integration. The seeded PM skill describes a capability the infrastructure does not yet provide, which creates false expectations and silent failure when agents follow the documented path.

*Proposed fix:* (Minimum) Remove or bracket the `register_agent` `remote:` reference in PM_TEMPLATES.md and ship `MAJORDOMUS_RUNBOOK.md` with its current actual schema, so the skill reflects reality. (Structural) Implement the `remote:` block: when `metadata.remote` is present, the server registers the agent as a forwarding stub — `dispatch_task` hits `POST /api/federation/request` on the peer and long-polls `POST /api/federation/wait`, delivering the result back through `collect_results`. Preference: structural fix; the minimum fix reduces confusion but leaves the capability gap.

**H2. `init.sh` overwrites 13+ customized files on an existing fleet with no additive identity/role mode.** When applying enterprise identity (`--enterprise-project= --role=`) to an already-bootstrapped, heavily customized fleet, `init.sh` offers only two paths: (a) reject with an error (when `agents.json` exists, no `--force`), or (b) overwrite everything with `--force` — including `agents.json`, `.mcp.json`, `CLAUDE.md`, all 4 seeded skill files (pm/scm/arch/review `SKILL.md`), `SKILLS.md`, `rules/project.md`, `rules/INDEX.md`, `tasks/README.md`, `doc/design/DOC_OWNERSHIP_MATRIX.md`, `doc/plans/ROADMAP.md`, `doc/NEXT_STEPS.md`, `seed-state.json`, and `.claude/settings.local.json`. The fleet.json write (Step 5c of `init.sh`) is entirely self-contained — it reads only `--enterprise-project=` / `--role=` and the seed version — and has no dependency on any of the steps that overwrite custom files. We hand-authored `fleet.json` directly from the spec (`ENTERPRISE_GUIDEBOOK.md:56–63`) because `--force` was too destructive. The correct content of `fleet.json` is not documented anywhere in the user-facing docs — only deducible from reading `init.sh` source.

*Proposed fix:* Add an idempotent `init.sh --enterprise-project= --role=` mode (or a standalone `task-router set-identity --enterprise-project= --role=`) that writes **only** `fleet.json` (Step 5c) and exits, never touching any other file. Fleet identity is semantically orthogonal to skill/roster bootstrapping and should be settable at any time without re-bootstrapping. As a minimum fix: document the `fleet.json` schema in the ENTERPRISE_GUIDEBOOK alongside §3 so operators can hand-author safely.

### MEDIUM — would improve output quality or reduce consumer friction

**M1. No dashboard or `list_agents` support for federated agents.** Because `register_agent` has no `remote:` path, federated fleet PMs can only be listed in `agents.json` as static entries with no live registration. The dashboard and `list_agents` show them as perpetually offline (grey state, no worker terminal). There is no way for the SoT operator to see at a glance whether a federated fleet is reachable, or when it was last seen.

*Proposed fix:* Introduce a `federated` / `remote` agent kind in the roster type system. The dashboard renders it with a "linked fleet" badge and derives reachability from the peer `/health` endpoint (lazy-checked on panel open). `list_agents` returns these with `status: "federated"` and a `last_reachable_at` field populated from the last successful federation call. This can be implemented without the full `dispatch_task`→federation forwarding of H1.

**M2. `fleet.config.json` not consumed by client; `env:` prefix must be manually stripped on every invocation.** The `fleet/fleet.config.json` registry (schema `{ name, url, grant, project, tokenRef }`) is a documentation artifact only — `client.js` never reads it. Every federation call requires repeating `--url`, `--project`, and `--token-env` explicitly. The `tokenRef` field uses the convention `"env:FED_TOK_<NAME>"`, but the CLI requires the bare var name (`--token-env=FED_TOK_SWARM`). Passing `--token-env=env:FED_TOK_SWARM` (as `tokenRef` suggests) causes `process.env["env:FED_TOK_SWARM"]` to resolve to `undefined` → silent 401, no error message indicating the prefix was the cause (`client.js:196`, `fedResolveToken`).

*Proposed fix:* (Minimum) Choose one convention for `tokenRef` and make it consistent: either (a) drop the `env:` prefix from the schema to match the CLI, or (b) have `fedResolveToken` strip the `env:` prefix before `process.env` lookup. Either eliminates the gotcha. (Structural) Let the client resolve a fleet by name: `--fleet=swarm` → reads `fleet/fleet.config.json`, extracts `url`, `project`, `tokenRef`, strips `env:`, resolves var. Preference: minimum fix (b) first; structural fix adds ergonomics once the minimum is in.

**M3. Phase-3 enterprise verbs documented in ENTERPRISE_GUIDEBOOK §7 but absent in v4.13 client.** `set-topic-owner`, `list-topic-owners`, `analyze-demand`, and `fleet-registry` are described in ENTERPRISE_GUIDEBOOK.md §7 as current `client.js` commands. None are present in either the project's v4.13 client (`.claude/mcp/task-router/client.js`) or the v1.4.9 seed bundle's `client.js` (verified: `grep -n "set-topic\|list-topic\|analyze-demand\|fleet-registry"` returns nothing in both files). The guidebook presents them without any "not yet available" or "Phase 3 — planned" marker, so an operator following §7 hits an unknown-command error with no explanation.

*Proposed fix:* Either (a) ship the Phase-3 verbs (the guidebook implies they exist now), or (b) annotate each undocumented command in the guidebook with `*(planned — not yet in v4.13)*` until they ship. A single `<!-- NOTE: Phase 3 verbs (set-topic-owner, list-topic-owners, analyze-demand, fleet-registry) are planned but not yet shipped in v4.x client. -->` block above §7 would suffice as a minimum fix.

---

## Possible documentation bugs

- **`ENTERPRISE_GUIDEBOOK.md §7` (`set-topic-owner`, `list-topic-owners`, `analyze-demand`, `fleet-registry`)** — four `client.js` commands described as current in §7; none present in v4.13 or v1.4.9 seed client (grep-verified). Unclear whether this is a forward-dated section or a documentation lag.

- **PM_TEMPLATES.md → seeded `.claude/skills/pm/SKILL.md:88–89`** — `register_agent` `remote:` block and `doc/runbooks/MAJORDOMUS_RUNBOOK.md` reference both documented in the seeded PM skill; neither implemented in v4.13 (no `remote:` key in MCP tool schema; runbook file absent from seed bundle and project). Grep-confirmed against `mcp__task-router__register_agent` tool schema.

- **`ENTERPRISE_GUIDEBOOK.md §3` (fleet.json schema)** — the schema shown (`{ "fleet_id", "enterprise_project_id", "role", "seed_version" }`) is accurate but the `created_at` and `_note` fields written by Step 5c of `init.sh` are not shown. Minor, but operators hand-authoring `fleet.json` (see H2) may omit them without knowing they're part of the canonical output.

- **Project ID case-sensitivity undocumented in ENTERPRISE_GUIDEBOOK and USER_MANUAL** — Task Router project IDs are lowercase and case-sensitive on the server; title-case returns `HTTP 404 project_not_registered` with no hint. Not mentioned in the guidebook, user manual, or TROUBLESHOOTING.md. Discovered empirically (3 × 404 round-trip before trying lowercase). The 404 body does not suggest casing as the cause.

---

## Suggested additions

**A1. `--fleet=<name>` shorthand in `client.js`.** Once `fleet.config.json` is consumed by the client (see M2 structural fix), a `--fleet=swarm` shorthand that resolves `url` + `project` + `tokenRef` (stripping `env:` prefix) would eliminate the need to repeat three flags on every federation call. The fleet name acts as a stable alias for the full connection spec, matching the pattern operators already follow when writing the config file.

**A2. `/api/projects` endpoint for listing active project slugs.** When a federation call returns `project_not_registered`, the operator needs to know the correct slug. Currently the only signal is `GET /health → tenants: N` (count only, no names). A lightweight `GET /api/projects` returning `{ projects: ["swarm", "dragon-vlm", "jetson-protect"] }` would let operators self-diagnose casing issues without guessing. Scope: read-only, no auth required beyond the existing federation gate (or gated by the same `trtok_` token).

**A3. Federation-bridge agent pattern — consider supporting natively as `role:"federated-pm"`.** As a workaround for H1 (no native federated-agent registration), we shipped a **federation-bridge SKILL** for each remote fleet PM. The bridge is a Claude Code skill that: (a) holds the remote fleet's connection metadata (url, project slug, token env-var name, grant level) as descriptive fields, (b) invokes `client.js remote-execute --url … --project … --agent=pm --token-env=…` to relay a request to the remote PM and long-poll the result, and (c) owns the SoT's durable knowledge *about* that fleet (a fleet-specific `GUIDELINES.md`). The bridge can operate in two modes: **fork** (PM invokes it as a one-shot subagent for a single cross-fleet request — zero extra terminals) or **bridge worker** (launched as a Task Router terminal, polls `pickup_next_task` and relays each dispatch to the remote PM via `remote-execute` — would make the federated agent show online in the dashboard using only v4.13 primitives). The verbatim SKILL.md is in Appendix A below. We propose this pattern as the shape for a native `role:"federated-pm"` agent kind: a registered agent whose `dispatch_task` forwards to `POST /api/federation/request` on the peer and delivers the result back through `collect_results`, eliminating the need for a bridge SKILL or explicit `remote-execute` plumbing.

---

## What not to change — explicit preservation

- **The `.gitignore` `*secret*` / `*.env` pattern + `tokenRef` split design.** Having the committed file hold only env-var names with raw tokens in a gitignored file is exactly the right division. The convention works without any tooling enforcement — the semantics are clear enough that agents don't accidentally commit tokens. This design should be preserved even if the `tokenRef` format evolves (see M2).

- **The `/health` `tenants: N` signal.** A count of active tenants is cheap to produce and high-value for diagnosing multi-tenant issues (connectivity vs. wrong project slug vs. no agents started). Keep it in the `/health` response body.

- **The federation second-gate model (remote PM can decline).** The `POST /api/federation/request → remote PM reviews → result` path preserves fleet autonomy. A home SoT dispatching to a dev fleet should not be able to bypass the fleet's PM — this is load-bearing for the trust model. Do not short-circuit to direct agent execution without the PM gate.

- **The 401/403/404 discrimination in federation error responses.** Getting distinct HTTP codes for "auth failed" vs "project not found" vs "operation denied" made debugging fast. Keep these separate; do not collapse into a generic 4xx.

---

## Numbers from this bootstrap round

- **Session type:** Federation + SoT enterprise identity bootstrap (not a seed bootstrap round — fleet was already seeded).
- **Fleets wired:** 3 consumer fleets → 1 SoT, all on 1 shared multi-tenant server (LAN, `http://192.168.1.111:3100`).
- **Agent roster (`agents.json`):** 8 total — 3 coordinators (pm, arch, review) + 5 specialists (scm, app, ha, ops, ha_devops). Custom roster, not the default 4-agent seed.
- **Docs produced this session:** 4 new files (doc/design/federation.md rewrite, doc/federation.md, doc/feedback/federation_bootstrap_feedback.md, fleet/fleet.config.json) + 2 created non-doc files (fleet.json, .env) + 1 doc updated (DOC_OWNERSHIP_MATRIX.md — 3 rows added).
- **Connectivity verification calls:** 6 total (3 × title-case → 404; 3 × lowercase → 200 OK + roster). Round-trips per fleet: 2.
- **Time to produce:** One session (~45 min agent time across 4 tasks: wire config, draft docs, apply review corrections, write feedback).
- **Source docs consumed for this feedback:** `ENTERPRISE_GUIDEBOOK.md` (~5K tokens), `init.sh` (~700 lines / ~2.5K tokens), `client.js` (~450 lines / ~1.5K tokens).

---

## Meta-note

This feedback was produced by the `/ops` specialist agent on the consumer fleet, not by PM or the user directly — which is itself a signal. The pattern of "PM dispatches federation work to /ops, /ops reports gaps back to PM, PM routes to /review for consolidation, then to /scm for commit" worked well and produced structured, verifiable output. The main friction in the feedback loop was that the gap between what PM_TEMPLATES.md promises (`register_agent remote:` block, MAJORDOMUS_RUNBOOK.md) and what v4.13 ships is invisible until you attempt the feature. A "planned features" section in the ENTERPRISE_GUIDEBOOK — even a simple bulleted list of features that are documented but not yet shipped — would have saved the round-trip of discovering each gap empirically.

---

## Appendix A — Federation-bridge SKILL.md (verbatim workaround for H1)

This is the exact SKILL.md we ship for each federated fleet PM (one per fleet; this is the `swarm` instance). It is the concrete shape we are proposing for a native `role:"federated-pm"` agent kind (see A3). Token env-var names are referenced by name only; no raw token values are present.

```markdown
---
name: swarm
description: "Federation bridge to the swarm dev fleet's PM (remote, 192.168.1.111:3100). Use to delegate a request into swarm's PM via the federation gate and to hold SoT-gathered canon about the swarm fleet."
disable-model-invocation: false
---

# swarm — Federation Bridge Agent

You are the **federation bridge** for the **swarm** dev fleet. You are NOT a local
build specialist — you carry a request from Majordomus (the home SoT) **into swarm's
remote PM** and relay its result back, and you own the SoT's durable knowledge *about*
the swarm fleet.

## Federation target (descriptive — see Key Facts on what consumes it)
- **Remote URL:** `http://192.168.1.111:3100`  (host may change; source of truth is `fleet/fleet.config.json` → `name:"Swarm"`)
- **Remote project slug:** `swarm`  (lowercase, case-sensitive — title case → HTTP 404 `project_not_registered`)
- **Remote agent:** `pm`  (every federated request lands on swarm's PM — the **second gate**)
- **Grant:** `pm` (level **RWE** server-side; query with `remote-list-agents`)
- **Token env var:** `FED_TOK_SWARM`  (raw token lives ONLY in gitignored `fleet/fleet.secrets.env`)

## What you are (and aren't)
- You are a **bridge/proxy**, not a polling worker with local domain code. v4.13 has **no
  native federated-agent forwarding** (see `doc/feedback/federation_bootstrap_feedback.md`),
  so this bridge is how a federated PM participates in the roster.
- You appear **offline** in the dashboard by design (no launcher/terminal yet). That is expected.
- **swarm's PM is a gate too:** it may decline, re-scope, or clarify. Relay its verdict verbatim — never pretend it executed something it refused.

## Invocation modes
1. **Fork (current default).** PM invokes this skill to relay one request to swarm's PM,
   then you return the result to PM. One-shot; no terminal needed.
2. **Bridge worker (optional, future).** If launched as a Task Router terminal, poll PM
   dispatches (`pickup_next_task`), relay each to swarm's PM, and `complete_task` with the
   result — which would make this agent show **online** in the dashboard using only existing
   v4.13 primitives. Not enabled now (operator chose offline-for-now).

## The bridge mechanic (the one thing you do)
Source the secrets, then `remote-execute` into swarm's PM:

```
set -a; . fleet/fleet.secrets.env; set +a
node .claude/mcp/task-router/client.js remote-execute \
  --url=http://192.168.1.111:3100 --project=swarm --agent=pm \
  --token-env=FED_TOK_SWARM --payload='<the request to swarm PM>'
```
- Pass the **bare** env-var name (`--token-env=FED_TOK_SWARM`); never the `env:` prefix.
- `remote-execute` long-polls swarm's PM result unless you add `--no-wait`.
- For read-only needs use `remote-read-guidelines` / `remote-list-agents` instead of execute.
- Return swarm's PM's result (and its gate verdict) to the caller; do not edit or second-guess it.

## MCP Transport (Required — only relevant if run as a bridge worker)
If `mcp__task-router__*` tools are exposed natively, use them; otherwise use
`.claude/mcp/task-router/client.js` (never roll your own HTTP). Local endpoint
`http://127.0.0.1:3100/mcp?project=$TASK_ROUTER_PROJECT`. The federation `remote-*` verbs
target the REMOTE server and need `--url/--project/--token-env` as shown above.

## Memory Policy
No auto-memory files. Your only sanctioned durable write target is
`doc/swarm_GUIDELINES.md`, and you do **not** write it directly — **request consolidation**
and PM routes the draft through `/review`. `save_memory`/`load_memory` are runtime state only.

## Consolidation (request — never write GUIDELINES directly)
The SoT knowledge-gathering phase populates `doc/swarm_GUIDELINES.md` with durable canon
about the swarm fleet (what it does, its conventions, recurring asks). On a durable+novel
discovery or a PM ask: re-read `doc/swarm_GUIDELINES.md` **fresh**, draft a delta, and
request consolidation — PM gates via `/review` and commits.

## Owns (files)
- `doc/swarm_GUIDELINES.md` — SoT-gathered durable knowledge about the swarm fleet.

## Never touches
- Other fleets' agents/docs (`dragon-vlm`, `jetson-protect`), any source code, `fleet/**`
  (`/ops` owns the registry + secrets), `host/**`, every other agent's files.
- `fleet/fleet.secrets.env` is read-only to you (source it; never edit — PM/`/ops` own the sink).

## Key Facts
- `fleet/fleet.config.json` and the agents.json `remote` block are **descriptive metadata** —
  v4.13's client does NOT parse them; tokens resolve only via `--token-env`. They document the
  target and are where a future federated-agent feature would read from.
- Majordomus is the federation **client**; swarm minted the `trtok_` grant. The token bypasses
  the global key by design — treat it as a credential (it stays gitignored).
- Active-pull direction (Majordomus → swarm) works today on loopback; no inbound binding needed.
```
