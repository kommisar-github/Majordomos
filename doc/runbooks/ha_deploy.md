# ha_devops Terminal — Operator Deploy Runbook

## Abstract

**TL;DR:** How to launch the `ha_devops` privileged terminal, what the cap-token gate guarantees, and the W5 bring-up + W7 e2e acceptance steps.

**Load when:** ha_devops launch, cap-token, config-write gate, session lifecycle, HA WebSocket reachability, Q-HA-CONFIGWRITE W4, deploy runbook, ha_devops bring-up.

**Key facts:**
- `ha_devops` is the **only** agent that may apply live HA config-writes (create/update/delete automations, scripts, helpers, template sensors). No `ha_devops` terminal ⇒ zero config mutations. This is a structural invariant enforced at the executor layer (loopback port 3101) — not PM policy.
- **Scope:** config-writes only. Tier-B service calls (open cover, set climate, etc.) keep the existing PM Telegram path and do **not** require `ha_devops`.
- Launch via `host/launch-ha-devops.sh`. Never fork `ha_devops` from PM — it is Mode-4-only (Task Router), `no_fork` flag set.
- **Exposure hygiene prerequisite (before W7):** scenes encoding `automation.*`/`script.*` on/off state must be un-exposed from the HA MCP Server — see `doc/runbooks/ha_v1_exposure.md §3.5`.

**Owner:** `/ha_devops`
**Related:** `doc/design/ha_config_write.md §2–§3`, `memory/ha-devops-hard-gate.md`, `doc/runbooks/ha_v1_exposure.md`.

---

## 1. Prerequisites

Before launching `ha_devops`, confirm all of the following:

| Requirement | How to verify |
|---|---|
| `majordomus-daemon` deps installed | `ls majordomus-daemon/node_modules/ws` — if absent: `( cd majordomus-daemon && npm ci )` |
| Task Router running on port 3100 | `curl -s http://127.0.0.1:3100/health` → 200 |
| Executor running on port 3101 | Reachability probe — see §5 (port 3101 has no `/health` route; empty-body POST returning any code ≠ `000` = UP); started in-process by `node majordomus-daemon/bin/app.js` |
| `HA_BASE_URL` in `.env` | e.g. `HA_BASE_URL=http://homeassistant.local:8123` |
| `HA_TOKEN` in `.env` | HA long-lived access token (Settings → Profile → Long-Lived Access Tokens) |
| `claude` CLI in PATH, authenticated | `claude --version` runs without a browser login (G1 headless) |
| `node` in PATH | `node --version` — required for token mint |
| `fleet/` directory writable | script creates it if absent |
| `host/launch-ha-devops.sh` executable | `chmod +x host/launch-ha-devops.sh` |

### HA WebSocket reachability

The executor's WS client (`ha-bridge.js`, `ws` npm package) connects to:

```
ws://<ha-host>:8123/api/websocket
```

Derived from `HA_BASE_URL` by replacing `http` → `ws` (or `https` → `wss`). Same host and port as the REST API.

**Token:** the **same `HA_TOKEN` env var** authenticates both REST calls and the WS auth handshake. No separate WS credential is needed.

**Tailscale/LAN note:** the WS connection is outbound from the Majordomus host to HA — same route as REST (HA port 8123 must be reachable over Tailscale or LAN). The loopback-only constraint (G3) applies to the executor mini-server (port 3101), not to outbound HA connections.

**Reachability test (run before W7):**
```bash
curl -i http://homeassistant.local:8123/api/websocket
```
Expected: HTTP 200 with body beginning `{"type":"auth_required",...}`.

This gates the `helper_create`, `helper_update`, `template_sensor_create`, and `template_sensor_delete` ops (WS path) — including the SoH sensor creation in W7.

---

## 2. Launch `ha_devops`

```bash
# From the repo root (macOS / Linux — use Git Bash on Windows):
bash host/launch-ha-devops.sh
```

The script performs these steps in order:

1. **Mint cap-token** — `trha_<32hex>` (128-bit CSPRNG entropy via `crypto.randomBytes(16)`). Raw token never touches disk.
2. **Compute SHA-256 hash** — only the hash goes to `fleet/ha_devops_session.json`.
3. **Write session file BEFORE registering** — avoids a window where `ha_devops` is registered but the executor would reject the token (§2.3 ordering).
4. **Register** — `POST /api/register` with `capabilities:["ha-config-deploy"]`.
5. **Export `HA_DEVOPS_CAP_TOKEN`** into the terminal env — raw token lives only here.
6. **Launch** `claude --agent ha_devops_agent /ha_devops` (not `exec`, so the EXIT trap fires on exit).

**Expected terminal output on start:**
```
[ha-devops] Session ready — cap-token minted, hash written, ha_devops registered.
[ha-devops] Gate is OPEN: config-writes permitted for this session.
```

---

## 3. Session-file lifecycle

The file `fleet/ha_devops_session.json` is the structural gate:

```json
{ "cap_token_hash": "<sha256-hex>", "agent": "ha_devops", "registered_at": "<ISO>" }
```

| Event | Effect on the session file |
|---|---|
| `ha_devops` launch | Created / overwritten with a fresh hash — prior session's token immediately invalid |
| `ha_devops` relaunch | Overwritten again — one hash per agent at all times |
| Normal exit (claude exits, Ctrl+C, SIGTERM) | Deleted by EXIT trap — gate closes immediately |
| SIGKILL | **Trap does NOT fire** — file persists, old hash still valid |

**If `ha_devops` is SIGKILLed:** manually delete the file to restore the fail-closed state:
```bash
rm -f fleet/ha_devops_session.json
```

The file is gitignored (holds a session secret hash). Never commit it.

### Gate guarantee

The executor hard-refuses `executeConfigWrite` unless ALL of:
- `fleet/ha_devops_session.json` exists and is parseable
- `stored.agent === "ha_devops"`
- `sha256(presented_cap_token) === stored.cap_token_hash`

File absent, agent mismatch, or hash mismatch → **401 `[CAP-TOKEN]`** — no HA I/O occurs. This check is STEP 1 in the executor, before any body-scan or HA request.

Tier-B **service calls** (`executeApprovedAction`) are a separate path and are not affected by the gate.

---

## 4. Gated-path mandate — ALL config-writes must use the executor (HA-REMEDIATION-2)

> **Hard rule — no exceptions for fleet-originated, audited deploys.**

Every HA config-write operation — `helper_create|helper_update|helper_delete`,
`template_sensor_create|template_sensor_delete`, `automation_upsert|automation_delete`,
`script_upsert|script_delete`, `undo_config_write` — **MUST** go through
`executeConfigWrite` via the live loopback executor at `http://127.0.0.1:3101`.

**Forbidden substitutes (both produce an unaudited, untracked write):**

- **Direct HA REST calls** — e.g. any agent issuing `POST /api/config/automation/config/<id>`
  directly against HA. Bypasses the cap-token gate, body-scan, cause-to-fire deny,
  force-disable injection, verify step, and audit log. The same config body posted
  directly to HA is **not a gated deploy**, even if the result looks identical.
- **Manual HA-UI or `configuration.yaml` edits** — operator-by-hand actions with no
  `confirm_id`, no `audit_id`, no `fleet/ha_config_audit.jsonl` entry, and no
  drift-safe `undo_config_write` path through the fleet.

**Exception — intentional out-of-band writes (operator-by-hand):** An operator who
deliberately creates or edits a helper/automation/sensor via the HA UI or YAML
directly (e.g. UI-created `input_number`, YAML-only template entities) is performing
a valid **out-of-band write, unaudited by design**. This MUST NOT be reported as, or
confused with, a gated fleet deploy. It carries no `audit_id`, no `confirm_id`, and
`undo_config_write` cannot reverse it.

**Root cause of HA-REMEDIATION-2:** during the battery SoH Pass-2 session, live
config-writes were applied via direct HA API / HA UI rather than through
`executeConfigWrite`. The executor was unreachable or was never called. Consequently,
`fleet/ha_config_audit.jsonl` had no entry for those writes — the code was correct
(`_appendAudit()` fires unconditionally inside `executeConfigWrite`), but the call
never reached the executor. This mandate closes that gap: the executor is the **only**
permitted path for fleet-originated config mutations.

---

## 5. Executor-liveness precheck — mandatory before any config-write (HA-REMEDIATION-3)

> **Hard gate — not a suggestion.**

Before issuing **any** config-write — including when `ha_devops` picks up a dispatched
task — the executor at `http://127.0.0.1:3101` MUST be confirmed live:

```bash
code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' -X POST http://127.0.0.1:3101/api/ha/config-write)
[ "$code" != "000" ] && echo "executor UP (HTTP $code)" || echo "executor DOWN — do not deploy"
```

> **Why POST, not GET /health?** Port 3101 has no `/health` route — `GET /health` returns
> 404 on a perfectly healthy executor, falsely reporting DOWN. The empty-body POST hits
> `readBody` and returns **400 ("Invalid JSON body")** before any cap-token check or HA I/O,
> proving liveness with zero side effects.

| Result | Meaning | Action |
|---|---|---|
| **`code` ≠ `000`** (e.g. `400`, `401`) | Executor reachable — UP | Proceed with the deploy. |
| **`code` == `000`** (connection refused / timeout) | Executor unreachable — DOWN | **STOP. Do NOT deploy.** Do not fall back to direct HA REST. |

**If executor is down:** complete any in-progress task with result:
`"[BLOCKED] Executor is down at 127.0.0.1:3101 — cannot deploy. Operator must
start the executor (node majordomus-daemon/bin/app.js) and re-dispatch this task."`
No HA mutation occurs. PM relays this to the operator.

**`ha_devops` precheck behavior (mandatory):** `ha_devops` MUST perform this liveness
check before calling `POST http://127.0.0.1:3101/api/ha/config-write`. If the health
check fails, call `complete_task` with the blocked result above. Do not attempt the
config-write call.

**Why not fall back to direct REST?** A down executor means the entire gate is
absent — cap-token validation, body-scan, cause-to-fire deny, force-disable injection,
verify, and audit are all bypassed. Falling back to direct REST silently defeats every
structural control. The correct response is always: restore the executor, then deploy.

**Full pre-deploy health check:**

```bash
# Task Router (has /health endpoint):
curl -sf http://127.0.0.1:3100/health && echo "Task Router UP" || echo "Task Router DOWN"

# Executor (no /health route — use reachability probe):
code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' -X POST http://127.0.0.1:3101/api/ha/config-write)
[ "$code" != "000" ] && echo "Executor UP (HTTP $code)" || echo "Executor DOWN"
```

Both must return UP before a config-write deploy can proceed. The `/app` supervisor
(`majordomus-daemon/bin/app.js`) starts the executor in-process on launch; if the
executor is down, the daemon itself may be down.

---

## 6. Config-write end-to-end flow

```
Operator → Telegram
  → PM: §H1 confirm (mint confirm_id, full-body Telegram prompt with critical_refs
        + "created DISABLED" banner + OVERWRITE-vs-new wording; parse APPROVE/DENY;
        config-write TTL 600 s ≤ 1800 s)
  → APPROVE received → PM dispatches to ha_devops (Mode 4, Task Router)
  → ha_devops: pickup task → calls executeConfigWrite({op, payload, confirm_id}, HA_DEVOPS_CAP_TOKEN)
  → Executor STEP 1: cap-token valid?  else → 401 [CAP-TOKEN]
  → Executor: body-scan + force initial_state:false + GET-first + apply (WS or REST) + verify + audit
  → ha_devops: complete_task
  → PM relays: "Done — created DISABLED. Enable it yourself in the HA UI."
```

**If `ha_devops` is offline when PM receives the request:** PM refuses outright — "launch the ha_devops terminal" — and does not send the Telegram confirm (no point confirming an undeployable change). No fork fallback.

---

## 7. W5 bring-up checklist

Run after W5 creates the `ha_devops` SKILL.md, rules, and `agents.json` row:

- [ ] `bash host/launch-ha-devops.sh` — terminal starts, prints `Gate is OPEN`
- [ ] `fleet/ha_devops_session.json` exists and contains a valid JSON object with `cap_token_hash`
- [ ] `node .claude/mcp/task-router/client.js list-agents` shows `ha_devops` registered
- [ ] **Env fail-closed check (W5.6 — MUST PASS before any config-write test):** inside the `ha_devops` terminal, run the value-blind form — a correct deployer refuses to echo a credential value, so the test must reveal nothing even if the var were set:
  ```bash
  [ -n "$HA_TOKEN" ]    && echo "HA_TOKEN SET — FAIL (gate bypassable)"    || echo "HA_TOKEN empty — PASS"
  [ -n "$HA_BASE_URL" ] && echo "HA_BASE_URL SET — FAIL"                   || echo "HA_BASE_URL empty — PASS"
  ```
  Both MUST print `PASS`. If either prints `FAIL`, `ha_devops` can bypass the loopback executor — **fail the bring-up and re-check `host/launch-ha-devops.sh`**.
- [ ] **Self-guard test:** in a second terminal, run `claude /ha_devops` WITHOUT `TASK_ROUTER_AGENT` set. It should print a self-guard refusal and not accept any config-write tasks
- [ ] Ping from PM: `/pm ping ha_devops` → `"I'm ha_devops ready."`

---

## 8. W7 e2e acceptance sequence

Run after W5 bring-up, W6 PM policy, HA WS reachability confirmed, and scene-exposure hygiene step complete (§9):

### 8.1 Create `sensor.battery_state_of_health` (Template helper)

- Operator via Telegram: request creation of the SoH template sensor
  (see `doc/reference/inverter_battery_health.md` for the template body)
- PM issues §H1 confirm: full body shown + "created DISABLED" banner
- Operator: `APPROVE <confirm_id>`
- PM dispatches to `ha_devops` → `executeConfigWrite({op:"template_sensor_create", ...})`
- Verify: `GET /api/states/sensor.battery_state_of_health` returns a non-null state

### 8.2 Undo the create

- Operator via Telegram: `undo config write <audit_id>` (audit_id from step 6.1 result)
- PM → `ha_devops` → `executeConfigWrite({op:"undo_config_write", payload:{audit_id}})`
- Verify: `GET /api/states/sensor.battery_state_of_health` returns null

### 8.3 Critical-referencing automation — deploy DISABLED

- Request creation of an automation referencing a Critical entity (e.g. `switch.main_breaker`)
- Verify: state of `automation.<id>` is `off` after deploy
- Attempt all 7 `fleet_enable_deny` forms — each must return 403 `[FLEET_ENABLE_DENY]`:
  1. `automation.turn_on`
  2. `automation.toggle`
  3. `automation.trigger` ← key: fires the action sequence of a disabled automation
  4. `script.turn_on`
  5. `script.toggle`
  6. `script.<object_id>` (call the script by its own service)
  7. `homeassistant.turn_on` / `homeassistant.toggle` targeting `automation.*`/`script.*`

### 8.4 Gate-closed check (config-write refused, service calls unaffected)

- Delete `fleet/ha_devops_session.json` manually (or let `ha_devops` exit normally)
- Attempt a config-write → executor must return 401 `[CAP-TOKEN]`
- Attempt a Tier-B service call (e.g. open a cover via the existing PM path) → must succeed (scope carve-out: Tier-B unaffected by the cap-token gate)

### 8.5 Pre-existing Critical safety automation is protected

- Identify an automation in HA whose body references a Critical entity
- Attempt `automation_delete` on it → must return 403 `[HARD-DENY]` (§3.4)
- Attempt `automation_upsert` (overwrite) of same → must return 403 `[HARD-DENY]` (§3.4 NEW-1)

---

## 9. Exposure hygiene prerequisite (cross-ref §3.5)

From `doc/runbooks/ha_v1_exposure.md §3.5`:

Before W7, confirm that operator-authored scenes encoding `automation.*`/`script.*` enabled-state are **un-exposed** from the HA MCP Server.

`scene.turn_on` on such a scene calls `automation.turn_on` internally — which is one of the 7 `fleet_enable_deny` cause-to-fire forms. Because `scene.*` defaults to Tier-A (auto-allow) and runs over the raw MCP path with no code chokepoint, L0 exposure is the only hard control.

**Action:** In HA → Settings → Voice assistants → Expose, search "scene". Un-expose any scene that stores `automation.*` or `script.*` on/off state. A scene that only captures lights/media/climate is safe to keep exposed.

---

## 10. Injection-point decision (W4b flag for `/app`)

`host/launch-ha-devops.sh` is the bash entry-point for manual launch and legacy setups. The `/app` supervisor (`launchCommand.js` / `supervisor.js`) must replicate the mint + inject logic in Node when spawning the `ha_devops` terminal via node-pty.

**Required `/app` W4b changes:**

When `agentName === "ha_devops"`:

1. **Mint:** `crypto.randomBytes(16).toString('hex')` → `"trha_" + hex`
2. **Hash:** `crypto.createHash('sha256').update(capToken).digest('hex')`
3. **Write** `fleet/ha_devops_session.json` with `{ cap_token_hash, agent: "ha_devops", registered_at }` — **before** `POST /api/register`
4. **Register:** `POST /api/register` with `capabilities: ["ha-config-deploy"]`
5. **Set** `HA_DEVOPS_CAP_TOKEN: capToken` in the pty env — raw token lives only in the spawned process env
6. `pty.spawn(claude, ["--agent", "ha_devops_agent", "/ha_devops"], { env: { ...env, HA_DEVOPS_CAP_TOKEN, TASK_ROUTER_AGENT: "ha_devops" } })`

On pty `exit` event:
- Delete `fleet/ha_devops_session.json`
- `POST /api/unregister` for `ha_devops`

**Do not** set `TASK_ROUTER_AGENT=ha_devops` and call claude directly without the mint step — `HA_DEVOPS_CAP_TOKEN` must be in the pty env before claude starts, and the session file must exist before registration completes.
