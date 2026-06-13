# /review — Agent Guidelines
**Last Updated:** 2026-06-13

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/review` agent
(Architecture Review). This file is the agent's **only** sanctioned write target for
notes that should survive across sessions. The agent appends here **only
when PM or the user explicitly asks** — never as a side effect of doing
work. Project-specific review checklists or risk categories the user wants to keep applying across reviews.

**Load when:** the `/review` agent starts a session, or when PM is
auditing roster consistency via `/pm audit`.

**Key facts:**
- Owner: `/review` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).

**Owner:** `/review` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/review/SKILL.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

### Audit a round-trip mechanism against the real transport code, never the design's claim
When a design asserts a request/response or confirmation round-trip (a "wait for the
reply" / "the result comes back as X"), trace the **actual message lifecycle in the
transport code** before accepting it. Designs describe the happy path they *want*; the
transport may not provide it. Verified failure mode (Q-HA-WHITELIST): the telegram bridge
(`.claude/mcp/telegram-bridge/bot.js`) **auto-completes any dispatched `to=telegram` task
on delivery** (`pollResponses` → `POST /api/complete/<id>` with result
`"delivered to telegram"`), and routes the operator's reply as a **brand-new inbound
`to=pm` task** — so a `wait_for_result`-based confirm resolves instantly with a delivery
ack and never sees the decision. A dispatched task to such a bridge can only be a one-way
**notification**; it can never carry a decision back. Checklist: who completes the task,
when, and with what result? Does a reply correlate to the original task, or arrive as new
work? Is there a blocking wait the transport defeats?

### Treat a confirm-id (or any approval token) as a security capability
If an approval reduces to *"possessing a live id + a message arriving on a channel"*,
audit it as a capability, not a UX detail:
- **Entropy / brute-forceability** within the TTL window — a "short" id is guessable by
  anyone who can submit the approving message before it expires.
- **Channel / origin binding** — require the approval to arrive from the *authenticated*
  channel (e.g. `from_agent="telegram"`, gated to the operator), never from any inbound
  that can carry the same text. Without this, an inbound request can **self-approve** the
  action it staged (confused deputy). Both holes compound: short id + no origin check = a
  clean bypass.

### Fail-closed must be structural, not timer-dependent
Prefer *"the action is never staged anywhere it can auto-fire; it executes only inside an
explicit approve branch against a found-and-unexpired record"* over *"deny on timeout."*
Timer/blocking-wait deny depends on the wait actually firing — which a transport can
silently defeat (see above). Structural fail-closed (no trigger ⇒ no execution) survives
crashes, restarts, and transport quirks. When you see "default-deny on TTL," ask what
*executes* the action and confirm nothing can fire it absent the explicit approval.

### Design-review APPROVE does not cover the implementation
An `APPROVE` / `APPROVE-WITH-CHANGES` verdict on a *design* doc validates the design only.
When it ships, the code that implements it still owes a separate implementation audit
(does the built artifact honor the design's invariants — entropy, origin check, delete-
before-execute ordering, whitelist re-check?). Say so explicitly in the verdict so the
gap isn't mistaken for coverage.

### "Surface-but-don't-deny" is only safe for a provably read-only entity type
A scan that *labels* Critical references without hard-denying them (e.g.
`_scanTemplateSensor` returning `hard_deny:false` always, feeding only the
Telegram confirm banner) is sound **only when the entity being created is
structurally read-only** — it has no `action`/`service`/trigger field and
therefore cannot cause-to-fire or mutate a Critical entity. Config-flow
`template` *sensors* qualify (state/availability Jinja is pure-read). Before
accepting any surface-don't-deny path, verify the **submitted schema** has no
actions/trigger surface — not just the template strings. Any future template
entity type that CAN carry actions/triggers (trigger-based template, YAML
`action:` blocks, automation/script bodies) MUST re-introduce a real `hard_deny`
and may NOT reuse a read-only scanner as-is. When you APPROVE a surface-only
scan, state the read-only premise explicitly so a later action-carrying cousin
can't silently inherit the weaker treatment.

### Resolved-indirection must bind to the Critical-checked identity
When an executor resolves an indirection before mutating — `entity_id → storage_id`
via a `/list`, `name → slug`, audit-entry → target — the id actually mutated MUST
be provably the same identity that passed the Critical/tier guard. Require:
(a) the guard runs **before ALL I/O**, including any list/lookup/GET used to
resolve — not merely before the final write (no TOCTOU window);
(b) the match predicate is **exact** on the normalized identifier (a near/dup
name like `x` vs `x_2` must never select the wrong entry), and the mutated id is
read from the **same matched record** that satisfied the guard, never a sibling;
(c) **fail-closed** on no-match or ambiguous/duplicate-match — refuse, audit, do
not "best-effort" pick one. Probe it adversarially: put a Critical entry and a
near-name decoy in the same lookup response and confirm the decoy resolves to its
own id while the Critical one is denied before the lookup even fires.

### An executor-side slugifier that gates a check must match the platform's slugify exactly
If a locally-computed slug (or any reconstructed identifier) is used to GET-first
and decide a NEW-1/overwrite hard-deny, it must match how the platform derives the
real id — **including unicode transliteration** (HA's `slugify` maps `é→e`,
`ß→ss`; a naive `[^a-z0-9]+ → _` yields `caf_`/`au_en`, a different entity_id).
A divergent slug makes the check query a different entity than the platform
creates — a silent NEW-1 detection blind spot — and mislabels the audit/return
`entity_id` when the platform suffixes on collision (`_2`). Prefer recording the
platform's **actual** created id (from the create response / a post-create state
read) over the pre-computed slug; if you must compute locally, match the platform
algorithm or restrict+validate inputs to the safe (ASCII) subset. Flag any
gate-bearing identifier that is reconstructed rather than echoed back from the
platform.

### Interlock protection gates on deliberately-declared, not fail-closed-default, criticality
When a guard hard-denies a destructive change (delete / disable / overwrite) to a pre-existing
object *because its prior body references a "Critical" entity*, verify the criticality test fires
only on **deliberately-declared** criticality — never on a fail-closed default. Worked example
(HA config-write NEW-1, `_isDeliberateCritical`, commit 11f1d73): the prior-body deny fires only on
(a) the `critical_entities` list (exact + glob), (b) a `per_entity_overrides` `tier:C`, or (c) a
`domain_defaults` value `C` (e.g. `lock.*`, `alarm_control_panel.*`) — and **not** on a
**fail-closed-unknown Tier-C** entity (a domain absent from `domain_defaults` that `classifyEntity`
floors to C: `sensor.*`, `input_number.*`, `binary_sensor.*`, …). The asymmetry is the correct
posture: a fail-closed default is a *labeling/surfacing* conservatism for the human confirm, NOT a
reviewed safety declaration — so **surface** unknown-C in the confirm label, but do **not** let it
trigger the interlock-protection deny. Conflating the two makes a passive, freely-replaceable object
(a battery-SoH calculator that only reads `sensor.*`/`input_number.*`) permanently un-replaceable
(un-deletable / un-overwritable) while protecting nothing. Also require: the Critical floor is
evaluated **before** any A/B override (cannot be downgraded — M7), and a per-entity A/B override on a
domain-default-C entity correctly drops it. This narrowing is load-bearing-coupled to the
cause-to-fire invariant below — it is safe ONLY while every actuating position is scanned-or-hard-
denied (a read-only Critical ref in a Jinja `value:` cannot actuate, so it neuters nothing); any
scanner relaxation that lets actuation hide in an unscanned position voids it and must be re-audited,
and the conservative `hard_deny` branch is the retained residual. (cf. "*Surface-but-don't-deny is
only safe for a provably read-only entity type*" — that governs when never-denying is safe at all;
this governs which *prior* references should trigger the deny once you do deny.)

### Force-disabled deploy models: audit cause-to-fire, not enable
A "draft-disabled, human-activates" deploy model rests entirely on the fleet being unable to make a
drafted automation/script's actions execute. When auditing one, **reject an "enable-only" deny as
incomplete** — the real invariant is **cause-to-fire**, because service paths exist that fire/run a
*disabled* object without ever enabling it (in HA: `automation.trigger` runs a disabled automation's
actions — `skip_condition` defaults true; `script.toggle` starts a stopped script — the two killers
an "enable" framing misses). Require three things:
1. **Exhaustive direct-deny set**, enforced at BOTH the service-call and config-write executors AND
   in-body. Worked example (HA `fleet_enable_deny`, 7 forms): the two killers + `automation.turn_on|
   toggle`, `script.turn_on`, named-script `script.<object_id>`, and `homeassistant.turn_on|toggle`
   resolving to `automation.*`/`script.*`. In-body matters: a drafted body that itself calls
   `automation.trigger`/`script.turn_on`/`script.<object_id>` drafts an *enabler* — the recursive
   body-scan must hard-deny it, distinct from the direct requested-service check.
2. **Structural floor.** Force-disable on every upsert (HA: `initial_state:false` force-injected,
   create and update, + post-write verify→`turn_off`) so no draft fires at deploy; and **no raw
   firing primitive on the executor** — no event-fire verb (`POST /api/events/*` trips a pre-existing
   `platform:event` automation, sidestepping the whole enumeration and the body-scan), no
   MQTT-publish, no Supervisor/add-on path, and the one-shot WS client command-type-scoped to NEVER
   `call_service`.
3. **Named residual vectors** that enumeration does NOT close, confirmed contained by the
   human-enable boundary rather than silently claimed-covered: scene-encoded enable (a pre-existing
   Tier-A scene flipping `automation.x:on`), transitive call-graph (a drafted automation calling a
   pre-existing Critical-touching script), blueprint-hidden bodies (actions in a host-side file the
   scan can't read → FLAG-not-deny + a "review the blueprint in HA before enabling" banner).
Standing test: any new executor verb or scanner relaxation that could *indirectly* trip an
already-enabled automation requires FRESH review — the "no out-of-band trigger path" property is
invisible unless explicitly stated, and it is the whole reason force-disable suffices. (cf.
"*Resolved-indirection must bind to the Critical-checked identity*" — that closes a TOCTOU identity
gap on a single mutation; this closes the *enumeration* gap on every path that can cause execution.)

## Decisions

- **2026-06-09 — Audit heuristics consolidated from the Q-HA-WHITELIST gate review**
  (two-round: APPROVE-WITH-CHANGES → C1 broken-confirm blocker → resolved). Source of the
  four Conventions above. Requested by PM after a `consider-consolidation` flag.

- **2026-06-13 — Audit heuristics consolidated from the Q-HA-CONFIGWRITE W7 build review**
  (`majordomus-daemon/src/ha-bridge.js` — `helper_delete(object_id)` list-resolve,
  `_helperDelete`/`_executeUndo` normalization, `template_sensor_create` REST config-flow
  + `_slugify`/`_scanTemplateSensor`). Source of the three Conventions added above:
  (1) read-only-scoped surface-don't-deny, (2) resolved-indirection identity binding,
  (3) executor slugify must match HA. Requested by PM after a `consider-consolidation`
  flag across the multi-round W7 re-reviews; independently audited by `/arch` (APPROVE,
  since `/review` is both requester and canonical reviewer of its own GUIDELINES).

- **2026-06-13 — Two cause-to-fire / interlock-protection invariants consolidated from the battery
  SoH config-write session** (the `sensor.battery_state_of_health` AGM SoH calculator deploy through
  the Q-HA-CONFIGWRITE gate; executor fix commit 11f1d73). Source of the two Conventions added above:
  (1) interlock-protection gates on deliberately-declared criticality (`_isDeliberateCritical`), not a
  fail-closed default; (2) force-disabled deploy models must be audited for cause-to-fire, not enable.
  Requested by PM after a `consider-consolidation` flag; independently audited by `/arch` (APPROVE —
  claims verified against `doc/design/ha_config_write.md`, no contradiction, durable), since `/review`
  is both requester and canonical reviewer of its own GUIDELINES.

## Open Questions

(none yet)
