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

## Conventions

_(none yet — populated via consolidation during the SoT knowledge-gathering phase)_

## Decisions

_(none yet)_

## Open Questions

_(none yet — e.g. what dragon-vlm's domain is, its build cadence, recurring cross-fleet asks)_
