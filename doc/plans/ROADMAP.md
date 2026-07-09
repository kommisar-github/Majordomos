# majordomos — Roadmap
**Last Updated:** 2026-07-08

## Abstract

**TL;DR:** High-level phase overview for majordomos. PM keeps status badges current.

**Load when:** planning, phase overview, roadmap, status, next phase

**Key facts:**
- PM owns this file per DOC_OWNERSHIP_MATRIX.md
- Status badges: PLANNED / IN_PROGRESS / VERIFIED / COMPLETE

**Owner:** `/pm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `NEXT_STEPS.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Phase 1 — TBD
> Status: PLANNED

## Backlog

### Local-model backend specialist (`/hacmd`)
> Status: PLANNED
- **What:** Add one narrow local `backend` specialist (`hacmd`) on `google/gemma-4-12b-qat`
  (LM Studio `127.0.0.1:1234`) for Telegram NL → structured HA service-call mapping.
- **Why:** Privacy (commands stay on the LAN) + offline capability on the command hot path; NOT token
  savings. Empirically validated 4/4 on a 2026-07-08 smoke test (NL-map, routing, both safety tiers).
- **Acceptance:** `--reseed` installs `local-runner.js`; `hacmd` registered in `agents.json`; a bounded
  validation suite passes `/review`; HA safety gate (default-deny executor + Tier-B confirm) proven
  unchanged and authoritative — local model assists, never decides.
- **Plan:** `doc/plans/LOCAL_MODEL_BACKEND_PLAN.md`. **Blocked on:** `--reseed` + operator go.
