# majordomos — Next Steps
**Last Updated:** 2026-07-08

## Abstract

**TL;DR:** Current action items for majordomos. PM updates after each implementation/verification cycle.

**Load when:** current work, next steps, action items, todo, what to do next

**Key facts:**
- PM owns this file per DOC_OWNERSHIP_MATRIX.md
- Items flow: NEXT_STEPS → ROADMAP (in-progress) → MEMORY (complete)

**Owner:** `/pm` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `ROADMAP.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Immediate

### Q-HA-WHITELIST — close-out (gate shipped: commits 9568384 + a22a420)
- [ ] **Operator:** finalize the Critical-entity `entity_id`s (breakers, PV/charger contactor, water valve, door lockdown/evacuation, main-entrance-lock relay, `visonic_p1_*`, intercom door relay — hunt siblings) → write to `fleet/ha_whitelist.json`. Seed list: `doc/design/ha_whitelist_gate.md §3.3`.
- [ ] **Operator:** run `doc/runbooks/ha_v1_exposure.md` — un-expose Tier B/C on the HA MCP Server (zero-code) to **close the live safety gap** (destructive HA domains currently reachable with no gate).
- [ ] **Deferred implementation review** (`/review`, after relaunch — terminal was `needs-restart`): end-to-end audit of `majordomus-daemon/src/ha-bridge.js` + `serverHost.js` (incl. `/app`'s separate `127.0.0.1:3101` executor server vs route-on-existing) **and the PM §H1 correlation path** (reply-parsing, N2 channel-bind, N3 server-time TTL, N4 delete-before-execute, N6 startup sweep) — that policy path is **not** covered by the 36+9 unit tests and is owed an audit before production trust.

## Backlog
- [ ] **Q-HA-WHITELIST v3** — quiet-hours rules (vacuum/media after-hours), confirm-fatigue tuning, an audit log of every confirm decision, per-entity graduation of selected Tier-C items to Tier B by explicit operator opt-in (`doc/design/ha_whitelist_gate.md §8 v3`).
- [ ] **Provision the always-on path** — run `host/provision.sh --inject-secrets` to populate the launchd plists (`com.majordomus.taskrouter.plist`, `com.majordomus.telegram.plist`) from `.env`, then `launchctl bootstrap`. (Templates + flow built; see `doc/design/host_ops.md`.)
- [ ] **Local-model backend `/hacmd`** — wire a narrow local `backend` specialist on `google/gemma-4-12b-qat` for Telegram NL→HA command mapping. **Blocked on** `--reseed` (installs `local-runner.js`) + operator go. Spec + safety boundary in `doc/plans/LOCAL_MODEL_BACKEND_PLAN.md`; roadmap entry under Backlog → "Local-model backend specialist".
