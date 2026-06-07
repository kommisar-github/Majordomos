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
```
Resolve every `FAIL` before continuing. The critical one is **headless `claude` auth** —
set `ANTHROPIC_API_KEY` (or a stored credential); the always-on PM has no human to log in.

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
