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
- jetson-protect builds **real-time behavioral video analytics on UniFi Protect cameras**, fusing
  computer-vision detection with Home Assistant security context to raise low-false-positive alerts.
- **Production target is a Jetson Orin Nano 8GB edge appliance — DESIGN-TARGET / Phase-4-deferred /
  NOT flashed.** The only running platform today is a **desktop RTX 5070 + WSL2 + DeepStream 8.0** dev box.
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.

**Owner:** `/jetson-protect` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`, `FEDERATION_RULEBOOK.md` (federation policy SoT), `fleet/fleet.config.json`

---

> **Source:** jetson-protect remote PM (fleet aggregate), read-only SoT gather (full-project
> questionnaire), 2026-06-15. Two honesty caveats from the responder: (1) concrete camera IDs, LAN
> IPs, RTSP/RTSPS URLs and UniFi/Protect tokens live in a **gitignored** `config/cameras.yaml` and
> were **withheld** cross-fleet — only roles/tiers are described here. (2) The Jetson is
> **design-target only**; deployment is deferred to Phase 4, no board flashed/benchmarked.
> Unprovided fields are marked **"not recorded"** — never inferred. Projected/unverified values are
> tagged **(design-target)**.

## Mission

Real-time **behavioral video analytics on UniFi Protect cameras**. The system fuses computer-vision
detection with **Home Assistant** security context (alarm state, motion, door contacts, presence) to
detect **suspicious behavior** — loitering near parked cars, casing/pacing, nighttime approaches,
vehicle tampering. The UniFi UNVR owns recording and camera management; jetson-protect is the
**behavioral intelligence layer** on top. End goal: a dedicated low-power **edge security appliance**
(Jetson) that raises high-quality, low-false-positive alerts.

## Architecture — subsystems & data flow

**Data flow:** UniFi cameras → (RTSP/H.264 from UNVR) → DeepStream pipeline (decode → batch → YOLO
infer → track → nvdsanalytics zones) → `DetectionEvent` → scene-awareness **zone-temperature engine**
(0–100) ← fused with HA context (MQTT) + multi-camera 3D reconstruction → behavior scoring → alert
dispatch (Telegram + MQTT) + live GUI.

Major subsystems:
- **Inference** — DeepStream/GStreamer, TensorRT YOLO11, nvtracker, nvdsanalytics zones.
- **Spatial/CV** — camera calibration, homography, multi-view DLT triangulation, Kalman 3D object
  state, SketchUp→trimesh property model, auto-zone generation.
- **Behavior** — zone-temperature engine (heat/cool events, directional cooling, decay-pauses-while-
  active), loiter/pacing detection, HA sensor fusion, baseline learning, auto-tuner.
- **Backend** — FastAPI (REST + WebSocket hub), Protect API relay, MQTT bridge, alert dispatcher,
  PTZ control, UNVR virtual camera (ModernGL→RTSP).
- **Frontend** — React 2D dashboard (property map, camera grid, event timeline) + Three.js 3D viewer;
  go2rtc video transport.
- **Stream transport** — go2rtc sidecar (WebRTC primary, MSE/MJPEG fallback).

## Fleet agent roster

jetson-protect runs its own multi-agent dev team via the MCP "Task Router". Each specialist runs in
an isolated fork, has a NEVER-touch boundary list, and a paired `.claude/rules/<name>.md`.

| Agent | Model | Owns |
|---|---|---|
| `/pm` | 1M Opus | Planning, delegation, tracking, doc updates; the federation gate (the responder here). |
| `/arch` | 1M Opus | Phase design, system architecture, interface contracts. |
| `/review` | 1M Opus | Architecture audit / challenge / GPU-budget enforcement. |
| `/scm` | Haiku | Git commits, branches, PRs (commits-only, never a doc author). |
| `/deepstream` | Sonnet | GStreamer pipeline, TensorRT, tracker, nvdsanalytics, GPU scheduling. |
| `/cv` | Sonnet | Calibration, homography, triangulation, 3D model, reconstruction. |
| `/behavior` | Sonnet | Zone temperature, scoring, HA context, sensor fusion, baselines. |
| `/frontend` | Sonnet | React, Three.js, SVG, WebSocket, GLB. |
| `/backend` | Sonnet | FastAPI, MQTT, Protect API, alerts, RTSP, virtual camera, SQLite, Docker. |
| `/devops` | Sonnet | Docker/compose, image pinning, TRT builds, host provisioning, systemd, reverse-proxy, secrets. |
| `telegram` | bridge | Remote PM access from phone. |

## Software stack

- **Languages:** Python (backend / CV / pipeline), TypeScript/JS (frontend).
- **Backend:** FastAPI + uvicorn, aiomqtt, aiosqlite (SQLite WAL), asyncio.
- **Frontend:** Vite + React 18 + TypeScript + Tailwind; Three.js (r168+) + GLTF/DRACO loaders;
  hls.js; go2rtc `video-rtc` web component.
- **CV/ML:** DeepStream + TensorRT, YOLO11 (`s` on desktop / `n` on Jetson), trimesh (3D — not
  Open3D), OpenCV (homography/triangulation), Kalman.
- **Rendering:** ModernGL (EGL headless) for the UNVR virtual camera; FFmpeg (`h264_nvenc`) → RTSP.
- **Transport sidecar:** go2rtc **pinned 1.9.14**.
- **Integration:** MQTT (HA), Telegram Bot API, UniFi Protect (undocumented WS/REST).

## Hardware

> **Platform truth for the Jetson Orin Nano 8GB lives in `doc/hw_lib/jetson_orin.md`** (the hw_lib
> Book 1) — sm_87 Ampere baseline, 8GB unified-memory budget, aarch64-vs-desktop CUDA split, JetPack
> 6.x / L4T R36 line, and the cross-fleet aarch64 gotchas. This section keeps only the
> **jetson-protect-specific deployment** detail and its IP-camera peripheral model.

### Dev compute (the only running platform today)

- Desktop PC, **RTX 5070 (12 GB VRAM, Blackwell sm_120)**, Windows 11 + **WSL2**.
- **DeepStream 8.0** (TensorRT 10.9). ~300 W draw.
- This is **dev-only**; the production target is the Jetson appliance below.

### Target appliance — Jetson Orin Nano 8GB (design-target / Phase-4-deferred / NOT flashed)

> ⚠️ **No Jetson board has been flashed, run, or benchmarked for jetson-protect.** Every value below
> is a **design-target** projection, unverified until a board is physically provisioned. Platform-level
> specs (sm_87, JetPack 6.x, unified-memory budget) are in `doc/hw_lib/jetson_orin.md`.

- **Model:** Jetson **Orin Nano 8GB** — single-module target, no multi-board (design-target).
- **JetPack / DeepStream:** JetPack **6.2.1**, **DeepStream 7.1** (TensorRT 10.3) — DS 7.1 is the cap
  on Orin Nano (DS 8.0 is Thor/Blackwell only) (design-target).
- **Power:** target budget **~25 W** whole-module (vs ~300 W dev PC) (design-target).
- **Model tier:** likely **YOLO11n** on Jetson vs YOLO11s on the desktop (design-target).
- **Run mode:** Jetson as a systemd-managed appliance (`Type=oneshot` + `RemainAfterExit` for
  compose), `network_mode: host` (design-target).
- Carrier, cooling, storage/rootfs, `nvpmodel` profile — **not recorded** (no board on hand).

### Peripheral model — no CSI, all-IP-camera

- **NO CSI / direct-attached sensors.** All video is **UniFi Protect IP cameras** streamed via a
  **UniFi UNVR** over LAN, pulled as **RTSP / H.264** substreams (the UNVR is not direct-attached to
  the Jetson).
- **Camera models:** UniFi Protect **AI Turret, G4 Bullet, G6 PTZ**.
- **Camera tiers** (GPU slots are time-shared with event-driven rotation, not per-camera):
  - **Tier A** — full AI, YOLO always on.
  - **Tier B** — Protect API → escalate.
  - **Tier C** — Protect API → escalate only on `armed_away`.
- **MQTT ↔ Home Assistant** for sensor/alarm context fusion.
- Concrete camera IDs / LAN IPs / RTSP URLs — **withheld** (secrets in gitignored `config/cameras.yaml`).

## Interfaces / protocols

- **REST + WebSocket** `/ws/events` — FastAPI; authoritative cross-team contract in jetson-protect's
  `doc/api.md`. Envelope carries `at` at envelope level; message types: `hello`, `detection_event`,
  `stream_status`, `protect_event`.
- **UniFi Protect** — `wss://{unvr}/proxy/protect/ws/updates` (protobuf events),
  `GET /proxy/protect/api/cameras`, RTSP(S) substreams, PTZ preset-recall (max 9). Token refresh on 401.
- **MQTT** — HA state topics (`home/alarm/state`, `home/motion/*`, `home/door/*`, `home/light/*`),
  alerts to `home/alerts/{zone}`, HA auto-discovery `homeassistant/sensor/{obj}/config`.
- **Telegram** — `sendPhoto` (<10 MB) + inline keyboards.
- **Cross-fleet** — MCP "Task Router" (HTTP, Streamable) + federation gate (the channel this gather used).

## Deployment topology

- **Today (dev):** runs on the desktop; docker-compose stack with go2rtc sidecar + FastAPI backend +
  Vite frontend; streams pulled direct from the UNVR over LAN. `/stream/*` reverse-proxied through the
  backend to go2rtc. **LAN-only, no auth on `/stream/*`** (deliberate user decision; a basic-auth shim
  is Phase-3 backlog).
- **Target:** Jetson as a systemd-managed appliance (`Type=oneshot` + `RemainAfterExit`),
  `network_mode: host` (design-target).
- Image pinning enforced (**no `:latest`**); **`.engine` files never committed** (architecture-specific,
  must rebuild on-device). Concrete host IPs — **withheld** (secrets).

## Status / phase / roadmap

- **Phase 1 (foundation):** ✅ COMPLETE (2026-04-20) — 3 cameras + PTZ batched inference on DS 8.0 /
  RTX 5070 / WSL2 SW-decode, ~21 fps total, GPU 4–9%, stable track IDs, DetectionEvent JSONL.
- **Current frontier:** out-of-band **Wave "2b.7-pre"** (pull-forward GUI skeleton + thin REST/WS
  slice) — **fully shipped** through pre.4 (go2rtc transport, FastAPI app + `/ws/events`, React
  dashboard, JSONL replay, Protect-API passthrough, WebRTC dev-stack fortification). A WS-proxy `?src=`
  root-cause bug was fixed (`fd93ef0`).
- **Next:** pre.5 backlog, then **Phase 2a** (property model & auto-config, `/cv`-owned), **2b** (scene
  awareness + HA), **2c** (behavior + PTZ), **2d/2e** (GUI/3D), **P3** (alerts / face / plate / UNVR),
  **P4** (Jetson). A 63-step plan lives in jetson-protect's `architecture.md` §11.

## Conventions / standards

- **Planning-only default** — agents don't write code without explicit instruction.
- **Strict phase isolation** — never advance without verification + user sign-off; max 2 retries.
- **Doc ownership matrix** — every doc has one Primary; PM routes edits; `/scm` never authors docs.
- **Review-gated knowledge capture** — specialists request consolidation; `/review` (higher tier)
  audits before GUIDELINES become source-of-truth.
- **Secret hygiene** — `.env` / `cameras.yaml` gitignored, `.example` committed sanitized; never
  `:latest`; never commit `.engine`.
- **Dual-platform discipline** — every infra decision must work on both DS 8.0/x86 and DS 7.1/Jetson
  (`profiles:` tags).
- **Zone temperature is an integer 0–100 scale** (chosen over float for UI/log readability).

## Known issues / gotchas

1. **go2rtc RTSP relay corrupts multi-PPS H.264** (stores only the first SPS/PPS) — DeepStream and any
   downstream consumer must read **direct from the UNVR**, not the localhost relay.
2. **go2rtc WebRTC SDP drops the Main-profile PT**, and **Chromium locks H.264 to Constrained Baseline**
   at SDP negotiation → green screen on Main-profile streams. Dev workaround: opt-in baseline transcode
   (`GO2RTC_FORCE_BASELINE_TRANSCODE=1`, ffmpeg direct from UNVR). **Jetson NVDEC unaffected.**
3. **Windows Docker Desktop UDP/ICE is unreliable** for WebRTC (userspace NAT); TCP ICE works; a Linux
   host is unaffected.
4. **WSL2 has no V4L2** → `nvv4l2decoder` yields 0 frames; `USE_SW_DECODE=1` is a **desktop-only**
   workaround — **never set it on Jetson** (native NVDEC/V4L2 works).
5. **MTAP24 `rtph264depay` GStreamer bug** (needs an ffmpeg bypass on the desktop); unknown whether the
   DS 7.1 Jetson build patches it — re-check on first Jetson bringup. *(See Open Questions.)*
6. **Jetson VRAM (design-target):** the **NvDCF tracker at 4K is the bottleneck** (not NVDEC); max **1
   concurrent HIGH-tier stream (design-target)**; INT8 calibration deferred until benchmarked on real
   hardware.
7. **TRT engine non-portability:** Orin Nano sm_87 vs desktop sm_120 (Blackwell) — YOLO ONNX must be
   re-exported and the TRT `.engine` rebuilt **inside the Jetson container**; never copy a desktop
   `.engine`. (Platform law — see `doc/hw_lib/jetson_orin.md`.)
8. **Debug-the-actual-layer lesson:** ~3 h burned chasing ICE/transcode when the real bug was a 2-line
   WS proxy `?src=` drop — isolate layers before deep dives.

## Cross-fleet & SoT relationships

- **Shared compute:** jetson-protect's production target **is** the shared **Jetson Orin Nano 8GB**
  that the SoT canonicalizes in `doc/hw_lib/jetson_orin.md` — jetson-protect is a **consumer** of that
  hardware book.
- **Shared infra:** participates in the cross-fleet MCP Task Router + federation gate (the channel this
  gather used). A `telegram` bridge gives remote PM access.
- **Depends on the SoT for:** the authoritative Jetson board spec (flashing / JetPack / power / cooling)
  once a board is physically provisioned — it would reconcile its **design-target** values against the
  SoT's **measured** ones.
- **Can contribute to the SoT:** the Jetson-specific DeepStream/TRT pitfalls above (engine
  non-portability, DS-version cap, NVDEC-vs-tracker-VRAM, `USE_SW_DECODE`) are battle-tested on the dev
  box and reusable by any Jetson-based fleet.

## Decisions

- **Zone temperature is an integer (0–100), not a float** — chosen for UI/log readability.
- **trimesh over Open3D** for the 3D property model.
- **LAN-only, no auth on `/stream/*`** today (deliberate); basic-auth shim deferred to Phase-3 backlog.

## Open Questions

- **MTAP24 / multi-PPS H.264 on the DS 7.1 Jetson build** — the desktop hit an `rtph264depay`
  MTAP24 bug needing an ffmpeg bypass; unknown whether the DS 7.1 Jetson build patches it.
  Re-check on first Jetson bringup (Phase 4). _(see "Known issues" → gotcha 5)_
