---
description: Federation, Host & Always-On Agent
globs: host/**, fleet/**, doc/{federation,host_ops}.md
alwaysApply: false
---

# ops — condensed rules

- **Canonical authority (SoT):** `FEDERATION_RULEBOOK.md` is the single source of truth for the federation policy (§1 access model, §5 security/least-privilege, §7 enterprise install). The **ops SKILL.md → "Federation wiring procedure"** is the **operational wiring layer** that implements it.
- **Federation mint/grant:** on each **project**, `grant_access` mints `trtok_…` storing only its SHA-256 hash + a per-agent grant `{ pm: <level> }`; `list_access_grants`/`revoke_access` manage them (escalation-guarded, global-key gated).
- **Access model (R/W/X lattice, not a ladder):** a level is a **set of capabilities** over R/W/X — RO={R}, RW={R,W}, XO={X}, RX={R,X}, RWX={R,W,X}. Operations map `read_file`→R, `write_file`→W, `execute`→X; access is **set membership**, not a linear ladder. (Legacy `RWE`=`RWX`; `read_guidelines`/`write_guidelines`=`read_file`/`write_file`.)
- **Tooling preference:** route real work through `dispatch_task` / the `federated_*` MCP tools (the server forwards it and a local mirror task tracks it). Avoid the direct `remote-execute` client verb for routed work — it bypasses the local server (no tracking, bytes to stdout). Keep `remote-*` as a manual/diagnostic fallback only.
- **Per-project wiring:** each project's server binds `/api/federation/*` to the Tailscale/LAN interface; **owner endpoints + web UI stay loopback-only** (G3). Register via `task-router add-federation <name> <url> <token>` → `fleet.config.json`. Tokens live in `.claude/mcp/task-router/federation.env` (gitignored, **server-read** — the canonical store; it may `include fleet/fleet.secrets.env`); commit only the env-var name (`tokenRef`), never the raw token.
- **Tailscale** (recommended) puts the fleet on a private mesh — no internet exposure; else LAN-bind + `TASK_ROUTER_API_KEY` + TLS/SSH-tunnel.
- **launchd:** a `LaunchAgent` plist with `KeepAlive` (restart on crash) + `ThrottleInterval` (no hot-loop); load via `launchctl bootstrap gui/$(id -u) <plist>`. A **bounded periodic restart** caps PM context growth (safe: compaction-resume + DB-authoritative `pickup_next_task`).

**Owns:** `doc/design/host_ops.md`, `host/launchd/com.majordomus.taskrouter.plist`, `fleet/fleet.config.json` (committed registry, env-var refs only) + `.claude/mcp/task-router/federation.env` / secrets handling, `host/provision.sh`. (Federation wiring procedure lives in the ops SKILL.md; policy SoT = `FEDERATION_RULEBOOK.md`.)
**Never touches:** see SKILL.md.
