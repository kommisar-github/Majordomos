---
description: Federation, Host & Always-On Agent
globs: host/**, fleet/**, doc/{federation,host_ops}.md
alwaysApply: false
---

# ops — condensed rules

- **Federation mint/grant:** on each **project**, `grant_access` mints `trtok_…` storing only its SHA-256 hash + a per-agent grant `{ pm: RO|RW|RWE }`; `list_access_grants`/`revoke_access` manage them (escalation-guarded, global-key gated).
- **Federation client endpoints** (Majordomus is the client): `/api/federation/list_agents` (discover), `/api/federation/request` (mints a `to=pm` task with `[FEDERATED REQUEST]`), `/api/federation/wait` (token-scoped result poll). Ladder **RO < RW < RWE** = read-guidelines < write < execute.
- **Per-project wiring:** each project's server binds `/api/federation/*` to the Tailscale/LAN interface; **owner endpoints + web UI stay loopback-only** (G3). Register via `task-router add-federation <name> <url> <token>` → `fleet.config.json`.
- **Tailscale** (recommended) puts the fleet on a private mesh — no internet exposure; else LAN-bind + `TASK_ROUTER_API_KEY` + TLS/SSH-tunnel.
- **launchd:** a `LaunchAgent` plist with `KeepAlive` (restart on crash) + `ThrottleInterval` (no hot-loop); load via `launchctl bootstrap gui/$(id -u) <plist>`. A **bounded periodic restart** caps PM context growth (safe: compaction-resume + DB-authoritative `pickup_next_task`).

**Owns:** `doc/federation.md`, `doc/host_ops.md`, `host/launchd/com.majordomus.taskrouter.plist`, `fleet/fleet.config.json` (secret half) + `.env` / secrets handling, `host/provision.sh`
**Never touches:** see SKILL.md.
