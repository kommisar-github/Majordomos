# /ops — Agent Guidelines
**Last Updated:** 2026-06-11

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/ops` agent
(federation, host & always-on — inter-PM federation wiring over Tailscale/LAN,
macOS launchd always-on, secrets, and provisioning). This file is the agent's
**only** sanctioned write target for notes that should survive across sessions.
The agent appends here **only when PM or the user explicitly asks** — never as a
side effect of doing work. Federation grant conventions, launchd policy,
secret-injection patterns, and network-exposure rules live here once formalised.

**Load when:** the `/ops` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/ops` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Secrets NEVER committed: `.env` / `fleet/*.secret.json` are gitignored; launchd plist `EnvironmentVariables` filled at provision time. Condensed rules: `.claude/rules/ops.md`.

**Owner:** `/ops` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/ops/SKILL.md`, `.claude/rules/ops.md`, `doc/federation.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

### ha_devops launcher — env hygiene (MAJOR security invariant)

`set -a; . .env; set +a` auto-exports EVERY variable in `.env`, including `HA_TOKEN` and
`HA_BASE_URL`. Always `unset HA_TOKEN HA_BASE_URL` immediately before the `claude` child line in
`host/launch-ha-devops.sh`. With the HA token + a shell the agent could `curl` HA directly,
bypassing the cap-token executor entirely — no body-scan, no `fleet_enable_deny`, no force-disable
(defeats the cause-to-fire linchpin). The executor process (port 3101) holds these vars separately;
the `ha_devops` agent never needs them. *(This is the standing rule to enforce on the launcher.)*

### Cap-token mint protocol (§2.3 ordering)

Mint = `crypto.randomBytes(16).toString('hex')` → `"trha_" + hex`. Write only the SHA-256 hash to
`fleet/ha_devops_session.json` (mode `0600`) **before** `POST /api/register` — this closes the
window where `ha_devops` is registered but the executor would reject the token. Raw token lives only
in the child process env (`HA_DEVOPS_CAP_TOKEN`); never touches disk.

### Use `claude` as a child, not `exec`

The launcher must call `claude …` without `exec` so the `EXIT` trap fires on normal exit, `SIGTERM`,
and `SIGINT`: the trap deletes `fleet/ha_devops_session.json` and `POST /api/unregister`, restoring
the fail-closed gate. `SIGKILL` skips the trap — operator must `rm -f fleet/ha_devops_session.json`
(the W4.6 liveness check also closes it once the heartbeat ages out).

### Bring-up env-empty check must be value-blind

The W5.6 HA-secret-stripping check (`ha_deploy.md` §5) must use
`[ -n "$HA_TOKEN" ] && echo FAIL || echo PASS`, never `echo $HA_TOKEN`. A correct deployer refuses
to echo a credential value, making the raw-echo form self-defeating (cannot distinguish "refused to
echo a set token" from "var is empty").

### Dependency install before supervised start (`npm ci`)

`mcp-task-router-app/package-lock.json` is committed — always use `npm ci`, not `npm install`, in
preflight and provisioning. `ws` is a hard `require()` at module load in `ha-bridge.js`; missing
`node_modules` crashes the process before any error handler runs. Three enforcement points:
(1) `provision.sh` Phase 0 auto-installs if absent, (2) `start-majordomos.sh` guards before
`exec node`, (3) `ha_deploy.md` §1 prerequisites. After any Node version upgrade, re-run
`( cd mcp-task-router-app && npm ci )` — a Node-version bump forces a native rebuild of `node-pty`
(the one native dep).

### launchd always-on path (pending wiring)

The headless bring-up path (`start-majordomos.sh` via launchd) needs `MAJORDOMOS_SUPERVISE=1` to tell
`bin/app.js` to run in full supervisor mode (otherwise it is server-host-only, no PM spawn). Not yet
wired — see Open Questions.

## Decisions

(none yet — append dated entries when PM or the user asks)

## Open Questions

- **`MAJORDOMOS_SUPERVISE=1` wiring:** the launchd plist (`host/launchd/com.majordomus.taskrouter.plist`
  `EnvironmentVariables`) + `start-majordomos.sh` need to set this flag for full supervisor mode.
  Flag name + injection point confirmed with `/app` (env var, read by `bin/app.js`); plist wiring TBD.
