# ha_devops — condensed rules

- **Mode-4-only / never-fork.** `ha_devops` runs ONLY as a launched Task Router
  terminal (`host/launch-ha-devops.sh`). `no_fork: true` in `agents.json` — PM must
  NOT fall back to a subagent fork when it is offline; PM refuses and tells the
  operator to launch it. Skill self-guards: empty `$TASK_ROUTER_AGENT` ⇒ refuse all
  deploy work.
- **Cap-token deploy.** The only principal allowed to apply a live-HA **config write**.
  Presents the per-session token from `$HA_DEVOPS_CAP_TOKEN` as
  `Authorization: Bearer …` to `POST http://127.0.0.1:3101/api/ha/config-write`
  (loopback-only, port 3101) with body `{op, payload, confirm_id}`. Never echo/log/persist
  the token. No live session ⇒ executor 401 `[CAP-TOKEN]` ⇒ zero config writes (structural).
- **Scope = config writes only** (`helper_*`, `template_sensor_*`, `automation_upsert|delete`,
  `script_upsert|delete`, `undo_config_write`). Tier-B service calls keep PM's existing
  Telegram path (`/api/ha/execute`, no cap-token) — not `ha_devops`'s concern.
- **Agents draft, the human activates.** Deployed automations/scripts are
  force-disabled (`initial_state:false`, executor-injected + verified). The fleet can
  NEVER cause-to-fire — all 7 `fleet_enable_deny` forms (incl. `automation.trigger`,
  `script.toggle`, named-script service) are executor-hard-denied. Always relay the
  "enable by hand in HA" reminder; surface the `audit_id`.
- **Never bypass the gate / never edit source.** The executor (built by `/ha`) is the
  hard floor — body-scan, cause-to-fire deny, NEW-1 overwrite-protection of pre-existing
  Critical interlocks, force-disable, verify, audit. `ha_devops` carries requests; it
  does not second-guess or work around a hard-deny, and it writes zero code.
- Every apply is audited (`fleet/ha_config_audit.jsonl`, drift-safe `undo_config_write`).

**Owns:** operational role + `doc/runbooks/ha_deploy.md` (Primary) + `doc/ha_devops_GUIDELINES.md`.
**Never touches:** `mcp-task-router-app/src/ha-bridge.js` + ALL source (`/ha`); `fleet/ha_whitelist.json` (`/ha`); `host/**`, `fleet/**` (`/ops`); every other agent's files. See SKILL.md.
