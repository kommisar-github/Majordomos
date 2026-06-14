# stm32 — STM32 (F103) MCU

## Abstract

**TL;DR:** Platform-level SoT for the **STMicroelectronics STM32 (F103)** MCU as a directly-attached
peripheral to edge compute. Stub — catalog placeholder pending its hw_lib gather pass.

**Load when:** stm32, stm32f103, st microcontroller, mcu, ch340, ch341, usb-serial, 1a86:7523,
hw_lib stm32.

**Key facts:**
- **STM32F103 reached over CH340 USB-serial, VID:PID `1a86:7523`.** Seen on **swarm**.
- **CH341/CH340 kernel module is out-of-tree — must be compiled** (not in the stock Jetson kernel;
  cross-platform law, see `jetson_orin.md`).

**Owner:** `/hw_lib` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`, `doc/hw_lib/imu_mpu.md`

---

> **STATUS: STUB — not yet populated.** Catalog placeholder; populate via the hw_lib consolidation
> gate as knowledge is gathered.

## Conventions

_(none yet — populated via consolidation during the hw_lib knowledge-gathering phase)_

## Notes

_(none yet)_

## Open Questions

_(none yet)_
