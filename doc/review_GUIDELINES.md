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

## Open Questions

(none yet)
