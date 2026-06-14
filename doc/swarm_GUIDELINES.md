# swarm — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `/swarm`, the federation bridge to the
**swarm** dev fleet's remote PM. This file is the SoT's home for canonical knowledge *about*
the swarm fleet — what it builds, its conventions, recurring asks, and routing notes — written
only on explicit PM/user request via the consolidation flow (`/review`-audited).

**Load when:** swarm fleet, swarm PM, federation bridge to swarm, swarm canon, what swarm does,
swarm conventions, SoT knowledge about swarm.

**Key facts:**
- `/swarm` is a **federation bridge**, not a local build specialist — it relays into swarm's
  remote PM (`http://192.168.1.131:3100`, project `swarm`, token-env `FED_TOK_SWARM`).
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.
- Populated during the **SoT knowledge-gathering phase** (deferred until the federated PMs are
  in the roster — currently in progress).

**Owner:** `/swarm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/federation.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

## NVIDIA Jetson baseline

> **Source:** swarm remote PM, read-only SoT gather (questionnaire), 2026-06-15.
> Derived from Swarm PM docs (`HELIOS_ORIN_NANO_BRINGUP.md`, `x3_client/HW_SW_INVENTORY.md`,
> devops rules) + PM session memory. Fields the remote PM did not have are marked
> **"not recorded"** — never inferred. Durable hardware/platform canon, not operational state.

The **swarm** fleet (multi-robot: Robomaster EP + Rosmaster X3, plus a Queen server) runs
**two** Jetson boards: a primary deployment board (robot compute) and a new Helios bench
board (dev/bringup). Both are **Jetson Orin Nano 8GB** on **JetPack 6.0 / L4T R36.2**.

### Board 1 — Deployment Jetson (primary, robot compute)

- **Address:** `192.168.1.72`
- **Status:** **OFFLINE since 2026-06-06** (still offline as of the 2026-06-15 gather; deployment work parked pending reachability).
- **Model:** Jetson Orin Nano 8GB (VERIFIED)
- **Carrier:** production robot integration; exact carrier/devkit — not recorded
- **JetPack / L4T:** JetPack 6.0 / L4T R36.2 (VERIFIED)
- **CUDA:** 12.x (r36.x bundle); cuDNN / TensorRT specific versions — not recorded
- **OS / kernel:** Ubuntu 22.04 LTS (jammy); L4T R36 kernel 5.15.x
- **Power mode / draw:** not recorded
- **RAM:** 8GB LPDDR5
- **Storage / rootfs:** storage medium — not recorded; Docker memory capped (8.5GB → 6.25GB) to fit the 8GB module
- **Cooling:** not recorded
- **Peripherals:**
  - RealSense D435 — USB3, VID:PID `8086:0b07`
  - RPLidar A1 — CP210x USB-serial, `10c4:ea60`
  - MPU-6050 external IMU — I2C bus7 @ `0x68`
  - MPU-9250 onboard IMU — via STM32
  - ESP32-S3 thermal camera — CDC-ACM, `0416:b002`
  - Orbbec Astra Pro Plus — `2bc5:050f` / `060f`
  - STM32F103 MCU — via CH340 USB-serial, `1a86:7523`
  - 40-pin GPIO header; Wi-Fi LAN
- **Role:** Edge AI brain — VSLAM / Nav2 SLAM, path planning, MQTT telemetry to the Queen
  server. **Shared by both robots (EP + X3)** — only **one** robot platform runs at a time;
  `DRONE_ID` is the identity boundary, **not** the IP.

### Board 2 — Helios bench board (new, dev / bringup)

- **Address:** `192.168.1.73` / `helios-orin-01`
- **Status:** bench/dev bringup only — **NOT yet a swarm deployment target**; not yet flashed.
- **Model:** Jetson Orin Nano 8GB module
- **Carrier:** Aerium Helios (59 × 89.5 mm, 44 g, 12–48 V in, SuperMode + on-board TPM,
  Quad MIPI CSI). **Custom BSP required:** `Aerium-Helios-BSP-Orin-NX-Nano.sh`
  (version-agnostic / **not** version-pinned; patches UART / CSI / USB-OTG / EEPROM by device-node name).
- **JetPack / L4T:** target JetPack 6.0 / L4T r36.2.0 (chosen for container parity; Aerium
  tests against JP6.2.2 / r36.5 but the BSP is **not** version-pinned)
- **CUDA:** 12.x (r36.x); validated post-flash via `nvcc --version`
- **OS / kernel:** Ubuntu 22.04 LTS; L4T R36 kernel 5.15.x
- **Power:** default MAXN (~15W); SuperMode supported by carrier; measured draw — N/A (not yet flashed)
- **RAM:** 8GB
- **Storage / rootfs:** validation checks **both** NVMe M.2 (`nvme0n1`) and eMMC (`mmcblk0`) for rootfs
- **Cooling:** not specified
- **Peripherals:** Quad MIPI CSI + on-board TPM; **headless**; no robot peripherals yet (bench/dev only)
- **Bringup gotchas:**
  - Recovery via **FRC button** (hold during power-up + 3s)
  - Flash via **USB0**
  - Run the BSP **after** SDK Manager image download **and** deleting `system.img` / `.raw`
  - UART DMA fix **only** if on r36.5
  - Host needs `dtc` / `device-tree-compiler`
- **Role:** bench/dev bringup only. A future second compute node would unblock running
  **EP + X3 simultaneously** (today the shared Board 1 forces one-at-a-time).

### Consolidated Jetson gotchas (cross-board, hard-won)

1. **`numpy<2` pin mandatory** in GPU / Isaac-ROS containers — cv2 / pyrealsense2 / OpenCV are
   built against NumPy 1.x; NumPy 2 breaks ABI.
2. **`pyrealsense2` must be compiled from source on aarch64** — copy the built `.so` into the
   venv `site-packages` (no working aarch64 wheel).
3. **Container / L4T parity matters** — `l4t-ml:r36.2.0` images can hit kernel-module mismatch
   on r36.3+ hosts; pin JetPack to the container baseline; verify with
   `docker run --runtime=nvidia l4t-base:r36.2.0 nvidia-smi`.
4. **`systemd-udev-settle` is deprecated on L4T 36** — use `udevadm wait` or polling in boot scripts.
5. **CH341 / CH340 kernel module is out-of-tree** — not in the stock Jetson kernel; must compile
   it for the USB-serial MCU / LiDAR.
6. **`brltty` steals CP210x / USB-serial devices** (hijacks the RPLidar) — mask the service.
7. **8GB RAM is tight** — cap Docker memory, trim container count; only one robot stack runs at a
   time on the shared board.
8. **Aerium Helios needs the custom BSP to even boot** (UART / CSI / USB-OTG / EEPROM DT patches);
   the stock NVIDIA image won't bring up the carrier peripherals.
9. **Avoid JetPack 7 / L4T r39** unless ready for a full container-stack migration.

## Conventions

_(none yet — populated via consolidation during the SoT knowledge-gathering phase)_

## Decisions

_(none yet)_

## Open Questions

_(none yet — e.g. what swarm's domain is, its build cadence, recurring cross-fleet asks)_
