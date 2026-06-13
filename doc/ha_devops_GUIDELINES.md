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

- **Gated-path mandate (HA-REMEDIATION-2).** All fleet config-writes go through `executeConfigWrite` at
  `127.0.0.1:3101` — no direct HA REST calls, no HA-UI / `configuration.yaml` substitutes for an
  audited deploy. A direct write bypasses the cap-token gate, body-scan, cause-to-fire deny,
  force-disable injection, verify, and the `fleet/ha_config_audit.jsonl` audit — it is NOT a gated
  deploy even if the resulting config looks identical. Out-of-band operator-by-hand writes are valid
  but carry no `confirm_id`/`audit_id` and are **unaudited by design** — never report one as a fleet
  deploy. (Root cause: the battery-SoH Pass-2 writes never reached the executor, so nothing was audited.)

- **Executor-liveness precheck (HA-REMEDIATION-3).** Confirm the executor on 3101 is reachable before
  every config-write. It serves only `POST /api/ha/{execute,config-write}` — there is **no `GET /health`
  route**, so probe reachability, not a 200:
  `code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' -X POST http://127.0.0.1:3101/api/ha/config-write)`
  — `code == 000` (refused/timeout) ⇒ DOWN; any HTTP code (400/401) ⇒ UP. On DOWN, block with a
  `[BLOCKED]` result and require re-dispatch. **Never** fall back to direct REST — a down executor means
  the whole gate (cap-token, body-scan, cause-to-fire deny, force-disable, audit) is absent.

## Decisions

_(none yet)_

## Open Questions

_(none yet)_
