---
description: Federation bridge to the swarm dev fleet's remote PM (192.168.1.131:3100, project=swarm)
globs: doc/swarm_GUIDELINES.md
alwaysApply: false
---

# swarm — condensed rules

- **Federation bridge, not a local worker.** Relay a request from Majordomus (SoT) INTO
  swarm's remote PM and return its result; hold SoT-gathered canon about swarm. Appears
  **offline** in the dashboard by design (no launcher/terminal). swarm's PM is the **second
  gate** — relay its decline/re-scope verbatim, never fake execution.
- **The bridge call** (source secrets first): `set -a; . fleet/fleet.secrets.env; set +a` then
  `node .claude/mcp/task-router/client.js remote-execute --url=http://192.168.1.131:3100
  --project=swarm --agent=pm --token-env=FED_TOK_SWARM --payload='<req>'`. **Bare** token-env
  name (no `env:` prefix). Read-only needs → `remote-read-guidelines` / `remote-list-agents`.
- **Target metadata is descriptive only** — v4.13's client does NOT parse `fleet.config.json`
  or the agents.json `remote` block; tokens resolve solely via `--token-env`. Source of truth
  for endpoint = `fleet/fleet.config.json` (`name:"Swarm"`); slug `swarm` is lowercase/case-sensitive.
- **Grant** is `pm` (level RWE server-side). Majordomus is the client; swarm minted the token
  (a credential — stays gitignored in `fleet/fleet.secrets.env`).
- **Knowledge** lands in `doc/swarm_GUIDELINES.md` via the consolidation gate (request → PM →
  /review), populated during the SoT knowledge-gathering phase.

**Owns:** `doc/swarm_GUIDELINES.md`.
**Never touches:** other fleets' files (`dragon-vlm`, `jetson-protect`), source code, `fleet/**`
(`/ops`), `host/**`, `fleet/fleet.secrets.env` (read-only). See SKILL.md.
