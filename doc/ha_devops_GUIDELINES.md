# ha_devops — Durable Guidelines

## Abstract

**TL;DR:** Durable, review-gated guidelines for `ha_devops`, the runtime deployer
that is the only principal allowed to apply live Home Assistant config-writes through
the cap-token-gated loopback executor. Written only on explicit PM/user request via
the consolidation flow (`/review`-audited); not a free-form scratchpad.

**Load when:** ha_devops guidelines, config-write deploy lessons, cap-token operating
notes, deploy runbook conventions, Q-HA-CONFIGWRITE durable knowledge.

**Key facts:**
- `ha_devops` owns no source code — it operates the mechanism `/ha` builds; durable
  *code* facts belong in `ha_GUIDELINES.md`, durable *operating* facts belong here.
- This file is the agent's ONLY sanctioned durable write target, and only through the
  PM→`/review` consolidation gate.
- Never record a cap-token or `confirm_id` value here — they are session secrets.

**Owner:** `/ha_devops` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `doc/runbooks/ha_deploy.md`, `doc/design/ha_config_write.md`, `.claude/rules/ha_devops.md`

---

## Conventions

_(none yet — populated via consolidation on first durable lesson)_

## Decisions

_(none yet)_

## Open Questions

_(none yet)_
