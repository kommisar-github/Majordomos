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
  calls against withheld domains via the gated loopback executor. The
  canonical tier tables + gate design live in
  `doc/design/ha_whitelist_gate.md` (summarised in
  `doc/design/ha_integration.md § Safety boundary`) — reference those docs;
  do not duplicate the lists here (update them when the tiers change).

## Decisions

- **2026-06-09 — Q-HA-TRANSPORT: RESOLVED → official HA MCP Server (SSE).**
  Majordomus is the MCP client of Home Assistant's "Model Context Protocol
  Server" integration. Endpoint: `${HA_BASE_URL}/mcp_server/sse`. Client wiring:
  `.mcp.json` `home-assistant` entry, `type: "sse"`. No custom `ha-bridge.js`
  for the **outbound** path — superseded (ha-bridge.js is still in scope for the
  inbound gate). Full rationale in `doc/design/ha_integration.md § Transport`.

- **2026-06-09 — Q-HA-WHITELIST: RESOLVED → three-tier default-deny gate.**
  Operator-approved + twice `/review`-audited. Authoritative design + tier
  tables: `doc/design/ha_whitelist_gate.md`. Model: **tier == reachability
  path** — Tier A exposed on the MCP Server (auto); Tier B NOT exposed,
  reached only via the gated loopback ha-bridge executor with a PM-correlated
  Telegram confirm (unguessable `confirm_id` + `from_agent=="telegram"`,
  delete-before-execute, server-time TTL 120 s/300 s, no-reply ⇒ never runs);
  Tier C neither exposed nor bridged (alarm/lock/Critical `switch.*`/unknown),
  READ-only via REST `GET /api/states`. Critical-entity list is a hard Tier-C
  floor in git-reviewed `fleet/ha_whitelist.json` (operator finalises exact
  entity_ids). Rollout: v1 zero-code exposure-pruning
  (`doc/runbooks/ha_v1_exposure.md`); v2 build executor + PM correlation.
  Accepted defaults: vacuum=B, media=confirm-after-hours, lock/alarm stay C,
  `set_shutters_to_min_light`=B, TTL 120/300.

## Open Questions

- **Critical-entity list finalisation — OPEN (operator).** Exact `entity_id`s
  for the Tier-C Critical list (breakers, PV/charger contactor, water valve,
  door lockdown/evacuation, main-entrance-lock relay, `visonic_p1_*`, intercom
  door relay) must be confirmed by the operator + siblings hunted, then written
  to `fleet/ha_whitelist.json`. Seed list in `doc/design/ha_whitelist_gate.md §3.3`.

- **Env-loading gap for always-on path — RESOLVED (`/ops`, 2026-06-09).**
  `host/launchd/com.majordomus.taskrouter.plist` (Task Router app) and
  `host/launchd/com.majordomus.telegram.plist` (Telegram bridge) created as
  templates with `__INJECT_AT_PROVISION__` sentinels. `host/provision.sh
  --inject-secrets` reads root `.env` + `.claude/mcp/telegram-bridge/.env`
  and patches both plists via PlistBuddy at provision time (secrets never
  committed). Full wiring doc: `doc/design/host_ops.md`.
