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
  jetson-protect's remote PM (`http://192.168.1.111:3100`, project `jetson-protect`, token-env `FED_TOK_JETSON_PROTECT`).
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a federation token or `confirm_id` value here — they are credentials/secrets.
- Populated during the **SoT knowledge-gathering phase** (deferred until the federated PMs are
  in the roster — currently in progress).

**Owner:** `/jetson-protect` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/design/federation.md`, `doc/federation.md`, `fleet/fleet.config.json`

---

## Conventions

_(none yet — populated via consolidation during the SoT knowledge-gathering phase)_

## Decisions

_(none yet)_

## Open Questions

_(none yet — e.g. what jetson-protect's domain is, its build cadence, recurring cross-fleet asks)_
