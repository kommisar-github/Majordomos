# /ha — Agent Guidelines
**Last Updated:** 2026-06-09

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/ha` agent (Home
Assistant integration — bidirectional REST/WebSocket/MCP bridge with an inbound
confirmation gate). This file is the agent's **only** sanctioned write target
for notes that should survive across sessions. The agent appends here **only
when PM or the user explicitly asks** — never as a side effect of doing work.
Resolved transport choices, entity-exposure conventions, and the safety-gate
policy live here once formalised; live design detail stays in
`doc/design/ha_integration.md`.

**Load when:** the `/ha` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/ha` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Design source of truth (not this file): `doc/design/ha_integration.md`.

**Owner:** `/ha` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/ha/SKILL.md`, `doc/design/ha_integration.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

- **Env-var expansion in `.mcp.json` is process-env only.** Claude Code
  substitutes `${HA_BASE_URL}` and `${HA_TOKEN}` from the environment of the
  running `claude` process — it is NOT a dotenv loader. If the vars are absent,
  the `home-assistant` MCP server will not authenticate against HA; diagnose
  this as a connect-time auth failure (no successful tool calls), not as a
  Claude Code-level error. Launchers (`start-majordomos.ps1`, `.sh`, `.command`)
  must load `.env` before invoking `claude`; the launchd plist must have
  `EnvironmentVariables` populated at provision time. (Launcher/secret wiring
  owned by `/ops`.)

- **HA-side entity exposure IS the v1 safety boundary on the MCP path.** There
  is no Majordomus-side whitelist for MCP-path outbound calls — the operator
  controls which entities the HA MCP Server integration exposes. The
  confirmation gate applies to inbound (HA→Majordomus) requests and to outbound
  calls against withheld domains once the Majordomus-side gate is built. The
  canonical first-expose / withhold entity tiers live in
  `doc/design/ha_integration.md § Outbound safety boundary` — reference that
  doc; do not duplicate the lists here (update it when the tiers change).

## Decisions

- **2026-06-09 — Q-HA-TRANSPORT: RESOLVED → official HA MCP Server (SSE).**
  Majordomus is the MCP client of Home Assistant's "Model Context Protocol
  Server" integration. Endpoint: `${HA_BASE_URL}/mcp_server/sse`. Client wiring:
  `.mcp.json` `home-assistant` entry, `type: "sse"`. No custom `ha-bridge.js`
  for the **outbound** path — superseded (ha-bridge.js is still in scope for the
  inbound gate). Full rationale in `doc/design/ha_integration.md § Transport`.

## Open Questions

- **Q-HA-WHITELIST (Majordomus-side gate) — OPEN.** The v1 safety boundary is
  HA-side entity exposure only. The Majordomus-side confirmation gate (for
  inbound `[HA REQUEST]` and outbound calls against destructive domains) is not
  yet designed. Proposed default when designed: reads + `light`/`scene`/`notify`
  immediate; `lock`/`alarm_control_panel`/`cover`/`climate` setpoints require
  Telegram confirmation via PM.

- **Env-loading gap for always-on path — OPEN (`/ops`).** The launchd plist
  (`host/launchd/com.majordomus.taskrouter.plist`, not yet created) needs
  `EnvironmentVariables` for `HA_BASE_URL`/`HA_TOKEN`. `/ops` must add a
  `host/provision.sh` step that reads `.env` and patches the plist. Until done,
  the always-on bundled app cannot connect to HA.
