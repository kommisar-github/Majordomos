---
description: Federation bridge to the swarm dev fleet's remote PM (192.168.1.131:3100, project=swarm)
globs: doc/swarm_GUIDELINES.md
alwaysApply: false
---

# swarm — condensed rules

- **Federation bridge, not a local worker.** Relay a request from Majordomus (SoT) INTO
  swarm's remote PM and return its result; hold SoT-gathered canon about swarm. swarm is a
  `role:"federated-pm"` peer (declared in `agents.json` with a `remote` block): PM **registers
  it at startup** and reaches it with a normal `dispatch_task(to="swarm")` — **Mode 4 federated**
  (the local server forwards over the gate and mirrors the result back into a local task). A
  federated peer has **no local skill to fork — NEVER fork it.** **"Offline" = the remote link is
  down** (`remote_unreachable`) → **report the link down**, do NOT fall back to a fork. swarm's PM
  is the **second gate** — relay its decline/re-scope verbatim, never fake execution.
  (`FEDERATION_RULEBOOK.md` §2 is the authority for federated-pm bridge behavior.)
- **The routed call:** `dispatch_task(to="swarm")` (server forwards; a local mirror task tracks
  it). Read/execute both ride this path. **Manual fallback only** (bypasses the local server — no
  tracking, prints bytes to stdout): `set -a; . .claude/mcp/task-router/federation.env; set +a`
  then `node .claude/mcp/task-router/client.js remote-execute --url=http://192.168.1.131:3100
  --project=swarm --agent=pm --token-env=FED_TOK_SWARM --payload='<req>'` (**bare** token-env
  name, no `env:` prefix; read-only → `remote-read-guidelines` / `remote-list-agents`).
- **Endpoint source of truth** = the agents.json `remote` block + `fleet/fleet.config.json`
  (`name:"Swarm"`); slug `swarm` is lowercase/case-sensitive.
- **Grant** is `pm` = whole-fleet access at level **RWX (legacy RWE)**. Majordomus is the client;
  swarm minted the token, which lives **server-read** in `.claude/mcp/task-router/federation.env`
  (gitignored) — never inline it in a payload/doc/commit/log.
- **Knowledge** lands in `doc/swarm_GUIDELINES.md` via the consolidation gate (request → PM →
  /review), populated during the SoT knowledge-gathering phase.

**Owns:** `doc/swarm_GUIDELINES.md`.
**Never touches:** other fleets' files (`dragon-vlm`, `jetson-protect`), source code, `fleet/**`
(`/ops`), `host/**`, `.claude/mcp/task-router/federation.env` (read-only). See SKILL.md.
