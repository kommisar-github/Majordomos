# NVIDIA Jetson — Cross-Fleet Source of Truth

**Owner:** `/pm` (Majordomus SoT) · **Type:** cross-cutting reference
**Created:** 2026-06-15 (first SoT knowledge-gathering pass)
**Sources:** read-only federated gather from the three fleet PMs (swarm, dragon-vlm,
jetson-protect) on 2026-06-15, each `/review`-audited through the consolidation gate.
Per-fleet canon lives in `doc/<fleet>_GUIDELINES.md → ## NVIDIA Jetson baseline`; this
file is the **cross-fleet synthesis** — what is common, what differs, and the hard-won
lessons that transfer between fleets.

> **Headline:** every federated project standardizes on the **NVIDIA Jetson Orin Nano 8GB**
> as its edge compute. The 8GB unified-memory budget and the aarch64-vs-desktop CUDA split
> are the two constraints that shape every fleet's design.

---

## 1. At-a-glance comparison

| Field | **swarm** (2 boards) | **dragon-vlm** (Drakosha) | **jetson-protect** |
|-------|----------------------|---------------------------|--------------------|
| **Module** | Orin Nano 8GB ×2 | Orin Nano 8GB | Orin Nano 8GB |
| **Form factor** | Board 1: production robot integ.; Board 2: Aerium Helios carrier | Developer Kit (ref. carrier) | not provisioned *(design-target)* |
| **JetPack / L4T** | 6.0 / R36.2 | 6.2.2 | 6.2.1 *(target; ceiling for Orin DS)* |
| **OS** | Ubuntu 22.04 (jammy), kernel 5.15.x | Ubuntu 22.04 aarch64 | Ubuntu 22.04 *(target)* |
| **CUDA family** | 12.x (r36.x) | JP6.2.2 bundle | TensorRT 10.3 (DS 7.1) *(target)* |
| **Power** | ~15W (Helios MAXN) | 15W mode (~15W) | ~25W target *(design-target)* |
| **Primary sensor** | RealSense D435 + Lidar + IMUs (Board 1) | RealSense D435 | **UniFi Protect IP cameras** (no CSI) |
| **Status (2026-06-15)** | Board 1 **OFFLINE** since 2026-06-06; Board 2 bench/unflashed | **ACTIVELY DEPLOYED** | **NOT flashed** — Phase 4 deferred |
| **Role** | Robot edge brain (VSLAM/Nav2/SLAM) | Always-on VLM companion runtime | Edge security appliance (DeepStream YOLO) |

---

## 2. Universal baseline (true for every fleet)

- **Module:** Jetson **Orin Nano 8GB** — Ampere GPU, compute capability **sm_87**.
- **OS:** Ubuntu 22.04 LTS, aarch64; JetPack 6.x / L4T R36 line (kernel 5.15.x where recorded).
- **8GB unified LPDDR5 (CPU+GPU shared) is the binding constraint** on every fleet — it caps
  container count (swarm: Docker mem capped, one robot stack at a time), concurrent model
  tiers (jetson-protect: ~3–4 streams, max 1×4K), and co-tenancy headroom (dragon-vlm: RAM
  contention with swarm containers). Budget memory first; everything else follows.
- **Low-power envelope:** 15–25W whole-module — that is the entire reason the Jetson is the
  deployment target over the desktop GPUs (~300W).

---

## 3. The cross-fleet hard rule — Jetson CUDA ≠ desktop CUDA

**Independently reported by two fleets — treat as a fleet-wide law.**

- The Jetson (JetPack **aarch64**, **sm_87** Ampere) GPU stack is a **different architecture**
  from the x86 desktop dev GPUs (dragon-vlm: RTX 5070 **Blackwell** CUDA 12.8+; jetson-protect:
  desktop **sm_120**). **Compiled GPU artifacts are NOT portable** between them.
- **Never copy `.so`, TensorRT `.engine`, or TensorRT-LLM artifacts from desktop → Jetson.**
  Rebuild **on-device, inside the Jetson container**:
  - dragon-vlm: TensorRT-LLM conversion happens in place on the Jetson.
  - jetson-protect: YOLO ONNX re-exported + TRT engine rebuilt in the Jetson container;
    `.engine` files are never committed.
- **DeepStream version is GPU-architecture-bound** (jetson-protect): DS **7.1** is the cap on
  Orin Nano; DS **8.0** is Thor/Blackwell only. Pipeline code must guard the "new nvstreammux"
  property differences (`find_property()` guards) when the same code runs on both.

## 4. RealSense / aarch64 Python lessons (swarm + dragon-vlm)

Both vision fleets hit the identical aarch64 packaging wall:

- **`pyrealsense2` has no working aarch64 PyPI wheel** — `pip install` ships an x86_64 stub
  that fails with `"undefined symbol"`. **Build librealsense from source** (dragon-vlm
  confirms **v2.57.7**) and copy the built `.so` into the venv `site-packages`.
- **`numpy<2` pin is mandatory** in GPU / Isaac-ROS containers (swarm) — cv2 / pyrealsense2 /
  OpenCV are built against NumPy 1.x; NumPy 2 breaks the ABI.

### The IR-emitter inversion (same sensor, opposite config)

The most instructive cross-fleet datum: swarm and dragon-vlm use the **same RealSense D435**
but with **opposite IR-projector requirements**:

- **swarm / cuVSLAM → IR projector OFF** — the projected dot pattern registers as **false
  stationary features** and corrupts VSLAM.
- **dragon-vlm / MediaPipe → IR projector ON** — needs the active illumination for low-light
  gaze tracking.

⚠️ **This matters because dragon-vlm and swarm share the same physical Jetson** (swarm drone
containers are stopped in dependency order before each Drakosha deploy). A D435 emitter setting
correct for one fleet is wrong for the other — emitter state must be set per-workload, never
assumed.

## 5. Platform / OS gotchas worth carrying between fleets

- **`systemd-udev-settle` is deprecated on L4T 36** — use `udevadm wait` or polling (swarm).
- **Out-of-tree USB-serial kernel modules** (CH341/CH340) must be compiled — not in the stock
  Jetson kernel (swarm: MCU + LiDAR).
- **`brltty` hijacks CP210x / USB-serial devices** — mask the service (swarm: steals RPLidar).
- **Container ↔ L4T parity** — an image built for `l4t-ml:r36.2.0` can hit kernel-module
  mismatch on r36.3+ hosts; pin JetPack to the container baseline (swarm).
- **CRLF kills shell scripts silently** on Windows→Jetson workflows — `sed -i 's/\r$//' *.sh`
  after every push (dragon-vlm).
- **Native decode is native** — do **not** apply WSL2-only software-decode workarounds
  (`USE_SW_DECODE=1`) on real L4T; `nvv4l2decoder` works natively (jetson-protect).
- **Avoid JetPack 7 / L4T r39** unless ready for a full container-stack migration (swarm).

## 6. Per-fleet specifics (pointers — full detail in each GUIDELINES file)

- **swarm** → `doc/swarm_GUIDELINES.md`. Two boards: deployment robot board (`192.168.1.72`,
  offline since 2026-06-06) shared by EP+X3 one-at-a-time (`DRONE_ID` is identity, not IP);
  new **Aerium Helios** bench board (`192.168.1.73`) needing a custom version-agnostic BSP
  (`Aerium-Helios-BSP-Orin-NX-Nano.sh`) to bring up UART/CSI/USB-OTG/EEPROM. Rich peripheral
  set (D435, RPLidar A1, MPU-6050/9250, ESP32-S3 thermal cam, Orbbec Astra, STM32 MCUs).
- **dragon-vlm** → `doc/dragon-vlm_GUIDELINES.md`. Actively-deployed DevKit; shared board with
  swarm; D435 + USB mic + foot-pedal; runs local Moondream-2 VLM, Director state machine,
  voice/agent loop, WebSocket server.
- **jetson-protect** → `doc/jetson-protect_GUIDELINES.md`. **Design-target only — Phase-4
  deferred, no board flashed.** IP-camera (UniFi Protect / UNVR RTSP) ingest, no CSI;
  DeepStream 7.1 + YOLO11n(INT8) target; MQTT/HA + Telegram alerts.

## 7. Open cross-fleet questions

- **Shared-board contention (swarm ↔ dragon-vlm):** the two fleets co-tenant one physical
  Orin Nano. No documented arbitration beyond "stop swarm containers before Drakosha deploy" —
  worth a formal ownership/scheduling note as both fleets mature.
- **JetPack drift:** swarm on 6.0/R36.2, dragon-vlm on 6.2.2, jetson-protect targeting 6.2.1.
  No fleet-wide pinned baseline. Container/L4T parity bites when versions diverge — a
  recommended fleet JetPack floor would de-risk cross-fleet image reuse.
- **jetson-protect Phase-4 bringup:** all values are unverified projections until a board is
  flashed; the MTAP24/multi-PPS H.264 question and INT8 calibration headroom resolve only on
  real hardware.
