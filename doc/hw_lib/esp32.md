# esp32 — ESP32 / ESP32-S3 (MCU/SoC)

## Abstract

**TL;DR:** Platform-level SoT for the **Espressif ESP32 / ESP32-S3** MCU/SoC as a directly-attached
peripheral to edge compute. Stub — catalog placeholder pending its hw_lib gather pass.

**Load when:** esp32, esp32-s3, espressif, mcu, microcontroller, cdc-acm, thermal camera,
0416:b002, hw_lib esp32.

**Key facts:**
- **ESP32-S3 enumerates as CDC-ACM, VID:PID `0416:b002`** (thermal camera) on **swarm**.
- **Toolchain: ESP-IDF (or Arduino-ESP32); flashed over USB (CDC-ACM / UART bootloader)** — to
  confirm and detail on the gather pass (IDF version, flash baud/recipe, the host CDC-ACM driver).

**Owner:** `/hw_lib` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`

---

> **STATUS: STUB — not yet populated.** Catalog placeholder; populate via the hw_lib consolidation
> gate as knowledge is gathered.

## Conventions

_(none yet — populated via consolidation during the hw_lib knowledge-gathering phase)_

## Notes

_(none yet)_

## Open Questions

_(none yet)_
