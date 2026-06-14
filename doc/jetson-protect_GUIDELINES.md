# jetson-protect — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `/jetson-protect`, the federation bridge to the
**jetson-protect** dev fleet's remote PM. This file is the SoT's home for canonical knowledge
*about* the jetson-protect fleet — what it builds, its conventions, recurring asks, and routing
notes — written only on explicit PM/user request via the consolidation flow (`/review`-audited).

**Load when:** jetson-protect fleet, jetson-protect PM, federation bridge to jetson-protect,
jetson-protect canon, what jetson-protect does, jetson-protect conventions, SoT knowledge about jetson-protect.

**Key facts:**
- `/jetson-protect` is a **federation bridge**, not a local build specialist — it relays into
  jetson-protect's remote PM (`http://192.168.1.131:3100`, project `jetson-protect`, token-env `FED_TOK_JETSON_PROTECT`).
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.
- Populated during the **SoT knowledge-gathering phase** (deferred until the federated PMs are
  in the roster — currently in progress).

**Owner:** `/jetson-protect` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/federation.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

## NVIDIA Jetson baseline

> ⚠️ **STATUS: DESIGN-TARGET / PHASE-4-DEFERRED / NOT-YET-FLASHED.** No Jetson board
> has been flashed, run, or benchmarked for the **jetson-protect** fleet. Every value
> below is a **design-target spec** drawn from architecture / DeepStream docs — **not**
> verified deployed hardware. The only thing running today is a **desktop dev box**
> (RTX 5070 + WSL2 + DeepStream 8.0). Values tagged **(expected)** are unverified
> projections; fields the remote PM did not record are marked **"omitted / not recorded"** —
> never inferred.
>
> **Source:** jetson-protect remote PM, read-only SoT gather (questionnaire), 2026-06-15.
> Derived from `doc/architecture.md §2.7`, `doc/deepstream.md §1/§6/§8`, and project
> memory (Jetson-deferred). Durable hardware/platform canon (target spec), not operational state.

The **jetson-protect** fleet's Jetson is the **intended production deployment target** for a
dedicated low-power (~25W) edge security appliance: DeepStream YOLO inference plus
multi-camera behavior / zone-temperature analytics over UniFi Protect feeds, MQTT/HA
fusion, and Telegram alerts. The desktop RTX 5070 box is **dev only**. Jetson deployment
is **deferred to Phase 4**.

### Board target (design-target — no board on hand)

- **Model:** Jetson Orin Nano 8GB — **single-module** target, no multi-board (design-target)
- **GPU / compute capability:** Ampere, **sm_87** (design-target)
- **Carrier:** not yet provisioned / omitted (no board on hand). Planned flash path: NVIDIA
  SDK Manager via WSL2 distro `Nvidia_SDKM_Ubuntu_22.04_JetPack_6.2.2` staged on the dev host.
- **JetPack / L4T:** JetPack **6.2.1** (ceiling for Orin Nano DeepStream support). L4T / BSP
  not separately pinned — omitted. (SDK Manager distro on host is labeled 6.2.2.)
- **CUDA / cuDNN / TensorRT:** **TensorRT 10.3** (bundled with DeepStream 7.1 / Triton 24.08).
  CUDA / cuDNN exact versions not pinned — omitted. **Engines rebuilt on-device.**
- **OS / kernel:** Ubuntu 22.04 (JetPack 6.2 default base). Kernel not documented — omitted.
- **Power:** target budget **~25W** whole-module (vs ~300W dev PC). `nvpmodel` profile not yet
  chosen — omitted.
- **RAM:** **8GB unified LPDDR5**, shared CPU+GPU (vs 12GB dedicated on the RTX 5070 dev box).
- **Storage / rootfs:** storage medium / rootfs not documented — omitted.
- **Cooling:** not documented — omitted.

### Peripheral model — no CSI, all-IP-camera

- **NO CSI cameras.** All video is **UniFi Protect IP cameras** over LAN, pulled as
  **RTSP / H.264 substreams** from a **UniFi UNVR** (not direct-attached to the Jetson).
- **MQTT ↔ Home Assistant** integration for sensor / alarm context fusion.
- No documented GPIO / CSI / sensor attach.

### Design-constraint gotchas (hard-won from the dev box + architecture docs)

1. **TRT engines are NOT portable across architectures.** Orin Nano **sm_87** vs desktop
   **sm_120** (Blackwell). YOLO11s/n ONNX must be **re-exported** and the TRT engine
   **rebuilt INSIDE the Jetson container** — never copy a desktop `.engine`. **Never commit
   `.engine` artifacts.**
2. **DeepStream is capped at DS 7.1 on Orin Nano.** DS 8.0 supports **Jetson Thor only**
   (not Orin); the desktop dev box runs DS 8.0 because it needs the RTX 5070 (Blackwell).
   Configs (`nvinferserver` proto, `nvtracker` YAML) are portable, **but pipeline code must
   guard the "new nvstreammux" diffs**: DS 8.0 drops the `width` / `height` /
   `batched-push-timeout` props that DS 7.1 **requires** — use `find_property()` guards.
3. **8GB shared memory is the binding constraint.** Target **~3–4 concurrent streams** with
   behavior analysis; **max 1 concurrent HIGH-tier (4K) stream (expected)**. The **NvDCF
   tracker feature-map VRAM at 4K** is the bottleneck — **not** NVDEC (4K30 ≈ 0.6
   decoder-equiv, safe). INT8 calibration is **deferred** until HIGH-tier VRAM headroom is
   benchmarked on real hardware.
4. **Model tier likely drops** to **YOLO11n (INT8)** on Jetson vs YOLO11s on the desktop (expected).
5. **NVDEC / V4L2 works natively on Jetson — do NOT set `USE_SW_DECODE=1`.** That flag is a
   **WSL2-only desktop workaround** (`nvv4l2decoder` yields 0 frames under WSL2 but works on
   native L4T).
6. **MTAP24 / multi-PPS H.264 — OPEN QUESTION.** The desktop hit an `rtph264depay` **MTAP24
   bug** needing an ffmpeg bypass. Unknown whether the DS 7.1 Jetson build patches it —
   **re-check on first Jetson bringup.**
7. **go2rtc WebRTC passthrough is fine on Jetson.** The Chromium Baseline-profile decoder lock
   and Windows Docker Desktop UDP/ICE issues are **desktop-only** and do not apply to native
   Linux / NVDEC.

## Conventions

_(none yet — populated via consolidation during the SoT knowledge-gathering phase)_

## Decisions

_(none yet)_

## Open Questions

- **MTAP24 / multi-PPS H.264 on the DS 7.1 Jetson build** — the desktop hit an `rtph264depay`
  MTAP24 bug needing an ffmpeg bypass; unknown whether the DS 7.1 Jetson build patches it.
  Re-check on first Jetson bringup (Phase 4). _(see "NVIDIA Jetson baseline" → gotcha 6)_
