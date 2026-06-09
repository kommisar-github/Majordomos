# Home Assistant Entity Catalog

**Generated:** 2026-06-09 via REST `GET /api/states` + MCP `GetLiveContext`
**Instance:** `http://192.168.2.125:8123` — 4,997 total entities
**Owner:** `/ha` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
**Purpose:** Operator reference for Critical-list finalization, v1 exposure pruning, and Safety-tier annotation per `doc/design/ha_whitelist_gate.md §3`.

## Abstract

**TL;DR:** Full inventory of the HA instance with per-entity safety-tier (A/B/C), MCP-exposure status, and Critical-list finalization input. Identifies the solar inverter battery entities (not MCP-exposed; readable via REST) and flags 11 currently-live Critical entities that need v1 pruning.

**Load when:** HA entity catalog, Critical list finalization, v1 exposure pruning, inverter battery state, entity_id lookup, safety tier audit.

**Key facts:**
- 4,997 total entities; ~200 meaningful control/status entities; rest are device-management noise (update, device_tracker, button, event).
- 11 Tier-C/Critical entities are currently MCP-exposed (live safety gap — v1 pruning urgent).
- Solar inverter battery: Deye hybrid via ESP32+OLED, battery 100% / 27.73V / discharging 78W. Entity prefix `sensor.inverter_esp32oled_*` — NOT MCP-exposed, readable via REST only.
- Lock entity: `lock.main_entrance` (UA Hub Door). Alarm: `alarm_control_panel.visonic_alarm_panel` + 3 others.

**Owner:** `/ha` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/ha_whitelist_gate.md`, `fleet/ha_whitelist.json`, `doc/ha_GUIDELINES.md`

---

## 1. Summary Counts

### 1a. All entities by domain

| Domain | Count | Notes |
|---|---|---|
| `sensor` | 2,708 | Mostly device diagnostics (battery, signal, firmware) |
| `device_tracker` | 627 | Vehicles, phones, network clients |
| `switch` | 462 | Includes ~350 camera AI-detection toggles (noise) |
| `binary_sensor` | 394 | Contact, motion, opening sensors |
| `button` | 239 | Restart/reboot buttons |
| `update` | 110 | Firmware update entities |
| `number` | 103 | Configuration numbers |
| `automation` | 90 | 90 automations |
| `select` | 72 | Configuration selects |
| `light` | 31 | Lights |
| `event` | 30 | Event entities |
| `camera` | 28 | UniFi Protect cameras |
| `media_player` | 16 | TV, tablets, speakers, browser_mod |
| `climate` | 5 | ACs + pool heater |
| `cover` | 11 | Shutters + projection screen |
| `fan` | 4 | Pool pump × 2, air purifier, Tasmota fan |
| `alarm_control_panel` | 4 | Visonic + UNVR + Gateway v3 + Xiaomi |
| `input_button` | 12 | Dashboard buttons |
| `input_boolean` | 8 | Soft flags |
| `time` | 8 | Config time entities |
| `notify` | 7 | Notification targets |
| `vacuum` | 2 | Roborock S5 (2 registrations) |
| `lock` | 1 | UA Hub Door main entrance |
| `script` | 1 | |
| Others | 58 | weather, zone, person, counter, sun, etc. |
| **TOTAL** | **4,997** | |

### 1b. MCP-exposed vs not (via GetLiveContext delta)

MCP Server exposes a subset. **Currently exposed includes Tier-B and Tier-C entities (live gap).**

| Category | MCP-exposed | Not exposed (REST only) |
|---|---|---|
| Lights | ~20 active lights | Some unavailable |
| Switches (controllable) | ~50 (incl. Critical — **see §5**) | ~400 camera AI-detection toggles |
| Covers/shutters | All 11 | — |
| Climate/AC | All 5 | — |
| Vacuum | Both S5 entities | — |
| Fans | All 4 | — |
| Media players | All 16 | — |
| Binary sensors | ~40 key sensors | Most |
| Sensors (environmental) | ~30 (temp, humidity) | All energy/inverter sensors |
| Solar inverter / battery | **NONE** | All `sensor.inverter_esp32oled_*` |
| Alarm control panel | **NONE** | All 4 |
| Lock | **NONE** | `lock.main_entrance` |

---

## 2. By Area

### Living Room
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `climate.living_room_ac` | climate | off (25.7°C) | B | MCP-exposed — needs pruning |
| `cover.sofa_shutters` | cover | open (100%) | B | MCP-exposed |
| `cover.tv_shutters` | cover | open (100%) | B | MCP-exposed |
| `cover.projection_screen` | cover | open (100%) | B | MCP-exposed |
| `switch.living_room_sofa_lights` | switch | off | A | |
| `switch.living_room_tv_lights` | switch | off | A | |
| `switch.living_room_rgb_strip` | switch | off | A | |
| `vacuum.robot_vacuum_s5` | vacuum | docked | B | MCP-exposed |
| `media_player.yes` | media_player | on | A | TV |

### Master Bedroom
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `cover.master_bedroom_shutters` | cover | open (100%) | B | MCP-exposed |

### Dany's Room
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `climate.danys_room_ac` | climate | unavailable | B | MCP-exposed |
| `cover.danys_room_shutters` | cover | open (100%) | B | MCP-exposed |

### Lilia's Room
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `climate.lilias_room_ac` | climate | unavailable | B | MCP-exposed |
| `cover.lilia_s_room_back_shutters` | cover | open (28%) | B | MCP-exposed |
| `cover.lilias_room_side_shutters` | cover | open (27%) | B | MCP-exposed |

### Office
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `climate.office_ac` | climate | unavailable | B | MCP-exposed |
| `fan.zhimi_m1_9809_air_purifier_2` | fan | unavailable | A | Air purifier |

### Kitchen
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `cover.kitchen_shutters` | cover | open (100%) | B | MCP-exposed |
| `binary_sensor.refrigerator_freezer_door` | binary_sensor | off | A | |
| `binary_sensor.refrigerator_fridge_door` | binary_sensor | off | A | |

### Front Door / Main Entrance
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.main_entrance_lock` | switch | unavailable | **C Critical** | Lock relay — MCP-exposed! |
| `switch.all_doors_lockdown` | switch | off | **C Critical** | MCP-exposed! |
| `switch.all_doors_evacuation` | switch | off | **C Critical** | MCP-exposed! |
| `switch.front_door_intercom_door_relay_0` | switch | unavailable | **C Critical** | Door relay — MCP-exposed! |
| `lock.main_entrance` | lock | locked | C | UA Hub Door — NOT MCP-exposed |
| `media_player.front_door_tab` | media_player | idle | A | Kiosk tablet |

### Parking / Power Cabinet / UPS
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.pv_contactor_switch_0` | switch | off | **C Critical** | PV Contactor — MCP-exposed! |
| `switch.main_power_breaker` | switch | unavailable | **C Critical** | Main Breaker — MCP-exposed! |
| `switch.charger_breaker_switch` | switch | unavailable | **C Critical** | Charger Breaker — MCP-exposed! |
| `switch.main_water_control_water_valve` | switch | on | **C Critical** | Water valve — MCP-exposed! |
| `switch.hiking_dds238_2_wifi` | switch | on | A | Energy meter toggle |

### Backyard / Pool
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `climate.bp6013g2` | climate | heat (36°C→35.5°C) | B | Pool heater — MCP-exposed |
| `fan.bp6013g2_pump_1` | fan | off | A | Pool pump 1 |
| `fan.bp6013g2_pump_2` | fan | off | A | Pool pump 2 |
| `switch.acs_contactors_switch_0` | switch | on | A* | ACs contactors — review (*see §5) |
| `cover.porch_shutters` | cover | open (100%) | B | MCP-exposed |

### Intercom / Street
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.street_intercom_door_relay_0` | switch | unavailable | **C Critical** | Street intercom relay — MCP-exposed! |

### Front Garden / Irrigation
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.irrigation_computer_enable_watering` | switch | on | A | Master irrigation toggle |
| `switch.irrigation_computer_sprinkler_a1`…`a6`, `b1`…`b6` | switch | off | A | Individual zones |
| `switch.irrigation_computer_skip_when_it_was_raining` | switch | on | A | |

### Server Cabinet / Network
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.starlink_sleep_schedule` | switch | off | A | |
| `switch.starlink_stowed` | switch | off | A | |
| Various `switch.unifi_network_*` | switch | mixed | A | Network VLAN/firewall toggles |

### Attic
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.sonoff_th_bioler` | switch | off | A | Boiler (Sonoff TH) |

### Security (Visonic P1)
| Entity ID | Type | State | Tier | Notes |
|---|---|---|---|---|
| `switch.visonic_p1_pgm_2` | switch | off | **C Critical** | PGM output — MCP-exposed! |
| `switch.visonic_p1_x01_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x02_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x03_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x04_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x05_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x06_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x08_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x09_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x10_2` | switch | off | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x11_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x12_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x13_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x14_2` | switch | on | **C Critical** | MCP-exposed! |
| `switch.visonic_p1_x15_2` | switch | off | **C Critical** | MCP-exposed! |
| `binary_sensor.visonic_p1_z01_zone` … `z19_zone` | binary_sensor | mixed | A read | Zone sensors |
| `alarm_control_panel.visonic_alarm_panel` | alarm | disarmed | C | NOT MCP-exposed |

---

## 3. By Function / Category

### Climate / HVAC
| Entity ID | Friendly Name | State | Tier |
|---|---|---|---|
| `climate.living_room_ac` | Living Room AC | off / 25.7°C | B |
| `climate.danys_room_ac` | Dany's Room AC | unavailable | B |
| `climate.lilias_room_ac` | Lilia's Room AC | unavailable | B |
| `climate.office_ac` | Office AC MQTT HVAC | unavailable | B |
| `climate.bp6013g2` | Pool Heater BP6013G2 | heat 36°C→35.5°C | B |

### Covers / Shutters
| Entity ID | Friendly Name | State | Tier |
|---|---|---|---|
| `cover.sofa_shutters` | Living Room Sofa Shutters | open 100% | B |
| `cover.tv_shutters` | Living Room TV Shutters | open 100% | B |
| `cover.projection_screen` | Projection Screen | open 100% | B |
| `cover.master_bedroom_shutters` | Master Bedroom Shutters | open 100% | B |
| `cover.danys_room_shutters` | Dany's Room Shutters | open 100% | B |
| `cover.lilia_s_room_back_shutters` | Lilia's Room Back Shutters | open 28% | B |
| `cover.lilias_room_side_shutters` | Lilia's Room Side Shutters | open 27% | B |
| `cover.kitchen_shutters` | Kitchen Shutters | open 100% | B |
| `cover.porch_shutters` | Porch Shutters | open 100% | B |
| `cover.home_shutters` | Home Shutters (group) | open 81% | B |
| `cover.presence_simulation_shutters` | Presence Simulation Shutters | open 63% | B |
Custom MCP tool: `set_shutters_to_min_light` → Tier B (mass cover action)

### Lighting (key entities)
| Entity ID | Area | State | Tier |
|---|---|---|---|
| `light.home_inside_lights` | (group) | off | A |
| `switch.home_outside_lights` | (group) | off | A |
| `switch.back_door_lights` | Back Door | off | A |
| `switch.shed_door_lights`, `switch.shed_lights` | Shed | off | A |
| `switch.porch_mood_lights` | Porch | off | A |
| `switch.living_room_sofa_lights`, `switch.living_room_tv_lights` | Living Room | off | A |
| `switch.irrigation_computer_display_backlight` | Front Garden | off | A |
| Various `light.*` | All areas | mixed | A |

### Security — Alarm & Access Control
| Entity ID | Friendly Name | State | Tier |
|---|---|---|---|
| `alarm_control_panel.visonic_alarm_panel` | Visonic Panel | disarmed | C (no path) |
| `alarm_control_panel.cerberushome_unvr_alarm_manager` | UNVR Alarm Manager | disarmed | C (no path) |
| `alarm_control_panel.6490c1785381_alarm` | Alarm (Xiaomi) | unavailable | C (no path) |
| `alarm_control_panel.lumi_mgl03_5381_arming_2` | Gateway v3 arming | unavailable | C (no path) |
| `lock.main_entrance` | UA Hub Door-Main Entrance | **locked** | C (no path) |
| `switch.main_entrance_lock` | Main Entrance Lock relay | unavailable | **C Critical** |
| `switch.all_doors_lockdown` | All Doors Lockdown | off | **C Critical** |
| `switch.all_doors_evacuation` | All Doors Evacuation | off | **C Critical** |
| `switch.front_door_intercom_door_relay_0` | Front Door Intercom Relay | unavailable | **C Critical** |
| `switch.street_intercom_door_relay_0` | Street Intercom Relay | unavailable | **C Critical** |
| Visonic P1 X/PGM switches (see §5) | Security zone outputs | mixed | **C Critical** |

### Energy & Solar

#### Deye Hybrid Inverter (ESP32+OLED — NOT MCP-exposed)
| Entity ID | Friendly Name | State | Unit |
|---|---|---|---|
| `sensor.inverter_esp32oled_battery_capacity` | Battery Capacity (SoC) | **100%** | % |
| `sensor.inverter_esp32oled_battery_voltage` | Battery Voltage | **27.73 V** | V |
| `sensor.inverter_esp32oled_battery_current` | Battery Current | **-2.83 A** (discharging) | A |
| `sensor.inverter_esp32oled_battery_power` | Battery Power | **-78 W** (discharging) | W |
| `sensor.inverter_esp32oled_temperature_battery` | Battery Temperature | 32.2°C | °C |
| `sensor.inverter_esp32oled_pv_power` | PV Power | **920 W** | W |
| `sensor.inverter_esp32oled_pv_voltage` | PV Voltage | 208.8 V | V |
| `sensor.inverter_esp32oled_pv_current` | PV Current | 4.2 A | A |
| `sensor.inverter_esp32oled_load_power` | Load Power | 1,107 W | W |
| `sensor.inverter_esp32oled_grid_power` | Grid Power | 159 W | W |
| `sensor.inverter_esp32oled_grid_voltage` | Grid Voltage | 228.8 V | V |
| `sensor.inverter_esp32oled_running_status` | Status | **Normal** | — |
| `sensor.inverter_esp32oled_daily_pv_production` | Today PV | 7.9 kWh | kWh |
| `sensor.inverter_esp32oled_total_pv_production` | Total PV | 4,486.5 kWh | kWh |
| `sensor.inverter_esp32oled_daily_battery_charge` | Today Battery Charge | 2.1 kWh | kWh |
| `sensor.inverter_esp32oled_daily_battery_discharge` | Today Discharge | 1.7 kWh | kWh |
| `sensor.battery_discharge_power` | Battery Discharge Power | 78.48 W | W |
| `sensor.battery_discharged_energy_total` | Total Discharged | 191.8 kWh | kWh |
| `select.inverter_esp32oled_energy_priority` | Energy Priority | Battery first | — |
| `binary_sensor.inverter_esp32oled_grid_connected` | Grid Connected | **on** | — |
| `switch.inverter_esp32oled_solar_sell` | Solar Sell | off | — |
| `switch.inverter_esp32oled_time_of_use` | Time of Use | on | — |

**All `sensor.inverter_esp32oled_*` entities = NOT MCP-exposed.** Read via REST `GET /api/states/sensor.inverter_esp32oled_battery_capacity` etc. Operator should expose read-only inverter sensors to HA MCP Server for Majordomus visibility.

#### PV Array String Monitoring (GNE — MCP-exposed)
5 GNE PV Monitoring temperature sensors (panel temperatures 47–54°C), `areas: Parking PV Array`. Entity prefix: `sensor.gne_pv_monitoring_<id>_temperature`. These are **panel surface temperatures only** — not the battery or inverter.

#### Energy Meters
| Entity ID | Description | Area | Tier |
|---|---|---|---|
| `sensor.shelly3em63g3_b081840cde50_*` | 3-phase meter (A: 54.9W, B: 63.9W, C: 148.8W, total: 267.5W) | Power Cabinet | A (read) |
| `sensor.shellyem3_fcf5c495b2a3_*` | 3-phase EM3 (A: 49W, B: 176W, C: 273W) | Power Cabinet | A (read) |
| `sensor.hiking_dds238_2_wifi_*` | DDS238 Tasmota meter (53W) | UPS | A (read) |
| `sensor.charger_breaker_phase_a_*` | Charger breaker phase sensor | Kia 2023 | A (read) |

#### Critical switches — energy/power path (see §5 for full list)
- `switch.pv_contactor_switch_0` — PV Contactor — **C Critical**
- `switch.main_power_breaker` — Main Breaker — **C Critical**
- `switch.charger_breaker_switch` — Charger Breaker — **C Critical**

### Water / Irrigation
| Entity ID | State | Tier |
|---|---|---|
| `switch.main_water_control_water_valve` | on | **C Critical** |
| `switch.irrigation_computer_enable_watering` | on | A |
| `switch.irrigation_computer_sprinkler_a1`…`a6` | off | A |
| `switch.irrigation_computer_sprinkler_b1`…`b6` | off | A |

### Cameras / Motion
28 UniFi Protect cameras (G3, G4, G5, G6 models across all areas). All provide `binary_sensor.*_motion` and `media_player.*_speaker` entities. Camera AI-detection toggles (`switch.g4_*_detections_*`) dominate the switch count (~350 entities) — all Tier A (configuration).

### Appliances
| Entity ID | State | Tier |
|---|---|---|
| `switch.washing_machine` | off | A |
| `switch.sonoff_th_bioler` | off | A (boiler switch) |
| `switch.prusa_mk4` | off | A |

### Vehicles
Device trackers for Jimny 2022, Kia 2023. CarGuard sensors (unavailable). BTHome window sensor on Jimny.

### Environment / Sensors
Extensive temp/humidity sensor network via Xiaomi/LUMI Zigbee, Ecowitt GW3000C weather station, BT Gateway, PRUSA enclosure, Shed/Attic/Server Cabinet sensors.

---

## 4. Safety-Tier Summary

### Tier A — Auto-allow (already or will remain MCP-exposed)
All lights, most switches (camera toggles, irrigation, appliances, network), media_player, fan, input_boolean, scene. Read-only sensors. Cover STOP only.

### Tier B — Confirm-required (must be removed from MCP Server in v1)
All `cover.*` (11 entities), all `climate.*` (5), all `vacuum.*` (2), `fan.*` if safety-critical, non-whitelisted scripts, custom tool `set_shutters_to_min_light`.

### Tier C — Default-deny (never exposed, never bridged)
All `alarm_control_panel.*` (4), all `lock.*` (1), all Critical switch entities (§5), unknown domains.

---

## 5. Critical-List Finalization Input

**⚠ OPERATOR ACTION REQUIRED: confirm exact entity_ids, remove unavailable ones if hardware is gone, hunt siblings.**

All entities below are **currently MCP-exposed** (live safety gap — v1 pruning removes them). Exact entity_ids verified from `GET /api/states` 2026-06-09:

| # | entity_id | Friendly Name | Current State | Whitelist glob match | Notes |
|---|---|---|---|---|---|
| 1 | `switch.main_power_breaker` | Main Breaker / Main Power Breaker | unavailable | exact | Different from seed `switch.main_breaker` — UPDATE whitelist |
| 2 | `switch.pv_contactor_switch_0` | PV Contactor switch_0 | off | `switch.pv_contactor_*` (not in seed) | UPDATE whitelist — seed says `switch.pv_contactor` |
| 3 | `switch.charger_breaker_switch` | Charger Breaker Switch | unavailable | exact match if seed updated | Seed says `switch.charger_breaker` — UPDATE |
| 4 | `switch.all_doors_lockdown` | All Doors Lockdown | off | exact | ✓ matches seed |
| 5 | `switch.all_doors_evacuation` | All Doors Evacuation | off | — | **NEW — not in seed list; add to whitelist** |
| 6 | `switch.main_entrance_lock` | Main Entrance Lock (relay) | unavailable | exact | ✓ matches seed |
| 7 | `switch.main_water_control_water_valve` | Main Water Control Water Valve | on | exact | ✓ matches seed |
| 8 | `switch.front_door_intercom_door_relay_0` | Front Door Intercom Door 1 relay | unavailable | — | Seed says `switch.door_1_relay` — UPDATE to this id |
| 9 | `switch.street_intercom_door_relay_0` | Street Intercom Door relay | unavailable | — | **NEW — not in seed list; add to whitelist** |
| 10 | `switch.visonic_p1_pgm_2` | Visonic P1 PGM | off | `switch.visonic_p1_*` glob | ✓ glob matches |
| 11–24 | `switch.visonic_p1_x01_2` … `switch.visonic_p1_x15_2` | Visonic P1 X01–X15 (X07 absent) | mixed | `switch.visonic_p1_*` glob | ✓ glob matches all |

**Also consider (operator decides):**
- `switch.acs_contactors_switch_0` (ACs Contactors, state=on) — controls AC contactors. Currently Tier A. Operator should confirm whether this is safety-critical (Tier C) or comfort-critical (Tier B).

### Whitelist correction summary

The seed `fleet/ha_whitelist.json` entity_ids need the following updates (operator-reviewed git commit):

| Seed entity_id | Actual entity_id | Action |
|---|---|---|
| `switch.main_breaker` | `switch.main_power_breaker` | Rename |
| `switch.pv_contactor` | `switch.pv_contactor_switch_0` | Rename (or add glob `switch.pv_contactor_*`) |
| `switch.charger_breaker` | `switch.charger_breaker_switch` | Rename |
| `switch.door_1_relay` | `switch.front_door_intercom_door_relay_0` | Rename |
| *(missing)* | `switch.all_doors_evacuation` | **Add** |
| *(missing)* | `switch.street_intercom_door_relay_0` | **Add** |

The `switch.visonic_p1_*` glob correctly covers all Visonic P1 X** and PGM entities (with `_2` suffix).

---

## 6. Solar Inverter Battery — Finding

**Question:** Where is the Solar Inverter battery state, and is it MCP-exposed?

**Answer:** The system uses a **Deye hybrid inverter** monitored by a custom ESP32+OLED WiFi firmware. All inverter+battery entities use the prefix `sensor.inverter_esp32oled_*` and are **not MCP-exposed** (absent from GetLiveContext).

**Current battery state (2026-06-09, ~10:50 local):**

| Metric | Value |
|---|---|
| SoC (capacity) | **100%** |
| Voltage | 27.73 V (24V nominal bank) |
| Current | -2.83 A (discharging) |
| Power | -78 W (discharging) |
| Temperature | 32.2°C |
| Energy priority | Battery first |
| PV production now | 920 W |
| Load now | 1,107 W |
| Grid import now | 159 W |
| Grid connected | Yes |
| Status | Normal |

**To expose to Majordomus:** Operator should add `sensor.inverter_esp32oled_battery_capacity`, `sensor.inverter_esp32oled_battery_power`, `sensor.inverter_esp32oled_pv_power`, `sensor.inverter_esp32oled_running_status` (and others as desired) to the HA MCP Server integration's exposed-entity list. Until then, Majordomus can read battery state via REST: `GET /api/states/sensor.inverter_esp32oled_battery_capacity`.

The **GNE PV Monitoring** sensors (5 × temperature sensors in Parking PV Array) are MCP-exposed but show **panel surface temperatures only** (47–54°C) — they are NOT the battery or inverter.

---

## 7. V1 Exposure Pruning — Tier B/C Entities to Remove from HA MCP Server

**Operator action: remove these from the HA MCP Server integration's exposed entity list.**

### Must remove — Tier C Critical (currently exposed!)
All 24 Critical switch entities listed in §5.

### Must remove — Tier B (currently exposed, need Telegram confirm gate before v2)
| Entity | Tier |
|---|---|
| `cover.danys_room_shutters` | B |
| `cover.home_shutters` | B |
| `cover.kitchen_shutters` | B |
| `cover.lilia_s_room_back_shutters` | B |
| `cover.lilias_room_side_shutters` | B |
| `cover.master_bedroom_shutters` | B |
| `cover.porch_shutters` | B |
| `cover.presence_simulation_shutters` | B |
| `cover.projection_screen` | B |
| `cover.sofa_shutters` | B |
| `cover.tv_shutters` | B |
| `climate.bp6013g2` | B |
| `climate.danys_room_ac` | B |
| `climate.lilias_room_ac` | B |
| `climate.living_room_ac` | B |
| `climate.office_ac` | B |
| `vacuum.robot_vacuum_s5` | B |
| `vacuum.roborock_s5_0173_robot_cleaner_2` | B |

### Must remove — custom tool (W3)
`set_shutters_to_min_light` — this is a custom MCP tool (not a `Hass*` intent) that mass-moves all covers → Tier B. A "remove all destructive Hass* tools" sweep will miss it; remove explicitly.

**After pruning, verify with `GetLiveContext`** that no Tier-B/C entity or custom destructive tool remains callable.
