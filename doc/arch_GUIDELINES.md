# /arch — Agent Guidelines
**Last Updated:** 2026-06-09

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/arch` agent
(Architect). This file is the agent's **only** sanctioned write target for
notes that should survive across sessions. The agent appends here **only
when PM or the user explicitly asks** — never as a side effect of doing
work. Project-specific design conventions or library choices that should outlive a single phase land here on explicit request.

**Load when:** the `/arch` agent starts a session, or when PM is
auditing roster consistency via `/pm audit`.

**Key facts:**
- Owner: `/arch` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).

**Owner:** `/arch` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/arch/SKILL.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

### Safety architecture — when a control path has no code chokepoint
- **Tier == reachability path.** When you cannot intercept a path in code, do NOT
  enforce safety by trusting the caller's judgment — enforce it by controlling
  **reachability** (what is exposed on that path). Map risk tiers onto *which path
  can reach a target*: safe→the fast/raw path; gated→only a path that flows through
  a code chokepoint; denied→no path at all. Confirmation then holds *by construction*,
  not by hoping a model declines to call a tool.
- **A raw MCP tool call cannot be intercepted.** When the agent calls an MCP tool
  directly (e.g. Home Assistant `Hass*` over SSE), nothing in our code sees it. The
  ONLY hard control on that path is the **upstream exposure** (what the server exposes
  to the MCP client). Treat upstream exposure as the hard outer boundary; anything you
  build on our side (policy, broker) is an *additional* layer, never the only one.
- **Classify at (resource, action, instance) granularity — never tool-level.** A
  by-domain/by-name tool is safe or catastrophic depending on its target (the same
  `HassTurnOn` toggles a light or a main breaker). Tool-level allow/deny is useless.
  Always allow an **instance-level Critical override** that is a hard *floor* — a generic
  allow-rule must never be able to lift a Critical instance below its deny tier.

### Async confirmation when the bridge owns the channel (single-PM runtime)
- **The PM is structurally the only correlator** when the messaging bridge (a) auto-
  completes any task dispatched *to* it on delivery, and (b) routes the human's reply
  back as a *fresh inbound task* uncorrelated to the original. A dispatched task can
  then only be a **prompt/notification**, never a decision carrier; `wait_for_result`
  on it returns a delivery ack, not the answer. Verify the bridge's actual behavior
  before designing any request/response round-trip over it.
- **Pending state lives in PM `save_memory`; fail-closed is structural.** Stage the
  pending decision in the server-managed per-agent memory primitive — never anywhere
  that auto-executes. The gated action runs ONLY inside the in-window APPROVE branch
  of the reply handler, so "no reply ⇒ never runs" *is* default-deny-on-timeout without
  any blocking wait. Invariant: **delete the pending record before executing** (a lost
  approval fails closed; execute-then-delete risks double-execution).
- **An approval that reduces to "a message with the right id arrives" needs two
  independent locks:** (1) the id must be an **unguessable capability** — high-entropy
  CSPRNG (≥64-bit), never a short/sequential token, or it is brute-forceable within the
  TTL by anyone who can post to the dispatch API; AND (2) **channel-bind** the reply to
  the authenticated origin (`from_agent == "<operator-channel>"` + strict payload shape),
  or a request arriving on the same inbound queue can self-approve (confused deputy).
  Entropy alone stops brute force; binding alone stops spoofing — you need both.

## Decisions

- **2026-06-09 — Q-HA-WHITELIST gate design (source of the Conventions above).**
  Authored `doc/design/ha_whitelist_gate.md` (PROPOSED) — the layered HA safety gate.
  The reusable principles distilled into Conventions came from it: tier==path; no
  chokepoint on the raw MCP path (HA-side exposure is the hard boundary); (resource,
  action, instance) classification + Critical floor; PM-as-correlator with `save_memory`
  pending state + structural fail-closed; unguessable-confirm-id + channel-bind. Full
  rationale, taxonomy, and the bot.js-verified bridge behavior live in that design doc —
  this file holds only the durable, project-general lessons.

## Open Questions

(none yet)
