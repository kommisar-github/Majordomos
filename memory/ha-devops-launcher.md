---
name: ha-devops-launcher
description: ha_devops uses a custom agents.json `launcher` (host/launch-ha-devops.sh) to mint its cap-token; only auto-runs once the v1.4.0+ bundle is the active launch surface, else launch manually
metadata:
  type: project
---

**ha_devops launch mechanics — supersedes the older "extension/tmux launcher
does NOT mint the cap-token" note.** Relates to [[ha-devops-hard-gate]].

`ha_devops` needs a special start sequence (mint a per-session `trha_` cap-token,
write `fleet/ha_devops_session.json` as a chmod-600 SHA-256 hash, register, export
`$HA_DEVOPS_CAP_TOKEN`, print "Gate is OPEN: config-writes permitted") before
running `claude`. That sequence lives in `host/launch-ha-devops.sh`.

As of **2026-06-12 (seed v4.13 erratum "custom agent launchers")** this is wired
through the agents.json `launcher` field — `.claude/mcp/task-router/agents.json`
→ `ha_devops` entry has `"launcher": "host/launch-ha-devops.sh"`. All three launch
surfaces (App in-house/node-pty, App detached/tmux, IDE extension) run that script
**instead of** the default `claude --agent X_agent /X` when the field is set. The
launcher contract (documented in `PM.md` → "### Custom launchers"): script is the
terminal's foreground process with `TASK_ROUTER_AGENT/PROJECT/MODEL` injected;
must end by running `claude` in the **foreground (not `exec`)** so its
`trap … EXIT` cleanup fires on Stop (=SIGHUP); cleanup unregisters + deletes the
session file. `host/launch-ha-devops.sh` already satisfied this; only
`TASK_ROUTER_MODEL` support was added (`MODEL_ARGS`).

**Why:** binds the cap-token mint to the standard launch path, so the
App/extension can start `ha_devops` correctly — previously they couldn't, which is
what broke W7 (ha_devops launched without `$HA_DEVOPS_CAP_TOKEN`, executor 401'd).

**How to apply / caveat:** the `launcher` field is read only by the **v1.4.0+
bundle** (the code that ships the field). Until v1.4.0 is the active launch
surface, the ONLY correct launch is still **manual** `bash host/launch-ha-devops.sh`
(must print "Gate is OPEN: config-writes permitted"). Do not assume the App/
extension mints the token until v1.4.0 is confirmed deployed.
