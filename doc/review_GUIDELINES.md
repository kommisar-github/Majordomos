# /review — Agent Guidelines
**Last Updated:** 2026-06-09

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

## Decisions

- **2026-06-09 — Audit heuristics consolidated from the Q-HA-WHITELIST gate review**
  (two-round: APPROVE-WITH-CHANGES → C1 broken-confirm blocker → resolved). Source of the
  four Conventions above. Requested by PM after a `consider-consolidation` flag.

## Open Questions

(none yet)
