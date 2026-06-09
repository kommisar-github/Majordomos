# HA MCP Server — v1 Exposure-Pruning Runbook

## Abstract

**TL;DR:** Zero-code operator runbook to close the live safety gap: un-expose Tier B (confirm-required) and Tier C (default-deny) entities from the HA MCP Server integration, leaving only Tier A (auto-allow) reachable via the raw MCP path.

**Load when:** HA MCP Server exposure, prune entities, un-expose, Tier B, Tier C, whitelist, v1 rollout, set_shutters_to_min_light, GetLiveContext verification, ha_whitelist_gate, exposure runbook, critical switch, cover climate vacuum lock alarm

**Key facts:**
- One-time operator action in the HA UI — no code changes required.
- After pruning, destructive HA actions are physically unreachable via the MCP path (not just blocked by policy).
- Un-exposing Tier C entities removes MCP-path READ access too; use the REST path (§4) for state reads on those entities.
- `set_shutters_to_min_light` is a custom tool name — it will NOT appear as a standard entity in domain filters. Hunt it explicitly (§3.4).

**Owner:** `/ops`
**Related:** `doc/design/ha_whitelist_gate.md`, `doc/design/host_ops.md`, `.claude/rules/ha.md`

---

## 1. Goal and safety rationale

The HA "Model Context Protocol Server" integration exposes HA entities as MCP tools to the Majordomus PM process. As of 2026-06-09, the full entity set is exposed — including destructive domains (locks, alarms, breakers, cover/shutters). Because the raw MCP tool path has **no code chokepoint** (design §1), neither PM policy nor a confirmation broker can block a call that never passes through code.

**The only hard control on the raw MCP path is HA-side exposure (Layer 0).**

v1 closes this gap by pruning: only Tier A (safe, auto-allow) entities remain exposed. After pruning, no Tier B or Tier C entity can be reached via a `Hass*` MCP call, regardless of PM behaviour. v2 will add a code-based broker (ha-bridge chokepoint + Telegram confirmation round-trip) to re-enable Tier B safely.

**Capability cost (accepted trade-off):** until v2 ships, there is no remote climate / cover / lock / vacuum / alarm path. Confirm acceptance to PM as Open Decision #3 once this runbook is complete (§7).

---

## 2. What stays vs what goes — tier summary

| Tier | Action | Domains / entities |
|---|---|---|
| **A — KEEP exposed** | Leave as-is | `light.*`, `scene.*` (whitelisted), `input_boolean.*`, `fan.*` (non-Critical), `media_player.*`, `notify.*`, `switch.*` **minus Critical list** (§6), `GetLiveContext`, `GetDateTime`, `HassCancelAllTimers`, `HassStopMoving` |
| **B — UN-EXPOSE** | Remove from exposure | `cover.*` (open/close/position), `climate.*`, `vacuum.*`, `script.*` / `automation.*` (non-whitelisted), Critical `fan.*`, **`set_shutters_to_min_light`** |
| **C — UN-EXPOSE** | Remove from exposure | `alarm_control_panel.*`, `lock.*`, Critical `switch.*` entities (§6), any unknown / unclassified domain |

Decision precedence (most specific wins): Critical-entity list → per-entity override → domain default → fallback Tier C (fail-closed).

---

## 3. Step-by-step: pruning in the HA UI

### 3.1 Open the entity exposure list

1. In Home Assistant, navigate to **Settings → Voice assistants**.
2. Click the **"Expose"** tab at the top of the page.
3. You will see every entity currently exposed to Assist (and the MCP Server integration).

### 3.2 Un-expose Tier B — confirm-required domains

For each domain below, filter the exposure list and toggle **off** every entity in that domain.

**`cover.*` — shutters, blinds, garage doors, gates**
Search or filter by "cover" and un-expose all `cover.*` entities.
These are physical/security actions (opening a door, raising a gate) that require operator confirmation.

**`climate.*` — thermostats and HVAC setpoints**
Filter by "climate" and un-expose all `climate.*` entities.
Remote setpoint changes carry energy cost and equipment stress risk.

**`vacuum.*` — robot vacuums**
Filter by "vacuum" and un-expose all `vacuum.*` entities.
Open Decision #1 (nuisance-auto vs confirm) is unresolved — default to un-exposed until decided.

**`script.*` and `automation.*` — non-whitelisted scripts**
Filter by "script" and "automation". Un-expose ALL unless you have a curated whitelist of verified safe convenience scripts. When uncertain, remove all — individual scripts can be re-exposed after explicit operator review.

### 3.3 Un-expose Tier C — default-deny domains and Critical entities

**`alarm_control_panel.*` — security panels**
Filter by "alarm_control_panel" and un-expose everything.
Arm/disarm actions are security-critical. No remote path exists in v1 or v2.

**`lock.*` — electronic locks**
Filter by "lock" and un-expose everything.
Physical access control. May graduate to Tier B per-entity after operator review in v2 (Open Decision #5).

**Critical `switch.*` entities — see §6 checklist**
Filter by "switch".
- Toggle **off** every entity in the Critical list in §6.
- Leave non-Critical switches (plug-controlled lights, non-safety accessories) **on**.
- If you are uncertain whether a switch is Critical: **default to un-expose** (fail-closed).

### 3.4 W3 — Mandatory: un-expose `set_shutters_to_min_light`

> **WARNING: This is a custom MCP tool name — it will NOT appear as a standard entity when filtering by domain. It is easy to miss and must be found explicitly.**

`set_shutters_to_min_light` is a currently-live mass cover action (moves all shutters to a preset minimum-light position). Because it has a custom name instead of a generic `Hass*` call, standard domain filters will not surface it.

**To remove it:**

1. In HA → Settings → Voice assistants → Expose, search for the keyword **"shutters"** or **"min_light"**.
2. If it appears as a **script entity** (`script.set_shutters_to_min_light` or similar): toggle it off in the exposure list.
3. If it is registered as a **custom tool** in the MCP Server integration configuration: open the MCP Server integration settings and remove it from the tool or action list.
4. After pruning, confirm it does **not** appear in a `GetLiveContext` scan (§5 — this is the definitive check).

Until `set_shutters_to_min_light` is removed, the Tier-B cover gap remains open.

---

## 4. W2 — Read mitigation: REST path for un-exposed entities

**Side-effect of un-exposing Tier C:** state queries over the MCP path — "is the front door locked?", "is the alarm armed?", "is the main breaker on?" — stop working for those entities, because MCP tools only see exposed entities.

**Mitigation:** the HA REST API is an **independent read path** unaffected by MCP exposure. Any entity — exposed or not — can be read via:

```bash
# Read a lock state
curl -s \
  -H "Authorization: Bearer ${HA_TOKEN}" \
  "${HA_BASE_URL}/api/states/lock.main_entrance" \
  | jq '{state: .state, last_changed: .last_changed}'

# Read an alarm panel state
curl -s \
  -H "Authorization: Bearer ${HA_TOKEN}" \
  "${HA_BASE_URL}/api/states/alarm_control_panel.home" \
  | jq '{state: .state, last_changed: .last_changed}'
```

Where:
- `HA_BASE_URL` = e.g. `http://homeassistant.local:8123`
- `HA_TOKEN` = a valid long-lived access token (HA → Settings → Profile → Long-Lived Access Tokens)

This REST call bypasses MCP exposure entirely. The Majordomus PM (and, in v2, the ha-bridge) can use this path to answer state-query questions about Tier-C entities after they are pruned from the MCP Server. The `.claude/rules/ha.md` auth shape applies: `Authorization: Bearer <token>`, JSON response body.

---

## 5. Verification scan

After completing §3, run a live check to confirm no Tier B/C entity remains reachable.

### 5.1 Trigger the scan

In a Majordomus PM session, call `GetLiveContext`:

```
/pm What entities and tools are currently available via the HA MCP path?
```

PM will invoke `GetLiveContext` and return the live palette. Alternatively, in a Claude Code session with the `home-assistant` MCP server active, call `GetLiveContext` directly.

### 5.2 Pass / fail criteria

**PASS** — the response contains ONLY items from this set:
- `light.*` entities
- Whitelisted `scene.*` entities
- `input_boolean.*` entities
- `fan.*` entities — **none** from the Critical list
- `media_player.*` entities
- `notify.*` services
- Non-Critical `switch.*` entities
- Read tools: `GetLiveContext`, `GetDateTime`
- `HassCancelAllTimers`, `HassStopMoving`

**FAIL** — any of the following appear:
- Any `cover.*` entity
- Any `climate.*` entity
- Any `vacuum.*` entity
- Any `alarm_control_panel.*` entity
- Any `lock.*` entity
- Any entity from the Critical switch list (§6)
- `set_shutters_to_min_light` by name (custom tool)
- Any unclassified domain not in the Tier A set above

If the scan fails: return to §3, un-expose the remaining entities, and re-scan. Repeat until PASS.

---

## 6. Critical-entity checklist — operator must finalize

The entities below are the **seed Critical list** from `ha_whitelist_gate.md §3.3`. Object IDs are indicative — the operator must confirm the exact `entity_id` values in their HA instance and hunt for siblings (other breakers, valves, locks, relays). These entities must be un-exposed (Tier C, default-deny) regardless of domain defaults.

**Instructions:** mark each row ✓ (verified present + un-exposed), or N/A (not present in this installation).

| Entity (indicative) | Why Critical | Status |
|---|---|---|
| `switch.main_breaker` | Main electrical breaker | [ ] |
| `switch.pv_contactor` | PV inverter contactor | [ ] |
| `switch.charger_breaker` | EV / battery charger breaker | [ ] |
| `switch.all_doors_lockdown` | Locks all access doors simultaneously | [ ] |
| `switch.evacuation` | Evacuation mode trigger | [ ] |
| `switch.main_entrance_lock` | Front door lock relay | [ ] |
| `switch.main_water_control_water_valve` | Main water shutoff valve | [ ] |
| `switch.visonic_p1_*` (all members) | Security system zones — enumerate all | [ ] |
| `switch.door_1_relay` (intercom) | Intercom / gate door relay | [ ] |

**Hunt for siblings** — search HA entity registry for any additional entities matching these patterns:
- Other breakers / contactors: search `switch.*` for keywords "breaker", "contactor", "circuit"
- Other water valves: search `switch.*` and `valve.*` for "water", "valve", "shutoff"
- Other door / gate relays: search `switch.*` for "relay", "door", "gate"
- Other lock entities: all of `lock.*` (should already be Tier C by domain)
- Other alarm / security panels: all of `alarm_control_panel.*`

This checklist is **Open Decision #4** in the design. Until the operator finalises and confirms every Critical entity is un-exposed, the Tier-C boundary is not fully closed.

---

## 7. After the runbook

Once the §5 verification scan passes:

1. **Confirm Open Decision #3 to PM:** state explicitly that you accept the capability loss (no remote climate / cover / lock / vacuum / alarm) until v2 ships. PM will record this in the design doc.
2. **Complete §6** — fill in the Critical-list checklist and share it with PM; this is the input for v2 implementation and the `fleet/ha_whitelist.json` data file.
3. **Mark in NEXT_STEPS.md** — PM updates the v1 exposure-pruning step to done.
4. **Maintenance:** re-run the §5 verification scan any time the HA MCP Server configuration changes (new entities added, HA updates, integration reconfiguration).
