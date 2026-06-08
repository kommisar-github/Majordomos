# /app — Agent Guidelines
**Last Updated:** 2026-06-09

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/app` agent
(standalone-app runtime & supervisor — node-pty agent supervision + in-process
Task Router server host for the headless Majordomus deployment). This file is
the agent's **only** sanctioned write target for notes that should survive
across sessions. The agent appends here **only when PM or the user explicitly
asks** — never as a side effect of doing work. Supervisor/nudge-loop
conventions, server start-vs-attach rules, and launch-argv parity notes live
here once formalised.

**Load when:** the `/app` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/app` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Condensed runtime rules (server attach on healthy /health, nudge-loop timing, node-pty pinning): `.claude/rules/app.md`.

**Owner:** `/app` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/app/SKILL.md`, `.claude/rules/app.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

(none yet — populate only when PM or the user asks)

## Decisions

(none yet — append dated entries when PM or the user asks)

## Open Questions

(none yet)
