# jetson_orin — NVIDIA Jetson Orin Nano 8GB (Book 1)

## Abstract

**TL;DR:** Platform-level SoT for the **NVIDIA Jetson Orin Nano 8GB** edge compute module —
the universal baseline (sm_87 Ampere, JetPack 6.x / L4T R36, Ubuntu 22.04 aarch64, 8GB
unified-memory budget, 15–25W envelope), the aarch64-vs-desktop CUDA split, and the hard-won
aarch64 packaging / udev / USB-serial gotchas that transfer between fleets. Platform truth only —
per-fleet deployment state lives in the fleet bridge GUIDELINES.

**Load when:** jetson, orin, orin nano, jetpack, l4t, r36, sm_87, aarch64 cuda, tensorrt jetson,
deepstream, edge compute, unified memory, jetson gotchas, hw_lib jetson.

**Key facts:**
- Module = **Jetson Orin Nano 8GB**, Ampere GPU, compute capability **sm_87**; OS Ubuntu 22.04
  LTS aarch64, JetPack 6.x / **L4T R36** line (kernel 5.15.x).
- **8GB unified LPDDR5 (CPU+GPU shared)** is the binding design constraint on every workload —
  budget memory first; everything else follows.
- **aarch64-Jetson CUDA ≠ x86 desktop CUDA — compiled GPU artifacts (`.so`, `.engine`,
  TensorRT-LLM) are NOT portable.** Rebuild on-device, inside the Jetson container.
- `pyrealsense2` has **no working aarch64 wheel** (build librealsense from source); `numpy<2`
  pin is mandatory in GPU/vision containers.

**Owner:** `/hw_lib` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/swarm_GUIDELINES.md`,
`doc/dragon-vlm_GUIDELINES.md`, `doc/jetson-protect_GUIDELINES.md`

---

> **Scope note:** This book holds **platform truth** about the Orin Nano 8GB — what is true of
> the hardware/OS/CUDA stack regardless of which fleet runs it. **Per-fleet deployment specifics**
> (board IPs, online/offline status, "deployed since" dates, carrier choices) live in the fleet
> bridge GUIDELINES, not here. See *Where it's deployed* below.

## 1. Universal baseline (true on every Orin Nano 8GB)

- **Module:** Jetson **Orin Nano 8GB** — Ampere GPU, compute capability **sm_87**.
- **OS:** Ubuntu 22.04 LTS, **aarch64**; JetPack 6.x / **L4T R36** line (kernel 5.15.x where recorded).
- **Memory:** **8GB unified LPDDR5**, shared between CPU and GPU. This is *the* binding constraint —
  it caps container count, concurrent model tiers, and co-tenancy headroom. Observed mitigations:
  cap Docker memory to fit the module (e.g. 8.5GB → 6.25GB), run one heavy stack at a time. Budget
  memory first.
- **Power envelope:** **15–25W** whole-module. This low envelope is the entire reason the Jetson is
  the deployment target over desktop GPUs (~300W). Typical modes: MAXN ~15W; security-appliance
  target ~25W.
- **CUDA family:** 12.x (r36.x bundle); exact cuDNN/TensorRT versions are JetPack-build-specific —
  validate post-flash via `nvcc --version`.

## 2. The hard rule — Jetson CUDA ≠ desktop CUDA

**Reported independently by multiple fleets — treat as a platform-wide law.**

- The Jetson (JetPack **aarch64**, **sm_87** Ampere) GPU stack is a **different architecture** from
  x86 desktop dev GPUs (Blackwell, sm_120, CUDA 12.8+). **Compiled GPU artifacts are NOT portable**
  between them.
- **Never copy `.so`, TensorRT `.engine`, or TensorRT-LLM artifacts from desktop → Jetson.** Rebuild
  **on-device, inside the Jetson container**:
  - TensorRT-LLM conversion happens in place on the Jetson.
  - YOLO ONNX is re-exported and the TRT `.engine` rebuilt in the Jetson container; `.engine` files
    are never committed.
- **DeepStream version is GPU-architecture-bound:** DS **7.1** is the cap on Orin Nano; DS **8.0** is
  Thor/Blackwell only. Pipeline code that must run on both should guard the "new nvstreammux"
  property differences (`find_property()` guards).

## 3. RealSense / aarch64 Python lessons

Hosts driving a RealSense D435 from an Orin Nano hit the aarch64 packaging wall (cross-references
`doc/hw_lib/realsense_d435.md`):

- **`pyrealsense2` has no working aarch64 PyPI wheel** — `pip install` ships an x86_64 stub that
  fails with `"undefined symbol"`. **Build librealsense from source** (v2.57.7 confirmed) and copy
  the built `.so` into the venv `site-packages`.
- **`numpy<2` pin is mandatory** in GPU / Isaac-ROS / vision containers — cv2 / pyrealsense2 /
  OpenCV are built against NumPy 1.x; NumPy 2 breaks the ABI.

### The IR-emitter inversion (same sensor, opposite config)

The same physical **RealSense D435** is used with **opposite IR-projector requirements** depending
on the consuming workload:

- **VSLAM (cuVSLAM) → IR projector OFF** — the projected dot pattern registers as **false
  stationary features** and corrupts VSLAM.
- **Gaze tracking (MediaPipe) → IR projector ON** — needs the active illumination for low-light
  tracking.

⚠️ Because two fleets can share one physical Jetson + D435, an emitter setting correct for one
workload is wrong for the other. **Emitter state must be set per-workload, never assumed.** (The
fleet-co-tenancy arbitration detail stays in the bridge docs.)

## 4. Platform / OS gotchas worth carrying

- **`systemd-udev-settle` is deprecated on L4T 36** — use `udevadm wait` or polling in boot scripts.
- **Out-of-tree USB-serial kernel modules (CH341/CH340) must be compiled** — not in the stock Jetson
  kernel (needed for USB-serial MCUs / LiDAR).
- **`brltty` hijacks CP210x / USB-serial devices** — mask the service (it steals the RPLidar).
- **Container ↔ L4T parity** — an image built for `l4t-ml:r36.2.0` can hit kernel-module mismatch on
  r36.3+ hosts; pin JetPack to the container baseline. Verify with
  `docker run --runtime=nvidia l4t-base:r36.2.0 nvidia-smi`.
- **CRLF kills shell scripts silently** on Windows→Jetson workflows — `sed -i 's/\r$//' *.sh` after
  every push.
- **Native decode is native** — do **not** apply WSL2-only software-decode workarounds
  (`USE_SW_DECODE=1`) on real L4T; `nvv4l2decoder` works natively.
- **Avoid JetPack 7 / L4T r39** unless ready for a full container-stack migration.

## 5. Carrier / bringup notes (platform-level)

- **Developer Kit reference carrier** is the default; some fleets use custom carriers (e.g. an
  Aerium Helios carrier with Quad MIPI CSI + on-board TPM, 12–48V in, SuperMode).
- A **custom carrier may require a version-agnostic BSP** to bring up UART / CSI / USB-OTG / EEPROM
  by device-node name — the stock NVIDIA image won't bring up non-reference carrier peripherals.
  (The specific Helios `Aerium-Helios-BSP-Orin-NX-Nano.sh` bringup procedure and per-board status are
  swarm-fleet specifics — see the bridge.)
- Recovery/flash basics: FRC button (hold during power-up + 3s), flash via USB0; host needs `dtc` /
  `device-tree-compiler`. Rootfs may live on NVMe M.2 (`nvme0n1`) or eMMC (`mmcblk0`).

## 6. Where it's deployed (see fleet bridges)

Deployment state — which boards, their IPs, online/offline status, and current role — is **not**
platform truth and is intentionally **not** recorded here. See the per-fleet bridge GUIDELINES:

- **swarm** → `doc/swarm_GUIDELINES.md` (robot edge brain; multi-board, rich peripheral set).
- **dragon-vlm** → `doc/dragon-vlm_GUIDELINES.md` (always-on VLM companion runtime).
- **jetson-protect** → `doc/jetson-protect_GUIDELINES.md` — **design-target only / no board flashed
  (Phase-4 deferred).** Its Orin Nano specs (e.g. ~25W, TensorRT 10.3 / DeepStream 7.1, INT8 YOLO)
  are **projections**, unverified until a board is flashed; treat them as design targets, not
  measured platform facts.

## 7. Open platform questions

- **JetPack drift across fleets** (6.0/R36.2 vs 6.2.2 vs 6.2.1-target) — no platform-wide pinned
  baseline. Container/L4T parity bites when versions diverge; a recommended JetPack floor would
  de-risk cross-host image reuse.
- **DeepStream/MTAP24 + INT8 calibration headroom** on Orin Nano resolve only on real hardware
  (open until a design-target board is flashed).
