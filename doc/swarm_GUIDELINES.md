# swarm — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `/swarm`, the federation bridge to the
**swarm** dev fleet's remote PM. This file is the SoT's home for canonical knowledge *about*
the swarm fleet — a **comprehensive project description** of the Robomaster EP + Rosmaster X3
ground-robot swarm: mission, architecture, agent roster, stack, hardware, interfaces,
deployment, status, conventions, gotchas, and cross-fleet ties. Written only on explicit
PM/user request via the consolidation flow (`/review`-audited).

**Load when:** swarm fleet, swarm PM, federation bridge to swarm, swarm canon, what swarm
does/builds, swarm conventions, swarm architecture, Robomaster EP, Rosmaster X3, Queen server,
ground-robot swarm, SoT knowledge about swarm.

**Key facts:**
- `/swarm` is a **federation bridge**, not a local build specialist — it relays into swarm's
  remote PM (`http://192.168.1.131:3100`, project `swarm`, token-env `FED_TOK_SWARM`).
- This file is now a **full project description** of the swarm fleet (was a Jetson-only stub).
  Hardware **platform truth** is referenced from the Hardware Library (`doc/hw_lib/jetson_orin.md`);
  only swarm-specific **deployment** detail (board IPs, status, peripheral attach map) lives here.
- The swarm git repo hosts **two distinct projects**: project #1 = the **EP + X3 ground-robot
  swarm** (this canon); project #2 = a separate **defense-drone autonomous system** at the repo
  root, which swarm's fleet does **NOT** own — see *Cross-fleet & SoT relationships*.
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.

**Owner:** `/swarm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`, `FEDERATION_RULEBOOK.md` (federation policy SoT), `fleet/fleet.config.json`

---

> **Source:** swarm remote PM, read-only SoT gather (full-project-description questionnaire),
> 2026-06-15. Derived from the swarm fleet's owned canon (`CLAUDE.md`, `.claude/` rules+skills,
> `swarm_shared/doc/DOC_OWNERSHIP_MATRIX.md`, `x3_client/doc/*`, `HELIOS_ORIN_NANO_BRINGUP.md`,
> PM session memory). Specialists were offline at request time; data drawn from their
> authoritative docs. Fields the remote PM did not provide are marked **"not recorded"** —
> never inferred.

> **⚠️ Repo disambiguation (read first).** The swarm git tree holds **two distinct projects**:
> 1. **The swarm fleet's project** = the **Robomaster EP + Rosmaster X3 ground-robot swarm**
>    (`robomaster_jetson_client/`, `x3_client/`, `swarm_shared/`, `dashboard/`, `queen/` +
>    `queen-lite/`, `controller/`, `infra/`, `.claude/`). **This is the canon below.**
> 2. A separate **"Drone Swarm — Autonomous Defense System"** at the repo *root* (`README.md`,
>    `core/`, `drone/`, `queen/api`, `simulation/`, `ansible/`) — military / IFF / CARVER /
>    ArduPilot quadrotors. The swarm agent fleet does **NOT** own or manage it; it is reported
>    only in *Cross-fleet & SoT relationships* because it shares the repo + Jetson hardware.

## Mission / purpose & end goal

A **multi-robot ground swarm** of camera/LiDAR-equipped autonomous rovers, each running on a
Jetson Orin Nano, coordinated by a central **Queen** server with a real-time web **Dashboard**.
Per robot: autonomous SLAM navigation + teleoperation + live video/telemetry. **End goal:**
multiple heterogeneous robots (DJI Robomaster EP, Yahboom Rosmaster X3) sharing a common map and
coordinating navigation over MQTT, controllable from one dashboard or a gamepad, with a **portal
mode** for field operation off the home network.

## Architecture — subsystems + data flow

- **Robot clients** (edge, on Jetson): `robomaster_jetson_client` (EP) and `x3_client` (X3).
  Each runs a main orchestrator + platform containers.
- **Queen / Queen-Lite** (server): FastAPI API, MQTT consumer, Redis, WebSocket push to the
  dashboard. `queen-lite` is the on-Jetson portal-mode variant.
- **Dashboard:** React/Vite/Three.js C2 web UI (LIVE OPS + SETTINGS tabs).
- **Portal stack:** on-Jetson local portal — MediaMTX RTSP server, local MQTT broker, WiFi
  AP/Client switching, USB-serial; toggled via a signal file.
- **Shared nav library:** VoxelGrid3D, PathPlanner (A*), ObstacleAvoidance, SLAMBridge, Navigator.
- **Controller:** DJI FPV2 gamepad → command adapter.
- **infra:** mosquitto MQTT broker, DNS, ROS2 config.

**Telemetry data flow:**
`client _run_robot_loop → output_queue → main loop → mqtt.publish_telemetry() → MQTT →
mosquitto → queen mqtt_consumer → Redis → WebSocket → Dashboard`.
Commands flow the reverse direction (dashboard → queen API → MQTT command topic → client handler).

## Fleet agent roster (swarm's own — 10 specialists + infra)

| Agent | Owns |
|---|---|
| `/pm` | Planning, tracking, delegation, doc hygiene, agent evolution |
| `/arch` | Phase design, architecture (design only, no code) |
| `/review` | Adversarial design audit, readiness scoring |
| `/nav` | Shared nav: voxel grid, path planning, SLAM bridge, coordinate frames, EKF/TF |
| `/ep` | Robomaster EP: DJI chassis SDK, ESP32-S3 thermal, RealSense D435, gimbal/blaster/gripper, cuVSLAM config |
| `/x3` | Rosmaster X3: Rosmaster_Lib, Nav2, RPLidar, STM32 MCU, mecanum, ultrasonics |
| `/backend` | MQTT, FastAPI (Queen/Queen-Lite), WebSocket, command routing, portal signal |
| `/dashboard` | React/TS/Three.js UI, 3D voxel map, mobile layout |
| `/devops` | Docker, compose, SSH/push to Jetson, build scripts, systemd, portal |
| `/scm` | Git commits, branches, push, PRs |
| **infra** | **task-router** MCP server (multi-terminal agent dispatch broker); **telegram-bridge** (remote-user I/O channel, zero-token REST) |

## Software stack

- **Edge (Python):** Python 3.11, paho-mqtt v2, pydantic v2 + pydantic-settings, pyserial,
  opencv-python-headless, numpy (**`<2` pin** in GPU containers), `Rosmaster_Lib` (vendored, X3
  STM32 driver), pyrealsense2 (compiled from source), pyzmq, msgpack, smbus2.
- **ROS2:** Humble (X3 = Nav2 + RTAB-Map + LiDAR SLAM, mecanum; EP = cuVSLAM via Isaac ROS +
  custom voxel grid + A*).
- **Server:** FastAPI, Redis, mosquitto, WebSocket; MediaMTX (RTSP, port 8554).
- **Dashboard:** React **18 (pinned)**, Vite, TypeScript (strict), Three.js via
  `@react-three/fiber@8.16.2` + `@react-three/drei@9.105.6` (React-19 incompat above these),
  `lucide-react` icons only.
- **Firmware:** ESP32-S3 thermal = ESP-IDF v5.3.2; STM32F103 = stock Yahboom (STM32CubeIDE).
- **Containers:** Docker 24+, NVIDIA Container Toolkit; bases `l4t-ml:r36.2.0-py3` (EP main),
  `isaac_ros_dev-aarch64` (SLAM sidecar), `python:3.11-slim` (wifi-mgr / X3 main),
  `ros:humble-ros-base-jammy` (X3 ROS2), `bluenviron/mediamtx`.

## Hardware

> **Platform truth lives in the Hardware Library — not here.** The Jetson Orin Nano platform
> (JetPack/L4T baseline, CUDA-stack non-portability, numpy<2, pyrealsense2-from-source, `brltty`/
> CP210x hijack, CH340/CH341 out-of-tree modules, Aerium Helios BSP, etc.) is canon in
> **`doc/hw_lib/jetson_orin.md`** (and the sensor/MCU books). This section keeps only swarm's
> **deployment-specific** detail: which board is where, status, and the peripheral attach map.

- **Compute:** NVIDIA **Jetson Orin Nano 8GB** — see `doc/hw_lib/jetson_orin.md` for platform
  truth (JP6.0 / L4T R36.2 / Ubuntu 22.04 baseline + gotchas).
  - **Board 1 — Deployment Jetson (robot compute):** `192.168.1.72`. **Shared by EP and X3 —
    only ONE stack runs at a time** (`DRONE_ID` is the identity boundary, **not** the IP).
    **OFFLINE since 2026-06-06** (4 devops tasks parked pending reachability).
  - **Board 2 — Helios bench board (dev/bringup):** Jetson Orin Nano 8GB on the **Aerium Helios**
    carrier → `helios-orin-01` / `192.168.1.73`. Bringup in progress; future 2nd compute node that
    would unblock running **EP + X3 simultaneously**. Helios carrier/BSP specifics →
    `doc/hw_lib/jetson_orin.md`.
- **Peripheral attach map** (deployment detail; per-device platform notes → hw_lib sensor/MCU books):
  - RealSense D435 — `8086:0b07`
  - RPLidar A1 — `10c4:ea60` (X3)
  - MPU-6050 IMU — I2C bus 7 @ `0x68`
  - MPU-9250 onboard IMU — (X3)
  - ESP32-S3 thermal — `0416:b002`
  - Orbbec Astra Pro Plus — `2bc5:050f` / `060f` (X3)
  - STM32F103 via CH340 — `1a86:7523` (X3)
  - EP chassis — via **RNDIS USB**, `192.168.42.2`
  - GPIO (AP / Portal / LED switches)
- **EP-only peripherals:** gimbal, blaster, gripper, onboard camera (proprietary TCP, no RTSP).
- **X3-only peripherals:** LiDAR, buzzer, RGB LED strip, 4× HC-SR04P ultrasonic cliff/bump
  (decided: Jetson GPIO).

## Interfaces / protocols

- **MQTT topics:** publish `drones/{id}/status|map|video|heartbeat`; subscribe
  `drones/{id}/command`, `drones/all/command`, `drones/+/map`. Telemetry model: all fields
  `Optional` (a missing field drops the event). `ALLOWED_COMMANDS` whitelist in both `queen/api`
  and `queen-lite/api` (gates HTTP 400).
- **REST:** FastAPI (Queen `:8000`, Queen-Lite portal).
- **WebSocket:** Queen → Dashboard (real-time telemetry/video).
- **RTSP:** MediaMTX `:8554` (RGB, depth, thermal, fusion, Astra chassis streams).
- **ROS2 DDS:** internal to X3 / EP nav containers.
- **Portal switching:** `/tmp/swarm/portal_active.json` signal file; client polls every 5s and
  `mqtt.reconnect()` on host change.
- **EP video:** proprietary TCP `tcp://192.168.42.2:40921`, bridged via FFmpeg (EP has no RTSP
  server). **X3 chassis:** serial `/dev/myserial` (Rosmaster protocol `0xFF 0xFC`,
  FUNC_MOTION=`0x12`).
- **Agent control plane:** task-router MCP (HTTP, Streamable) at `127.0.0.1:3100`; federated
  cross-fleet request channel (the federation bridge this doc serves).

## Deployment topology

- **Jetson `192.168.1.72`** (robot): per-platform Docker compose. EP = 3 containers
  (main / isaac-ros SLAM / wifi-manager). X3 = `swarm-x3-ros2` (Nav2 + RTAB-Map + LiDAR + D435 +
  IMU + EKF) + main orchestrator + mediamtx. Lifecycle via `./start.sh` / `./stop.sh`
  (never raw compose).
- **Queen** = x86 PC base station ("The Queen"): MQTT broker, dashboard, RTSP, Redis, API. Wi-Fi LAN.
- **Portal mode:** Jetson hosts its own broker + RTSP + queen-lite for field ops (no home LAN).
- **Helios `192.168.1.73`** = future 2nd compute node (would unblock EP + X3 simultaneous).
- **SSH from Windows:** `plink`/`pscp` to `akolesni@192.168.1.72`; push via
  `swarm_shared/scripts/push_to_jetson.ps1`. (Credential value not recorded here — it is a secret.)
- **Remote ops:** Telegram bridge → PM.

## Status / roadmap

- **EP:** mature — chassis, thermal, D435, cuVSLAM, dashboard, portal all delivered across many
  phases.
- **X3:** active integration — Nav2 convergence (RTAB-Map + EKF + Nav2), bringup verified,
  ultrasonic path decided (2026-04-20), Astra-FPV closed (2026-04-20). Phases 4A/B/C
  (dual-platform) **deferred** pending a 2nd Jetson.
- **2026-04-21 session shipped:** WebRTC ICE fix (`MTX_WEBRTCADDITIONALHOSTS`), thermal/fusion
  RTSP reconnect v4, dashboard settings cleanup, portal-aware nav bridge, ALLOWED_COMMANDS
  expansion, RTAB-Map `map_always_update`, nav-bridge params unwrap, nav-panel mode gating.
- **Current focus (2026-06):** Aerium **Helios Orin Nano bringup** — fully unblocked, bringup doc
  complete but **uncommitted** (next: `/scm` commit). Deployment Jetson **offline since 2026-06-06**;
  4 devops tasks parked.
- **Open verify items:** navigate-with-wheels-on-ground + valid costmap; Reset Map E2E; dashboard
  version-badge after commits.

## Conventions / standards

- **Planning-only default mode** — Claude plans; implementation is delegated/explicit. Strict
  **phase isolation** (never advance without user "yes"); retry limit 2.
- **Push-to-Jetson after any `robomaster_jetson_client/` edit.**
- **BUILD.md Rule 0:** sequential push-then-build; `compose up -d --no-deps` (not `docker restart`)
  for code deploys; `--no-cache` for dashboard rebuilds.
- **Doc governance:** `DOC_OWNERSHIP_MATRIX.md` (PM-owned) maps every doc → primary/secondary
  agent; every doc carries an `## Abstract` block; a new doc must be matrixed in the same commit.
- **Imports rule:** no cross-imports from root `core/` / `drone/` / `robomaster_client/` into
  `robomaster_jetson_client/` (use `internal/`). **Telemetry:** base telemetry always published;
  platform fields added only when the chassis is connected.
- Conventional commits; debug scripts live in each platform's `debug/`.

## Known issues / gotchas / open questions

- **Deployment Jetson offline** since 2026-06-06 → 4 parked devops tasks (X3 file push,
  wheels-don't-move groundtruth, X3 TF/EKF fix, drone.json verify).
- **Open issues:** dashboard 3D map rendering enhancement (2.5D extrude vs OctoMap voxels);
  obsolete dashboard settings (Camera / Nav Map Mode) cleanup.
- **Gotchas (hard-won):**
  - Kernel pipe buffer (~65KB) masks a dead ffmpeg → use `_proc.poll()`.
  - `docker compose up -d <svc>` recreates siblings → use `--no-deps`; `docker restart` doesn't
    swap images.
  - RTAB-Map `Grid/MapAlwaysUpdate` ≠ ROS2 `map_always_update` (namespace mismatch).
  - MQTT payload shape `{command, params:{…}}` must be unwrapped.
  - paho v2 `on_connect` gives a `ReasonCode`, not an int.
  - MQTT worker exits permanently after 15 failed reconnects.
  - Platform-level gotchas (`systemd-udev-settle` deprecated on L4T36 → `udevadm wait`; `brltty`
    hijacks CP210x → mask it; CH341 module out-of-tree; numpy<2; pyrealsense2-from-source) are
    canon in **`doc/hw_lib/jetson_orin.md`** — not duplicated here.

## Cross-fleet & SoT relationships

- **Federation:** swarm's fleet exposes `pm` over the task-router with a federated **RWX** grant
  (whole-fleet access; legacy `RWE` = `RWX`);
  it has answered SoT gathers (Jetson hardware baseline + this full project canon).
- **Shared baseline:** the Jetson Orin Nano / JP6.0 / L4T R36.2 / Ubuntu 22.04 stack is the
  cross-fleet common compute — contributed to the SoT Jetson canon (`doc/hw_lib/jetson_orin.md`).
- **Shared-repo neighbor (NOT swarm's project):** the repo root hosts a separate **defense-drone
  autonomous system** (FastAPI + Redis + Qdrant Queen, IFF/CARVER/EOF/ROE doctrine, ArduPilot
  quadrotors, InsightFace/YOLO/MoveNet vision, Gazebo SITL, Ansible fleet deploy, 7-stage CI).
  It **shares** the git repo, the Jetson Orin Nano hardware class, and the `queen/` directory name.
  swarm's fleet does **not** own, manage, or hold authoritative canon on it — if the SoT needs its
  detail, query its own owner/maintainer. (Reported from the repo-root `README.md` only.)
- **What swarm would want from the SoT:** a canonical cross-fleet Jetson flashing / version-pinning
  reference (so Helios + future nodes stay container-parity); and a shared hardware-reference index
  if other fleets use D435 / RPLidar / ESP32 thermal — both now in scope via `/hw_lib`.

## Decisions

- **2026-06-15** — Jetson platform truth migrated out of this doc into the Hardware Library
  (`doc/hw_lib/jetson_orin.md` + sensor/MCU books); this file keeps swarm-specific deployment
  detail only (board IPs `.72`/`.73`, offline status, peripheral attach map) and references the
  hw_lib books for platform gotchas.

## Open Questions

- When does the deployment Jetson (`192.168.1.72`) come back online to unpark the 4 devops tasks?
- Helios (`192.168.1.73`) bringup-doc commit timing (parked at `/scm` commit step).
- Dashboard 3D-map rendering direction (2.5D extrude vs OctoMap voxels) — not recorded as resolved.
