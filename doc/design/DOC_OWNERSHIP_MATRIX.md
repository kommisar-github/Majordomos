# Documentation Ownership Matrix

**Purpose:** Maps every design / implementation / reference document in the majordomos project to the specialist agent(s) responsible for it. Agents read their assigned docs when dispatched; PM uses this matrix to pick the right delegate.

**Last Updated:** 2026-06-13
**Maintained By:** `/pm`

## Abstract

**TL;DR:** Index of every design / implementation / reference doc in the majordomos project, mapping each to the specialist agent(s) that own or read it. PM's routing table for dispatch; agents' filter for which docs are relevant to their domain.

**Load when:** doc ownership, who owns, which agent reads, doc assignment, new doc added, doc primary owner, where to add a new doc, Abstract standard, `DOC_OWNERSHIP_MATRIX`

**Key facts:**
- Every doc in the matrix has an `## Abstract` block (see Section 3) for cheap skimming by subagent forks.
- New docs MUST be added to this matrix in the same commit — un-matrixed docs go stale within weeks.
- PM reads ROADMAP + NEXT_STEPS + MEMORY + this matrix on every dispatch.
- Primary agent updates the doc; secondary agents read but don't own.

**Owner:** `/pm` (self-referential)
**Related:** `ROADMAP.md`, `NEXT_STEPS.md`, `MEMORY.md`

---

## How to use this matrix

- **Primary** — the agent who *owns* the doc: updates it after implementation, enforces its conventions, is the first delegate for related work.
- **Secondary** — agents who must *read* the doc when they touch its subject, but don't own updates.
- **Type** — helps filter by purpose:
  - `roadmap` — phase progress + next steps
  - `design` — architecture + acceptance criteria for a feature
  - `reference` — stable facts (protocol, hardware, config)
  - `analysis` — investigation output, may become stale
  - `plan` — in-flight implementation plan
  - `memory` — project state / history
- **Every agent reads its own roadmap + NEXT_STEPS first** on any task in its domain.
- **`/pm` reads all roadmap + NEXT_STEPS + MEMORY docs** on any dispatch, in addition to whatever the delegated specialist loads.

---

## 1. `doc/` — cross-cutting design + architecture

| Document | Type | Primary | Secondary | Notes |
|---|---|---|---|---|
| `ROADMAP.md` | roadmap | `/pm` | all | Phase overview + status badges. PM must read before planning. |
| `NEXT_STEPS.md` | roadmap | `/pm` | all | Current action items. PM updates after each implement/verify cycle. |
| `MEMORY.md` | memory | `/pm` | all | Project state — architecture facts, cross-cutting decisions. |
| `DOC_OWNERSHIP_MATRIX.md` | reference | `/pm` | all | **This file.** (lives in `doc/design/`) |
| `design/ha_integration.md` | design | `/ha` | `/pm` | HA bidirectional bridge design; Q-HA-TRANSPORT resolved → official HA MCP Server (SSE). |
| `pm_GUIDELINES.md` | reference | `/pm` | — | Durable per-agent guidelines for `/pm`. Write on explicit request only. |
| `arch_GUIDELINES.md` | reference | `/arch` | `/pm` | Durable per-agent guidelines for `/arch`. |
| `review_GUIDELINES.md` | reference | `/review` | `/pm` | Durable per-agent guidelines for `/review`. |
| `scm_GUIDELINES.md` | reference | `/scm` | `/pm` | Durable per-agent guidelines for `/scm`. |
| `ha_GUIDELINES.md` | reference | `/ha` | `/pm` | Durable per-agent guidelines for `/ha`. |
| `app_GUIDELINES.md` | reference | `/app` | `/pm` | Durable per-agent guidelines for `/app`. |
| `ops_GUIDELINES.md` | reference | `/ops` | `/pm` | Durable per-agent guidelines for `/ops`. |
| `runbooks/ha_v1_exposure.md` | reference | `/ops` | `/ha`, `/pm` | Operator runbook: prune Tier B/C entities from HA MCP Server exposure (v1 zero-code safety gate). |
| `design/host_ops.md` | reference | `/ops` | `/pm` | macOS always-on host runbook: provisioning, headless claude auth, launchd, env wiring for HA/telegram secrets. |
| `reference/ha_entity_catalog.md` | reference | `/ha` | `/pm` | Full HA entity inventory (4,997 entities): by area, by function, safety-tier annotation, Critical-list finalization input, solar inverter battery finding, v1 pruning checklist. |
| `reference/inverter_battery_health.md` | reference | `/ha` | `/pm` | Deye inverter battery health baseline (2026-06-09): health snapshot, SoH calculator diagnosis (3 missing helpers → silent no-op), operator fix steps, monitoring candidates. ⚠️ chemistry refs say LiFePO4 — STALE, the bank is AGM (see battery_monbat_12mvr200.md). |
| `reference/battery_monbat_12mvr200.md` | reference | `/ha` | `/pm` | Monbat 12MVR200 AGM battery spec (2× series = 24V ~4.8kWh): full 20°C+25°C discharge tables, temp-correction table, derived Peukert k≈1.12, charge regime, SoH usage (rated_kwh=4.8). |
| `design/ha_config_write.md` | design | `/ha` | `/pm`, `/ha_devops` | Gated HA config-write (draft-disabled, human-enables); two-layer `/ha`+`ha_devops`; cap-token hard gate + body-scan + drift-safe undo. |
| `ha_devops_GUIDELINES.md` | reference | `/ha_devops` | `/pm` | Durable guidelines for the runtime deployer; written via consolidation only. |
| `runbooks/ha_deploy.md` | reference | `/ha_devops` | `/ha`, `/ops`, `/pm` | Operator runbook: launch `ha_devops`, deploy flow, enable-by-hand step, undo, W5 bring-up + W7 e2e. |
| `../FEDERATION_RULEBOOK.md` (project root) | reference (seed-shipped) | `/ops` | `/pm` | **Canonical federation policy SoT** (R/W/X access model, federated-pm/federated-sot roles, SoT-agent obligations, security, §7 enterprise install). Root-level, refreshed by the seed/errata. The operational *wiring procedure* lives in the ops `SKILL.md`. Supersedes the former `design/federation.md` + `federation.md` (both removed 2026-06-17). |
| `feedback/federation_bootstrap_feedback.md` | reference | `/ops` | `/pm` | First-fleet federation + SoT bootstrap feedback for Task Router maintainer (v4.13, 6 verified gaps + proposed fixes). **Delivered artifact — frozen; new feedback goes in round2.** |
| `feedback/federation_feedback_round2.md` | reference | `/ops` | `/pm` | Post-bootstrap (round 2) Task Router maintainer feedback. Entry 1: `read_guidelines` doc-tree-serve gap (needed for `/hw_lib`-style SoT library agents). |
| `swarm_GUIDELINES.md` | reference | `/swarm` | `/pm` | SoT-gathered canon about the swarm dev fleet; written via consolidation gate. |
| `dragon-vlm_GUIDELINES.md` | reference | `/dragon-vlm` | `/pm` | SoT-gathered canon about the dragon-vlm dev fleet; written via consolidation gate. |
| `jetson-protect_GUIDELINES.md` | reference | `/jetson-protect` | `/pm` | SoT-gathered canon about the jetson-protect dev fleet; written via consolidation gate. |
| `hw_lib_GUIDELINES.md` | reference | `/hw_lib` | `/pm` | Hardware Library catalog: index of per-platform hardware books + cross-platform laws. The doc the `hw_lib` federation grant serves. |
| `hw_lib/jetson_orin.md` | reference | `/hw_lib` | `/pm` | Book 1: NVIDIA Jetson Orin Nano 8GB platform SoT (sm_87, JetPack/L4T R36, 8GB unified-mem, CUDA-≠-desktop law). Written. |
| `hw_lib/realsense_d435.md` | reference | `/hw_lib` | `/pm` | Book: Intel RealSense D435 depth camera (USB3 8086:0b07). Stub — populate via hw_lib gate. |
| `hw_lib/orbbec_astra.md` | reference | `/hw_lib` | `/pm` | Book: Orbbec Astra Pro Plus depth camera (2bc5:050f/060f). Stub — populate via hw_lib gate. |
| `hw_lib/rplidar_a1.md` | reference | `/hw_lib` | `/pm` | Book: RPLidar A1 lidar (CP210x 10c4:ea60). Stub — populate via hw_lib gate. |
| `hw_lib/esp32.md` | reference | `/hw_lib` | `/pm` | Book: ESP32 / ESP32-S3 MCU/SoC (CDC-ACM 0416:b002). Stub — populate via hw_lib gate. |
| `hw_lib/stm32.md` | reference | `/hw_lib` | `/pm` | Book: STM32 (F103) MCU (CH340 1a86:7523). Stub — populate via hw_lib gate. |
| `hw_lib/imu_mpu.md` | reference | `/hw_lib` | `/pm` | Book: MPU-6050 / MPU-9250 IMU (I2C bus7 0x68). Stub — populate via hw_lib gate. |

---

## 2. Cross-cutting load rules

### When dispatched for a feature in a domain
1. **Primary agent** reads its roadmap + NEXT_STEPS + MEMORY (if present) + all docs where it is Primary in that domain.
   **Single-repo projects:** "its roadmap" means the single shared `ROADMAP.md` owned by PM — most specialists don't have their own roadmap, just use the shared one.
   **Multi-platform projects:** each platform agent reads its platform-specific ROADMAP (e.g., `<PLATFORM_A_DOC_DIR>/ROADMAP.md`).
2. **Secondary agents** on the same dispatch read only the specific design doc that applies.
3. **All agents** read their skill file (`.claude/skills/<agent>/SKILL.md`) first.

### When PM is doing triage / planning
1. PM reads: `CLAUDE.md`, ROADMAP.md, NEXT_STEPS.md, MEMORY.md (where present), and this matrix.
2. PM does NOT read hardware/reference docs unless specifically needed to triage an issue.

### When writing a new doc
- **Cross-cutting design** → `doc/`
- **Platform-specific** → `<PLATFORM_A_DOC_DIR>/` or `<PLATFORM_B_DOC_DIR>/` *(Appendix A; multi-platform projects only)*
- **Hardware reference** → `<HARDWARE_DOC_DIR>/` *(Appendix B; hardware projects only)*
- **Add an entry to this matrix in the same commit** — new docs without an owner go stale within weeks.

### Doc hygiene (PM responsibility)
- After a phase completes, PM moves items from NEXT_STEPS → ROADMAP → MEMORY.
- Analysis docs (`ANALYSIS_*.md`, `PLAN_*.md`) may be superseded — mark `SUPERSEDED BY <doc>` at the top rather than deleting.
- Design docs (`DESIGN_*.md`) are updated in place when implementation deviates from the original design. Do NOT fork a new design doc for every iteration.

### Ownership transfer (when a doc changes Primary)

When a refactor, feature move, or roster change reassigns a doc's Primary agent (e.g., `/frontend` → `/backend` after UI logic moves server-side):

1. **PM proposes** the transfer with rationale: *"`<doc>.md` Primary should change `/<old>` → `/<new>` because <reason>."*
2. **User approves** (explicit confirmation — this is not an auto-decision).
3. **Matrix row is updated** in the **same commit** as the code change that motivated the transfer. Never split the update across commits.
4. The doc's own `## Abstract` block must also update its `Owner:` field in the same commit.
5. **History entry logged.** If the matrix has a `## History` section, append: `YYYY-MM-DD — <doc>.md Primary /<old> → /<new> (<one-line reason>)`. If not, add the section.

**Rule:** never silently change the Primary column. Silent transfers break traceability and re-open old ownership debates.

---

## 3. Abstract standard (for all docs in the matrix)

Every doc listed in Section 1 (and Appendix A / Appendix B, if used) must have an `## Abstract` block placed immediately after the title/metadata header and before the first content section. This lets agents skim all abstracts cheaply (~50 tokens each) to decide which docs to read in full — critical for subagent fork context efficiency.

### Format

```markdown
## Abstract

**TL;DR:** <1–2 sentence description of what the doc covers and its purpose.>

**Load when:** <comma-separated keywords/phrases that would appear in task payloads.>

**Key facts:**
- <one-liner non-obvious fact that would save time if known upfront>
- <another key fact, max 5 bullets>
- <prefer facts that were bug-causing when forgotten>

**Owner:** `/<agent>` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `OTHER_DOC.md`, `ANOTHER.md`
```

### Rules

- `TL;DR` — 1–2 sentences on the doc's purpose (not its structure).
- `Load when` — comma-separated matchable keywords. The most important field for heuristic matching. **Count keywords as noun phrases, not individual tokens** — `rate limit middleware` is one keyword (one comma-bounded phrase), not three. Commas are the phrase boundary; spaces inside a phrase are not. A list of 20 noun phrases reads as 20 keywords regardless of how many individual words the phrases contain.
- `Key facts` — 2–5 bullets of non-obvious load-bearing info. Prefer facts that would have prevented past bugs.
- `Owner` — must match the Primary column. Use `Owner: (none — read lazily per task)` if no Primary is assigned.
- `Related` — 2–4 most-commonly-co-loaded docs. Not exhaustive; do not include the doc itself.

### Placement

Immediately after the title/metadata block, before the first content section. If there is no metadata block, place it immediately after the `# Title`.

### Special cases

- **Live-state docs** (`ROADMAP.md`, `NEXT_STEPS.md`, `MEMORY.md`) — Abstract describes the **purpose and structure** of the file, not its current contents.
- **Hardware reference docs** — lead with the hardware model name; `Key facts` MUST include VID/PID for USB devices and I2C address for I2C devices.
- **Design docs** (`DESIGN_*.md`) — `Key facts` captures the 2–3 load-bearing decisions the design makes, not the process of making them.
- **`DOC_OWNERSHIP_MATRIX.md`** itself — has a self-referential Abstract; `Owner: /pm`.

### When adding a new doc

1. Write the doc.
2. Add the Abstract block immediately after the title/metadata.
3. Add an entry to this matrix in the appropriate section.
4. Commit the new doc + matrix update in the same commit.

---

## 4. Quick-reference — "which agent for which topic"

PM uses this table to pick `Context docs:` for every `dispatch_task` payload. One row per topic domain; cover every capability claimed by every specialist in the project.

| If the task is about... | Read first |
|---|---|
| <topic 1> | `/<agent>` → <DOCS> |
| <topic 2> | `/<agent>` → <DOCS> |
| Planning, tracking, delegation, doc updates | `/pm` → ROADMAP.md + NEXT_STEPS.md + MEMORY.md + this matrix |

---

<!--
End of the single-repo default matrix shape. Multi-platform and hardware-reference
appendices are NOT part of the default copy — they live in a separate
"Matrix multi-platform addendum" section in PM_TEMPLATES.md below. Copy those
only if your project has distinct platform runtimes or dedicated hardware reference
sheets. Do not paste empty appendix stubs into single-repo projects.
-->

