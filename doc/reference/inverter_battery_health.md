# Inverter Battery Health — Deye ESP32+OLED
**Last Updated:** 2026-06-09
**Owner:** `/ha`

## Abstract

**TL;DR:** Point-in-time (2026-06-09) battery health baseline for the Deye hybrid inverter monitored via ESP32+OLED WiFi firmware. Verdict: Healthy. Also documents the SoH calculator automation diagnosis (3 missing `input_number` helpers → silent no-op) and the operator fix to surface a queryable `sensor.battery_state_of_health`.

**Load when:** Deye inverter, battery health, SoH, state of health, inverter_esp32oled, battery_state_of_health_calculator, battery capacity, battery temperature, controller temperature, input_number.battery_estimated_capacity_wh

**Key facts:**
- All inverter sensors are REST-only under `sensor.inverter_esp32oled_*` — none MCP-exposed.
- The SoH calculator automation (id `1773779229092`) is enabled and firing but silently no-ops because its 3 target `input_number` helpers do not exist in HA.
- No current SoH% is derivable until the operator creates the helpers and one qualifying discharge cycle completes.
- AMBER: `sensor.inverter_esp32oled_controller_temperature` = 58.3°C at time of snapshot (~6.7°C headroom to typical 65°C limit).

**Owner:** `/ha` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/reference/ha_entity_catalog.md`, `doc/design/ha_integration.md`, `doc/design/DOC_OWNERSHIP_MATRIX.md`

---

## 1. Device

| Property | Value |
|---|---|
| Inverter model | Deye hybrid inverter |
| Monitoring firmware | Custom ESP32+OLED WiFi firmware (RS485 bus read) |
| HA entity prefix | `sensor.inverter_esp32oled_*` |
| Total entities | 58 (sensor, number, select domains) |
| HA access path | REST only: `GET /api/states/sensor.inverter_esp32oled_*` |
| MCP exposure | None — all ESP32+OLED entities are REST-only |
| Data granularity | Pack-level only (no per-cell, no BMS internal registers) |

---

## 2. Health Snapshot (2026-06-09) — Point-in-Time Baseline

**Verdict: HEALTHY**

Justification: SoC cycling normally (50%→100% in 24h), running_status=Normal, battery temperature stable and well within LiFePO4 safe range, voltage consistent with a healthy 24V pack, lifetime throughput modest (~1,860 kWh, indicating early-to-mid life).

### Dedicated Health Sensors

| entity_id | Snapshot value | Healthy range | Status |
|---|---|---|---|
| `sensor.inverter_esp32oled_battery_capacity` | 100% (24h: min 50%, max 100%) | 20–100% | ✅ IN RANGE |
| `sensor.inverter_esp32oled_battery_voltage` | 27.68V (24h: min 24.22V, max 29.32V) | 24.0–29.2V | ✅ IN RANGE |
| `sensor.inverter_esp32oled_battery_current` | −2.33A (discharging) | −100A to +20A | ✅ IN RANGE |
| `sensor.inverter_esp32oled_battery_power` | −64W | — | ✅ light load |
| `sensor.inverter_esp32oled_temperature_battery` | 32.1°C (24h: min 27.8°C, max 32.2°C) | ≤45°C | ✅ IN RANGE |
| `sensor.inverter_esp32oled_temperature_dc_transformer` | 46.6°C | ≤65°C typical | ✅ IN RANGE |
| `sensor.inverter_esp32oled_temperature_heat_sink` | 49.3°C | ≤65°C typical | ✅ IN RANGE |
| `sensor.inverter_esp32oled_controller_temperature` | **58.3°C** | ≤65°C | ⚠️ **AMBER — elevated** |
| `sensor.inverter_esp32oled_running_status` | "Normal" | "Normal" | ✅ IN RANGE |
| `sensor.inverter_esp32oled_total_battery_charge` | 1,061.8 kWh | — | ✅ lifetime accumulator |
| `sensor.inverter_esp32oled_total_battery_discharge` | 797.8 kWh | — | ✅ lifetime accumulator |

**AMBER flag — controller temperature (58.3°C):** 6.7°C below the typical Deye limit of 65°C. Elevated but not alarming at time of snapshot. Monitor, especially in summer. Recommend alerting at 62°C. Confirm inverter has adequate ventilation.

**Lifetime throughput:** charge 1,061.8 kWh + discharge 797.8 kWh ≈ **1,859.6 kWh total**. For a typical 5–10 kWh LiFePO4 pack rated at 2,000–6,000 cycles, this is early-to-mid life.

---

## 3. What Is NOT Measurable (Firmware Limitation)

The ESP32+OLED firmware reads pack-level data from the RS485 bus only. The following metrics are **not available in HA**:

| Metric | Status |
|---|---|
| State of Health % (SoH) | ❌ Not exposed — see § 4 for workaround |
| Battery cycle count | ❌ Not exposed |
| Per-cell voltage | ❌ Not exposed (pack voltage only) |
| Cell voltage imbalance | ❌ Not exposed |
| BMS fault / alarm flags | ❌ Not exposed |
| BMS temperature per cell | ❌ Not exposed (pack temperature only) |

`automation.battery_state_of_health_calculator` is a workaround for the missing SoH — see § 4.

---

## 4. SoH Calculator Automation — Diagnosis

### Automation facts

| Property | Value |
|---|---|
| entity_id | `automation.battery_state_of_health_calculator` |
| Numeric id (config API) | `1773779229092` |
| State | `on` (enabled) |
| Last triggered | 2026-06-09T11:12:37 UTC (firing correctly) |

### Root cause — silent no-op

The automation fires normally, but calls `input_number.set_value` on **three helpers that do not exist in HA**. All three return `"Entity not found."` from the REST API. HA silently ignores `set_value` calls to non-existent entities — no error is logged, `last_triggered` updates, but nothing is written.

Missing helpers:

| Entity ID | Purpose |
|---|---|
| `input_number.battery_start_energy` | Snapshot of `sensor.battery_discharged_energy_total` at full charge |
| `input_number.battery_start_soc` | Snapshot of SoC% at full charge |
| `input_number.battery_estimated_capacity_wh` | **The computed output** — measured pack capacity in Wh |

### What the automation computes

**Phase 1 — Snapshot** (trigger: `sensor.inverter_esp32oled_battery_capacity` > 99.5%, i.e. fully charged):
```
battery_start_energy ← sensor.battery_discharged_energy_total   (kWh accumulated)
battery_start_soc    ← sensor.inverter_esp32oled_battery_capacity (SoC %)
```

**Phase 2 — Measurement** (trigger: `sensor.inverter_esp32oled_battery_current` > 0.5A AND SoC < 90%, i.e. charging starts after a discharge):
```
soc_diff    = battery_start_soc  − current_soc          (% discharged since full charge)
energy_used = current_energy     − battery_start_energy  (kWh discharged in that period)

if soc_diff > 10:
    battery_estimated_capacity_wh = energy_used / (soc_diff / 100)
    (guard: ignores trivial cycles where SoC drop ≤ 10%)
```

Example: 50% SoC discharged → 2.5 kWh consumed → estimated capacity = 5.0 kWh (5,000 Wh).

**Formula assessment:** Sound empirical approach. Output is pack capacity in **Wh** (not SoH% directly). To derive SoH%: `SoH% = (battery_estimated_capacity_wh / rated_capacity_wh) × 100`. The rated capacity is not in HA data — the operator must supply it from the battery datasheet.

---

## 5. Fix — Operator-Applied

### Step 1: Create 3 input_number helpers

Go to: **Settings → Devices & Services → Helpers → + Create Helper → Number**

| Name | Entity ID | Min | Max | Step | Unit |
|---|---|---|---|---|---|
| Battery Start Energy | `input_number.battery_start_energy` | 0 | 100000 | 0.001 | kWh |
| Battery Start SoC | `input_number.battery_start_soc` | 0 | 100 | 0.1 | % |
| Battery Estimated Capacity Wh | `input_number.battery_estimated_capacity_wh` | 0 | 100000 | 1 | Wh |

The entity_ids must match exactly as listed — the automation references them by these names.

After creating the helpers, the automation will populate `battery_estimated_capacity_wh` on the next qualifying cycle (full charge → discharge > 10% SoC → charging starts again).

### Step 2 (optional): Add a sensor.battery_state_of_health template sensor

Converts the Wh reading to a human-readable SoH%. Add to `configuration.yaml` (or via Settings → Helpers → Template → Sensor):

```yaml
template:
  - sensor:
      - name: "Battery State of Health"
        unique_id: battery_soh_pct
        unit_of_measurement: "%"
        state_class: measurement
        state: >
          {# OPERATOR: replace 5000 with your battery's rated capacity in Wh         #}
          {# Example: 200Ah × 24V = 4800 Wh; 100Ah × 48V = 4800 Wh                   #}
          {% set rated_wh = 5000 %}
          {% set measured = states('input_number.battery_estimated_capacity_wh') | float(0) %}
          {% if measured > 0 %}
            {{ (measured / rated_wh * 100) | round(1) }}
          {% else %}
            unknown
          {% endif %}
```

---

## 6. Caveats

**No current SoH derivable.** The formula requires a baseline snapshot (`battery_start_energy`, `battery_start_soc`) captured at the last full-charge event. Since the helpers never existed, no baseline was ever stored. The earliest a real SoH reading will appear: after the helpers are created AND the battery completes one full charge → discharge (>10% SoC drop) → charge-start cycle.

**`battery_discharged_energy_total` discrepancy.** At time of snapshot:
- `sensor.battery_discharged_energy_total` = 191.821 kWh (used by the SoH formula)
- `sensor.inverter_esp32oled_total_battery_discharge` = 797.8 kWh (lifetime accumulator)

These differ by ~4×. The standalone sensor likely tracks a partial window (post-HA-restart or post-integration-install epoch) rather than lifetime total. **Risk:** if HA restarts between Phase 1 (snapshot) and Phase 2 (measurement), `battery_discharged_energy_total` may reset, making `energy_used` negative or near-zero — the automation's `if soc_diff > 10` guard does not protect against this. The operator should verify whether `sensor.battery_discharged_energy_total` is persistent across HA restarts (check its platform/integration source).

---

## 7. Monitoring Candidates (REST-only today)

These sensors are worth wiring into Majordomus alerts once the monitoring pipeline supports REST-only sources:

| entity_id | Suggested alert threshold | Rationale |
|---|---|---|
| `sensor.inverter_esp32oled_controller_temperature` | Alert ≥ 62°C | 3°C before limit; AMBER already at 58.3°C |
| `sensor.inverter_esp32oled_temperature_battery` | Alert ≥ 42°C | Safety margin before 45°C charging limit |
| `sensor.inverter_esp32oled_battery_capacity` | Alert ≤ 15% | Low SoC floor (adjust to operator preference) |
| `sensor.inverter_esp32oled_running_status` | Alert ≠ "Normal" | Fault detection |
| `input_number.battery_estimated_capacity_wh` | Alert < [rated × 0.80] | SoH degradation (80% = common replacement threshold) |

All entities are REST-only — not MCP-exposed. Access via `GET /api/states/<entity_id>`.
