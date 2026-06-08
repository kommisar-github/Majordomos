# /ops — Agent Guidelines
**Last Updated:** 2026-06-09

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/ops` agent
(federation, host & always-on — inter-PM federation wiring over Tailscale/LAN,
macOS launchd always-on, secrets, and provisioning). This file is the agent's
**only** sanctioned write target for notes that should survive across sessions.
The agent appends here **only when PM or the user explicitly asks** — never as a
side effect of doing work. Federation grant conventions, launchd policy,
secret-injection patterns, and network-exposure rules live here once formalised.

**Load when:** the `/ops` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/ops` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Secrets NEVER committed: `.env` / `fleet/*.secret.json` are gitignored; launchd plist `EnvironmentVariables` filled at provision time. Condensed rules: `.claude/rules/ops.md`.

**Owner:** `/ops` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/ops/SKILL.md`, `.claude/rules/ops.md`, `doc/federation.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

(none yet — populate only when PM or the user asks)

## Decisions

(none yet — append dated entries when PM or the user asks)

## Open Questions

(none yet)
