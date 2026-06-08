# ha integration

## Abstract
**TL;DR:** bidirectional Home Assistant bridge (MCP client outbound + inbound confirmation gate).
**Load when:** home assistant, HA, entity_id, states, call_service, light, climate, script, notify, bearer token, long-lived token, websocket, subscribe_events, MCP server, MCP client, Assist, ha_get_state, ha_call_service, inbound, whitelist, confirmation, H1
**Key facts:** Outbound via HA MCP Server (SSE); inbound default-deny + Telegram confirm for destructive/cross-project.
**Owner:** /ha   **Related:** doc/design/federation.md, PM SKILL (mediation)

---

## Transport — Q-HA-TRANSPORT: RESOLVED (2026-06-09)

**Decision:** Official Home Assistant **"Model Context Protocol Server"** integration — Majordomus is the MCP **client** over SSE. No custom `ha-bridge.js` for outbound; that approach is superseded.

- **Endpoint:** `${HA_BASE_URL}/mcp_server/sse`
- **Auth:** `Authorization: Bearer ${HA_TOKEN}` — long-lived token; env var only, never inlined
- **Client wiring:** `.mcp.json` entry `home-assistant`, `type: "sse"`, `url: "${HA_BASE_URL}/mcp_server/sse"` — already added to repo
- **Status (2026-06-09):** HA MCP endpoint verified live (HTTP 200, SSE handshake); operator has exposed a starter entity set
- **Open gap (handled by /ops):** `HA_BASE_URL` / `HA_TOKEN` must be loaded into the Claude Code process environment before connection — the launcher (`start-majordomos.ps1`, `.sh`) and the launchd plist both need `.env` loading added

---

## Outbound safety boundary (MCP path) — Q-HA-WHITELIST: partially open

There is **no Majordomus-side whitelist** on the MCP path — HA-side entity exposure is the v1 safety boundary. The operator controls which entities the HA MCP Server integration exposes.

**First-expose tier (immediate, no confirmation gate required):**
`sensor.*`, `binary_sensor.*`, `sun.*`, `weather.*` (read-only), `light.*`, `switch.*`, `scene.*`, `input_boolean.*`

**Withhold until Majordomus confirmation gate is designed:**
`lock.*`, `alarm_control_panel.*`, `cover.*`, `climate.*` setpoints, `script.*`, `automation.*`

**Q-HA-WHITELIST remains OPEN** for the Majordomus-side confirmation gate design (inbound and destructive outbound).

---

## Inbound action whitelist

*(to be finalized — Q-HA-WHITELIST.)* Proposed default: reads + non-destructive `light`/`scene`/`notify` are **immediate**; `lock`/`alarm_control_panel`/`cover`/`climate` setpoints + any cross-project write require **Telegram confirmation** via PM.
