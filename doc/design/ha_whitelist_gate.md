# HA Whitelist & Confirmation Gate — Q-HA-WHITELIST

> **Status: PROPOSED** (authoritative `/arch` design — 2026-06-09)
> Supersedes the "to-be-finalized" stubs in `doc/design/ha_integration.md`
> §Outbound safety boundary and §Inbound action whitelist. Those live docs are
> updated by PM **only after operator approval + `/review`** — this doc is the
> proposal, not the merge.

## Abstract

**TL;DR:** A layered, default-deny safety gate for Home-Assistant actions. Tier
membership maps directly onto **which path can physically reach an entity**:
auto-allow → exposed on the HA MCP Server (fast raw path); confirm-required →
reachable *only* through a gated code chokepoint that runs a Telegram approval
round-trip; default-deny → no path at all. Enforcement is defense-in-depth
across three layers because the raw MCP path has no code chokepoint.

**Load when:** HA confirmation gate, whitelist, `[HA REQUEST]`, `[HA CONFIRM]`,
destructive HA action, Critical entity, breaker/lock/alarm, Telegram confirm,
default-deny, confirm timeout, Q-HA-WHITELIST.

**Owner:** `/arch` (this proposal) → `/ha` (entity map + broker), `/app` (wiring),
`/ops` (exposure runbook + secrets). **Related:** `doc/design/ha_integration.md`,
`doc/ha_GUIDELINES.md`, PM SKILL §"HA inbound mediation (H1)", `.claude/rules/ha.md`.

---

## 1. The core problem (why tool-level gating is impossible)

Three verified constraints (live entity + tool scan, 2026-06-09) shape the whole design:

1. **`HassTurnOn`/`HassTurnOff` target by name / area / *domain*.** The *same tool*
   is harmless on `light.office` and catastrophic on `switch.main_breaker` or the
   `switch.main_entrance_lock` relay. Note the real attack surface: the live
   exposed tool set has **no `lock` or `alarm` intent** — `lock.*` / `alarm_control_panel.*`
   are not directly controllable via the MCP tools at all. The danger on the MCP
   path is the generic `HassTurnOn/Off` reaching **`switch.*` relays** (several of
   which *are* breakers, valves, and door/lock relays — see constraint 3), plus
   `cover.*`, `climate.*`, `vacuum.*`, and the custom `set_shutters_to_min_light`
   tool. ⇒ Classification **must** be at **(domain, service, entity)** granularity.
   Tool-level allow/deny is useless.

2. **There is no code chokepoint on the raw MCP path.** Claude Code (the
   Majordomus PM process) calls `Hass*` tools directly over the `home-assistant`
   SSE MCP server. *Nothing intercepts.* A confirmation broker physically cannot
   block a call that never passes through code. ⇒ The **only hard control on the
   raw MCP path is what HA exposes to the MCP Server.**

3. **Several `switch.*` entities are high-consequence** despite the folk rule
   "switch = safe": `Main Breaker`, `PV Contactor`, `Charger Breaker`,
   `All Doors Lockdown`, `Evacuation`, `Main Entrance Lock`,
   `Main Water Control Water Valve`, `Visonic P1 *`, intercom `Door 1 relay`.
   ⇒ The taxonomy needs an **entity-level Critical override**, not just domain tiers.

**Design principle that resolves all three:** *don't trust the caller not to
call the dangerous tool — deny the dangerous path the tool entirely.* Tier
membership decides the **reachability path**, so confirmation is enforced by
construction rather than by judgment.

---

## 2. Layered enforcement model (defense in depth)

| Layer | Mechanism | Hardness | Covers |
|-------|-----------|----------|--------|
| **L0 — HA-side exposure** | Which entities the HA *MCP Server* integration exposes | **HARD** (only control on raw MCP path) | All outbound MCP-path calls |
| **L1 — PM-skill policy** | PM classifies `[HA REQUEST]` & its own outbound intents by (domain, service, entity); acts / confirms / denies | **SOFT** (model judgment) | Inbound mediation + PM's outbound decisions |
| **L2 — Confirm correlation + executor** | PM correlates the operator's reply (pending record in PM server-memory; §6) and, on a valid in-window APPROVE, invokes the **loopback ha-bridge executor**, which re-checks the whitelist and issues the HA REST call | **HARD** for execution (only path to Tier-B entities); **SOFT** for the correlation decision (PM policy) | Confirm-required actions |

**Critical consequence:** the only *hard* control is the execution path, not the
confirmation logic. Confirm-required entities are **deliberately *not* exposed on
the MCP Server** (so the raw `Hass*` path cannot reach them); their **only**
execution path is the loopback ha-bridge executor, which fires solely inside PM's
APPROVE branch. This is why tier == path. (The correlation itself is PM policy —
L1 soft — because the bridge forces it there; see §6.)

```
                         ┌─────────────────── Majordomus PM (Claude Code) ───────────────────┐
 OUTBOUND                │                                                                    │
   Tier A ──────────────►│ raw MCP tool  Hass*  ──────────────────► HA MCP Server (SSE) ─────┼──► HA
   (auto-allow)          │   (no gate; L0 exposure is the boundary)                           │
                         │                                                                    │
   Tier B ──────────────►│ save pending (PM mem) ─► prompt via dispatch→telegram (notify)     │
   (confirm-required)    │   …operator reply (new to=pm task)─► PM correlates (§6)            │
                         │        │ APPROVE+in-window ─► loopback ha-bridge executor           │
                         │        │                       └► POST /api/services/… ────────────┼──► HA
                         │        │ deny / expired / unknown ─► withheld (fail-closed, M6)     │
                         │                                                                    │
   Tier C ──────────────►│ control: no path (not exposed, not bridged) ─► declined            │
   (default-deny)        │ read:  HA REST GET /api/states/<id> still works (W2) ──────────────┼──► HA
                         └────────────────────────────────────────────────────────────────────┘
```

---

## 3. Taxonomy — three tiers + Critical override

**Decision precedence (most specific wins):**

1. **Critical-entity list — a hard Tier-C *floor*.** A Critical entity is Tier C
   (default-deny). **M7:** a per-entity *allow* override can **never** lift a
   Critical-listed entity below Tier C — the resolver MUST ignore allow-overrides
   for Critical entities. The *only* way to move a Critical entity is a distinct,
   audited `promote_critical` field that raises it to **Tier B (confirm-required)**;
   never to Tier A. That field lives **only** in the change-controlled
   `fleet/ha_whitelist.json` (operator-edited, reviewed in git) — it is never settable
   at runtime or via a request. A generic deny-override may still apply (it can only
   tighten).
2. **Per-entity allow/deny override** (e.g. a trusted `script.goodnight`) — applies
   to **non-Critical** entities only (see #1).
3. **Domain default tier** (tables below).
4. **Fallback for anything unknown → Tier C (default-deny).**

### 3.1 Tier A — Auto-allow (immediate, no confirmation)

Reads and low-consequence comfort/annoyance actions. **Exposed on the MCP Server.**

| Domain / capability | Live tools | Rationale |
|---|---|---|
| Read / context | `GetLiveContext`, `GetDateTime` | Read-only, no side effects |
| `light.*` | `HassTurnOn`/`Off` (light targets), `HassLightSet` | Reversible, low stakes |
| `scene.*` (whitelisted) | `HassTurnOn` (scene) | Curated convenience scenes |
| `input_boolean.*` | `HassTurnOn`/`Off` | Soft flags |
| `fan.*` (non-critical) | `HassFanSetSpeed`, `HassTurnOn`/`Off` | Comfort; *unless Critical* |
| `media_player.*` | `HassMedia*`, `HassSetVolume(Relative)`, `HassMediaPlayer(Un)Mute` | Annoyance class ¹ |
| Broadcast / notify | `HassBroadcast`, `notify.*` | Annoyance class |
| Cover **STOP only** | `HassStopMoving` | Abort is always safe — never *opens* anything |
| `switch.*` **minus Critical list** | `HassTurnOn`/`Off` (switch) | Lights/plugs; Critical entities elevated to C |
| Timers | `HassCancelAllTimers` | Low consequence ² |

¹ ²: see Open Decisions (night-time volume blast; timer cancellation collateral).

### 3.2 Tier B — Confirm-required (Telegram operator approval before acting)

Physical / comfort / cost / arbitrary-side-effect actions. **NOT exposed on the
MCP Server** — reachable only via the ha-bridge chokepoint (L2).

| Domain / capability | Live tools | Rationale |
|---|---|---|
| `cover.*` open/close/position | `HassSetPosition`, `set_shutters_to_min_light` ³ | Garage doors, gates, shutters — physical/security |
| `climate.*` setpoints & mode | `HassClimateSetTemperature` | Comfort, energy cost, equipment stress |
| `vacuum.*` ⁴ | `HassVacuumStart`, `HassVacuumCleanArea`, `HassVacuumReturnToBase` | Physical (pets, cables, noise) |
| `script.*` / `automation.*` (non-whitelisted) | `HassTurnOn` (script) | Arbitrary side effects |
| `fan.*` **if Critical** (e.g. extraction tied to safety) | — | Critical override |
| **Any Critical entity explicitly promoted by operator** | `HassTurnOn`/`Off` | Per-entity opt-in only |
| **Any cross-project write/execute** (federation) | — | Already PM policy (second gate) |

³ **W3 — `set_shutters_to_min_light` is a currently-live *custom* MCP tool**, not a
generic `Hass*` intent — it does not match a `Hass*` name filter and is easy to
miss when pruning exposure. The v1 runbook (§8) MUST explicitly un-expose it; a
"un-expose all `Hass*` destructive tools" sweep would leave it live. It is a mass
cover action → Tier B. Open Decision: operator may want it as an auto scene.
⁴ Vacuum tier is an Open Decision (nuisance-auto vs confirm).

### 3.3 Tier C — Default-deny (no path; explicit per-action opt-in to ever allow)

Security-critical and irreversible-consequence. **Neither exposed nor bridged.**
No remote path exists in v1/v2. May graduate to Tier B per-entity only by
explicit operator design + `/review`.

| Domain / capability | Why deny |
|---|---|
| `alarm_control_panel.*` (arm/disarm) | Security system (no MCP intent anyway — control denied) |
| `lock.*` unlock | Physical access control (no MCP intent anyway — control denied) |
| **Critical `switch.*` list** (below) | Catastrophic / safety / security |
| Any unknown / unclassified domain | Fail-closed default |

**Critical-entity list (v1 — operator MUST finalize):** `switch.main_breaker`,
`switch.pv_contactor`, `switch.charger_breaker`, `switch.all_doors_lockdown`,
`switch.evacuation`, `switch.main_entrance_lock`,
`switch.main_water_control_water_valve`, `switch.visonic_p1_*` (all),
intercom `switch.door_1_relay`. *(Object-ids are indicative — operator confirms
exact `entity_id`s and hunts for siblings: other breakers, valves, locks, relays.)*

**M5 — wildcard handling:** `switch.visonic_p1_*` is a glob. The `fleet/ha_whitelist.json`
resolver (§7) MUST be **glob-capable** (trailing-`*` prefix match on `entity_id`),
**or** the operator enumerates the exact `entity_id`s. A non-glob resolver fed a
`*` pattern silently matches nothing — i.e. silently de-classifies Critical
entities — so the loader MUST reject a `*`-containing entry unless glob support is
on. (Decision flagged in §7 schema.)

**W2 — Tier C still allows READS via REST.** Un-exposing a Tier-C entity from the
MCP Server removes it from the MCP tool surface entirely — including *read*
visibility (`GetLiveContext` no longer reports it). That does **not** blind
Majordomus: the HA **REST** API `GET /api/states/<entity_id>` (bearer token) is an
**independent read path** that survives un-exposure. So Tier C means *deny control,
permit read via REST* — PM can still answer "is the alarm armed? / is the main
breaker on?" through a REST state read even though the corresponding control is
denied. (The REST read path is the same one `.claude/rules/ha.md` documents for
outbound reads; the v1 runbook wiring is `/ops`'s, but the design relies on it.)

---

## 4. Enforcement Point 1 — Inbound `[HA REQUEST]` mediation (PM runtime gate)

HA automation/Assist → `POST /api/dispatch` (to `pm`) or HA MCP-client → `/mcp`,
tagged `[HA REQUEST]`. PM is the L1 gate. PM resolves the requested action to
`(domain, service, entity)` and applies the taxonomy:

```
[HA REQUEST] arrives (tagged)
   │
   ├─ resolve → (domain, service, entity)
   │
   ├─ entity ∈ Critical list? ───────────────► Tier C  ─┐
   ├─ per-entity override? ──────────────────► that tier │
   ├─ else domain default tier                           │
   │                                                      ▼
   ├─ Tier A (read/status/auto) ─────► ACT NOW (read → reply; write → call tool/bridge)
   ├─ Tier B (confirm-required) ─────► confirm correlation flow (§6); APPROVE→execute, deny/expire/unknown→withhold
   └─ Tier C (default-deny) ─────────► DECLINE (control); reads still answerable via REST (W2)
```

- **Read / status** (`GetLiveContext`, REST `GET /api/states/<id>`, state queries) →
  answer immediately, no gate — including reads of Tier-C entities via REST (W2).
- **Tier B** → PM does **not** "decide and act" in one turn; it stages a pending
  confirm and acts only on a valid in-window APPROVE reply (§6).
- **Tier C** → control declined with a one-line reason; never silently dropped.
- **Cross-project** writes embedded in an `[HA REQUEST]` inherit the federation
  second-gate (still Tier B at minimum).

## 5. Enforcement Point 2 — Outbound destructive calls (path routing)

PM's own outbound intents (and any inbound request that resolved to a write) are
gated by **which path the tier permits**:

```
outbound intent → (domain, service, entity) → tier
   │
   ├─ Tier A → exposed on MCP Server → call Hass* directly (raw path, fast)
   ├─ Tier B → NOT on MCP Server → stage confirm (§6); on APPROVE → loopback ha-bridge
   │              executor → POST /api/services/<domain>/<service>
   │              deny / expire / unknown → withheld, report to caller
   └─ Tier C → control: no path (not exposed, not bridged) → declined; read via REST (W2)
```

The hard guarantee: **a Tier-B/C entity is never exposed on the MCP Server**, so
even a mis-classifying PM turn *cannot* reach it via a raw `Hass*` call — the only
execution door is the loopback ha-bridge executor, which re-checks the whitelist
before issuing the REST call (defense in depth).

---

## 6. Confirmation correlation (PM-as-correlator — Task-Router-native)

> **Revised (C1).** The earlier "dispatch `[HA CONFIRM]` to `telegram` and read its
> result via `wait_for_result`" design **does not work** against the real bridge,
> verified in `.claude/mcp/telegram-bridge/bot.js`:
> 1. The bridge **auto-completes any `to=telegram` task on delivery** (`pollResponses`
>    → `POST /api/complete/<task_id>` with result `"delivered to telegram"`,
>    bot.js:317). So `wait_for_result` resolves *instantly* with a delivery ack —
>    never APPROVE/DENY. The TTL/default-deny path would never fire.
> 2. The operator's reply comes back as a **brand-new inbound `to=pm` task** carrying
>    the raw text (bot.js:269–274) — **uncorrelated** to any confirm.
>
> ⇒ A `to=telegram` task can only be a **prompt (notification)**; it can never carry
> a decision back. And because every operator reply lands in **PM's** inbox as fresh
> free text, **PM is structurally the only component that can correlate it.** This is
> forced by the bridge, not a design preference.

### 6.1 Scope-boundary resolution (the question PM asked)

**Can correlation be done with existing Task Router primitives + Majordomos-owned
code, WITHOUT modifying `bot.js`? — YES.** Per the operator steer (the
telegram-bridge is a Task-Router component, *not* a general-purpose channel; do
**not** bolt on a bespoke confirm store + a new `/api/ha/confirm` endpoint), the
design uses only:
- **PM server-managed memory** (`save_memory` / `load_memory` — the Task Router's
  own per-agent runtime-state primitive, the use it is explicitly reserved for) as
  the pending-confirm store. *Not* a bespoke subsystem; *not* a new endpoint.
- **PM reply-parsing** for correlation (forced by the bridge).
- A **Majordomos-owned executor** (the ha-bridge module, `/ha`) that performs the
  approved HA REST call — invoked by PM over **loopback only**.

`bot.js` is **not modified**, and **no new Task-Router *server* endpoint** is added.
The inbound `[HA REQUEST]` and the operator reply both arrive through the
**existing** `POST /api/dispatch → to=pm` path; the prompt goes out through the
**existing** dispatch-to-`telegram` path. ✔ within Majordomos module ownership.

> **Out-of-scope alternative (flagged, not assumed):** making the operator reply
> resolve a *literal originating task object* in the router (review's option b proper)
> would require `bot.js` to dispatch replies as a *resolution of a prior task* rather
> than as a fresh `to=pm` task — a **Task-Router-seed change** outside Majordomos's
> module ownership. It is **not** needed; recorded here only so PM can route it as an
> optional future seed enhancement if ever desired.

### 6.2 Flow (identical for inbound `[HA REQUEST]`→Tier B and PM-initiated outbound Tier B)

```
PM turn (classify → Tier B)        existing /api/dispatch + bot.js        operator (Telegram)
  │ mint confirm_id = ≥64-bit CSPRNG hex (N1)   │                                   │
  │ save_memory("ha_confirm:<id>",             │                                   │
  │   {action,origin,requested_by,                │   (pending store = PM memory)     │
  │    created_at, expires_at}) (server time N3) │                                   │
  │ dispatch_task(to="telegram",               │                                   │
  │   "[HA CONFIRM <id>] <summary>.            │                                   │
  │    Reply APPROVE <id> / DENY <id>          │                                   │
  │    (expires N min)") ──────────────────────►│ ── deliver + AUTO-COMPLETE ──────►│   (prompt only;
  │ … PM turn ENDS (no blocking wait) …         │   (we never read its result)      │    decision NOT here)
  │                                             │◄── "APPROVE <id>" (new to=pm task)┤
  │ inbound reply arrives in PM inbox           │   from_agent="telegram"           │
  │ GATE: from_agent=="telegram" AND payload matches ^(APPROVE|DENY) <id>$ ?  (N2)  │
  │   else (incl. any [HA REQUEST]-tagged payload) → NOT a confirm reply, ignore     │
  │ load_memory("ha_confirm:<id>"):             │                                   │
  │   not found / resolved → "unknown/handled — ignored", STOP            (M6)      │
  │   reply.created_at ≥ rec.expires_at → delete, "expired", STOP  (server time, N3)│
  │   DENY                  → delete, "cancelled", STOP                              │
  │   APPROVE & in-window   → delete record FIRST (N4), THEN invoke executor:        │
  │                            POST /api/services/<domain>/<service> ──────────────► HA
  │                            relay "Done <id>: <result>" ─────────────────────────► operator
```

### 6.3 Where pending state lives, and why it's fail-closed

- **Pending-confirm store = PM server-managed memory** (`save_memory`/`load_memory`),
  keyed `ha_confirm:<confirm_id>`, value `{action:{domain,service,entity,data},
  origin (inbound|outbound), requested_by, created_at, expires_at}`. Server-side ⇒
  survives PM restarts/compaction; the action text is **never** placed anywhere that
  auto-executes.
- **N1 — `confirm_id` is a secret capability, so it must be unguessable.** Approval
  reduces to *"a `APPROVE <id>` task lands at `pm` for a live `id`"*; anyone able to
  `POST /api/dispatch` (LAN/Tailscale + `TASK_ROUTER_API_KEY`, G3) could otherwise
  brute-force a short id inside the 120–300 s TTL — and the executor's whitelist
  re-check does **not** stop this (a brute-forced id targets an already-Tier-B
  action). **Mint `confirm_id` with ≥64-bit cryptographic entropy** (CSPRNG hex/UUIDv4).
  Treat repeated APPROVE attempts against **unknown** ids as hostile: rate-limit /
  log them. N1 is a *hard* part of the operator-facing guarantee, not a nicety.
- **N2 — channel-bind the reply (confused-deputy fix).** Inbound `[HA REQUEST]`s also
  land at `pm`; without binding, an HA-originated request could emit `APPROVE <id>`
  and **self-approve** the Tier-B action it just staged. A payload is a valid confirm
  reply **only when both** hold: (1) `from_agent == "telegram"` — the authenticated
  operator channel (`bot.js` accepts only `ALLOWED_USER` and stamps `from:'telegram'`);
  **and** (2) the payload matches `^(APPROVE|DENY)\s+<id>$`. **A payload carrying the
  `[HA REQUEST]` tag is NEVER treated as a confirm reply**, regardless of text.
  N1 + N2 **together** close the brute-force *and* the spoof vector.
- **Fail-closed by construction.** The HA action is *not* staged for execution
  anywhere — it runs **only** inside the APPROVE branch of a reply handler, against a
  found-and-unexpired record passing the N2 gate. Therefore:
  - **No reply ever ⇒ the record simply lapses and the action never runs.** That *is*
    default-deny-on-timeout — achieved by gating execution behind an explicit future
    approval, not behind a blocking wait (which the bridge makes impossible).
  - **N3 — TTL compared against server time, not PM's eyeballed "now".** Compare the
    reply task's server-stamped `created_at` against the record's `expires_at`
    (record's server `created_at`/`updated_at` + TTL). A **late** APPROVE
    (`reply.created_at ≥ expires_at`) is inert.
  - **N4 — delete-before-execute (stated invariant):** in the APPROVE branch, **delete
    the pending record FIRST, then invoke the executor.** A rare crash between delete
    and execute loses that one approval (operator re-issues) — acceptable, because it
    fails *closed*. Never execute-then-delete (that risks double-execution on retry).
  - **M6:** an APPROVE/DENY whose `confirm_id` has no live record (unknown, already
    handled, or expired) is **discarded with an "unknown/expired confirmation" notice
    — never acted on.** Approvals are **single-use** (deleted on first handling, N4) to
    prevent replay.
- **TTL defaults:** **120 s** interactive inbound, **300 s** PM-initiated outbound
  (operator may be away). *(Open Decision — operator tunes.)* PM also opportunistically
  sweeps expired `ha_confirm:*` records when it next runs a confirm handler (and on
  startup — N6, §7).
- **One confirm = one action.** No "approve all". A batch/scene is a single Tier-B
  item only if it maps to one whitelisted scene entity.

### 6.4 Hardening note (acknowledged limitation)

Because the correlation lives in PM policy (L1, soft) rather than a code chokepoint,
a confirm reply is only as reliable as PM honoring §6.3 (N1–N4). The **hard** guarantees
still hold independently: Tier-B/C entities are **never exposed on the MCP Server** (L0),
so PM physically *cannot* execute one via a raw `Hass*` tool — the **only** execution
path is the loopback ha-bridge executor.

**N5 — what the executor can and cannot verify.** The executor **cannot** itself confirm
that the operator approved an action — approval lives in PM's correlation, which the
executor does not see. What it *does* enforce, by re-running the whitelist on its own
input: it **hard-refuses** any action that is Tier C, Critical-listed, on an unknown/
unclassified entity, or whose tier doesn't match what should be reachable — independent
of any "approved" claim. For the Tier-B *approval bit specifically*, the executor
**trusts PM's invocation** (it is loopback-only, G3, so only the local PM process can
call it). So: executor = a hard floor against mis-classification and out-of-policy
targets; PM correlation (N1–N4) = the operator-approval gate. Neither alone is the whole
control; together they are defense in depth.

---

## 7. Pure-PM-policy vs must-be-BUILT

### Pure PM policy (no code — lives in PM SKILL + this doc)
- Tier classification of inbound `[HA REQUEST]` by (domain, service, entity).
- The act / confirm / decline decision and operator-facing wording.
- **The whole confirm correlation (§6):** mint a **≥64-bit CSPRNG `confirm_id`** (N1),
  `save_memory` the pending record (server-time `created_at`/`expires_at`, N3), send the
  prompt via dispatch→telegram, parse the operator's reply **only when it passes the N2
  channel gate** (`from_agent=="telegram"` AND `^(APPROVE|DENY) <id>$`, never an
  `[HA REQUEST]` payload), enforce server-time TTL / single-use / **delete-before-execute
  (N4)** / **M6** (discard unknown/expired; rate-limit unknown-id attempts, N1), and
  invoke the executor only on a valid in-window APPROVE.
- **N6 — on PM startup, sweep `ha_confirm:*`** and drop expired records (safety-neutral —
  stale records are rejected on load anyway — but avoids cruft).
- Cross-project federation second-gate (already in place).

### Must be BUILT
| Owner | Build item | Files |
|---|---|---|
| **/ha** | Canonical tier map + Critical list as **data** (`fleet/ha_whitelist.json`), schema + loader. **M5:** schema MUST declare glob support (trailing-`*` prefix match) for entity entries, and the loader MUST **reject** a `*`-containing entry when glob support is off (never silently match nothing) | `majordomus-daemon/src/ha-bridge.js`, new `fleet/ha_whitelist.json` |
| **/ha** | **Loopback ha-bridge executor** — invoked by PM (CLI or loopback-only route; **no `ha` worker agent exists at runtime — Majordomos spawns only PM**). Given an action it **re-checks the whitelist** (defense in depth, incl. Critical floor / M7) and **hard-refuses** anything Tier C / Critical / unknown / not-reachable-by-policy. It **cannot** verify operator approval (N5) — for the Tier-B approval bit it trusts PM's loopback invocation (G3). On a permitted action it issues `POST ${HA_BASE_URL}/api/services/<domain>/<service>` with the bearer token | `ha-bridge.js`, `majordomus-daemon/test/ha-bridge.test.js` |
| **/ha** | `(domain,service,entity)` resolver + precedence engine (Critical **floor** > non-Critical override > domain > deny; glob-aware) — shared by classification and the executor's re-check | `ha-bridge.js` |
| **/app** | If the executor is exposed as a route, wire it **loopback-only** into `serverHost` (G3 owner-endpoint tier; attach to live server, no double-start / 409). If it is a CLI, no server change | `majordomus-daemon/src/serverHost.js` |
| **/ops** | **v1 exposure runbook**: operator un-exposes Tier B + C from the HA MCP Server — **incl. the custom `set_shutters_to_min_light` tool (W3)**; document in host_ops | `doc/host_ops.md` |
| **/ops** | Ensure `HA_BASE_URL`/`HA_TOKEN` + telegram `.env` reach the process (launcher + launchd plist) | `host/provision.sh`, launchd plist |

**No `bot.js` / Task-Router *server* change is required** (see §6.1). The pending
store is PM `save_memory`; inbound/reply/prompt all use existing dispatch APIs.

---

## 8. Phased rollout

### v1 — Close the live gap NOW (zero code)
Operator **un-exposes Tier B + Tier C** domains/entities from the HA MCP Server
integration, leaving **only Tier A** exposed (reads + light/scene/input_boolean/
fan/media/notify + `switch.*` minus Critical). The raw MCP path becomes
physically safe with no Majordomus code. **Closes the verified live safety gap.**
- **Capability cost:** no remote *control* of cover / climate / vacuum until v2
  (lock / alarm were never MCP-controllable — no such intent exposed).
  *(Open Decision — operator accepts the trade-off.)*
- **Reads survive (W2):** un-exposing also drops these entities from MCP *read*
  visibility, but the HA REST `GET /api/states/<entity_id>` path is unaffected — PM
  can still read Tier-B/C state (alarm armed? breaker on?) via REST.
- **Action for /ops + operator:** prune the MCP Server entity exposure to Tier A —
  **including the custom `set_shutters_to_min_light` tool (W3), which is not a
  `Hass*`-named intent and is easy to miss**; verify with a `GetLiveContext` scan
  that no Tier-B/C entity *and no destructive custom tool* remains callable.

### v2 — Build the executor + correlation (re-enable Tier B safely)
Implement the PM confirm-correlation flow (§6: `save_memory` pending store, reply
parsing, TTL/M6) + the loopback ha-bridge executor and the data tier map (§7) — **no
`bot.js`/server change** (§6.1). Re-enable Tier B **through the gated executor only**
— *never* by re-exposing those entities on the MCP Server. Tier C stays denied.
- Acceptance: a Tier-B request sends a Telegram prompt and PM ends its turn; a later
  `APPROVE <id>` reply executes (via the loopback executor); `DENY`, an expired
  `confirm_id`, or an unknown `confirm_id` all withhold and notify (M6); no reply at
  all ⇒ never executes (fail-closed); no Tier-B entity is reachable via a raw `Hass*`
  call; the executor refuses any action its own whitelist re-check rejects.

### v3 — Policy refinement (optional)
Time-of-day rules (vacuum/media quiet hours), confirm-fatigue tuning, an audit
log of every confirm decision, per-entity graduation of selected Tier-C items to
Tier B by explicit operator opt-in.

---

## 9. Open Decisions (need the operator)

1. **Vacuum tier** — Tier A (nuisance, auto) or Tier B (confirm)? Default proposed: **B**.
2. **Media / volume at night** — auto (Tier A) risks a 2 a.m. volume blast. Quiet-hours rule (v3) or confirm after hours?
3. **v1 capability-loss acceptance** — OK to lose remote *control* of climate/cover/vacuum until v2 ships? (lock/alarm were never MCP-controllable; reads of all still work via REST.)
4. **Critical-list finalization** — confirm the listed `entity_id`s and hunt siblings (other breakers, valves, lock relays, door relays, `visonic_p1_*` members). Confirm whether the resolver ships with glob support (M5) or you enumerate exact ids.
5. **lock / alarm graduation** — should `lock.*`/`alarm_control_panel.*` ever become controllable (would require exposing a lock/alarm intent + Tier-B/confirm), or stay control-denied permanently (read-only via REST)?
6. **`set_shutters_to_min_light`** — keep Tier B (cover) or promote to an auto convenience scene (Tier A)?
7. **Confirm TTLs** — accept 120 s inbound / 300 s outbound, or tune?

---

## Implementation Delegation

- **/ha** — Owns the gate's data + code: `fleet/ha_whitelist.json` (tier map +
  Critical list schema, **glob-aware per M5**), the `(domain,service,entity)`
  resolver with precedence (Critical floor / M7), and the **loopback ha-bridge
  executor** (whitelist re-check → HA REST `POST /api/services/...`). The confirm
  correlation itself is **PM policy, not /ha code** (the bridge forces it there —
  §6). Tests in `ha-bridge.test.js`.
- **/app** — If the executor is a loopback route, wire it into `serverHost`
  (attach-don't-restart, loopback-only, never double-start/409). If it is a CLI,
  no `serverHost` change.
- **/ops** — v1 exposure-pruning runbook (operator un-exposes Tier B/C on the HA
  MCP Server) in `doc/host_ops.md`; secrets/env (`HA_*`, telegram `.env`) reach
  both the launcher and the launchd always-on path.
- **PM** — After operator approval + `/review`: fold the finalized tables into
  `doc/design/ha_integration.md` (replacing the stubs) and the policy summary into
  PM SKILL §H1; update `doc/ha_GUIDELINES.md` Q-HA-WHITELIST from OPEN → RESOLVED.

---

## Cross-doc reconciliation note

This proposal **refines** `doc/design/ha_integration.md`'s current tiers: that doc
lists `switch.*` and `scene.*` in the *first-expose* set. This design keeps them
Tier A **except Critical `switch.*`** (elevated to C) and **non-whitelisted
`script.*`/scene** (Tier B). On approval, PM replaces §Outbound safety boundary
and §Inbound action whitelist with the §3 tables above.
