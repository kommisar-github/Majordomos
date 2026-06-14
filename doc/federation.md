# Federation Runbook

## Abstract

**TL;DR:** Operator runbook for wiring remote fleets into Majordomus: `fleet.config.json` format, sourcing tokens from `fleet/fleet.secrets.env`, verifying connectivity, and ongoing grant management.

**Load when:** federation runbook, add fleet, fleet.config.json, fleet registry, FED_TOK, fleet.secrets.env, wiring fleets, remote-list-agents, connectivity check, grant management, federation ops

**Key facts:**
- `fleet.config.json` is committed with env-var refs only (`"env:FED_TOK_…"`); raw tokens live in gitignored `fleet/fleet.secrets.env`.
- Project IDs on a multi-tenant Task Router are **lowercase and case-sensitive** — always verify with `remote-list-agents` before committing.
- `fleet.config.json` is descriptive metadata — the client does NOT read it. Token resolution is CLI-side: `--token-env=FED_TOK_<NAME>` (bare var name, no `env:` prefix on the CLI).
- Source secrets before any `remote-*` call: `set -a; . fleet/fleet.secrets.env; set +a`.

**Owner:** `/ops` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/federation.md`, `doc/design/host_ops.md`, `fleet/fleet.config.json`

---

## 1. Prerequisites

- Remote fleet Task Router reachable at its base URL (verify: `curl -s <url>/health`).
- Remote fleet PM has minted a `trtok_…` grant token and delivered it out-of-band.
- Token sunk into `fleet/fleet.secrets.env` (PM does this sink; ops never writes raw tokens).

---

## 2. Adding a fleet entry

1. Determine the **exact project ID** on the remote server — ask the fleet owner or verify with `remote-list-agents`. IDs are lowercase and case-sensitive.
2. Add an entry to `fleet/fleet.config.json`:

```json
{
  "name": "<DisplayName>",
  "url": "http://<host>:3100",
  "project": "<lowercase-id>",
  "grant": "pm",
  "tokenRef": "env:FED_TOK_<NAME>"
}
```

`tokenRef` is a human pointer only — it records which env var holds the raw token. The client does not read this file.

3. Verify: `grep -i trtok fleet/fleet.config.json` must return empty.
4. Hand to `/scm` for commit (add a matrix row for any new doc in the same commit).

---

## 3. Verifying connectivity

Source the secrets first, then call `remote-list-agents` with the bare env-var name:

```bash
set -a; . fleet/fleet.secrets.env; set +a
node .claude/mcp/task-router/client.js remote-list-agents \
  --url=<url> --project=<lowercase-project-id> --token-env=FED_TOK_<NAME>
```

Note: pass `--token-env=FED_TOK_SWARM` (bare var name), NOT `--token-env=env:FED_TOK_SWARM` — the client resolves the env var directly; the `env:` prefix in `tokenRef` is a human convention for the config file only.

Expected: `{"ok":true,"result":{"project":"<id>","agents":{"pm":"<level>"}}}`.

| Outcome | Meaning |
|---|---|
| `ok: true` + agents returned | Reachable, token valid; `agents` shows grantee → server-side access level |
| HTTP 404 `project_not_registered` | Wrong project ID (check case) or project not yet started |
| HTTP 401 / 403 | Token invalid or revoked — flag for rotation |
| Connection refused / timeout | Server down or URL wrong |

---

## 4. Ongoing grant management

- Tokens are issued by the **remote fleet owner** — rotation request goes to them out-of-band.
- On rotation: update `fleet/fleet.secrets.env` (PM sinks the new token); `fleet.config.json` needs no change (tokenRef env-var name stays the same).
- To revoke Majordomus's access: ask the remote fleet owner to call `revoke_access` on their server.

---

## 5. Multi-tenant notes

When multiple fleets share one Task Router URL (e.g. `http://192.168.1.111:3100`):
- Disambiguate via the `project` field — routed as `?project=<id>` on each API call.
- Each fleet's token is scoped to its own project — a Swarm token cannot read Dragon-VLM data.
- `curl -s <url>/health` returns `"tenants": N` — sanity-check N matches expected fleet count.
- `/api/projects` (if exposed) lists active project slugs — useful for confirming exact casing before adding an entry.
