---
name: battery-soh-config-write
description: Battery SoH calculator (AGM) deployed via gated config-write; pending operator HA-UI steps + executor lessons from the 2026-06-13 session
metadata:
  type: project
---

Battery bank is **2× Monbat 12MVR200 AGM (lead-acid) in series → 24 V, ~4.8 kWh**
(C20 @ 25 °C = 200 Ah). NOT LiFePO4. Full spec: `doc/reference/battery_monbat_12mvr200.md`.
Inverter SoC is **voltage-based** (Deye lead-acid mode, no coulomb counting).

**Where we left off (2026-06-13, origin/main=11f1d73, all pushed).** The AGM-normalized
SoH calculator (Pass 2) is fully deployed via the gated config-write path and the old
duplicate is cleaned up — **config side complete**. Two operator HA-UI steps remain to
activate it (agents draft, the human enables):
1. set `input_number.battery_estimated_capacity_wh` = 0 (clears stale 0.347);
2. enable `automation.battery_state_of_health_calculator_2` (deployed force-disabled).
Then `sensor.battery_state_of_health` (uses `rated_kwh = 4.8`) updates after a full cycle
(charge ≥99.5 % → discharge ≤55 %). v2 logic: Peukert k=1.12 (timestamp true-avg current),
temp-normalize to 25 °C (datasheet table), EMA α=0.2, guard soc_diff≥40, odometer source
`sensor.inverter_esp32oled_total_battery_discharge`.

**Durable executor lessons (verify against code; candidates for [[ha-config-write]] /
GUIDELINES consolidation — flagged by /ha + /review + /arch, NOT yet consolidated):**
- For HA config-write ops, `object_id` of a UI-created helper/automation is its **numeric
  config id (e.g. `1773779229092`), NOT the alias slug** — using the slug creates a
  *duplicate* (404 on GET → new create) instead of overwriting. Bit us on both a helper
  and an automation this session.
- `helper_delete` / `template_sensor_create` need HA's real internal id / REST config-flow,
  not WS-by-entity_id (storage-based helpers resolve via `<type>/list`; template sensors via
  `POST /api/config/config_entries/flow handler=template`).
- **NEW-1 (§3.4) must gate on _deliberately_-Critical only** (`_isDeliberateCritical`:
  critical_entities + per-entity-C + domain-default-C like lock/alarm), NOT fail-closed-unknown
  Tier-C (sensor/input_number). The old code blocked deleting/overwriting almost any automation.
  Invariant recorded in `doc/design/ha_config_write.md` §3.4.

**Open follow-ups:** run consolidation gate; §6 acceptance demos; companion whitelist
`domain_defaults` additions (sensor/input_number→A); optional strip of 3 "NOT LiFePO4"
doc mentions. See PM MCP memory `current_goal` for the full resume checklist.
