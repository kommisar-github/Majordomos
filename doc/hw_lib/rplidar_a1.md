# rplidar_a1 — RPLidar A1 (lidar)

## Abstract

**TL;DR:** Platform-level SoT for the **Slamtec RPLidar A1** 360° laser scanner as attached to edge
compute. Stub — catalog placeholder pending its hw_lib gather pass.

**Load when:** rplidar, rplidar a1, slamtec, lidar, laser scanner, 2d lidar, cp210x, brltty,
10c4:ea60, hw_lib lidar.

**Key facts:**
- **CP210x USB-serial, VID:PID `10c4:ea60`.** Seen on **swarm**.
- **`brltty` hijacks CP210x / USB-serial devices and steals the RPLidar — mask the service**
  (cross-platform law; see `jetson_orin.md`).

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
