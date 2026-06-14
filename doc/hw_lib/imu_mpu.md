# imu_mpu — MPU-6050 / MPU-9250 (IMU)

## Abstract

**TL;DR:** Platform-level SoT for the **InvenSense MPU-6050 / MPU-9250** inertial measurement units
as attached to edge compute. Stub — catalog placeholder pending its hw_lib gather pass.

**Load when:** imu, mpu, mpu-6050, mpu6050, mpu-9250, mpu9250, invensense, accelerometer, gyroscope,
i2c imu, hw_lib imu.

**Key facts:**
- **MPU-6050 external IMU on I2C — bus7 @ address `0x68`.** Seen on **swarm**.
- **MPU-9250 onboard IMU reached via the STM32** (not direct I2C from the host); see
  `doc/hw_lib/stm32.md`.

**Owner:** `/hw_lib` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`, `doc/hw_lib/stm32.md`

---

> **STATUS: STUB — not yet populated.** Catalog placeholder; populate via the hw_lib consolidation
> gate as knowledge is gathered.

## Conventions

_(none yet — populated via consolidation during the hw_lib knowledge-gathering phase)_

## Notes

_(none yet)_

## Open Questions

_(none yet)_
