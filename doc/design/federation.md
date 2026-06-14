# federation

## Abstract

**TL;DR:** Inter-PM federation client wiring: how Majordomus reaches remote fleet PMs over Tailscale/LAN, the `fleet.config.json` registry schema, and the tokenRef/secrets split.

**Load when:** federation, grant_access, revoke_access, trtok, token, RO, RW, RWE, /api/federation, list_agents, request, wait, add-federation, fleet.config, tokenRef, project_not_registered, multi-tenant, Tailscale, LAN, loopback, G3, second gate, project PM, fleet registry schema

**Key facts:**
- `fleet.config.json` schema: `{ name, url, grant, project, tokenRef }` — `project` is required when multiple fleets share one multi-tenant URL.
- Project IDs on the Task Router are **case-sensitive and lowercase** (`swarm`, not `Swarm`); title-case yields HTTP 404 `project_not_registered`.
- `tokenRef` is a human pointer to the env-var name (`"env:FED_TOK_<NAME>"`) — raw `trtok_` tokens NEVER go in the committed file; they live in gitignored `fleet/fleet.secrets.env`.
- `fleet.config.json` is descriptive registry metadata only — the seeded client does NOT parse it; federation tokens are resolved CLI-side via `--token-env=<BARE_VAR_NAME>`.

**Owner:** `/ops` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/host_ops.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

## Fleet registry — `fleet/fleet.config.json`

Top-level shape: `{ "fleets": [ <entry>, … ] }`. Each entry:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Display name (e.g. `Swarm`). Cosmetic — never sent to the server. |
| `url` | yes | Remote Task Router base URL (e.g. `http://192.168.1.111:3100`). |
| `project` | yes | Server project slug — **lowercase, case-sensitive** (`swarm`, not `Swarm`); title case → HTTP 404 `project_not_registered`. |
| `grant` | yes | The **local grantee agent** the token authenticates as — `"pm"`. NOT an access level. |
| `tokenRef` | yes | **Human pointer** to the env var holding the raw token, written `"env:FED_TOK_<NAME>"`. |

**This file is descriptive registry metadata — no code parses it.** The seeded client
(`.claude/mcp/task-router/client.js`) does NOT read `fleet.config.json`; federation token resolution
is exclusively CLI-side — `--token=<trtok_…>` or `--token-env=<ENV_VAR>` (default `TASK_ROUTER_FED_TOKEN`),
resolved as `process.env[<ENV_VAR>]` (`fedResolveToken`). Therefore:
- **Strip the `env:` prefix when invoking:** pass the bare var name, `--token-env=FED_TOK_SWARM`
  (NOT `--token-env=env:FED_TOK_SWARM`, which resolves a literally-named `env:FED_TOK_SWARM` var → fails).
- **The access level (RO/RW/RWE) is server-side, not in this file.** Query it with `remote-list-agents`,
  which returns e.g. `{ "pm": "RWE" }` (grantee → level). Local `grant: "pm"` only names the grantee agent.

**Security invariant:** `grep -i trtok fleet/fleet.config.json` returns **nothing** — this file holds only
env-var *names*, never raw `trtok_…` values. Raw tokens live solely in gitignored `fleet/fleet.secrets.env`.
