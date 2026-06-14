# realsense_d435 — Intel RealSense D435 (depth camera)

## Abstract

**TL;DR:** Platform-level SoT for the **Intel RealSense D435** active-IR stereo depth camera as
attached to edge compute. Stub — catalog placeholder pending its hw_lib gather pass.

**Load when:** realsense, d435, intel depth camera, depth sensor, stereo depth, ir projector,
pyrealsense2, librealsense, 8086:0b07, hw_lib realsense.

**Key facts:**
- **USB3 device, VID:PID `8086:0b07`.** Used by **swarm** and **dragon-vlm**.
- **`pyrealsense2` has no working aarch64 wheel — build librealsense from source** and copy the
  built `.so` into the venv `site-packages` (cross-platform law; see `jetson_orin.md`).
- **IR-emitter setting is workload-dependent and opposite per workload** — OFF for VSLAM (dot
  pattern = false features), ON for low-light gaze tracking. Set per-workload, never assumed.

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
