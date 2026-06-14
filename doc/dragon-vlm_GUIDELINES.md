# dragon-vlm — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `/dragon-vlm`, the federation bridge to the
**dragon-vlm** dev fleet's remote PM. This file is the SoT's home for canonical knowledge *about*
the dragon-vlm fleet — what it builds, its conventions, recurring asks, and routing notes —
written only on explicit PM/user request via the consolidation flow (`/review`-audited).

**Load when:** dragon-vlm fleet, dragon-vlm PM, federation bridge to dragon-vlm, dragon-vlm canon,
what dragon-vlm does, dragon-vlm conventions, SoT knowledge about dragon-vlm.

**Key facts:**
- `/dragon-vlm` is a **federation bridge**, not a local build specialist — it relays into
  dragon-vlm's remote PM (`http://192.168.1.111:3100`, project `dragon-vlm`, token-env `FED_TOK_DRAGON_VLM`).
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.
- Populated during the **SoT knowledge-gathering phase** (deferred until the federated PMs are
  in the roster — currently in progress).

**Owner:** `/dragon-vlm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/federation.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

## NVIDIA Jetson baseline

> **Source:** dragon-vlm remote PM (read-only SoT gather, 2026-06-15), aggregated on behalf
> of dragon-vlm's `/devops` + `/perception` + `/learn` from repo canon (`doc/ENVIRONMENT.md`,
> `DESIGN.md`, `BUILD.md`, `REALSENSE_D435.md`, `/devops` + `/perception` SKILLs).
> Unrecorded fields are marked **"not recorded"** — never inferred.
> **Deployment status:** Jetson is **PROCURED, IN-HAND, ACTIVELY DEPLOYED** — not a target/plan.
> Module serial `1423725099752` (provenance: captive-portal setup 2026-04-27; librealsense +
> pyrealsense2 built on-device 2026-04-26; `start.sh`/`stop.sh` operational; D435 smoke-tested).
> **Shared board:** swarm (drone) containers coexist on the same Jetson and are stopped in
> dependency order before each Drakosha deploy — the two fleets contend for the 8GB module.

### Hardware & platform

| Field | Value |
|-------|-------|
| Board | Jetson Orin Nano 8GB — 1024 CUDA cores, 67 TOPS (INT8) |
| Form factor | Developer Kit (reference carrier), not a production module |
| JetPack / L4T | JetPack 6.2.2; L4T/BSP version not recorded |
| CUDA / cuDNN / TensorRT (Jetson) | Bundled by JetPack 6.2.2; point versions not recorded |
| OS | Ubuntu 22.04 aarch64; kernel version not recorded |
| Power / nvpmodel | 15W mode (~15W steady); exact profile id not recorded. Thermal cap documented — drops FPS on long runs; monitored via `tegrastats`; throttle if `AO_THERMAL > 75°C` |
| RAM | 8GB — shared with swarm containers (RAM contention; far less free with them running). Exact free-MB figures drift; treat as point-in-time. |
| Storage | Storage medium + rootfs not recorded |
| Cooling | Not explicitly recorded; throttle monitoring implies stock DevKit active fan |

### Peripherals

- **Intel RealSense D435** (device serial `832112073725`) — RGB 1920×1080@30; IR-fallback depth
  848×480@30; mounted on a 1/4-20 tripod.
- **USB mic** with hardware mute.
- **Generic single-switch USB HID foot-pedal.**
- **Network** LAN / WebSocket link to the driving machine.
- **GPIO** — none documented.

### Hard rule — Jetson CUDA ≠ desktop CUDA

The Jetson (JetPack aarch64) CUDA stack is **DISTINCT** from the RTX 5070 Blackwell desktop
CUDA 12.8+ stack. `.so` files are **NEVER** copied between the two. TensorRT-LLM conversion
happens **in place on the Jetson** — never convert on the desktop and copy across (the CUDA
toolchains differ).

### Gotchas hit in deployment

- **pyrealsense2 has no aarch64 PyPI wheels** — `pip install pyrealsense2` ships an x86_64 stub
  that fails with `"undefined symbol"`. Fix: build librealsense from source (**v2.57.7**
  confirmed) and copy the built `.so` into the venv `site-packages`.
- **TensorRT-LLM conversion is on-device only** — see hard rule above (CUDA toolchains differ).
- **IR emitter policy is INVERTED vs swarm** — Drakosha turns the IR projector **ON** for
  low-light fallback (MediaPipe needs illumination); swarm/cuVSLAM needs it **OFF** (projected
  dots register as false stationary features). Same shared board, opposite emitter requirements.
- **Windows → Jetson transfer uses `plink`/`pscp` via `powershell.exe`** — Git Bash `ssh`/`scp`
  fails (password auth + OneDrive path spaces).
- **CRLF kills scripts silently** — after every push run
  `sed -i 's/\r$//' *.sh && chmod +x *.sh` or scripts fail without error.
- **JetPack bumps can break TensorRT-LLM** — test before upgrading; tool versions are pinned;
  `/learn` audits.
- **Swap + version pinning** are recurring troubleshooting areas.

### Use / role

Always-on local runtime for the **Drakosha** presentation-companion dragon: D435 gaze
perception, the Director state machine, local **Moondream-2** VLM inference, the voice/agent
loop, and a WebSocket server.

## Conventions

_(none yet — populated via consolidation during the SoT knowledge-gathering phase)_

## Decisions

_(none yet)_

## Open Questions

_(none yet — e.g. what dragon-vlm's domain is, its build cadence, recurring cross-fleet asks)_
