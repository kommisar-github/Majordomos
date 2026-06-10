# host ops

## Abstract
**TL;DR:** macOS always-on host runbook — provisioning, headless claude auth, launchd, Tailscale.
**Load when:** macOS, launchd, LaunchAgent, plist, KeepAlive, ThrottleInterval, launchctl, bootstrap, headless, ANTHROPIC_API_KEY, claude auth, provision, preflight, Tailscale, restart policy, bounded restart, G1, G2
**Key facts:** claude must be non-interactively authed (G1); launchd KeepAlive+Throttle; bounded periodic restart safe via compaction-resume.
**Owner:** /ops   **Related:** doc/design/app_runtime.md

---

macOS host runbook (Phase 0 + Phase 6). Preflight (`host/provision.sh`) asserts Node, git, **headless `claude` auth**, Tailscale; launchd plist for always-on with throttled restart.

## Q-APP-VENDORING — resolved (v1): install-on-host, do not vendor

The standalone app (`mcp-task-router-app`) imports the server via a **sibling path**
(`../../mcp-task-router/src/index.js`) and is designed as a *tool pointed at projects*
("reuse, don't rebuild"). So for v1 the app + server are **installed from a
`claude-task-router` clone on the Mac**, not copied into this repo — Majordomos stays
config-only (this `.claude/` bootstrap + design docs + `host/` scripts). The
Majordomus-specific **HA bridge** home is deferred to Phase 5 (likely a project-loaded
module so it can live here without forking the shared app).

## Phase 0 — preflight (run on the Mac)

```bash
bash host/provision.sh      # asserts node>=18, git, headless claude auth (G1), Tailscale (G3)
                             # also auto-installs mcp-task-router-app deps (npm ci) if absent
```
Resolve every `FAIL` before continuing. The critical one is **headless `claude` auth** —
set `ANTHROPIC_API_KEY` (or a stored credential); the always-on PM has no human to log in.

**Dependency install:** `provision.sh` auto-runs `npm ci` in `mcp-task-router-app/` if
`node_modules/` is absent. `start-majordomos.sh` (the launchd entry-point) repeats this
guard so the supervised process never starts without deps present. `ws` is the hard
runtime dep (`ha-bridge.js:8` requires it at module load).

**Node version bump:** upgrading Node forces a native rebuild of `node-pty` (the one
native dep in the app). After any Node upgrade, re-run:
```bash
( cd mcp-task-router-app && npm ci )   # reinstall project deps incl. node-pty rebuild
```
`start-majordomos.sh` also triggers a re-install of the global/user-local `node-pty`
prebuild automatically on first run after a Node bump (via `scripts/setup-app.sh`).

## Phase 1 — run the app + bring up the Majordomus PM (run on the Mac)

```bash
# one-time: clone the seed (provides the app + the reused server)
git clone https://github.com/kommisar-github/claude-task-router ~/GitHub/claude-task-router
export SEED_REPO=~/GitHub/claude-task-router
export TASK_ROUTER_API_KEY=...        # gates the REST surface

bash host/run-majordomus.sh           # npm-installs the app, starts server in-process,
                                      # registers the 'majordomos' tenant, supervises the PM
```

**Runtime verify (BOOTSTRAP_PLAN §10 step 14 — macOS only):**
1. App logs `server started in-process` + `project "majordomos" registered — N agents`.
2. The Majordomus **PM comes up green** (its `Stop` hook fires `/hook/stop`); a stuck
   "starting" means a missing Stop/StopFailure hook — re-check `.claude/settings.local.json`.
3. `/pm` lists the roster; `/pm ping` is healthy for app/ha/ops/scm.
4. Web UI (optional) at `127.0.0.1:3200` shows the agent.

Stop here for review before Phase 2 (Telegram) — per the plan's Phase-1 gate. The
remaining `§12` answers (HA transport, fleet roster/grants, status-cost, whitelist,
network) gate Phases 4–5, not this slice.

## Env → process → launchd: secret wiring

### Variables that must reach the process

| Variable | Used by | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | `claude` CLI (G1 headless auth) | root `.env` |
| `TASK_ROUTER_API_KEY` | Task Router REST gate | root `.env` |
| `HA_BASE_URL` | `.mcp.json` `${HA_BASE_URL}` expansion + v2 ha-bridge executor | root `.env` |
| `HA_TOKEN` | `.mcp.json` `${HA_TOKEN}` expansion + v2 ha-bridge executor | root `.env` |
| `TELEGRAM_BOT_TOKEN` | Telegram bridge process | `.claude/mcp/telegram-bridge/.env` |
| `TELEGRAM_ALLOWED_USER` | Telegram bridge process | `.claude/mcp/telegram-bridge/.env` |

`HA_BASE_URL` and `HA_TOKEN` expand `${VAR}` references in `.mcp.json` at connection
time — Claude Code reads from the running process environment only; it is NOT a
dotenv loader. If either var is absent, the `home-assistant` SSE MCP server will
fail to authenticate (diagnose as connection-time auth failure, not a Claude Code
error).

The v2 ha-bridge loopback executor (`POST ${HA_BASE_URL}/api/services/…`) also reads
both vars directly. The executor route is loopback-only (G3): owner endpoints and
web UI stay bound to 127.0.0.1; the executor is the only external-API caller.

### Interactive launcher path (all platforms)

All three launchers source the root `.env` **before** invoking `node` / `claude`:

| Launcher | Mechanism |
|---|---|
| `start-majordomos.ps1` (Windows) | `Get-Content .env \| ForEach-Object { SetEnvironmentVariable }` |
| `start-majordomos.sh` (macOS/Linux terminal) | `set -a; . .env; set +a` |
| `start-majordomos.command` (macOS Finder) | same as `.sh` |

The Telegram bridge (`bot.js`) reads `.claude/mcp/telegram-bridge/.env` through its
own Node.js dotenv load — interactive invocation of the bridge does not need a
separate wrapper.

**Gap closed:** all interactive paths already load the required vars. No change needed.

### Always-on path: launchd plists

launchd runs with a minimal environment — no shell profile, no `.env`. Two LaunchAgent
plists under `host/launchd/` cover the always-on path:

| Plist | Process | Vars it carries |
|---|---|---|
| `com.majordomus.taskrouter.plist` | Task Router app (`start-majordomos.sh`) | `ANTHROPIC_API_KEY`, `TASK_ROUTER_API_KEY`, `HA_BASE_URL`, `HA_TOKEN`, `HOME` |
| `com.majordomus.telegram.plist` | Telegram bridge (`bot.js`) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER`, `TASK_ROUTER_API_KEY`, `HOME` |

Both plists are committed **as templates** — the `EnvironmentVariables` keys contain
the sentinel `__INJECT_AT_PROVISION__` instead of real values. Secrets are **never
committed** (`.env` and `*.env` are gitignored). Provision-time injection is the only
write path.

### Provision-time injection (`host/provision.sh --inject-secrets`)

```bash
bash host/provision.sh                   # Phase 0: assert prerequisites (read-only)
bash host/provision.sh --inject-secrets  # Phase 0 + Phase 2: patch plists in-place
```

Phase 2 (`--inject-secrets`) reads from:
- `$REPO_ROOT/.env` — all Task Router + HA vars
- `$REPO_ROOT/.claude/mcp/telegram-bridge/.env` — telegram vars

And uses `/usr/libexec/PlistBuddy` to patch the `EnvironmentVariables` dict,
`ProgramArguments` paths, `WorkingDirectory`, and log paths in both plists.

**After patching, the plists contain secrets — do NOT commit the patched files.**
The `.gitignore` does not currently exclude the plist files; the operator must avoid
staging them after injection. A pre-commit hook (optional) can enforce this.

Load the patched plists:
```bash
launchctl bootstrap gui/$(id -u) "$(pwd)/host/launchd/com.majordomus.taskrouter.plist"
launchctl bootstrap gui/$(id -u) "$(pwd)/host/launchd/com.majordomus.telegram.plist"
```

Verify both are registered:
```bash
launchctl list | grep majordomus
```

Unload (e.g. before re-patching):
```bash
launchctl bootout gui/$(id -u)/com.majordomus.taskrouter
launchctl bootout gui/$(id -u)/com.majordomus.telegram
```

### `.env` format (root)

The root `.env` (gitignored, operator-created) must contain at minimum:

```bash
ANTHROPIC_API_KEY=sk-ant-…
TASK_ROUTER_API_KEY=<your-key>
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=<long-lived-ha-token>
```

Create the token in HA: **Settings → Profile → Long-Lived Access Tokens → Create**.
`HA_BASE_URL` is the base URL of your HA instance (no trailing slash, no `/api` suffix).
