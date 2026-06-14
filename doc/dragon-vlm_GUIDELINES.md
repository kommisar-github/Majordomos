# dragon-vlm — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `/dragon-vlm`, the federation bridge to the
**dragon-vlm** ("Drakosha") dev fleet's remote PM. This file is the SoT's home for canonical
knowledge *about* the dragon-vlm fleet — what it builds, its architecture, agent roster, stack,
hardware deployment, conventions, and cross-fleet couplings — written only on explicit PM/user
request via the consolidation flow (`/review`-audited).

**Load when:** dragon-vlm fleet, Drakosha, dragon-vlm PM, federation bridge to dragon-vlm,
dragon-vlm canon, what dragon-vlm does, dragon-vlm conventions, SoT knowledge about dragon-vlm.

**Key facts:**
- `/dragon-vlm` is a **federation bridge**, not a local build specialist — it relays into
  dragon-vlm's remote PM (`http://192.168.1.131:3100`, project `dragon-vlm`, token-env `FED_TOK_DRAGON_VLM`).
- dragon-vlm = **Drakosha**, a presentation-companion dragon + edge-VLM learning project. Always-on
  runtime on a Jetson Orin Nano (shared with the swarm fleet); training/3D on a separate RTX 5070 desktop.
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.
- **Hardware PLATFORM truth lives in `doc/hw_lib/`** (Jetson, RealSense books); this file holds only
  dragon-vlm-specific DEPLOYMENT detail (serials, IPs, deployed-status, shared-board fact).

**Owner:** `/dragon-vlm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/jetson_orin.md`, `doc/hw_lib/realsense_d435.md`,
`doc/design/federation.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

> **Source:** dragon-vlm remote PM (read-only SoT gather, 2026-06-15), aggregated across its roster +
> canonical docs (`DESIGN.md` v0.5, `ROADMAP.md`/`NEXT_STEPS.md` 2026-05-26, `BOOTSTRAP_PLAN.md`, ADRs).
> Unrecorded fields are marked **"not recorded"** — never inferred. One secret (a leaked HF token)
> was redacted at dragon-vlm's gate; the open issue is noted below, the value never recorded.

## Mission

Three-goal arc (`DESIGN.md §1`):
1. **Learn** to train + deploy a VLM end-to-end on edge hardware.
2. **The talk** — give *"How to Train Your VLM"* where Drakosha is **live on the slides**: she
   behaves when the presenter looks at the screen and hijacks/heckles the deck when they look away.
   The talk IS the build log.
3. **The assistant** — evolve her into a personal **desk assistant** (timers, notes, calendar,
   email, web, files, code).

End product = a live conference demo (Chapters 0–7) + a post-talk assistant (Chapters 8–10),
shipped as an open-source learning project.

## Architecture

Five layers (connected by a WebSocket transport between Director and Overlay), with versioned
interface contracts (`DESIGN.md §3`, `BOOTSTRAP_PLAN.md §7`):

- **Perception** — D435 → MediaPipe gaze → shared-memory ring buffer.
- **Director** — 5-state machine (HIDDEN → EMERGING → ACTIVE → RETREATING → COOLDOWN) + antic
  scheduler + personality dials.
- **Overlay** — reveal.js deck + transparent Three.js layer rendering the dragon.
- **Cognition** — local Moondream-2 + cloud VLM routing.
- **Audio/Agent** — wake-word → STT → tools → TTS.

Data flow: Perception → ring buffer → Director → WebSocket → Overlay; Cognition and Audio/Agent feed
the Director.

**Four interface contracts** (any change requires an ADR with `/review` as mandatory consumer):
1. **Gaze signal v2** (perception→director): `{is_looking_at_screen: bool, mode: presenter|qa|transitioning}`
   on shared-mem ring buffer, 15–30 Hz (`ADR_001`).
2. **Overlay command envelope v=4** (director→overlay): JSON over WebSocket, versioned; v4 added 11
   `rig_command` kinds (pose_blend_to, set_facial_expression, look_at, wing_flare/relax,
   tail_flick/curl/idle_sway, mouth_open, head_tilt, body_lean) (`ADR_006`).
3. **VLM inference interface** (director→cognition): `InferenceRequest`/`InferenceResult` dataclasses.
4. **Config layouts**: `personality.yaml`, `antics.yaml`, `calibration.yaml`, `routing.yaml`, `sheet.json`.

## Agent roster (16 specialists)

- **Coordinators (1M Opus):** `/pm` (plan/delegate/govern docs), `/arch` (design + ADRs),
  `/review` (privacy + safety + security audit).
- **Specialists (Sonnet; `/scm` Haiku):** `/scm` (git), `/perception` (D435 + MediaPipe gaze),
  `/director` (state machine + antics + dials), `/cognition` (local + cloud VLM + routing),
  `/training` (LoRA on RTX 5070), `/voice` (wake + STT + MCP tools + memory + safety),
  `/overlay` (reveal.js + overlay + rendering), `/art` (sprite + voice pipeline + character canon),
  `/learn` (methodology + Learning-First), `/devops` (Jetson deploy + adapter promotion),
  `/portal` (FastAPI/PWA config UI), `/rig` (3D rigging),
  `/hunyuan` (Hunyuan3D image-to-3D, added 2026-05-04).

## Software stack & models

- **Local VLM:** Moondream-2 (~1.9B) + LoRA (PEFT rank 8 / alpha 16), INT8 via **TensorRT-LLM** on
  Jetson, <500 ms target.
- **Cloud VLM:** Claude 3.5 Sonnet (primary), GPT-4o (fallback) — pre-gen + complex agent plans only.
- **Perception:** MediaPipe Face Landmarker Tasks API (478 landmarks + iris), librealsense/pyrealsense2 v2.57.7.
- **Audio:** openWakeWord (wake), faster-whisper base/small.en INT8 (STT), Piper TTS
  (en_US-lessac/amy, en_GB-semaine) + pitch shift +4–6 semitones + roar splices.
- **Overlay:** reveal.js + Three.js (NPR/toon shaders + outline), alpha-MP4 fallback.
- **Portal:** FastAPI + (React/Vite/Tailwind PWA), 22 endpoints live.
- **Training (RTX 5070 Blackwell sm_120):** PyTorch nightly + CUDA 12.8+.
- **3D:** Hunyuan3D 2.1 (production), TRELLIS.2 (abandoned), Blender 4.5+, Auto-Rig Pro.
- **Memory:** markdown + bge-small embeddings.

## Hardware (deployment view — platform truth in hw_lib)

Platform-level specs, gotchas, and cross-platform laws live in the hardware library books — this
section records only dragon-vlm's deployment specifics. See:
- **`doc/hw_lib/jetson_orin.md`** — Jetson Orin Nano platform (JetPack, CUDA stack, aarch64 laws,
  TensorRT-LLM build rules, `numpy<2` pin, thermal behavior).
- **`doc/hw_lib/realsense_d435.md`** — Intel RealSense D435 platform (librealsense aarch64 build,
  VID/PID, depth/RGB modes).

| Asset | dragon-vlm deployment detail |
|-------|------------------------------|
| **Jetson Orin Nano 8 GB Dev Kit** | Serial `1423725099752`. The **always-on runtime brain** (perception, director, cognition, agent, TTS, WebSocket server). JetPack 6.2.2 / Ubuntu 22.04 aarch64, 15 W mode, ~5.7 GB free RAM (point-in-time). **PROCURED, IN-HAND, ACTIVELY DEPLOYED** *(as-of 2026-05-04)*. ⚠️ **Shared board with swarm** — swarm reports this same `192.168.1.72` Jetson **OFFLINE since 2026-06-06** (predates this status); verify current reachability before relying on "deployed". |
| **Shared board** | **Shared with the swarm/drone fleet** — swarm containers coexist on the same Jetson and are stopped in dependency order before each Drakosha deploy; the two fleets contend for the 8 GB module (RAM + power + thermal). Primary cross-fleet coupling. |
| **Intel RealSense D435** | Serial `832112073725`. RGB 1920×1080@30; IR-fallback depth 848×480@30. **IR emitter ON** for low-light (MediaPipe needs illumination) — **inverted vs swarm** (swarm/cuVSLAM needs it OFF). |
| **RTX 5070 12 GB desktop** | **Separate host** — training + 3D reconstruction only, **never the runtime**. Blackwell sm_120, CUDA 12.8+. Its CUDA stack is DISTINCT from the Jetson aarch64 stack (see hw_lib cross-platform law: never cross-copy GPU artifacts). |
| **Windows dev box** | Authoring + deploy origin (plink/pscp push). |
| **USB mic** | Hardware mute switch. |
| **USB foot-pedal** | Single-switch HID — preset cycle / emergency retreat. |

## Interfaces / protocols

- **WebSocket** (director ↔ overlay) — with 250 ms → 5 s reconnect backoff.
- **Shared-memory ring buffer** (perception → director) — zero-copy.
- **MCP tools** — Google Workspace via OAuth 2.0 Desktop: `gcal.*` (get_next / create_event /
  list_today), `gmail.read_inbox/search/draft` (send is Stage-2, gated), `gdrive.search/fetch`;
  plus local `timer / notes / files / code.run_shell` (firejail-sandboxed, allow-listed paths).
- **Cloud APIs** — Anthropic + OpenAI vision.

## Deployment topology

- **Jetson** at `192.168.1.72` (recorded 2026-05-04), headless. Runtime via `start.sh`/`stop.sh` +
  PID dir (`~/drakosha/run/`), ~6 processes; systemd deferred to post-Ch 7.
- **Portal** at `http://192.168.1.72:8766` (FastAPI).
- **Display** driven by laptop (stage) or desktop (desk) running Chrome
  `--app --transparent --always-on-top` + reveal.js + overlay.
- **Deploy** — PowerShell push (plink/pscp) → mandatory CRLF strip + `chmod +x` on `.sh`.
  LoRA adapter transit RTX 5070 → Windows → Jetson; **TensorRT-LLM conversion happens in-place on the
  Jetson** (JetPack CUDA ≠ desktop CUDA — see hw_lib).

## Status / roadmap

- Design **closed at v0.5** (Q1–Q18 resolved).
- Chapters: Ch 0 (scaffold) + Ch 1 (eyes/perception, Portal v1.5, 22 endpoints) + Ch 2 (dragon
  appears, 3D pivot via ADR_005/006) all **in-progress/verified**; Ch 3–10 planned.
- **Ch 5 LoRA (drakosha_v3) verified 2026-05-02.**
- **Current active work: Phase B.production-3 (rigging)** — v17 GLB base mesh complete; the Auto-Rig
  Pro session is the **non-delegable, operator-authored** next step (tail-tip repair → ARP backbone →
  21 chibi bones → ~12 blendshapes → eye-socket depth → R-OUT-1 outline → glTF export → handoff),
  after which `/rig` executes final rigging.

## Conventions / standards

- **Learning-First non-delegable list** (operator-authored, `/learn`-reviewed): Ch 1.4
  gaze-calibration math, Ch 3.2 Director state machine, Ch 4.3 first Moondream call, Ch 5.3 LoRA loop,
  Ch 9.3 first MCP tool + Safety Gate, ADR_003 sprite-LoRA training. PM refuses specialist-authored
  dispatches for these.
- **Privacy perimeter (hard):** no raw camera/mic persistence ever; cloud calls = region-cropped PNG +
  curated text, never raw frames; memory writes only from user-directed interactions; 30-day retention;
  physical off-switches. Cloud-reconstruction carve-out (ADR_005) covers synthetic LoRA-rendered
  references only, ledgered with `/review` countersign.
- **Blackwell CUDA pin:** every `drakosha/training/requirements.txt` pins PyTorch nightly + CUDA 12.8+;
  sm_120 = (12,0).
- **Contract change → ADR with `/review`** as mandatory consumer.
- **Safety Gate:** screen content wrapped `<observed>…</observed>`, never concatenated into
  instructions; confirmation on side-effectful tools.

## Known issues / gotchas

- Sprite-scaling wall (~360 frames needed vs ~70 budget) → **resolved by 3D pivot** (ADR_005); LoRA
  repurposed as character oracle.
- TensorRT-LLM breaks on JetPack bumps — test before upgrade; never cross-copy `.so` (see hw_lib).
- **A HuggingFace token was leaked in plaintext (2026-05-02); revocation was still pending — value
  redacted at dragon-vlm's gate, flagged for operator action.**
- Hunyuan3D PBR eye-whites artifact (downstream `/rig` material fix).
- Jetson 15 W thermal cap drops FPS to ~10 Hz on long runs — Director tolerates gracefully.
- Portal-override vs voice mode-set last-writer-wins (accepted risk, revisit Ch 7).
- Storage medium/rootfs, L4T version, exact Jetson CUDA/cuDNN/TensorRT point versions, kernel —
  **not recorded** in dragon-vlm's own `ENVIRONMENT.md` (a gap in their docs).

## Cross-fleet & SoT relationships

- **Shared dependency (primary coupling):** the Jetson Orin Nano is shared with the **swarm/drone
  fleet**. Coexistence is governed by a standing dependency-ordered container-stop rule before any
  Drakosha deploy. This is the most valuable thing for a cross-fleet SoT to track — board ownership,
  who-stops-whom, power/thermal contention.
- **What dragon-vlm wants from the SoT:** authoritative Jetson L4T/CUDA/cuDNN/TensorRT point versions,
  flashing/BSP provenance, and the swarm fleet's container inventory + healthy-state definition (so
  the stop/restart ordering stays correct).
- **What dragon-vlm provides:** this project canon + the Jetson runtime-role view (perception/VLM/voice
  workload, 15 W budget, D435 IR-emitter-ON policy that is inverted from swarm's).

## Decisions

- **3D pivot (ADR_005/006):** abandoned the sprite/frame-budget approach for a Three.js 3D dragon;
  LoRA repurposed as a character oracle.

## Open Questions

- Resolution of the leaked HF token (revocation pending as of gather).
- Jetson platform version gaps (L4T, CUDA/cuDNN/TensorRT point versions, kernel, storage) — owned by
  hw_lib once gathered.
- systemd-vs-`start.sh` runtime supervision (deferred to post-Ch 7).
