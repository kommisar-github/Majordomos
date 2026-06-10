# HA Gated Config-Write Capability — Q-HA-CONFIGWRITE

> **Status: PROPOSED (v4 — 2026-06-10)** (authoritative `/arch` design)
> Extends `doc/design/ha_whitelist_gate.md` (three-tier gate + §H1 confirm
> correlation N1–N6 + Critical floor) and `doc/design/ha_integration.md` §Safety
> boundary. **Design proposal, not a merge.** PM STOPs for operator approval, then
> routes to `/review` before any build.
>
> **Changelog**
> - **v1 (2026-06-10):** first design — recommended *extend `/ha`, no new agent*;
>   automations referencing Critical entities **hard-denied** at create. `/review`
>   verdict **NEEDS REVISION (6/10)**.
> - **v2 (2026-06-10):** folded three **operator-locked** decisions overriding v1
>   + all `/review` v1 findings: (1) **two-layer split** `/ha` + new `ha_devops`;
>   (2) **executor hard gate** (no live `ha_devops` ⇒ no mutations); (3) **"agents
>   draft, the human activates"** force-disabled model. `/review` verdict **NEEDS
>   REVISION (7/10)** — split/create-disabled/cap-token SOUND; one **BLOCKER**
>   (linchpin not exhaustive) + 4 MAJORs, all enumerable.
> - **v3 (2026-06-10, this doc):** fixes the `/review` v2 BLOCKER + 4 MAJORs +
>   MINORs and folds two operator scope decisions:
>   1. **Linchpin redefined `enable` → "cause-to-fire"** — `fleet_enable_deny` now
>      denies all **7** service forms incl. the killers **`automation.trigger`** and
>      **`script.toggle`**; §3.3 no longer over-claims completeness; scene-encoded-
>      enable + transitive call-graph moved to the documented residual (§3.5).
>   2. **Hard-gate scope = CONFIG-WRITES ONLY** (operator) — the cap-token/`ha_devops`
>      gate covers only `executeConfigWrite`; Tier-B *service* calls keep the existing
>      PM→`executeApprovedAction` Telegram path, no `ha_devops` required (§2.2,
>      resolves MAJOR-4).
>   3. **Disable-scope rule** (operator, verbatim) resolves the v2 §3.1↔§3.4
>      contradiction (§3.4).
>   4. **Cap-token lifecycle** (one-hash-per-agent, session-bound; MAJOR-2),
>      **WS-client scoped invariant** (never `call_service`; MAJOR-3), TTL 600 s /
>      ≤1800 s ceiling, `ha_devops` = `claude-sonnet-4-6`, scenes stay deferred.
> - **v4 (2026-06-10, this doc):** `/review` re-verified v3 → **8.5/10, linchpin
>   AIRTIGHT** (exhaustive 8th-path probe found nothing). Folds two new `/review`
>   MAJORs (both "protect-the-interlock / eyes-open" family) + operator calls:
>   1. **NEW-1 — overwrite-protection (§3.4/§5.2):** `automation_upsert`/`script_upsert`
>      onto a **pre-existing object whose prior body references a Critical entity** is
>      **hard-denied** (closes the "replace+neuter a safety interlock via one benign
>      upsert" laundering path); the §3.1 backstop carve-out is scoped to `prior==null`
>      or a non-Critical prior so it never disables a pre-existing interlock.
>   2. **NEW-2 — blueprint bodies FLAG, not deny (operator):** `use_blueprint:` bodies
>      hide their actions in a host-side file the scan can't read → the confirm
>      prominently **flags "actions not shown — review the blueprint in HA before
>      enabling"**; recorded in the §3.5 human-enable residual.
>   3. **Scene-exposure hardening — operator opted IN (§9 + runbook):** scenes that
>      encode an `automation.*`/`script.*` state stay **off the HA MCP Server**. §9 now empty.
>   4. **No-event-fire-verb guardrail** (executor invariants) + 3 new tests.

## Abstract

**TL;DR:** A gated capability that lets the fleet **draft HA configuration
entities** — helpers, template sensors, automations, scripts — instead of handing
operators YAML to paste. Live mutation is performed **only** by a new privileged
`ha_devops` terminal; the loopback executor hard-refuses any HA write not
attributable to a live, registered `ha_devops` session. Agent-created automations
deploy **force-disabled** and the fleet is **hard-denied from ever enabling** one —
enabling is a human-only act in HA's UI. Reuses §H1 (N1–N6) confirm correlation
verbatim; adds one executor verb, a one-shot HA WebSocket client, an evasion-proof
body-scan, and a drift-safe audit/undo.

**Load when:** HA config write, create helper, `input_number/create`, template
sensor, create/upsert automation, draft-disabled, `initial_state false`, fleet
never enable, `ha_devops`, hard gate, body-scan, transitive escalation, config
rollback, audit log, Q-HA-CONFIGWRITE, `sensor.battery_state_of_health`.

**Key facts:**
- **Two layers:** `/ha` owns the *code* (`ha-bridge.js`); **`ha_devops`** is the
  *only* runtime principal allowed to apply a live-HA **config write**. Hard gate at
  the executor: **no live `ha_devops` ⇒ no config writes.** **Scope = config-writes
  only** — Tier-B service calls (cover/climate/vacuum) keep the existing PM Telegram
  path, no `ha_devops` required.
- **Linchpin invariant ("cause-to-fire", not just "enable"):** the fleet may never
  cause an agent-drafted (or any disabled) automation/script's actions to execute,
  by **any** service. `fleet_enable_deny` hard-denies all **7** forms:
  `automation.turn_on`, `automation.toggle`, **`automation.trigger`**,
  `script.turn_on`, **`script.toggle`**, `script.<object_id>` (named-script
  service), and `homeassistant.turn_on`/`toggle` resolving to `automation.*`/`script.*`.
  Agents draft (force-disabled); a **human enables**. Scene-encoded-enable +
  transitive call-graph are contained by the human boundary, not enumeration (§3.5).
- **Create-disabled mechanics verified:** `initial_state: false` is HA's
  authoritative load/reload state lever — executor **force-injects it on every
  upsert** (create *and* update) + **verifies** post-write state `== off`, issuing
  the permitted `automation.turn_off` if HA reports `on` (disabling is allowed;
  only enabling is denied).
- Primary write path = HA-native APIs (WS helper collections + Template-helper
  config-flow; REST `/api/config/{automation,script}/config/<id>`). Host-file edits
  to `configuration.yaml` are **Tier-C, operator-by-hand**. `scene_upsert` **deferred**.
- Body-scan role shifts **deny → label/surface** (Telegram confirm shows full body
  + every Critical entity + "created DISABLED"), with two **remaining hard-denies**:
  (i) delete/disable of an existing Critical-referencing safety automation;
  (ii) any fleet **enable** attempt.

**Owner:** `/arch` (this proposal) → `/ha` (executor/scan/WS/audit/undo + tests),
**`ha_devops`** (runtime deploy + self-guard), `/app` (loopback route + token
validation wiring), `/ops` (token mint + WS reachability + env), PM (confirm policy
+ `ha_devops`-liveness routing gate).
**Related:** `doc/design/ha_whitelist_gate.md`, `doc/design/ha_integration.md`,
`doc/reference/ha_entity_catalog.md`, `.claude/rules/ha.md`, `memory/ha-devops-hard-gate.md`.

---

## 0. Problem (unchanged from v1)

The loopback executor (`ha-bridge.js → executeApprovedAction`) gates **service
calls** only — `POST /api/services/...` behind Tier A/B/C. It **cannot create or
mutate HA configuration entities** (helpers, template sensors, automations,
scripts). That gap forces the fleet to hand the operator YAML to paste by hand —
current live example: the `sensor.battery_state_of_health` SoH calculator from
`doc/reference/inverter_battery_health.md`. We want a **gated config-write
capability** — but the operator has bound it to a strict two-layer + human-activate
model (below).

---

## 1. Capability surface — primary write path (carried from v1, intact)

HA exposes three structurally different config-mutation surfaces; the design uses
two and rejects the third.

| Surface | Reaches | Transport | Reversible? | Restart? |
|---|---|---|---|---|
| **(a) Helper collections** — `input_number/create`, `input_boolean`, `input_text`, `input_select`, `input_datetime`, `input_button`, `counter`, `timer`, `schedule` | `input_*`/counter/timer helpers | **WebSocket** command | Yes — paired `…/delete` by id | No — live |
| **(a′) Template-helper config-flow** — `config_entries/flow` (`template` integration) | One template `sensor`/`binary_sensor`/… (state template + unit/device_class/state_class) | **WebSocket** config-flow (multi-step) | Yes — `config_entries/remove` | No — live |
| **(b) Config REST API** — `POST/GET/DELETE /api/config/{automation,script}/config/<object_id>` | Automations, scripts | **REST** (reuse `ha-bridge.js` http transport) | Yes — `DELETE`/re-`POST` prior | No — auto-reloads |
| **(c) Host-file edit** — write `configuration.yaml`/`*.yaml` + reload/restart | Arbitrary YAML | HA-host filesystem (**no access**) | Only git/backup | Yes |

**Recommendation (unchanged): primary = (a)+(a′)+(b); reject (c).** No host access,
reversible by construction, no restart, and the motivating `sensor.battery_state_of_health`
fits **(a′)** as a single-state Template helper (unit `%`, `device_class: battery`)
— closes the live gap without touching `configuration.yaml`. Surface **(c)** is
**Tier C (no path)** — operator-by-hand. Honest limits unchanged: rich multi-attribute
`template:` blocks and `trigger`-based template entities still need (c); v1
auto-creates only single-state template sensors.

**Scene note (v2 change):** **`scene_upsert` is DEFERRED to a later phase**
(`/review` MINOR). A scene snapshots *live state across many entities* — it can
embed a Critical entity's state and is awkward to body-scan — high surface, little
v1 benefit. v1 ships helpers + template sensors + automations + scripts only.

---

## 2. The runtime model — two layers + the hard gate (operator-locked)

v1 reasoned about *code ownership* and concluded "one agent." That conclusion holds
**for the code** — but the operator added an orthogonal **runtime-authorization**
layer that v1 missed. v2 keeps both.

### 2.1 Two layers (do not conflate)

| Layer | Principal | What it is | What it touches |
|---|---|---|---|
| **Code-implementer** | **`/ha`** | Builds the mechanism: executor verb, body-scan, WS client, audit, undo, tests | `ha-bridge.js`, `ha_whitelist.json`, tests. **Never mutates live HA.** |
| **Runtime-deployer** | **`ha_devops`** (NEW) | The **only** principal allowed to apply a live-HA mutation. A human-launched, registered, audited terminal. | Invokes the loopback executor's config-write verb. Owns **no code.** |

`/review` was right that the *code* stays a single owner (`/ha`) — that part of v1
§4 survives. `ha_devops` is **not** a second code-owner; it is a **runtime
capability boundary**. They are different axes, so there is no `ha-bridge.js`
co-edit / overlap-collapse (the v1 objection to a split) — `ha_devops` writes zero
source.

### 2.2 The hard gate — "no agent running, no config changes" (executor-enforced)

**Scope (operator decision 2026-06-10): CONFIG-WRITES ONLY.** The cap-token /
`ha_devops` gate applies **only to `executeConfigWrite`** — create/update/delete of
automations, scripts, helpers, and template sensors. **Tier-B *service* calls**
(open cover, set climate, start vacuum, …) are **not** config writes: they keep the
**existing** PM→`executeApprovedAction` Telegram-confirm path (`ha_whitelist_gate.md`
§H1) and do **not** require `ha_devops` live or a cap-token. So *"no agent running,
no HA changes"* means *no agent running, no **config/automation** changes* — comfort
service calls are unaffected. (This is the corrected scope in
`memory/ha-devops-hard-gate.md`; resolves `/review` MAJOR-4.)

**Structural invariant (not PM policy):** within that scope, the loopback executor
(3101) hard-refuses any config-write **unless the call carries a valid, session-bound
`ha_devops` cap-token.** Two parts, defense-in-depth:

- **Routing (PM, fail-closed):** `ha_devops` is **Task-Router-only (Mode 4), NEVER
  fork (Mode 2)**. PM's normal offline→fork fallback is **disabled** for it. At
  classification time PM calls `list_agents` — if `ha_devops` is **not registered/
  live**, PM **refuses and tells the operator to launch its terminal**; it does not
  even send the Telegram confirm (no point confirming an undeployable change).
- **Skill self-guard (`ha_devops`):** its Startup Sequence refuses any deploy when
  `$TASK_ROUTER_AGENT` is empty (i.e. running as a fork, not a dedicated terminal).
- **Executor attribution (the hard floor):** the mutate verb requires a
  **per-session `ha_devops` capability token** and validates it against the
  task-router registry; an absent/invalid/stale token ⇒ **hard-refuse**, regardless
  of any upstream "approved" claim.

### 2.3 Enforcement mechanism — recommended design + rejected alternatives

**Recommended: per-session capability token + registry liveness, validated by the
executor (reusing the federation token pattern `/ops` already owns).**

```
ha_devops launch (launcher, mechanical)
   ├─ mint cap-token  trha_<≥128-bit CSPRNG>   (one per session)
   ├─ POST /api/register  ha_devops + capabilities:["ha-deploy"] + token SHA-256 hash
   └─ spawn claude  --agent ha_devops_agent  /ha_devops   env: TASK_ROUTER_AGENT, …, HA_DEVOPS_CAP_TOKEN

deploy turn
   ha_devops ── executor.executeConfigWrite({op,payload,confirm_id}, cap_token) ──► executor:
        1. hash(cap_token) == the CURRENT registered hash for ha_devops AND that hash's
           session is live (heartbeat fresh)?  else HARD-REFUSE      ← VALIDATION STEP 1, before any HA I/O
        2. body-scan + tier floor + force initial_state:false  (§3, §4)
        3. apply via WS/REST → verify → audit
```

**Cap-token lifecycle (MAJOR-2 — exactly one valid hash per agent, session-bound):**
- **One hash at a time.** Registration stores **exactly one** active cap-token hash
  for `ha_devops`. A **re-register** (relaunch) **purges/overwrites** the prior hash;
  **unregister-on-exit** (pty `exit` → `POST /api/unregister`) **deletes** it. There
  is never a second valid hash.
- **Bind to the token's OWN session, not "an `ha_devops` is up".** The executor's
  live-check matches the presented token's hash to *the registry row it minted* and
  confirms **that** session's heartbeat is fresh — so a **stale prior-session token
  cannot validate** just because a *new* `ha_devops` happens to be registered. Token
  hash + session identity are checked together (a relaunch rotates both).
- **Validation is STEP 1**, before any HA read/write (a refused call touches HA zero
  times).

- **Why a token, not just liveness:** a registry-liveness-only check passes for
  *any* loopback caller (PM, a bug, a stray fork) whenever `ha_devops` merely
  *happens* to be up — it proves existence, not attribution. The operator made this
  a **structural** invariant; the token proves the call **came from** the
  `ha_devops` session. Validating the token requires the agent be registered + live,
  so the token *subsumes* the liveness check.
- **Reuses existing machinery:** identical to `/ops`'s federation tokens
  (`grant_access` mints `trtok_…`, stores SHA-256 hash, validates) — not novel
  surface, just a new grant kind `ha-deploy`. The token rides `ha_devops`'s env
  (loopback-only, G3).

**Rejected alternatives:**
- **(R1) Registry-liveness only** (executor checks `list_agents` shows a live
  `ha_devops`, PM is still the caller). *Weaker:* attribution hole above; and it
  contradicts the operator's "`ha_devops` is the *only* agent that applies changes"
  — PM would still be the caller. Kept only as a lighter fallback if the operator
  wants less build surface and accepts the weaker attribution.
- **(R2) PM-direct with a policy flag** ("PM only calls the executor after checking
  ha_devops is up"). Rejected outright: pure PM policy, exactly what the operator
  said it must **not** be ("structural invariant, not PM policy").
- **(R3) Mutual-TLS / unix-socket peer-cred between ha_devops and the executor.**
  Strongest attribution, but heavy for a loopback single-host deploy and doesn't
  reuse existing machinery — over-engineered for v1.

### 2.4 Where the §H1 confirm sits relative to the layers

PM remains the **authorization brain** (it owns Telegram + the confirm_id + memory,
forced by the bridge per §H1). `ha_devops` is the **privileged hands**. Order:

```
operator ─Telegram─ PM (policy/confirm) ── dispatch approved write ─► ha_devops (principal) ── cap-token ─► executor (structural floor) ─► HA
```

1. PM classifies the request → config write. PM checks `ha_devops` live (§2.2); not
   live → refuse.
2. PM runs §H1 verbatim: mint ≥64-bit CSPRNG `confirm_id` (N1), `save_memory`
   under the **`ha_confirm:` keyspace** (so the N6 startup sweep covers it),
   Telegram prompt, parse reply **only** on the N2 channel-bind
   (`from_agent=="telegram"` AND `^(APPROVE|DENY) <id>$`; an `[HA REQUEST]` payload
   can **never** self-approve), server-time TTL (N3 — **config-write TTL = 600 s,
   operator-tunable, hard ceiling ≤ 1800 s** so an approved-but-unexecuted write
   cannot sit pending forever; entropy (N1) not TTL carries the anti-brute-force
   property, so a longer TTL is safe), **delete-before-execute** (N4), single-use /
   unknown-id discard (M6).
3. On a valid APPROVE, PM **dispatches the approved write** (with `confirm_id`) to
   `ha_devops` (Mode 4).
4. `ha_devops` picks it up and calls `executeConfigWrite(..., cap_token)`.
5. Executor validates the token (§2.3), re-runs the body-scan + tier floor +
   force-disable + verify (its own hard floor, independent of PM — the §H1 N5
   principle), applies, audits, returns.
6. PM relays: *"Done — created **DISABLED**; enable it yourself in the HA UI."*

The three layers are independent failures-closed: wrong PM logic is caught by the
executor token + scan; a missing `ha_devops` is caught by PM routing *and* the
token; a fork `ha_devops` self-guards.

---

## 3. Automation model — "agents draft, the human activates"

This **supersedes** v1's create-time hard-deny **and** the `/review`-rejected
create-time extra-confirm. Agents may create/upsert **any** automation/script,
**including Critical-referencing ones**, subject to:

### 3.1 Force-disabled on create (verified mechanics)

- **HA's lever:** `initial_state: false` in an automation's config sets the
  automation **OFF on every load/reload**, authoritatively (it is exactly the field
  that overrides restored state). A disabled automation does **not** respond to
  triggers — no autonomous path exists at deploy.
- **Make-or-break detail the operator flagged:** `initial_state` only governs
  state *at load*. The failure mode is an *update* that **omits** it → HA then
  *restores last state* (could be on). **Fix:** the executor **force-injects
  `initial_state: false` into EVERY upsert it POSTs — create AND update —
  non-overridable** (it rewrites the field even if the agent supplied `true`). So no
  reload can ever find it absent.
- **Robust backstop (since `initial_state` edge cases exist across HA versions):**
  after the write the executor **verifies** by reading `GET /api/states/automation.<id>`;
  if HA reports state `on`, the executor issues `automation.turn_off` and writes an
  **anomaly audit entry**. Belt-and-suspenders: declared-disabled *and* verified-off.
  This `turn_off` is **§3.4-permitted disable case (a)** — the executor tightening
  *the very object it is deploying* — so it is allowed **regardless of Critical refs**
  and is **not** the hard-denied "disable a pre-existing safety interlock" case (§3.4).
- **Scripts:** a script has no "disabled-but-present firing" risk — it only acts
  when **run**. Containment for scripts = the fleet may **never run** one (`script.turn_on`
  / `script.<object_id>` service hard-denied, §3.3). Creation ≠ execution; a human
  runs it. So `script_upsert` needs no `initial_state` analogue — the run-deny is
  the whole control.

### 3.2 Updates re-disable

Any agent update that changes an automation's body **force-reverts it to disabled**
(via the always-injected `initial_state: false` + verify). The human must
**re-enable** after reviewing the change. The Telegram confirm says
*"OVERWRITES existing `<alias>` and DISABLES it — re-enable in HA."*

### 3.3 The linchpin — the fleet can never CAUSE-TO-FIRE (hard-denied, executor + classify)

> **v3 correction (`/review` BLOCKER).** v2 framed this as "the fleet can never
> *enable*" and claimed the denied set was "exactly one enumerated set, complete."
> **That was wrong** — there are service paths that *fire a disabled automation* or
> *run a script* **without ever enabling it**, so an "enable-only" deny is bypassable
> (agent drafts a disabled breaker automation → operator approves the *disabled*
> create → fleet calls `automation.trigger` → its actions fire → breaker drops, no
> enable ever happened). The invariant is therefore redefined to **cause-to-fire**.

**Invariant (corrected):** *the fleet may never cause an agent-drafted (or any
disabled) automation/script's actions to execute, by **any** service.* This is
broader than "enable" — it covers triggering and running, not just flipping state.

**`fleet_enable_deny` — the exhaustive set of DIRECT fleet service paths, all
hard-denied** at *both* the service-call executor and the config-write executor:

| # | Service | Why it must be denied |
|---|---|---|
| 1 | `automation.turn_on` (on any `automation.*`) | enables → can then fire |
| 2 | `automation.toggle` | enables a disabled automation |
| 3 | **`automation.trigger`** | **runs the action sequence of a *disabled* automation anyway** (`skip_condition` defaults `true` — skips conditions too). **The killer v2 missed.** |
| 4 | `script.turn_on` | runs the script |
| 5 | **`script.toggle`** | **toggling a *stopped* script starts (runs) it.** v2 missed. |
| 6 | `script.<object_id>` (named-script service) | calling a script by its own service runs it |
| 7 | `homeassistant.turn_on` / `homeassistant.toggle` whose **target resolves to any `automation.*`/`script.*`** | generic-domain enable (caught by §4(b) domain-prefix, not the `service:` domain) |

**Permitted (tightening only):** `automation.turn_off` / `homeassistant.turn_off`
targeting `automation.*`/`script.*` (the executor uses this for the §3.1 backstop;
fleet `turn_off` is otherwise governed by the §3.4 disable-scope). Disabling/stopping
is always-safe tightening; causing-to-fire is human-only in HA's authoritative UI.

**Exact whitelist/classify rule (for `/ha`):** add a `fleet_enable_deny` block to
`fleet/ha_whitelist.json` enumerating the 7 forms above (services 1–6 by
`(domain,service)`; form 7 as the `homeassistant.turn_on|toggle` + automation/
script-target case). `classify()`, `classifyEntity()`, **and** the body-scan all
consult it and return a **distinct hard-refuse sentinel** (not plain Tier C, so the
audit reason is precise). The executor checks it on the *requested* service call too,
not only inside scanned bodies.

**Honesty about completeness (the part v2 over-claimed):** the **direct fleet service
paths** above ARE exhaustively enumerated and denied — there is no other HA service
by which the fleet itself can fire/run an automation or script. But two **indirect**
vectors are *not* closed by enumeration and are **contained by the human-enable
boundary instead** (documented in §3.5), so §3.3 no longer claims to be the whole
control:
- **scene-encoded enable** — `scene.turn_on` on a *pre-existing* scene that encodes
  `automation.x: on` calls `automation.turn_on` under the hood, and `scene` defaults
  to **Tier-A** (auto-allow) — a real enable corner. See §3.5.
- **transitive call-graph** — a drafted automation that calls a pre-existing
  `script`/`automation` that itself touches a Critical entity. See §3.5.

### 3.4 Disable-scope rule + body-scan's dual role

**Disable-scope (operator decision 2026-06-10, adopted verbatim — resolves the v2
§3.1↔§3.4 contradiction).** A fleet-initiated disable is judged by *whether the
target is the object currently under deployment* and *whether its prior body touches
a Critical entity*:

- **PERMITTED disables:**
  - **(a)** the executor's **OWN force-disable of the object currently under
    deployment** (the §3.1 `initial_state:false` injection + verify→`turn_off`
    backstop). **Carve-out scope (v4/NEW-1):** case (a) applies **only when the
    upsert is a genuine create (`prior == null`) OR the prior body references NO
    Critical entity** — so the backstop **never runs against (and never disables) a
    pre-existing Critical interlock** (that case is hard-denied below, before any
    disable). Within that scope it is allowed regardless of the *new* body's Critical
    refs (it is tightening the very thing it just made).
  - **(b)** a fleet-initiated `turn_off` on an automation/script whose **prior body
    (GET-first) references NO Tier-C/Critical entity** — **Tier-B confirm**.
- **HARD-DENIED (operator-by-hand) — targeting a pre-existing object NOT under a
  benign-create whose PRIOR body references ANY Tier-C/Critical entity** (a safety
  interlock — evacuation/lockdown/breaker automation):
  - **delete** — `automation_delete` / `script_delete`;
  - **disable** — fleet-initiated `turn_off`;
  - **overwrite (v4/NEW-1)** — `automation_upsert` / `script_upsert` onto that
    `object_id`, **even with a benign new body**. Otherwise one Tier-B confirm could
    *replace + disable* the safety logic of an existing interlock (launder a neuter
    through an "upsert"). The GET-first check (§5.2-4) classifies the **prior** body;
    if it touches a Critical entity, the whole upsert is refused.

So creating a **new** Critical-referencing draft still works (model intent
preserved); you simply **cannot delete, disable, or overwrite a pre-existing Critical
interlock** through the fleet. The §3.1 backstop is case (a), scoped to create /
non-Critical-prior, so it never collides with this protection. No contradiction.

**Body-scan's dual role.** The scan's job **shifts from deny-on-Critical to
label/surface**: the Telegram confirm shows the **full body** + **every Critical
entity referenced** + the **"created DISABLED — you must enable it in HA"** banner,
so the operator approves with eyes open (plus the **blueprint flag**, §4(h)). The
scan **still hard-denies** these cases:

1. **Delete / disable / overwrite of a pre-existing automation/script whose PRIOR
   body references a Tier-C/Critical entity** — the HARD-DENIED set above (NEW-1
   adds overwrite).
2. **Any fleet cause-to-fire attempt** (the 7 `fleet_enable_deny` forms, §3.3) —
   **including in-body occurrences**: an `automation_upsert` whose own `action`
   sequence contains `automation.trigger` / `script.turn_on` / `script.<object_id>`
   (i.e. drafts an *enabler* of another disabled object) is refused by the body-scan,
   distinct from the direct requested-service check.

### 3.5 Residual vectors — DOCUMENTED (contained by the human boundary, not enumeration)

Two vectors are **not** closed by the §3.3 direct-service enumeration. They are
**contained by the draft-disabled + human-enable boundary** instead — the firing-
capable state only ever flips by a **deliberate human act in HA's own UI**:

1. **Transitive call-graph.** The body-scan is **single-object**: an agent-drafted
   automation that calls a **pre-existing** `script.x` / fires another `automation.y`
   that *itself* references a Critical entity is invisible to a single-object scan.
   Not closed at create time. Contained: the drafted automation cannot fire until a
   **human enables it**, and `script.x` is itself in the fleet run-deny set (§3.3),
   so the laundering only completes once a *human* enables the draft.
2. **Scene-encoded enable.** `scene.turn_on` on a **pre-existing** scene that encodes
   `automation.x: on` calls `automation.turn_on` under the hood — and `scene` defaults
   to **Tier-A (auto-allow)**, so this is a genuine *enable corner the §3.3 enumeration
   does not catch*. Mitigations: (i) the fleet cannot *create* such a scene in v1
   (`scene_upsert` is **deferred**, §1), so the dangerous scene must *pre-exist*
   operator-authored; (ii) **exposure hardening — operator OPTED IN (v4):** any
   operator-authored scene that encodes an `automation.*`/`script.*` on/off state is
   kept **off the HA MCP Server**. A Tier-A scene is applied via the raw MCP path with
   **no code chokepoint** (`ha_whitelist_gate.md` L0/§2), so **L0 exposure is the only
   hard control** — un-exposing such scenes removes the path entirely. Zero code;
   operator exposure-hygiene step recorded in the runbook (`doc/runbooks/ha_v1_exposure.md`).
3. **Blueprint-hidden bodies (v4/NEW-2).** A `use_blueprint:` automation/script keeps
   its actual `action` sequence in a **blueprint file on the HA host** that the
   body-scan cannot read — so the scan sees only the passed inputs, not what the
   blueprint *does* with them. **Operator decision: FLAG, do not deny** (the more
   permissive option; it leaves a slightly easier social-engineering residual on the
   human-enable boundary, accepted). The Telegram confirm must prominently show
   **"⚠ BLUEPRINT-BASED — action sequence is NOT shown here; it lives in the blueprint
   on the HA host. Review the blueprint in HA before you enable this."** Scanned inputs
   (entity_ids passed as blueprint inputs) are still labeled as usual; the warning
   covers the **unseen** blueprint actions. Containment is the same human-enable
   boundary — the operator reviews the blueprint in HA before enabling the draft.

**Residual risk = social-engineering the human into enabling a specific named
automation (incl. a blueprint whose hidden actions they didn't review), or an
operator-authored scene that re-enables one. Accepted — the operator is the trust
boundary.** Recorded explicitly for `/review` and the operator; §3.3 deliberately no
longer claims these are covered by enumeration.

---

## 4. Hardened body-scan spec (evasion-proof — `/review` items (a)–(g) + v4 (h) blueprint-flag, (i) in-body cause-to-fire)

The scan runs on the **fully-resolved config the executor will POST** (after
force-injecting `initial_state: false`), not the raw request. Entity classification
uses a **service-agnostic** helper (`/review`): body entities have no `service`
arg, so use **`classifyEntity(entity, whitelist)`** = Critical-floor (`_isCritical`)
→ per-entity override → domain-default → fail-closed C — **not** the 3-arg
`classify(domain,service,entity)` (which needs a service and would mis-handle a bare
entity_id). Add `classifyEntity` alongside `classify` in `ha-bridge.js`.

| # | Evasion | Rule |
|---|---|---|
| **(a)** | Nested control flow hides a ref | **Recursive walk** of the whole body incl. `choose`/`if`/`then`/`else`/`repeat`/`while`/`until`/`sequence`/`parallel`/`default` — visit every node. |
| **(b)** | `service: homeassistant.turn_off`, `target.entity_id: switch.main_power_breaker` (Critical hidden behind a generic service) | **Classify every string by its OWN domain prefix**, never the `service:` domain. Extract every value matching the entity_id shape from **every** position (`entity_id`, `target.entity_id`, `data.entity_id`, bare strings) → `classifyEntity`. |
| **(c)** | `entity_id: "{{ critical_var }}"` (Jinja computes a Critical id at runtime) | **Deny-on-template:** any `{{`/`{%` in an **actionable** position ⇒ **refuse** (a static scan cannot evaluate Jinja). Actionable positions explicitly include the **legacy** `service_template` and `data_template` keys and any **templated `target`** (`target: "{{ … }}"` / `target.entity_id: "{{ … }}"`), plus `service`/`entity_id`/`data` that resolves an entity. |
| **(d)** | `area_id`/`device_id`/`label_id`/`floor_id` selector expands to a Critical member | **DENY these selectors in v1** (closes v1 §7 open-decision 3 → DENY). Unbounded/opaque sets. |
| **(e)** | `group.x` / a `switch.`-prefixed group containing a Critical member | **Expand-or-deny** `group.*`/collection entities: GET the group's `entity_id` attribute, classify each member; if unresolvable ⇒ **deny**. |
| **(f)** | ` Switch.Main_Power_Breaker ` (whitespace/case) | **Normalize** every candidate: `trim` + `lowercase` before matching. |
| **(g)** | `entity_id` as a list vs a string | Handle **string OR list** — iterate lists. |
| **(h)** | `use_blueprint:` hides the action sequence in a host-side file (v4/NEW-2) | **Detect `use_blueprint:` → set a `blueprint_flag`** (do **not** deny — operator decision). The confirm shows the §3.5 "⚠ BLUEPRINT-BASED — actions not shown, review in HA" banner. Passed inputs are still classified/labeled normally. |
| **(i)** | In-body cause-to-fire — the drafted body itself calls `automation.trigger`/`script.turn_on`/`script.<object_id>` to draft an *enabler* | The recursive walk (a) matches each `(domain,service)` against `fleet_enable_deny` (§3.3) → **hard_deny** (distinct from the direct requested-service check). |

**Output:** `{ critical_refs:[…], hard_deny:bool, blueprint_flag:bool, reason }`.
`hard_deny` set for §3.4's cases (delete/disable/**overwrite** of a Critical-prior
interlock; any cause-to-fire incl. in-body §4(i)) or a template/selector/
unresolvable-group refusal. `blueprint_flag` drives the confirm banner (never denies).
Otherwise the `critical_refs` list feeds the Telegram label.

---

## 5. Executor extension — verb, schema, validation, atomicity (MAJOR fixes folded)

`executeApprovedAction(...)` (service calls) is **unchanged**. Add a sibling on the
same loopback executor, **callable only with a valid `ha_devops` cap-token** (§2.3):

```
async executeConfigWrite({ op, payload, confirm_id }, capToken) → { op, applied, audit_id, created_disabled, overwrote }
```

### 5.1 Supported ops (v1)
`helper_create|helper_update|helper_delete`, `template_sensor_create|template_sensor_delete`,
`automation_upsert|automation_delete`, `script_upsert|script_delete`,
`undo_config_write`. **`scene_*` deferred.** Anything else ⇒ fail-closed refuse.

### 5.2 Validation order (defense-in-depth; mirrors §H1 N5)
1. **Cap-token valid — VALIDATION STEP 1, before any HA I/O** (hash == the *current*
   registered hash for `ha_devops` **and** that hash's own session is heartbeat-live;
   a stale prior-session token is refused — §2.2/§2.3) — else hard-refuse.
2. `op` ∈ supported set; never surface (c).
3. **Cause-to-fire deny** (§3.3 `fleet_enable_deny`) — refuse any of the 7 forms
   (incl. `automation.trigger`, `script.toggle`, named-script service).
4. **GET-first → create vs update + prior-body classification:** GET the existing
   object. Distinguish **create** (`prior == null`) vs **OVERWRITE** (surface to PM
   so the Telegram confirm says **"OVERWRITES existing `<alias>`"** vs **"creates
   new"**, `/review` MAJOR). **NEW-1 hard-deny:** if the target **pre-exists** AND its
   **prior body** references ANY Tier-C/Critical entity (`classifyEntity` over the
   prior body), **hard-refuse the whole upsert** (§3.4 — cannot launder a neuter of a
   safety interlock through an overwrite). A genuine create (`prior == null`) is
   unaffected; a Critical-referencing *new* draft still proceeds.
5. **Body-scan** (§4) on the resolved *new* config → `critical_refs`, `blueprint_flag`;
   honor `hard_deny` (incl. in-body cause-to-fire §4(i)).
6. **Force-inject `initial_state: false`** on automation upserts (§3.1). The §3.1
   verify→`turn_off` backstop runs **only** when this upsert is case-(a)-eligible
   (`prior == null` or non-Critical prior, §3.4) — never against a pre-existing
   Critical interlock (already refused at step 4).
7. **Capture `prior` at EXECUTE-time** (post-approval, immediately before write) +
   `prior_hash` (`/review` MAJOR — undo non-atomic fix). Not at confirm-time (stale).
8. Apply: WS command (helpers/Template-helper) or REST `POST` (automation/script).
9. **Verify** (automation): state `== off`; else `automation.turn_off` + anomaly audit.
10. **Audit** the result (§6). On **HA rejection** (post-approval 4xx/5xx, WS error):
    surface the error to PM **and write a failure audit entry** (`/review` MINOR).

### 5.3 WS auth + scoping + atomicity (MAJOR fixes)
- **WS client is command-type SCOPED — it can NEVER issue `call_service` (MAJOR-3).**
  The one-shot WS client is allowed to send **only** the enumerated config command
  types: the helper-collection commands (`input_number/create|update|delete`, …,
  `counter/*`, `timer/*`, `schedule/*`) and the Template-helper config-flow
  (`config_entries/flow/*`, `config_entries/remove`). It **must reject any other WS
  message type at the client boundary** — emphatically **`call_service`**. Otherwise
  a crafted payload (`{type:"call_service", domain:"automation", service:"turn_on"}`)
  would reach HA over WS and **bypass the REST/`classify`-gated executor and the
  `fleet_enable_deny` check entirely**. Invariant: **all service calls go through
  `executeApprovedAction`/`classify`; the WS client does config commands only.**
- **One-shot WS client** (`${HA_BASE_URL}/api/websocket`): `auth_required` →
  `{type:"auth", access_token}` → `auth_ok`, **incrementing ids**. Handle
  `auth_invalid` (⇒ rotate token, not retry), **mid-command socket drop** (timeout →
  abort → audit), and **HA restart** (reconnect once or fail-closed + audit).
- **Partial-write atomicity** (Template-helper config-flow is multi-step: start flow
  → submit step(s) → create entry): on **any** step failure, **abort and delete the
  dangling partial** (`config_entries/flow` abort / `config_entries/remove` the
  half-created entry) and **audit the partial** so no orphan config entry lingers.

### 5.4 Confirm-store sizing (MINOR)
A full automation body can be large; **verify `save_memory` value capacity won't
truncate it**. If bounded: store `{confirm_id, op, body_hash, body_ref}` in
`ha_confirm:<id>` memory and the **full body in an audit-staging side file**
(`fleet/ha_config_pending/<confirm_id>.json`), reloaded at execute-time and checked
against `body_hash`. (A truncated body that silently executes is a correctness *and*
safety bug.)

### 5.5 Executor invariants — load-bearing for the linchpin (v4 guardrail)

The cause-to-fire linchpin (§3.3) holds **only** because the executor exposes **no
raw firing primitive**. Record this as a standing constraint for any future change:

- **NEVER add a raw event-fire verb** (`POST /api/events/<event_type>`) — firing an
  event can trip a **pre-existing, enabled** automation whose trigger is
  `platform: event`, completely sidestepping the `fleet_enable_deny` enumeration and
  the body-scan (the fleet wouldn't call an automation/script service at all).
- **NEVER add an MQTT-publish path or a Supervisor/add-on service path** for the same
  reason (an MQTT message can be an automation trigger; the Supervisor API can reach
  host-level reload/restart).
- Any such addition **requires fresh `/review`** — the "no event-fire / no out-of-band
  trigger path" property is what blocks *indirectly* tripping an already-enabled
  automation, and it is invisible unless stated. The WS client's `call_service` ban
  (§5.3) is the same family of guarantee; keep them together.

---

## 6. Rollback / auditability (drift-safe — MAJOR fix)

- **Append-only `fleet/ha_config_audit.jsonl`**, one line per write:
  `{ ts, confirm_id, op, payload, prior, prior_hash, post_hash, result, created_disabled, audit_id, outcome }`.
  `confirm_id` ties the change to the exact operator approval (and via §H1 the
  Telegram reply). **Gitignored** (holds `confirm_id`s) and **detective-only — not
  tamper-proof** (`/review` MINOR; a host-compromised actor could edit it — it is an
  audit trail, not an enforcement control).
- **Drift-safe undo** (`/review` MAJOR): `prior` + `prior_hash` captured at
  **execute-time** (§5.2-7), and `post_hash` of what the executor wrote.
  `undo_config_write({audit_id})` (itself a **gated** config write through the same
  Tier-B confirm + `ha_devops` path):
  1. GET current config of the object.
  2. **If `hash(current) ≠ post_hash` ⇒ DRIFT — refuse** (someone changed it since;
     do **not** clobber). Operator resolves manually.
  3. Else apply the inverse: create→`*_delete`; update→re-apply `prior`;
     delete→re-create from `prior`. An undo of an automation also deploys
     **disabled** (the human re-enables).
- **HA-native backstop (noted, not primary):** API-created objects persist to
  `.storage`/`automations.yaml`, covered by HA's own backups — disaster fallback
  only; the audit-log inverse is the routine, confirm_id-traceable path.
- **Git-snapshot of HA config: rejected** — no HA filesystem access (same reason (c)
  is out of scope).

---

## 7. New-agent artifacts — `ha_devops`

`ha_devops` is a **runtime-deployer specialist** that owns **no source code**. It
operates the gated deploy and self-guards against fork execution.

| Artifact | Change |
|---|---|
| `.claude/skills/ha_devops/SKILL.md` | **NEW.** Scope: the *only* principal that applies live-HA mutations via the loopback executor. **Startup self-guard:** refuse any deploy when `$TASK_ROUTER_AGENT` is empty (fork). **Mode 4 only** — announce `[HA_DEVOPS]`, check inbox, idle otherwise. Result/state-brief/consolidation discipline mirrors `/ha`. **Owns:** *no source* — operational role + `doc/runbooks/ha_deploy.md`. **NEVER-touches:** `ha-bridge.js` and **all** source (that's `/ha`), all other agents' files. Presents `HA_DEVOPS_CAP_TOKEN` to the executor. |
| `.claude/rules/ha_devops.md` | **NEW.** Condensed: Mode-4-only/no-fork; cap-token deploy; force-disabled/never-enable invariant; delete-protection; audit every apply. |
| `.claude/mcp/task-router/agents.json` | **NEW row** `"ha_devops": { "capabilities":["ha-config-deploy"], "role":"specialist", "model":"claude-sonnet-4-6", "no_fork": true }` (scope = config writes only, §2.2). The **`no_fork` flag** is the machine-readable signal PM honors (disable offline→fork fallback). |
| `.claude/SKILLS.md` | Add roster row + bottom-table row for `ha_devops` (note Mode-4-only). |
| `.claude/rules/INDEX.md` | Add `/ha_devops` row → `.claude/rules/ha_devops.md`. |
| `doc/design/DOC_OWNERSHIP_MATRIX.md` | Add rows: `design/ha_config_write.md` (Primary `/ha`), `ha_devops_GUIDELINES.md` (Primary `/ha_devops`), `runbooks/ha_deploy.md` (Primary `/ha_devops`). |
| `doc/ha_devops_GUIDELINES.md` | Created lazily on first consolidation (placeholder row in matrix). |
| `CLAUDE.md` | Add `/ha_devops` to the Agent Skills invoke table; note it is **Mode-4-only, never fork** in the PM routing summary. |
| PM SKILL (`.claude/skills/pm/SKILL.md`) | Encode: (1) the **`no_fork` routing rule** — if `ha_devops` offline, **refuse + tell operator to launch**, never fork; (2) §H1 config-write confirm policy — full-body summary, `critical_refs` label, "created DISABLED" banner, OVERWRITE-vs-new wording, dispatch-approved-write-to-`ha_devops` step. |
| Launcher (`/ops` + `/app`) | The launcher that spawns `ha_devops` must **mint the cap-token, register the SHA-256 hash, and inject `HA_DEVOPS_CAP_TOKEN`** into the terminal env (federation-token pattern). |

---

## 8. Wave-ordered dispatch plan

Gates inline. **No build** until operator approval + `/review` of this v4 (final
quick re-check — NEW-1/NEW-2 + tests).

| Wave | Owner | Work | Gate |
|---|---|---|---|
| **0** | `/arch` → PM → `/review` | This v4 → PM STOPs for **operator approval** → `/review` final re-check (NEW-1/NEW-2) | ⛔ approval **and** `/review` pass before Wave 1 |
| **1** | `/ha` | `fleet/ha_whitelist.json`: `config_write` block (per-op tier floor) + **`fleet_enable_deny`** block enumerating **all 7 cause-to-fire forms** incl. `automation.trigger` + `script.toggle` (§3.3) + selectors-denied note + **disable-scope** rule data (§3.4); loader + `validateWhitelist` tests. Add **`classifyEntity()`** helper. | unit tests green |
| **2** | `/ha` | `executeConfigWrite` in `ha-bridge.js`: **cap-token check as VALIDATION STEP 1** (session-bound, before any HA I/O), supported-op set, **hardened body-scan §4** (recursive, domain-prefix, deny-template incl. `service_template`/`data_template`/templated `target`, deny-selectors, group expand-or-deny, normalize, list/string), **force-inject `initial_state:false` + verify-then-`turn_off` backstop**, GET-first create/overwrite + **disable-scope + NEW-1 overwrite-protection** enforcement (§3.4/§5.2-4), **blueprint-flag (§4(h)) — flag not deny**, **execute-time `prior`+hash capture**, **command-type-scoped one-shot WS client that can NEVER send `call_service`** (§5.3), **no event-fire/MQTT/Supervisor verb (§5.5)**, partial-write abort+delete, audit writer, drift-safe `undo_config_write`. Tests incl.: **each of the 7 cause-to-fire forms hard-refuses** (esp. `automation.trigger`, `script.toggle`); **`automation_upsert` overwriting a pre-existing Critical-referencing automation hard-refuses AND the backstop does NOT disable that pre-existing interlock** (NEW-1); **`use_blueprint` body → confirm flags "actions not shown"** (NEW-2); **in-body cause-to-fire** (`automation_upsert` whose action contains `automation.trigger`/`script.turn_on`/`script.<object_id>`) **→ body-scan hard-refuses** (§4(i)); **WS client rejects a `call_service` payload**; **disable of a pre-existing Critical safety automation hard-refuses while §3.1 backstop disable of the under-deploy object passes**; **template/selector evasions refused**; **drift undo refused**; **create-disabled verified off**; **stale prior-session cap-token refused**. | `/review` of body-scan + cause-to-fire-deny + tests green |
| **3** | `/app` | Wire the executor verb **loopback-only** into `serverHost` (attach-don't-restart, no 409) **and** the **cap-token validation** path (validate hash against the registry; **one-hash-per-agent, session-bound** per §2.2). | loopback-only + token-gated verified |
| **4** | `/ops` | **Mint + inject `HA_DEVOPS_CAP_TOKEN`** at `ha_devops` launch (federation-token pattern); register hash. HA **WebSocket** reachability + bearer config scope; env to launcher + launchd. Author `doc/runbooks/ha_deploy.md`. | host preflight |
| **5** | **`/ha_devops` bring-up** | Create `.claude/skills/ha_devops/SKILL.md` + rule + `agents.json` row (`no_fork`) + roster/INDEX/matrix/CLAUDE.md rows. Launch the terminal; verify self-guard refuses on fork. | registration + self-guard verified |
| **6** | **PM** (policy) | §H1 config-write policy: `no_fork` routing refusal, full-body + `critical_refs` + "DISABLED" + OVERWRITE wording, dispatch-to-`ha_devops` step. | folded after W2–W5 |
| **7** | `/ha_devops` (verify) | E2E through the **whole gate**: with `ha_devops` up, create `sensor.battery_state_of_health` (Template helper) → confirm `undo` removes it → confirm a **Critical-referencing automation deploys DISABLED and the fleet cannot cause it to fire** (all 7 forms refused, incl. `automation.trigger`) → confirm **config-write deploy refused when `ha_devops` is down**, while a **Tier-B service call (e.g. open a cover) still works without `ha_devops`** (scope check) → confirm a **pre-existing Critical safety automation cannot be deleted/disabled** by the fleet. | acceptance demo |

**Always-on runtime gates after build (config writes):** `ha_devops` live + session
cap-token (else zero config writes) · Tier-B Telegram confirm (full body + Critical
labels + DISABLED banner + OVERWRITE/new wording) · executor body-scan +
cause-to-fire-deny + disable-scope + force-disable + verify · audit entry · drift-safe
undo. **(Tier-B *service* calls keep their existing PM Telegram path — unchanged.)**

---

## 9. Open questions for operator — NONE

All prior open questions are **decided** and folded into the design: hard-gate scope =
config-writes-only (§2.2); cap-token = per-session token, `/review`-endorsed (§2.3);
`ha_devops` model = `claude-sonnet-4-6` (§7); config-write TTL = 600 s / ≤ 1800 s (§2.4);
`scene_upsert` deferred (§1); fleet may-disable-not-cause-to-fire (§3.3–3.4); blueprint
bodies **FLAG-not-deny** (§3.5/§4(h)); **scene-exposure hardening — operator OPTED IN**
(scenes encoding `automation.*`/`script.*` state kept off the HA MCP Server; recorded in
`doc/runbooks/ha_v1_exposure.md`, §3.5 vector 2). **Nothing remains for the operator to
decide** — v4 is build-ready pending the final `/review` quick re-check.

---

## Implementation Delegation

- **`/ha`** — `fleet/ha_whitelist.json` (`config_write` + `fleet_enable_deny`),
  `classifyEntity()`, `executeConfigWrite` + hardened body-scan + force-disable/verify
  + WS client + partial-write atomicity + execute-time-`prior` + drift-safe undo +
  audit writer, all in `ha-bridge.js`; tests in `ha-bridge.test.js`. **Builds the
  code; never mutates live HA.**
- **`ha_devops`** (new) — the runtime deployer: picks up PM's approved write, presents
  the cap-token, calls the executor; self-guards on fork; owns `doc/runbooks/ha_deploy.md`.
- **`/app`** — loopback-only `serverHost` route + **cap-token validation** wiring
  (attach-don't-restart, no 409).
- **`/ops`** — mint/inject `HA_DEVOPS_CAP_TOKEN` (federation-token pattern), register
  hash; HA WS reachability + token scope + env to launcher/launchd; deploy runbook.
- **PM** — `no_fork` routing refusal for `ha_devops`; §H1 config-write confirm
  policy; on approval, fold this design into `doc/design/ha_integration.md`, add the
  matrix rows, create the roster/INDEX/CLAUDE.md `ha_devops` rows, flip
  `doc/ha_GUIDELINES.md` Q-HA-CONFIGWRITE OPEN → RESOLVED.

---

## Doc-matrix proposal (PM applies on approval)

Add to `doc/design/DOC_OWNERSHIP_MATRIX.md §1`:

| Document | Type | Primary | Secondary | Notes |
|---|---|---|---|---|
| `design/ha_config_write.md` | design | `/ha` | `/pm`, `/ha_devops` | Gated HA config-write (draft-disabled, human-enables); two-layer `/ha`+`ha_devops`; hard gate + body-scan + drift-safe undo. |
| `ha_devops_GUIDELINES.md` | reference | `/ha_devops` | `/pm` | Durable guidelines for the runtime deployer (created on first consolidation). |
| `runbooks/ha_deploy.md` | reference | `/ha_devops` | `/ha`, `/ops`, `/pm` | Operator runbook: launch `ha_devops`, deploy flow, enable-by-hand step, undo. |

---

## Cross-doc reconciliation note

This design **extends** `ha_whitelist_gate.md` (a config-write dimension + the
`ha_devops` runtime layer + the fleet **cause-to-fire** deny) and **does not change**
any existing service-call tier, the Critical floor, or §H1 N1–N6 (it reuses them,
incl. the `ha_confirm:` keyspace). The hard gate is **scoped to config writes only**
— Tier-B service calls keep their existing PM Telegram path unchanged. On approval,
PM folds the config-write + hard-gate summary into `doc/design/ha_integration.md`
§Safety boundary alongside the three-tier pointer.
