# Monbat 12MVR200 — Battery Spec (AGM VRLA, Front Terminal)
**Last Updated:** 2026-06-13
**Owner:** `/ha`

## Abstract

**TL;DR:** Manufacturer spec sheet for the Monbat 12MVR200 (12 V ~190–200 Ah AGM
VRLA lead-acid battery), reconstructed from the official datasheet + a 25 °C
discharge table. The fleet's battery bank is **2× 12MVR200 in series → 24 V,
~200 Ah (C20), ~4.8 kWh nominal**. Provides the rated capacity, full
discharge/temperature tables, and a derived Peukert exponent needed to compute a
trustworthy battery State-of-Health from the Deye inverter telemetry.

**Load when:** Monbat 12MVR200, battery spec, battery datasheet, AGM, lead-acid,
rated capacity, C20 capacity, Peukert exponent, discharge table, temperature
correction, state of health, SoH, battery_state_of_health, rated_kwh, 24V bank,
Deye SoC.

**Key facts:**
- Chemistry is **AGM lead-acid — NOT LiFePO4** (a prior assumption in
  `inverter_battery_health.md` was wrong; lead-acid physics apply: Peukert + temp).
- Rated **190 Ah @ C10** / **200.0 Ah @ C20 (25 °C)** per 12 V unit → 2-in-series 24 V
  bank ≈ **4.80 kWh** at 25 °C. Use **`rated_kwh = 4.8`** (25 °C reference).
- **Peukert k ≈ 1.12** (derived from the 25 °C table — Monbat publishes none).
  A ~29 A discharge (~6 h rate) delivers only ~88% of C20; multiply measured
  capacity by ~1.13 to recover the C20 reference.
- Capacity is **temperature-dependent** (datasheet table below); the Deye reports
  SoC **voltage-based** (lead-acid mode, no coulomb counting) → ΔSoC carries error,
  but the per-night voltage thresholds are repeatable so the SoH *trend* stays valid.

**Owner:** `/ha` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/reference/inverter_battery_health.md`, `doc/reference/ha_entity_catalog.md`, `doc/ha_GUIDELINES.md`

---

## 1. Identity & Bank Configuration

| Property | Value |
|---|---|
| Manufacturer | Monbat Plc (Sofia, Bulgaria) |
| Model | 12MVR200 — Front Terminal AGM VRLA |
| Chemistry | Valve-regulated lead-acid (VRLA), Absorbing Glass Mat (AGM) |
| Per-unit nominal voltage | 12 V (6 cells) |
| **Fleet bank** | **2× 12MVR200 in series → 24 V nominal** |
| Bank rated capacity | ~200 Ah (C20 @ 25 °C) → **~4.8 kWh** nominal energy |
| Application | Stationary / reserve power; solar inverter backing |

Capacity (Ah) is unchanged in a series string; voltage adds. Energy (Wh) = Ah × 24 V.

## 2. Physical (per 12 V unit)

| Property | Value |
|---|---|
| Length × Width × Height | 555 × 125 × 316–320 mm |
| Weight | 59.2 kg (130.5 lb) |
| Terminal | Front, brass M8 female; torque 7–8 Nm |
| Container | Shock-resistant ABS, flame-retardant UL94 V0 |

## 3. Electrical (per 12 V unit)

| Property | Value |
|---|---|
| Nominal voltage | 12 V (6 cells) |
| Rated capacity | **190 Ah** @ 10 h rate to 1.80 V/cell, 20 °C |
| Internal resistance | 3.0–3.9 mΩ (revision-dependent; IEC 60896-21/22) |
| Short-circuit current | 3150–3165 A |
| Float voltage | 2.27 V/cell @ 20 °C (2.25 V/cell @ 25 °C) |
| Self-discharge | < 2.0 %/month @ 20 °C |
| Design life | EUROBAT "Very Long Life", 12+ years @ 20 °C |
| Operating temp | −20 °C to +55/60 °C (recommended +15 to +25 °C) |

## 4. Discharge Performance @ 20 °C — Capacity (Ah) to end voltage (from datasheet PDF)

Constant-current capacity (Ah), selected end-voltages:

| Uf V/cell | 1 h | 2 h | 3 h | 4 h | 5 h | 6 h | 8 h | 10 h | 20 h |
|---|---|---|---|---|---|---|---|---|---|
| 1.80 | 115.9 | 134.9 | 148.2 | 157.7 | 165.3 | 171.0 | 182.4 | 190.0 | **203.3** |
| 1.75 | 117.0 | 136.2 | 149.7 | 159.2 | 167.0 | 172.7 | 184.3 | 191.9 | 205.2 |

Constant-current discharge **current (A)** @ 1.80 V/cell, 20 °C:
`1h 115.9 · 2h 67.5 · 3h 49.4 · 4h 39.4 · 5h 33.1 · 6h 28.5 · 8h 22.8 · 10h 19.0 · 20h 10.17`

## 5. Discharge Performance @ 25 °C (operator-provided — PREFERRED reference; bank runs ~25–30 °C)

Constant-current discharge **current (A)** @ 1.80 V/cell, 25 °C:

| | 5 min | 15 min | 30 min | 1 h | 2 h | 3 h | 4 h | 5 h | 6 h | 8 h | 10 h | 20 h |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 382 | 278 | 174 | 116 | 73.9 | 50.3 | 40.2 | 33.6 | 29.4 | 22.9 | 19.0 | **10.0** |

Derived capacity (Ah = A × h) @ 1.80 V/cell, 25 °C:
`1h 116 · 2h 147.8 · 3h 150.9 · 4h 160.8 · 5h 168.0 · 6h 176.4 · 8h 183.2 · 10h 190.0 · 20h 200.0`

Constant-**power** discharge (W per cell) @ 1.80 V/cell, 25 °C:
`1h 216 · 5h 65.3 · 6h 56.1 · 10h 36.5 · 20h 19.6`

**Reference capacities:** C10 = 190.0 Ah (1.80 Vpc) · C20 = **200.0 Ah** (1.80 Vpc, 25 °C).
→ 24 V bank C20 energy = 200.0 Ah × 24 V = **4800 Wh = 4.80 kWh**.

## 6. Temperature Correction Factor of Capacity (datasheet)

Multiply rated capacity by the factor for the discharge temperature:

| Discharge time | −10 °C | 0 °C | 10 °C | 15 °C | 20 °C | 25 °C | 30 °C | 35 °C | 40 °C | 45 °C |
|---|---|---|---|---|---|---|---|---|---|---|
| 5–59 min | 0.70 | 0.80 | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.13 | 1.15 | 1.16 |
| 1–20 h | 0.82 | 0.88 | 0.94 | 0.97 | 1.00 | 1.03 | 1.05 | 1.08 | 1.09 | 1.10 |

To normalize a measured capacity to 25 °C, divide by the 25 °C-rebased factor
(e.g. at 29.5 °C, 1–20 h row ≈ 1.05/1.03 ≈ 1.017 → measured reads ~1.7 % high).

## 7. Peukert Exponent (derived — Monbat does not publish one)

`k = ln(t₂/t₁) / ln(I₁/I₂)` from two rated points (25 °C constant-current table):

| Span | Points | k |
|---|---|---|
| 20 h ↔ 10 h (low rate) | 10.0 A / 19.0 A | ≈ 1.08 |
| 20 h ↔ 6 h (operating span) | 10.0 A / 29.4 A | **≈ 1.12** |
| 20 h ↔ 5 h | 10.0 A / 33.6 A | ≈ 1.14 |
| 10 h ↔ 5 h (high rate) | 19.0 A / 33.6 A | ≈ 1.17 |

(20 °C table runs higher: 20h↔5h ≈ 1.17.) `k` is not perfectly constant — choose
for the operating rate. The fleet's nightly discharge is ~29 A ≈ the **6 h rate**,
normalizing back to the C20 (10 A) reference → **use k = 1.12**.

**Rate-correction (recover C20 from a measured cycle):**
`C20 = measured × (I_avg / 10)^(k − 1)`, with k = 1.12, I_avg = mean discharge current.
At I_avg = 29 A: factor ≈ ×1.13. (Most accurate alternative: interpolate the table
directly — C20 200 Ah ÷ capacity-at-actual-rate.)

## 8. Charge Regime (20 °C)

| Parameter | Value |
|---|---|
| Regime | Constant voltage, current-limited (IU) |
| Charge current limit | 0.1–0.25 × C10 A (recommended 0.20 C10) |
| Float | 2.27 V/cell @ 20 °C (−3 mV/cell/°C temp comp) |
| Boost | 2.40 V/cell @ 20 °C (−4 mV/cell/°C) |
| Equalization | 2.32 V/cell, every ~3 months / 24 h during long float |
| Cycling | 2.40 V/cell; recharge ≥ 105 % of previous discharge Ah |
| Recommended DoD | ≤ 50 % for cycle life (the fleet's nightly 100→50 % is appropriate) |

## 9. Use for State-of-Health (SoH)

`sensor.battery_state_of_health` = `measured_capacity_kWh / rated_kWh × 100`, where
**`rated_kWh = 4.8`** (C20 @ 25 °C). For a *trustworthy* SoH on this AGM bank, the
measured capacity must be **Peukert- and temperature-normalized** (lead-acid is rate-
and temp-sensitive — unlike LiFePO4):

- **Source:** integrate battery-side energy over the nightly 100→50 % window;
  `capacity = ΔkWh ÷ ΔSoC` (×2 for 50 %).
- **Peukert:** × (I_avg / 10)^(1.12 − 1) to recover C20.
- **Temperature:** normalize to 25 °C via the §6 table (sensor
  `sensor.inverter_esp32oled_temperature_battery`).
- **SoC caveat:** the Deye reports SoC **voltage-based** (lead-acid mode, no coulomb
  counting). Voltage-under-load ≠ true SoC and OCV needs ~30–60 min rest; the ΔSoC
  denominator carries ±6–10 %. The per-night thresholds are repeatable, so the SoH
  **trend** (fade over months) stays valid even if the absolute value has a small offset.
- **Denoise:** EMA (α ≈ 0.2, ~5-cycle) + a long-window trend = the real fade curve.

The SoH-calculator automation, helper wiring, and the unit-bug history are documented
in `doc/reference/inverter_battery_health.md` (note: that doc's LiFePO4 references are
stale — this battery is AGM).

## 10. Sources

- Monbat official product page: <https://www.monbat.com/product/12mvr200/>
- Datasheet PDF (20 °C tables, physical/electrical/charge): <https://ezprofinal.eu/media/attachment/file/b/a/bat_ria_12mvr200.pdf>
- 25 °C constant-current/constant-power discharge table: operator-provided (Monbat "FRONT ACCESS VRLA" revision)
