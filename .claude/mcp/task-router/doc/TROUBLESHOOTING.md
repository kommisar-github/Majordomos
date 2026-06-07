# Troubleshooting

Common issues and their fixes, ordered by frequency.

---

## v0.9.x

### `Task Router: Doctor` deleted `start.sh` / `seed-oauth.js` ("Delete orphans")

**Our own `Task Router: Doctor`** (not Claude Code's `/doctor`) had a bug **fixed in
v0.9.10**: its "Delete orphans" remediation listed `start.sh` and `seed-oauth.js`
among pre-bundle embedded-server leftovers and removed them on approval — but those
are *current* runtime files (`start.sh` is the SessionStart launcher; `seed-oauth.js`
seeds OAuth). After deletion the SessionStart hook (`bash …/start.sh`) silently
no-ops and `/pm audit` flags `stale_runtime_artifacts`.

**Fixed (v0.9.10):** Doctor no longer lists those (or `client.js`/shims) as orphans —
it only offers to delete genuine pre-bundle embedded-server artifacts (`bin`, `src`,
`node_modules`, `package.json`, …). **Recover (v0.9.9+):** the extension also
**self-heals** on activation — it restores any missing runtime file from the bundle
(`ensureRuntimeFiles`), so reloading the window fixes it. **Manual:** re-run
`init.sh`, or copy `start.sh` + `seed-oauth.js` (+ `client.js`/`client.sh`/`client.cmd`
if also missing) from `vX.Y.Z/seed/`. A pre-v0.5 project's *embedded server* under
`.claude/mcp/task-router/` (`bin`/`src`/`node_modules`) genuinely is obsolete and
safe to let Doctor remove.

### An agent stays stuck in "starting" (yellow) and never goes green

The yellow→green lifecycle transition fires when the agent's **`Stop` hook** hits
`/hook/stop` at the end of its first turn. If `.claude/settings.local.json` has **no
`Stop`/`StopFailure` hooks** (common in old projects that predate the v3.1 lifecycle
hooks, or were hand-edited), the agent runs but never reports "done" — so it sits in
"starting" forever.

**Detect (v0.9.8):** run **`/pm audit`** — the `hook_integrity` check flags missing or
malformed (flat, non-`{matcher,hooks:[]}`-enveloped) hooks across SessionStart,
UserPromptSubmit, and Stop/StopFailure.
**Fix:** add the `Stop`/`StopFailure` hooks (the canonical `type: http` → `/hook/stop`
form) to `settings.local.json` — re-run `init.sh` from the latest seed, or apply the
hook erratum. Then relaunch the agent terminal (Claude Code reads `settings.local.json`
at terminal launch, so an already-running terminal won't pick up the new hook).

### A task result arrives empty even though the agent reported success

The agent likely passed its result via **`--result-file`** on an old `client.js` (before
**v0.9.6**), which silently ignored the flag and submitted an empty string. Or the
deliverable is a file and nothing was inlined.

**Fix:** update the project's `client.js` (it ships in the bundle — re-run `init.sh` /
reinstall the extension; `/pm audit`'s `stale_runtime_artifacts` check flags an old
client). With **v0.9.6+** `client.js`: use `complete --result-file=<path>` to inline a
file's content, or `complete --result-ref=<path> --result-description='…'` to submit a
`[FILE RESULT]` reference (content stays on disk). A result is **never empty** (v4.7
Result Discipline) — a file deliverable is a path + substantive description.

### After updating an old project's seed-state, errata still show as pending

If you wrote/bumped `.claude/mcp/task-router/seed-state.json` **after** errata were
already dispatched, older builds left them stuck `dispatched` forever (the version gate
only auto-acked *newly-seen* errata). **Fixed in v0.9.7** — advancing `seed-state.json`
now retroactively auto-acks already-dispatched out-of-range errata on the next PM
register (`not_applicable`), without touching human-processed ones. Update the server
(reload onto v0.9.7+) and re-register PM; the stale backlog clears itself.

### The Dashboard shows a red "server version drift" banner after updating the extension

**Expected, by design.** The task-router server is a **detached, multi-tenant singleton** shared across every project and IDE on its port. The extension *attaches* to a running server rather than restarting it — restarting would disconnect every other tenant. So after you update the extension, a server started by the **older** version keeps running, and new fixes / errata-channel changes aren't active until it's restarted.

**Fix:** run `Task Router: Stop Server` (Command Palette), then **reload the window** — the bundled (new) server relaunches. **Update every IDE that shares the server to the same version first**, or another IDE will just relaunch the old one. As of **v0.9.3**, Stop-Server reliably kills the shared server **and** any orphan bridge, verifies the port is free, and reports the killed PIDs (or warns that the port is still responding because another IDE is respawning it).

### A new seed feature (e.g. agent state briefs) doesn't seem to work, even though the SKILLs were updated

Your project's **bundle-delivered runtime artifacts have drifted behind its errata-delivered SKILLs.** Errata advance SKILL content automatically (pull, on PM register); but `client.js` / `start.sh` ship in the **VSIX bundle** and only update when you re-run `init.sh`. So a project can reach a new seed version in its SKILLs while keeping an older `client.js` that silently drops the new behavior (e.g. a v4.4 SKILL tells a specialist to attach a `state_brief`, but a `node/v4.2` client never forwards it).

**Detect (v0.9.4):** `GET /health` exposes `expected_client_protocol` and a `stale_clients[]` list; `start.sh`'s SessionStart banner prints a `WARNING` when the local client is behind; and `/pm audit` reports `stale_runtime_artifacts` (seed v4.5+).
**Fix:** **re-run `init.sh` from the latest seed bundle** (`<releases>/vX/seed/init.sh`) to refresh the runtime artifacts. Errata cannot fix a bundle artifact. Background: `doc/plans/SEED_ARTIFACT_SYNC_PLAN.md`.

### `Task Router: Stop Server` says it stopped but the server is still running

Fixed in **v0.9.3**. The old Stop-Server killed only the PID it had spawned and reported success unconditionally — so a server the window had merely *attached* to (e.g. a stale one from before an update) survived. Update to v0.9.3+; it now kills by port-listener + verifies. If it still warns the port is responding, **another IDE is respawning the shared server** — close the other IDE windows, then retry.

### `Configure Errata Channel` shows a success toast but the setting doesn't change

Fixed in **v0.9.3**. The picker wrote the value to **Workspace** scope (a folder's `.vscode/settings.json`) while you were viewing **User** settings. It now writes to **User** settings. Note that the channel is read when the server **spawns**, so reload the window for a change to take effect.

---

## v0.6.0

### Federation dispatch fails with `remote_unreachable`

The MacMini's task-router cannot reach the dev machine's task-router. Causes (most-common first):

1. **Dev machine is off / asleep / on a different network.** Wake the laptop, confirm it's on the LAN, re-dispatch.
2. **Task-router not running on the dev machine.** Open the project in its IDE; the extension auto-starts the server. Confirm with `curl http://<dev-machine-IP>:3100/health` from the MacMini.
3. **Firewall blocking port 3100.** macOS / Windows / Linux firewalls may block. Allow inbound 3100 on the dev machine's LAN profile.
4. **Wrong URL in agents.json.** Open `~/majordomus/.claude/mcp/task-router/agents.json`; verify the `remote.url` field matches the dev machine's current LAN IP (DHCP-changing IPs are a common cause; consider static reservations or mDNS hostnames like `dragon-laptop.local`).

### Federation dispatch fails with `remote_disconnected`

Long-poll connection dropped mid-task and the retry layer's 24-hour budget exhausted. Causes:

- Network instability (Wi-Fi roaming, sleep/wake cycles on either machine).
- The remote task-router restarted (idle-shutdown after 600s) and the in-flight task didn't survive the restart cleanly.

Re-dispatch. If chronic, check Wi-Fi stability or set `TASK_ROUTER_IDLE_SHUTDOWN=0` on the dev machine to disable idle-shutdown for that server.

### Federation dispatch fails with `remote_failed:server_shutting_down`

The remote task-router was shutting down at the moment Majordomus tried to wait_for_result. Could be idle-shutdown firing while Majordomus had a long-poll active, or a manual server stop. Re-dispatch — when the remote respawns (next IDE activity), federation works again.

### Federation dispatch returns auth errors (401)

The MacMini's outbound call to the remote was rejected by the remote's API-key gate. Causes:

- The env var named in `remote.api_key_env` doesn't exist on the MacMini.
- The env var's value doesn't match the remote machine's `TASK_ROUTER_API_KEY`.
- The MacMini's task-router was started before you set the env var; restart it so it sees the new value.

Re-export the env var in the MacMini's shell rc and restart the local task-router.

### `list-remotes` shows my remote but `last_seen` is `—`

Majordomus has never successfully interacted with that remote. Try a dispatch — first successful round-trip populates the cache. If dispatch fails, the runbook's "remote_unreachable" diagnostic above applies.

---

## v0.5.0

### Errata channel is configured but no errata appear in the GUI pane

Likely causes and checks (in order):

1. **Public key mismatch (v0.5.1+).** Server logs `errata-listing.json signature verification failed`. The default trust anchor is the maintainer pubkey embedded in the server bundle (since v0.5.1). If you've set `taskRouter.errataPubkeyPath` to a different key, or the channel was signed with a key that doesn't match the embedded one, every signature fails verification. Either remove the `errataPubkeyPath` setting (falls back to embedded) or point it at the matching `.public.pem`.
2. **Channel content is missing or malformed.** Server logs `[errata] load failed (...): ...`. Open the configured `folder:` path or `github:` raw URL and check that `errata-listing.json` + `.sig` are present and well-formed.
3. **Channel was just updated.** The server reads the listing once at startup; idle-shutdown (default 600s) is the natural cache invalidation. Either wait for the next respawn or kill the server (it auto-respawns within ~10s via the watchdog).
4. **Project not registered with the server yet.** The Errata pane shows nothing if no PM has registered against this project. Open a PM terminal first, then check the pane.
5. **`errataPubkeyPath` set but unreadable.** Server logs `--errata-pubkey-path '...' is unreadable: ... — falling back to embedded maintainer key`. Either fix the path or remove the setting to use embedded explicitly.

If you're authoring a new erratum and it's not propagating to consumers, see [`doc/runbooks/ERRATA_AUTHORING.md`](ERRATA_AUTHORING.md) → §3 step 8 (end-to-end verify locally) and §8 (recovery from a bad erratum).

### A second IDE refuses to open my project (`project_in_use`)

Expected behavior since v0.4.13. The first IDE holds the lock via its `/health?project=...` heartbeats; the second sees a recent `last_human_seen` and gets a 409. Close the first IDE and wait ~30s; the lock auto-releases via heartbeat ageout. There is no force-takeover by design — see `CHANGELOG.md` v0.4.13 for the rationale.

If the lock stays stuck after closing the holder IDE, the server cache may be ahead — kill the server (`taskkill /PID <pid> /F`); the watchdog respawns within ~10s and the new server has no tenant rows for any project until something registers fresh.

---

## v0.4.11

### `task-router.db` lives in OneDrive / Dropbox / iCloud and entries are missing after a crash

**Symptom (pre-v0.4.11).** PM dispatched tasks normally for one or more days, agents responded in terminals, Telegram messages arrived, the dashboard task list grew. After an unclean shutdown (PC crash, forced reboot, sleep/wake corruption) the on-disk DB had whole-day gaps; the cloud-synced version was even further behind.

**Root cause.** In v0.4.0–v0.4.10, every agent watchdog heartbeat (`touchAgent`) wrote the entire DB file to disk via `tmp + rename`. With the default 10s watchdog interval and ~15 agents per project, this produced ~1.5 full-file rewrites per second. Cloud-sync engines (OneDrive in particular) cannot keep up with a binary file mutating faster than they can hash + chunk + upload + confirm — uploads kept restarting from scratch and the engine eventually backed off entirely. Once the cloud version was stale, an idle-window "resolution" sometimes pulled cloud-down on top of local, replacing any in-memory state the running server had not yet flushed via a non-heartbeat write.

**Fix in v0.4.11.** Agent-table writes (`registerAgent`, `touchAgent`, `setAgentStatus`, `unregisterAgent`'s agent delete, `expireDeadAgents`'s agent delete, `clearAgents`) are now volatile (`_runVolatile` in `db.js`) — they mutate the in-memory sql.js DB but do not call `_save()`. Disk write rate drops to the real-event rate (task lifecycle, memory updates, project metadata). OneDrive can keep up.

**Recovery for projects already affected.** Already-lost rows are not recoverable from disk (the data was only ever in the dead server's RAM). Check OneDrive's web version history for the affected `task-router.db`; if any cloud-side version is *larger* than the current local file, restore it and merge. If cloud is also stale (the common case — the symptom that prompted this fix is exactly "OneDrive sync stalled days ago"), there is no recovery.

**Verification after upgrading to v0.4.11.** Watch the DB file mtime for 30 seconds with the server idle: it should not change. Pre-fix, ~45 mtime updates would land in the same window.

---

## v0.4.10

### Extension does not activate after running `Task Router: Doctor` → "Delete orphans"

**Symptom (v0.4.1 — v0.4.9).** A consumer project originally seeded with `init.sh --with-server-source` works correctly until the user runs `Task Router: Doctor` and clicks the "Delete orphans" remediation. After a subsequent IDE close + reopen on that project alone, the extension does not activate cold — no Task Router sidebar, no auto-spawned server, no MCP connection from `claude` terminals. The DB file appears "stuck" (no OneDrive sync activity, no new task rows visible from a fresh IDE) even though earlier sessions wrote to it normally. If the user has a *second* IDE window already open that has the extension activated, that instance keeps writing to the DB and the regression is invisible until they try to use the project from a clean state.

**Root cause.** Pre-v0.4.10 the extension's only activation event was `workspaceContains:**/.claude/mcp/task-router/package.json`. Doctor's orphan-cleanup list (`doctor.ts:140`) classified `package.json` as a legacy `--with-server-source` server-tree artifact "safe to delete in v0.4.1+". Both claims were true individually — `package.json` was the npm-manifest for the legacy consumer-side server source, and v0.4.1+ ships the server bundled inside the VSIX so consumers don't need it — but the file was doing double duty as the activation marker. Removing it for the (legitimate) migration reason silently disarmed the activation event.

**Fix (v0.4.10+).** Activation event moved to `agents.json`, which `init.sh` creates in both default and `--with-server-source` modes and which Doctor explicitly preserves during orphan cleanup. The two roles of `package.json` (npm-manifest, activation-marker) are now decoupled.

**Recovery if you're on v0.4.9 or earlier and the extension is dead.**

1. **Easiest:** upgrade the extension to v0.4.10+. No further action — activation now hangs off `agents.json`, which all init.sh-bootstrapped projects already have.
2. **If you can't upgrade right now:** drop a one-line stub `package.json` into the project's `.claude/mcp/task-router/` directory:
   ```json
   {"name":"task-router-marker","version":"0.0.0","private":true}
   ```
   Reload the IDE. The activation event fires; the extension wakes up; the bundled server spawns; the workspace gets registered as a tenant. The stub has no functional effect beyond being a marker.

**Why the symptom often shows up as "OneDrive shows no DB updates for N days" rather than "extension is broken".** With one IDE window still active (extension already activated, watchdog running, server alive), the system continues to work end-to-end — terminals dispatch tasks, Telegram acks flow, the DB is written every poll cycle. What's broken is *cold* activation: open a fresh window on only the affected project and nothing happens. Users typically notice via secondary indicators (OneDrive sync state, dashboard showing the wrong project, agents disappearing after IDE restarts) before tracing back to the missing activation marker.

**Note: SQLite + atomic-rename + OneDrive is also a real, separate failure mode.** If the local DB mtime is current (verified via `Get-Item ... | Format-List LastWriteTime`) but OneDrive's view is days stale, that's not this bug — it's OneDrive's sync engine failing to keep up with the per-write atomic-rename storm `_save()` produces. Microsoft has a documented advisory against putting active SQLite databases under cloud-sync folders. Recommended workaround: exclude `.claude/mcp/task-router/` from OneDrive sync per-project. The DB is regenerable runtime state, not source.

---

## v0.4.9

### Doctor reports `Spawn source: EXTERNAL` even though everything is up to date

**Symptom (v0.4.1 — v0.4.8 in multi-IDE setups).** `Task Router: Doctor` shows all version lines matching at vX.Y.Z and prints `VERDICT: versions match ✓`, but immediately above prints `Spawn source: EXTERNAL — Likely a stale v0.3.x/v0.4.0 copy. Remediation: stop all IDEs, kill the server, reload an IDE`. The remediation prompt offers to kill the server.

**Root cause.** Pre-v0.4.9 Doctor compared the running server's spawn path against *its own* extension bundle path. In Cursor + Antigravity (or any IDE pair), whichever IDE's watchdog respawned the server first owns the process; the other IDE's bundle path is identical-but-different (`…\.cursor\extensions\kommisar.claude-task-router-X.Y.Z\…` vs `…\.antigravity\extensions\…`). Cosmetic false alarm — the "versions match" line below was already authoritative — but confusing.

**Fix (v0.4.9+).** Doctor recognizes any extension-host bundle of matching version as legitimately bundled and reports `bundled (another IDE's VSIX, vX.Y.Z) ✓` with a "multi-IDE setup detected" note. The kill-server prompt is suppressed when running on a sibling IDE's bundle.

**Workaround if stuck on v0.4.8 or earlier.** Trust the version-match verdict, ignore the EXTERNAL flag, and click `Skip` on the kill-server prompt. Do NOT click `Kill stale server` — that would tear down a perfectly fine server and disrupt the other IDE.

---

## v0.4.8

### Telegram bot bombards me with **hundreds** of the same message in a loop

**Symptom (v0.4.0 — v0.4.7).** A single bridge is running (verified via `Get-CimInstance Win32_Process` / `ps`, only one `bot.js` process) and `GET /bridge/claims` shows the expected count, yet every message PM dispatches to telegram arrives on your phone over and over — sometimes hundreds of times. `GET /tasks?project=<name>&status=pending&to_agent=telegram` shows the queue growing, never draining, even though each message is clearly reaching the phone.

**Root cause (pre-v0.4.8).** v0.4.0 introduced query-param multi-tenancy: every per-tenant REST endpoint requires `?project=<name>`. The migration was applied to `/api/inbox/:agent` and `/api/dispatch` and `/api/register` — but **not** to `/api/accept/:taskId`, `/api/complete/:taskId`, or `/api/deliver` body. The bridge fetched the inbox successfully (correct project param), forwarded each task to Telegram, then failed silently when calling `accept` and `complete` — server returned `400 missing_project_param`, the error was swallowed inside the bridge's poll-error catch block. The task stayed `pending`. The next poll cycle (every ~5s) re-fetched the same task → re-forwarded to phone → infinite loop.

The bug was dormant unless `telegram` was actually registered as an agent and the PM was actively dispatching to it. Most projects don't trigger it because the auto-forward `[Dispatched]`/`[Result]` notifications skip when telegram is not registered. Once registered (REST `/api/register` from a v0.4.x bridge), every `dispatch_task` and every `complete_task` server-side creates a notification task addressed to telegram — and from there the loop is one PM action away.

**Fix (v0.4.8+).** Bridge `bot.js` now appends `?project=${encodeURIComponent(PROJECT)}` to `/api/accept/:taskId` and `/api/complete/:taskId`, and includes `project: PROJECT` in the `/api/deliver` body. Smoke tests now exercise all three endpoints with and without project to prevent regression.

**Recovery from a stuck pre-v0.4.8 state.**

1. Drain the `pending` backlog so the bridge has nothing to re-forward:
   `curl -X DELETE "http://127.0.0.1:3100/tasks/purge?project=<name>&status=pending&to_agent=telegram&before=$(date +%s)000"`
   (The `to_agent=telegram` filter is critical — don't drain other agents' work.)
2. Upgrade the extension to v0.4.8+ (bundled bridge ships with the fix).
3. Reload IDE windows so the new bridge picks up.

**Mismatched versions.** A v0.4.7 bridge talking to a v0.4.8 server — the bug persists, since the fix is on the bridge side. Always upgrade the bridge.

---

## v0.4.6

### Telegram bot bombards me with duplicates / `[Result]` tasks stay `pending` forever

**Symptom.** Every Telegram message arrives 2-3 times. PM-side `[Result]` tasks dispatched to the `telegram` agent never deliver — they sit in `pending` indefinitely. `GET /bridge/claims` shows fewer claims than the number of bridge processes you can see in Task Manager.

**Root cause (pre-v0.4.6).** Multiple telegram-bridge processes share the same `TELEGRAM_BOT_TOKEN` and run independent Telegram `getUpdates` long-polls. Each bridge's poll steals updates the others have not yet acknowledged; whichever bridge wins a given message dispatches the resulting task into *its* project's PM session, leaving the other PMs' inboxes blank. Common origins:

- **v0.4.4 detached lifecycle accumulated orphans.** Closing an IDE no longer kills its bridge (by design). Re-opening the same IDE — or opening a second IDE on the same project — spawns *another* bridge on top.
- **Multi-root workspace race.** A single IDE with two workspace folders that both have `.claude/mcp/telegram-bridge/.env` activates the extension once per folder, sometimes spawning two bridges concurrently before either sets the `bridgeProcess` guard.
- **Two IDEs, one project.** Cursor + Antigravity both opened on the same repo each spawn their own bridge.

**Fix (v0.4.6+).** The bridge claims its bot token (sha256-hashed) in the shared task-router server before opening any Telegram polling session. The second claimant for the same hash gets `409` and exits cleanly with a log line naming the holder (`project`, `pid`, `host`, `claimedAt`). One bridge per token per machine, period — IDE count is irrelevant.

**Recovering from a pre-v0.4.6 multi-bridge state.**

1. Confirm: `curl http://127.0.0.1:3100/bridge/claims` lists every active claim with project/pid/host. On v0.4.6+ this should match the bridge process count.
2. List bridge processes: PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bridge/bot.js*' }`. Linux/macOS: `pgrep -f 'bridge/bot.js'`.
3. Kill all bridges: Windows `taskkill /PID <pid> /F` per PID; Unix `kill -9 <pid>`. The server keeps running.
4. Restart any one IDE (or use the `Task Router: Refresh` command): the bridge it spawns claims the token uncontested.
5. Drain stuck `[Result]` tasks via the v0.4.3 filter-driven purge: dashboard → Filter `status=pending agent=telegram search=[Result]` → *Filter* → *Purge* (extra-warning modal fires because `pending` is selected — confirm).

**Pre-v0.4.6 bridge talking to v0.4.6 server**: bridge never calls `/bridge/claim`, so the lease isn't enforced. Upgrade the bridge.
**v0.4.6 bridge talking to pre-v0.4.6 server**: bridge logs `proceeding without lease (duplicate-detection disabled)` and behaves like v0.4.5. Upgrade the server.

### Switching projects in one IDE no longer kicks other IDEs offline (was a v0.4.4 regression)

If you saw, in v0.4.4 / v0.4.5: switching workspace folder in IDE A caused IDE B's agents to flicker offline-then-re-register. That was `processManager.switchProject` calling `stopAll()` and killing the shared detached server. Fixed in v0.4.6 — switchProject now stops only the per-project bridge.

## v0.4.5

### Server keeps shutting down on its own / "Idle-shutdown" log lines appear

**Symptom.** Server log shows `Idle-shutdown: no MCP sessions, all tenants human-idle ≥1800s — exiting cleanly.` after a long break, and the watchdog respawns it on next IDE activity. Or you set `taskRouter.idleShutdownSeconds = 0` and it still happens.

**Cause.** v0.4.5 ships idle-shutdown enabled by default at 10 minutes (extension default). Server self-exits when no MCP sessions are active, all tenants' `last_human_seen` is older than the threshold, and no in-flight requests. Telegram bridge polling does NOT count as activity.

**Fix.** Either let it self-heal (watchdog auto-respawns within 30s of next IDE activity), or raise the threshold: in extension settings set `taskRouter.idleShutdownSeconds` to a higher value (e.g., `3600` for an hour) or `0` to disable entirely, then reload the IDE so the next server spawn picks up the new flag value.

### Server self-exited right after PC wake / sleep

**Symptom (should NOT happen in v0.4.5).** PC slept for 8 hours. On wake, server immediately exits citing idle-shutdown.

**Cause.** Pre-v0.4.5 idle-shutdown decisions used wall-clock time, which advances during sleep. v0.4.5 uses monotonic time (Node `performance.now()`, QPC-backed on Windows) which freezes during sleep — so post-wake, the server doesn't see "every tenant idle for 8 hours".

**Fix.** None needed if you're on v0.4.5+. If the symptom happens anyway, file an issue with the OS version and `Get-Process node` output captured before/after sleep.

---

## v0.4.4

### Server died when I closed another IDE / agents disconnected after closing a window

**Symptom (pre-v0.4.4).** Closing the IDE window that originally auto-started the server killed the server, disrupting agents in every other IDE that was sharing it. Workaround was to switch project in another IDE, which re-spawned the server, and then wait for the v0.3.2 auto-re-register path to bring the agents back.

**Cause.** The server was spawned as a child of the extension host. When the extension host closed (IDE close), the child went with it. On Windows, the extension host's Job Object enforces this even if `detached: true` is set in modern setups.

**Fix.** v0.4.4 spawns the server (and telegram bridge) with `{ detached: true, stdio: 'ignore' }` + `proc.unref()`. They outlive the IDE that started them. Closing any IDE — including the one that spawned the server — leaves the server running for everyone else. The watchdog respawns automatically if it finds the server actually gone (e.g., explicit `taskkill`, OS reboot).

**To explicitly stop the server**, use the `Task Router: Stop Server` palette command — it confirms ("other IDEs will lose connectivity") before killing.

---

## v0.4.2

### "tenant 404" log lines after server restart

**Symptom.** Watchdog output channel shows `[watchdog] recovered: re-registered tenant <name> after 404` shortly after a server restart.

**Cause.** Server restart wipes the in-memory tenant registry. Existing watchdog poll receives 404; the v0.4.2 recovery path re-posts `POST /projects/register` for the affected workspace and the next poll cycle finds the now-registered tenant. Self-heals.

**Fix.** None needed — this is the recovery working. If the message repeats indefinitely, check that the workspace path is reachable and `task-router.db` parent dir exists.

### Tenant DB closed after long idle

**Symptom.** Dashboard for a project that hasn't been touched in 30+ minutes briefly shows stale data; first request after idle takes a moment to respond.

**Cause.** v0.4.2 idle-tenant eviction sweeper closed the SQLite handle (saves memory in many-tenant deployments). The registry entry persists; `ensureOpen` reopens the DB on the next request.

**Fix.** None — by design. To disable: `--tenant-idle-evict 0` on the CLI, or set env var `TASK_ROUTER_TENANT_IDLE_EVICT=0`. To raise the threshold: `--tenant-idle-evict 7200` (2 hours).

### `DELETE /projects/<name>` returns 409

**Symptom.** Trying to drop a tenant via REST returns `{ error: "in_flight", hint: "..." }`.

**Cause.** One or more in-flight requests against that tenant. Server refuses to drop a busy tenant by default (request handlers would lose `req.tenant.db`).

**Fix.** Stop agents and retry, or pass `?force=true`. With `force`, the server marks `closing`, closes the DB, and removes the entry regardless of `inFlight`.

---

## v0.4.1 upgrade

### Run `Task Router: Doctor` first

When something feels off after upgrading, run `Ctrl+Shift+P` → **Task Router: Doctor**. The output channel reports extension version, bundled server + bridge versions, the running server's version + spawn path, registered tenants, and any orphan source files left over in consumers from pre-v0.4.1 layouts. Most v0.4.1 issues self-diagnose from that output.

### Modal error on activation: "running server is too old"

**Symptom.** Reloading the IDE after upgrading to v0.4.1 shows a modal error: *"Task Router: running server is v0.3.x (or no version), but the extension requires v0.4.0+."*

**Cause.** A pre-v0.4.1 server is still running on `:3100` (likely auto-spawned earlier from a consumer's stale `.claude/mcp/task-router/bin/cli.js`). The extension's bundled server can't bind to the port until the old one dies.

**Fix.**
1. Close all IDE windows that use Task Router.
2. Find the running server PID:
   - Windows: `netstat -ano | findstr :3100`
   - macOS/Linux: `lsof -i :3100`
3. Kill it (`taskkill /PID <pid> /F` or `kill <pid>`).
4. Re-open one IDE — the v0.4.1 extension spawns the bundled server.
5. Run **Task Router: Doctor**; verdict line should read "versions match ✓".

### Doctor lists "orphan source files"

**Symptom.** Doctor reports lines like `orphan source files (safe to delete in v0.4.1): task-router/bin, task-router/src, telegram-bridge/bot.js, telegram-bridge/node_modules`.

**Cause.** Pre-v0.4.1 `init.sh` copied server + bridge source into every consumer's `.claude/mcp/`. v0.4.1 ships those bundled in the VSIX, so the consumer copies are now dead weight.

**Fix.** From the consumer repo:
```bash
rm -rf .claude/mcp/task-router/{bin,src,test,start.sh,seed-oauth.js,package.json,package-lock.json,node_modules,watchdog.ps1}
rm -rf .claude/mcp/telegram-bridge/{bot.js,package.json,package-lock.json,node_modules}
```
Keep `.claude/mcp/task-router/{task-router.db,agents.json}` and `.claude/mcp/telegram-bridge/{.env,.env.example,README.md,SETUP.md,.gitignore}`. CLI-only consumers (no VS Code extension) should leave the source in place — see `init.sh --with-server-source`.

### Dashboard header shows `MCP v?`

**Symptom.** The dashboard's `Extension v0.4.1 (build …) · MCP v?` line shows `?` instead of a server version.

**Cause.** Running server is too old to report `version` in `/health` (i.e. v0.3.x or earlier).

**Fix.** Same as "running server is too old" above — kill the old server, reload the IDE.

---

## v0.4.0 upgrade

### Agent terminal exits with `400 missing_project_param`

**Symptom.** After installing v0.4.0 server / extension, agents fail to register with a 400 error mentioning `missing_project_param` and a pointer to `doc/design/MULTI_PROJECT_ROUTING.md#7-migration`.

**Cause.** Pre-v0.4.0 `.mcp.json` in the consumer repo points at `http://127.0.0.1:3100/mcp` (no `?project=`). The v0.4.0 server requires `?project=<name>` on every per-tenant URL.

**Fix.** Re-run `init.sh` against the upgraded seed — it rewrites `.mcp.json` with `?project=<PROJECT_NAME>`. Or hand-edit:

```json
{ "mcpServers": { "task-router": { "type": "http", "url": "http://127.0.0.1:3100/mcp?project=YOUR_PROJECT_NAME" } } }
```

Then commit the updated `.mcp.json` (the project name is committable — it's the project's own name, not a per-machine value). Stop and restart agent terminals.

### Hot upgrade is unsafe

**Symptom.** Agents that were running before the v0.4.0 upgrade start failing with 400 errors mid-session.

**Cause.** Pre-v0.4.0 agents have an open MCP connection to `/mcp` (without `?project=`). When the new server takes over the port, those connections start returning 400.

**Fix.** Upgrade sequence: stop all agents → install v0.4.0 server + extension → re-run `init.sh` → restart agents. Cannot be done live.

### `409 tenant_conflict` when activating extension

**Symptom.** Extension activation logs `Tenant conflict: project "X" already registered with dbPath "..."` and the dashboard shows a warning.

**Cause.** The v0.4.0 server holds tenants in-memory, keyed by project name. If the same project name is registered twice with different `dbPath` values (e.g., two clones of the same repo at different paths), the server keeps the first registration and rejects the second with 409 (S1 design fix — silent swap would orphan in-flight writes).

**Fix.** Either use the registered path (the path from the first IDE that activated), or restart the server to clear the in-memory registry, or pick a different project name.

---

## Connection Issues

### "needs authentication" in Claude Code

**Symptom:** `claude mcp list` shows Connected, but sessions show "needs authentication."

**Cause:** Claude Code 2.1.90+ runs a full OAuth flow before connecting to HTTP MCP servers. The CLI and session clients use different code paths.

**Fix:** The server includes a no-op OAuth provider that auto-approves everything. Run the seed script to pre-write the token:

```bash
node .claude/mcp/task-router/seed-oauth.js
```

If that doesn't work, select "1. Authenticate" when prompted — the browser briefly opens and the token is cached permanently.

### Server not starting

**Symptom:** `curl http://127.0.0.1:3100/health` fails.

**Checklist:**
1. Is Node.js 18+ installed? `node --version`
2. Are dependencies installed? `cd .claude/mcp/task-router && npm install`
3. Is port 3100 already in use? `lsof -i :3100` (macOS/Linux) or `netstat -ano | findstr 3100` (Windows)
4. Check logs: `cat .claude/mcp/task-router/task-router.log`

### "localhost" doesn't connect (Windows)

**Cause:** On Windows, `localhost` can resolve to IPv6 `::1` while Node.js listens on IPv4 `127.0.0.1`.

**Fix:** Always use `127.0.0.1` in `.mcp.json`, settings, and curl commands.

---

## Agent Issues

### Agent terminal exits immediately with "unknown command"

**Symptom:** The terminal launched by the extension prints
```
✘ unknown command "<agent-name>"
  └ Did you mean claude agents?
```
and exits back to the host shell. Watchdog then injects re-register prompts into the raw shell, producing "The term 'Re-register' is not recognized…" spam.

**Cause:** The agent's name collides with (or is one edit-distance away from) a Claude Code CLI subcommand. The extension launches `claude ... --agent <name>_agent "<name>"`; the trailing positional `"<name>"` is the initial user prompt that triggers the matching `/<name>` skill. Claude Code's subcommand parser fuzzy-matches that positional against built-in subcommands and aborts before any skill loads.

**Reserved names (Claude Code 2.x):** `agent`, `agents`, `auth`, `auto-mode`, `doctor`, `install`, `mcp`, `plugin`, `plugins`, `setup-token`, `update`, `upgrade`. Note that `agent` itself is forbidden — it's a near-match for the `agents` subcommand.

**Fix:** Rename the agent to a non-colliding synonym (`voice` / `assistant` / `wakeword` for a voice-assistant skill, etc.), updating `agents.json`, `.claude/skills/<name>/`, `.claude/rules/<name>.md`, `.claude/SKILLS.md`, `.claude/rules/INDEX.md`, and the Document Ownership Matrix rows in the same commit. The seed docs (`PM.md` → "agents.json Schema" → *Reserved agent names*, and `BOOTSTRAP_PROMPT.md §4`) call this out at bootstrap time.

### Agents not registering

**Symptom:** Agent terminal starts but `list_agents()` returns empty.

**v0.7.0+ checklist** (registration is mechanical now — the launcher pre-registers before claude loads):
1. Is `TASK_ROUTER_AGENT` env var set in the terminal? Run `echo $TASK_ROUTER_AGENT`
2. Did the launcher actually fire `POST /api/register`? Check the server log for a registration call landing within ~1s of terminal launch.
3. Is the agent listed in `.claude/mcp/task-router/agents.json`? The extension reads agent capabilities from this file before pre-registering.
4. If the watchdog can't reach the server (port 3100 closed), the row may have been pre-registered then evicted (TTL). Check `Task Router: Doctor` for server health.
5. Is `disable-model-invocation` set to `false` in the skill YAML front matter? (Required for the skill to load when the launcher passes the agent name as the first prompt.)

### Tasks fail with `'agent' parameter is required` (v0.7.0)

**Symptom:** Specialist accepts a task and the MCP call returns an error containing `'agent' parameter is required` or `task is assigned to "X", not "<agent>"`.

**Cause:** v0.7.0 retired the legacy `sessionAgentName` MCP-session binding. `accept_task` / `submit_result` / `cancel_task` now require an explicit `agent="<name>"` parameter. The SKILL.md you're running was authored against v0.6.x or earlier.

**Fix:** Either (a) configure an errata channel and let PM apply the v0.7.0 migration erratum (recommended), or (b) manually patch each `.claude/skills/*/SKILL.md`: add `, agent="<name>"` to every `accept_task`, `submit_result`, and `cancel_task` call. See the v0.7.0 CHANGELOG migration table.

### Agents going offline (TTL expiry)

**Symptom:** Agents disappear from `list_agents()` after being idle. PM falls back to fork mode instead of MCP dispatch.

**Cause:** Default TTL is 300 seconds. If no hook/watchdog refreshes `last_seen`, the maintenance timer deletes the agent row.

**Built-in protection (v0.3.2+):**

1. **Watchdog keepalive:** The extension watchdog polls `/hook/check` every 10s for extension-launched terminals. Each poll refreshes the agent's `last_seen` timestamp. The `UserPromptSubmit` hook also refreshes on every user prompt.

2. **No auto-resurrection (v0.3.1+):** `/hook/check` only touches agents that are already registered — it does NOT re-create expired agents. Registration happens at terminal-launch time only (mechanical pre-register in the extension / `start.sh` / `claude_start.bat` since v0.6.2).

3. **Mechanical re-registration (v0.7.0+):** The watchdog detects running agents that lost server registration (e.g. after server restart) and hits `POST /api/register` directly with the agent's capabilities from `agents.json`. No prompt injection, no model involvement — recovery is silent. Dashboard transitions orange → green within ~10s. (Pre-v0.7.0 the watchdog injected `# Register again` prompts; that path is gone.)

### PM uses "Agent fork" despite agents being online

**Symptom:** Dashboard shows agents as idle/registered, but PM outputs `Delivery: Agent fork (not online via MCP)`.

**Cause:** PM composed the delegation template (including `Delivery:`) before calling `list_agents()`, or called `list_agents()` without passing the `project` parameter — causing a session error that it interpreted as "server down."

**Fix (v0.3.2+):** PM.md now requires:
1. Calling `list_agents(project=$TASK_ROUTER_PROJECT)` **before** writing the delegation template
2. Always passing `project` explicitly — never relying on MCP session defaults

If the PM is already running, paste this in its terminal:
```
Read PM.md and re-apply the Delegation — Smart Routing section. From now on, you MUST call list_agents(project=$TASK_ROUTER_PROJECT) before outputting the delegation template.
```
Or restart the PM agent to pick up the updated rules.

### Agents expire too quickly

**If agents expire:** Increase TTL in your start script:
```bash
node bin/cli.js --ttl 3600   # 1 hour (default in start.sh)
node bin/cli.js --ttl 0      # no expiry (agents only removed on unregister)
```

### Watchdog not injecting prompts

**Symptom:** Tasks are pending but the agent doesn't pick them up.

**Checklist:**
1. Is the extension installed and active? Check "Output" → "Task Router Watchdog" channel
2. Is `taskRouter.watchdogInterval` set? Default is 10000ms (10s)
3. Check `/hook/check?agent=<name>&project=<project>` — does it return pending tasks?

---

## Task Issues

### Tasks stuck in "accepted" state

**Observed root cause:** Agent accepted the task, started working, then received a newer dispatch via `check_inbox` and forgot the older `task_id`. Nothing in the server forces "one task at a time" — an agent can hold multiple `accepted` tasks simultaneously. Secondary causes: agent crashed mid-task, session lost MCP binding, watchdog prompt injection was corrupted (pre-v0.3.7 bracketed-paste bug).

**Auto-recovery:** Tasks auto-timeout after `--task-timeout` seconds (default: 3600). **`expireTimedOutTasks`** runs inside **`check_inbox`**, **`GET /hook/check`**, **and** the periodic maintenance interval (alongside TTL/retry housekeeping). If **the server is down**, nothing sweeps accepted tasks until it restarts (then startup + maintenance resume).

**Primary fix — PM reconciliation (v0.3.8+):** PM queries open accepted tasks before every dispatch and at session startup, sends a `# RECONCILE <task_id>` prompt to the owning agent, and force-unregisters the agent as an escape hatch if reconciliation itself times out. See `doc/design/ARCHITECTURE.md` → Task State Machine → Stuck `accepted` state.

**Manual cancel (one task):**
```
cancel_task(task_id="<id>")                         # MCP
```

**Manual bulk cancel (all accepted for an agent):**
```bash
curl -X DELETE "http://127.0.0.1:3100/agents/<agent>?project=<proj>&cancel_pending=true"
# → sweeps all accepted → timed_out, unregisters agent. Watchdog auto-reregisters in ~10s.
```

### Results not being delivered

**Symptom:** Agent submitted a result but PM never sees it.

**Checklist:**
1. Is the `UserPromptSubmit` hook configured in `.claude/settings.local.json`?
2. Does `get_pending_results(dispatcher="pm")` show the result?
3. After reviewing, call `acknowledge_results(task_ids=[...])` to stop re-notification

### Task expired from router during context compaction

**Symptom:** A specialist agent (often a coordinator mid-long-task) surfaces a message shaped like:

> **Task expired from router during context compaction — `<task_id>`**

…and stops making progress, waiting for guidance. User intervention is required to continue.

**Cause:** Claude Code's context compaction pauses the agent's Ink UI loop while the conversation is summarized and re-loaded. During that window the agent stops calling MCP tools. If compaction takes longer than the agent's TTL (default 300s), the maintenance timer runs **`expireDeadAgents`** — the agent row is deleted and any tasks it had in the `accepted` state are swept to `timed_out` / `cancelled`. When compaction finishes, the agent resumes, recognises the gap, and reports the expiry.

The watchdog's auto-reregistration (v0.3.2+) re-creates the agent row within ~30s. **As of v0.7.16 the server allows `submit_result` on `timed_out` tasks** from the originally-assigned `to_agent`: the result is recorded normally and the task flips to `completed`, with `recovered_from_timeout: true` in the response so callers can surface "agent finished after lease expired" to the user. Pre-v0.7.16 the server rejected the submit with "not in accepted state" and the manual recipe below was the only path.

**Modern recovery (v0.7.16+):** if the agent retained the `task_id` (either in conversation context or via the v2.14 `save_memory(key="in_flight_task_id")` discipline), it just calls `submit_result(task_id, result, agent="<name>")` as normal. The server accepts it whether the task is still `accepted` OR has been swept to `timed_out`. No manual intervention required for the common compaction-resume case.

**Legacy manual recipe** (still useful when the agent truly lost the task_id and can't recover it via memory):

1. Copy the `<task_id>` from the agent's expiry message (the original dispatch).
2. Reply to the agent with something like: *"Continue with the original task — task_id `<task_id>`. Proceed."*
3. The agent resumes from where compaction interrupted it, calls `submit_result(<task_id>, …)`, and the v0.7.16 tolerance accepts it even if the lease has already timed out.

**Belt-and-suspenders layers in order:**
- **Agent-side** (v2.14 seed, 2026-04-30): `save_memory(key="in_flight_task_id")` after `accept_task`, `load_memory` (with `list_tasks` as fallback) before `submit_result`. Conversation-resident task_id is no longer the source of truth.
- **Server-side** (v0.7.16, 2026-05-12): `submit_result` accepts both `accepted` and `timed_out` statuses from the originally-assigned `to_agent`. Combined with the `--task-timeout` default raised 1h → 24h, the compaction-resume case is now structurally handled rather than reliant on a recovery recipe.
- **Manual fallback**: only needed when both layers above failed (agent lost the task_id entirely AND the task somehow ended up in a non-recoverable state like `cancelled`).

Projects bootstrapped from v2.14+ have agent-side retention; v0.7.16+ servers have submit-tolerance. Pre-v0.7.16 servers reject `submit_result` on `timed_out` tasks — the manual recipe above is the only recovery path for those.

### Duplicate task notifications

**Cause:** `acknowledge_results` was not called after reading results.

**Fix:** Always call `acknowledge_results(task_ids=[...])` after presenting results to the user. This sets `delivered_at` and stops the hook from re-firing.

---

## Extension Issues

### Dashboard shows empty/wrong data

**Symptom:** Dashboard shows 0 agents or 0 tasks when agents are running.

**Possible cause:** Project name mismatch. The extension queries using the workspace folder name (e.g., `"my-project"`), but agents registered under a different name.

**Fix:**
1. Check `$TASK_ROUTER_PROJECT` is set correctly: `echo $TASK_ROUTER_PROJECT` in an agent terminal
2. It must match the workspace folder name exactly
3. All REST endpoints and hooks require explicit `?project=` — there is no "default" fallback
4. If using legacy Windows terminals, ensure `claude_start.bat` derives project from the correct directory (macOS/Linux: the VS Code extension sets `$TASK_ROUTER_PROJECT` automatically)

### Status bar not updating

**Fix:** Check `taskRouter.pollInterval` in settings (default: 10s). The status bar fetches `/health` on this interval.

---

## Platform-Specific Issues

### Windows: `start.sh` fails

**Cause:** Git Bash or WSL may not be available.

**Fix:** Ensure `bash` is in your PATH (Git for Windows includes it), or start the server manually:
```bash
node .claude/mcp/task-router/bin/cli.js --ttl 3600
```

### Windows: Watchdog (legacy `watchdog.ps1`)

The PowerShell watchdog uses `WriteConsoleInput` (Windows API) to inject prompts. This is a legacy tool — the VS Code extension replaces it with `terminal.sendText()` which is cross-platform (Windows, macOS, Linux).

### macOS/Linux: `claude_start.bat` not needed

`claude_start.bat` is a Windows-only legacy launcher. On macOS and Linux, use the VS Code extension to launch agents (it sets `$TASK_ROUTER_AGENT` and `$TASK_ROUTER_PROJECT` automatically), or launch manually:
```bash
TASK_ROUTER_AGENT=pm TASK_ROUTER_PROJECT=my-project claude --agent pm_agent "pm"
```

### macOS/Linux: `seed-oauth.js` permission denied

**Fix:**
```bash
chmod +x .claude/mcp/task-router/seed-oauth.js
node .claude/mcp/task-router/seed-oauth.js
```

---

## Verification Commands

```bash
# Server health (project parameter required)
curl -s "http://127.0.0.1:3100/health?project=my-project" | jq .

# List registered agents
curl -s "http://127.0.0.1:3100/health?project=my-project" | jq .agents_online

# Check specific agent's inbox (both agent and project required)
curl -s "http://127.0.0.1:3100/hook/check?agent=pm&project=my-project"

# OAuth discovery
curl -s http://127.0.0.1:3100/.well-known/oauth-authorization-server | jq .issuer

# MCP handshake test
curl -s -X POST http://127.0.0.1:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## Known Compatibility Notes

| Issue | Workaround |
|-------|-----------|
| Zod v4 `z.record()` single-arg crashes `tools/list` | Use `z.record(z.string(), z.string())` (two-arg) |
| Commander v13 `parseInt` gets wrong radix | Wrap: `(v) => parseInt(v, 10)` |
| Express 5 wildcards reject `*` | Use `{*path}` syntax (path-to-regexp v8) |
| `--agent` name matching a skill | Use `--agent name_agent` (append `_agent` suffix) |
| `disable-model-invocation: true` blocks startup | Set to `false` for agents that auto-register |
