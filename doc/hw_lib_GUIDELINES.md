# hw_lib — Hardware Library Catalog

## Abstract

**TL;DR:** The catalog/index for `/hw_lib`, the Hardware Library SoT agent. One row per
hardware "book" (edge/embedded compute + directly-attached sensors/peripherals/MCUs), with
the cross-platform laws that span more than one book. Each book is a full SoT document under
`doc/hw_lib/`; this file is the entry point the `hw_lib` federation grant serves.

**Load when:** hardware, jetson, realsense, orbbec, lidar, rplidar, esp32, stm32, imu, mpu,
edge compute, sensor, peripheral, hw_lib, hardware library, SoT.

**Key facts:**
- Class scope = **edge/embedded compute + directly-attached sensors/peripherals/MCUs**. Desktop
  GPUs (RTX 5070) and NVR/IP-camera appliances (UniFi Protect / UNVR) are explicitly **out of
  class** — they belong to fleet-deployment docs, not the hardware library.
- This catalog holds **platform truth**, not per-fleet deployment state — board IPs, online/offline
  status, and "deployed since" facts stay in `doc/{swarm,dragon-vlm,jetson-protect}_GUIDELINES.md`.
- The foremost cross-platform law: **aarch64-Jetson CUDA stack ≠ x86 desktop CUDA stack** —
  compiled GPU artifacts are **not portable**; rebuild on-device.
- Books are written/extended only through the **hw_lib consolidation gate** (request → PM →
  `/review`). Six of seven books are stubs awaiting their gather pass.
- **Ownership is by federation grant, not by one fleet** (see *Access & ownership* below): any
  project holding an **RW{R,W}** (or **RWX{R,W,X}**; legacy `RWE` = `RWX`) grant on the `hw_lib`
  agent is a **co-owner** and may contribute/update books; an **RO{R}** grant is a read-only
  consumer.

**Owner:** `/hw_lib` curator (Primary per DOC_OWNERSHIP_MATRIX.md) + **any project with an RW{R,W}
grant on `hw_lib`** (federation co-owner)
**Related:** `doc/hw_lib/jetson_orin.md`, `doc/swarm_GUIDELINES.md`,
`doc/dragon-vlm_GUIDELINES.md`, `doc/jetson-protect_GUIDELINES.md`,
`FEDERATION_RULEBOOK.md` (§4 provider rules + §1 access model — canonical authority for how
`hw_lib` is served)

---

## Access & ownership

The hardware library is a **shared SoT corpus**. **The single `hw_lib` agent token is the access
boundary for the whole library** — this catalog *and* every book under `doc/hw_lib/`. There is no
per-book token; one grant covers everything. Ownership is defined by the grant level a project
holds on the `hw_lib` agent — not by which fleet first wrote a book. **Canonical authority for how
`hw_lib` is served: `FEDERATION_RULEBOOK.md` §4 (SoT-agent provider rules) + §1 (R/W/X access
model).**

**Accessed by name (seed v4.20 / server v1.5.x).** A consumer/co-owner project that holds a grant
on `hw_lib` registers it as a first-class `role:"federated-sot"` roster entry — the App's "Add SoT
agent" writes the `agents.json` block, stores the token in `federation.env`, and registers it, so
it appears as a 📚 dashboard card carrying its granted level. Once registered, the caller exercises
the grant **by name** with the `federated_read_file` / `federated_write_file` MCP tools (legacy
`read_guidelines` / `write_guidelines` = `read_file` / `write_file`).

**How the serving side (this fleet, the provider) fulfils a request (rulebook §4):**
- **`read_file` (R)** — the serving PM/`/hw_lib` curator **shell-copies the catalog
  `doc/hw_lib_GUIDELINES.md` + the whole book tree `doc/hw_lib/**.md`** (or the single named file)
  into **`.claude/mcp/task-router/fed-stage/out/<handle>/`** — **without reading the bytes into
  context** — and the server streams them to the caller. The whole tree counts as **one** read
  (**one anti-distillation unit**).
- **`write_file` (W)** — the caller's contribution arrives **staged** in
  **`.claude/mcp/task-router/fed-stage/in/<handle>/`**. The curator **audits** it, backs up first,
  moves the appropriate files into `doc/hw_lib/`, **updates this catalog**, and **cites the external
  caller** in the commit.
- **Consumer-side convention:** a consumer that pulls this library lands the fetched files in
  **`doc/sot/hw_lib/`** (the canonical home for SoT-sourced files, per rulebook §3).

The bytes transfer **server-to-server through temp staging** and **never enter the caller's — or
the serving PM's — context**. This supersedes the legacy `remote-read-guidelines` /
`remote-write-guidelines` client verbs, which printed bytes to stdout/context; those are
**deprecated for SoT corpus access**.

| Grant on `hw_lib` | Caps | Role | May |
|---|---|---|---|
| **RO** | {R} | consumer | read the **entire library** — this catalog + every book under `doc/hw_lib/` — via the one `hw_lib` token (the server's **R** / `read_file` capability); fetched **by name** with the `federated_read_file` tool once the library is registered as a `federated-sot` agent; budgeted by anti-distillation |
| **RW** | {R, W} | **co-owner** | also contribute/update books via `write_file` — submit hardware knowledge that the `/hw_lib` curator runs through the consolidation gate (`/review`) |
| **RWX** | {R, W, X} | co-owner + | also request execution (X) (e.g. commission a gather). Legacy `RWE` = `RWX`. |

- **Any project with an RW{R,W} grant is an owner** of the library and is expected to keep its
  hardware knowledge current here. The local `/hw_lib` curator is the gate-runner for *all*
  writes (local or federated), never the sole owner.
- A federated `write_file` (W) contribution arrives as a `# [FEDERATED REQUEST]` to PM
  (legacy `write_guidelines`, agent `hw_lib`); PM routes it to `/hw_lib` → `/review` → commit,
  citing the contributing project.
- Grants are **per agent** (the federation schema's unit). Need finer granularity than the whole
  library? That is a separate agent, by request — not a per-book token.
- **"Co-owner" ≠ the guidebook's `topic_ownership`.** Here "co-owner" is an informal *contributor*
  label that follows from holding an RW grant. The guidebook's `topic_ownership` registry
  (`set-topic-owner --topic=hw_lib --fleet-id=…`) is a separate thing the SoT maintainer sets
  explicitly; it governs **active-pull direction** (which fleet the SoT commissions research from),
  not write permission, and is **not** implied by a grant.

---

## Catalog

| Book | Platform | Doc | Status | Seen in fleets |
|---|---|---|---|---|
| jetson_orin | NVIDIA Jetson Orin Nano 8GB (compute module) | `doc/hw_lib/jetson_orin.md` | written | swarm, dragon-vlm, jetson-protect (design-target) |
| realsense_d435 | Intel RealSense D435 (depth camera) | `doc/hw_lib/realsense_d435.md` | stub | swarm, dragon-vlm |
| orbbec_astra | Orbbec Astra Pro Plus (depth camera) | `doc/hw_lib/orbbec_astra.md` | stub | swarm |
| rplidar_a1 | RPLidar A1 (lidar) | `doc/hw_lib/rplidar_a1.md` | stub | swarm |
| esp32 | ESP32 / ESP32-S3 (MCU/SoC) | `doc/hw_lib/esp32.md` | stub | swarm |
| stm32 | STM32 (F103) MCU | `doc/hw_lib/stm32.md` | stub | swarm |
| imu_mpu | MPU-6050 / MPU-9250 (IMU) | `doc/hw_lib/imu_mpu.md` | stub | swarm |

> **Out of class (not catalogued here):** RTX 5070 desktop GPU and UniFi Protect / UNVR —
> different hardware class (desktop GPU / NVR appliance). Their facts live in the fleet bridge
> GUIDELINES, not the hardware library.

---

## Cross-platform laws

Rules that genuinely span more than one book live here; book-specific detail stays in the books.

1. **aarch64-Jetson CUDA stack ≠ x86 desktop CUDA stack — compiled GPU artifacts are NOT
   portable; rebuild on-device.** The Jetson (aarch64, sm_87 Ampere) GPU stack is a different
   architecture from x86 desktop dev GPUs (Blackwell / sm_120, CUDA 12.8+). Never copy `.so`,
   TensorRT `.engine`, or TensorRT-LLM artifacts desktop → Jetson; rebuild **inside the Jetson
   container, on-device**. This law spans Jetson + every desktop GPU host. (See
   `doc/hw_lib/jetson_orin.md` for the full treatment.)

2. **`pyrealsense2` has no working aarch64 PyPI wheel — build librealsense from source on
   aarch64.** Affects every aarch64 host driving a RealSense D435 (jetson_orin × realsense_d435).
   Copy the built `.so` into the venv `site-packages`. (Detail: `realsense_d435.md`.)

3. **`numpy<2` pin is mandatory in GPU / vision containers on aarch64** — cv2 / pyrealsense2 /
   OpenCV are built against NumPy 1.x; NumPy 2 breaks the ABI. Spans the Jetson platform and any
   sensor pulled through OpenCV. (Detail: `jetson_orin.md`.)

4. **`brltty` hijacks CP210x / USB-serial devices — mask the service.** Bites any CP210x-based
   peripheral on Linux (rplidar_a1 on the Jetson platform). Spans jetson_orin × rplidar_a1.

5. **Out-of-tree USB-serial kernel modules (CH341/CH340) must be compiled** — not in the stock
   Jetson kernel. Bites MCUs/LiDAR reached over CH340 (stm32, and serial peripherals on the
   Jetson). Spans jetson_orin × stm32.

---

## Conventions

- One book per hardware platform, filed at `doc/hw_lib/<hw>.md`, each carrying a full `## Abstract`
  block (Owner `/hw_lib`).
- **Hardware-reference Abstracts** lead with the hardware model name and MUST include VID/PID for
  USB devices and the I2C address for I2C devices (per DOC_OWNERSHIP_MATRIX.md §3).
- Platform truth here; deployment state in the fleet bridge GUIDELINES. A book may carry a
  "Where it's deployed" pointer to the bridges, but never copies board IPs or online/offline state.
- A rule earns a place in **Cross-platform laws** only if it spans ≥2 books; otherwise it lives in
  its book.

## Decisions

- **`sot/jetson_orin_baseline.md` superseded by `hw_lib/jetson_orin.md`** (2026-06-15) — the
  PM-owned cross-fleet Jetson synthesis was migrated into Book 1 of the hardware library; the
  platform-level content moved here, per-fleet deployment specifics stayed in the bridges.
- **Federated tree-serve gap resolved by `federated_read_file`** (2026-06-17) — the old
  per-agent `read_guidelines(agent=X)` served only the single `hw_lib_GUIDELINES.md`, so a
  federated RO read couldn't reach full book depth. Seed v4.20 / server v1.5.x's
  `federated_read_file` stages the **whole corpus** — this catalog **+ every `doc/hw_lib/**` book** —
  server-to-server into the caller's `fed-stage/in/` in a single request. Confirmed in practice: an
  inbound federated read_file request staged all 8 files (catalog + 7 books) for an external HW Lib
  SoT caller. The intended "one `hw_lib` token → catalog + all books" model is now satisfied; closes
  the corresponding Open Question.

## Open Questions

- **(RESOLVED 2026-06-17 — see Decisions) Server dependency — federated tree-serve.** Superseded by
  `federated_read_file` (seed v4.20 / server v1.5.x), which stages the whole corpus
  (catalog + every `doc/hw_lib/**` book) server-to-server in one request. History pointer retained
  in *Decisions*.
- Which of the six stub books gets the next gather pass (sensor-first vs MCU-first)?
- Whether to add a fleet JetPack-floor recommendation as a cross-platform law once a baseline is
  pinned (currently an open question in `jetson_orin.md`).
