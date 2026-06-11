---
description: Home Assistant Integration Agent
globs: majordomus-daemon/src/ha-bridge.js, doc/ha_integration.md
alwaysApply: false
---

# ha — condensed rules

- **HA REST (outbound):** `GET /api/states[/<entity_id>]` to read; `POST /api/services/<domain>/<service>` with JSON `{ entity_id, …data }` to act. Auth: `Authorization: Bearer <long-lived token>`. Base e.g. `http://homeassistant.local:8123`.
- **entity_id**: `<domain>.<object_id>` (`light.office`, `climate.living_room`, `script.<name>`); services `<domain>.<service>` (`light.turn_on`, `notify.mobile_app_<device>`).
- **WebSocket API** (`/api/websocket`) for live state: auth handshake → `subscribe_events`/`state_changed` with incrementing `id`. Use when REST polling is too slow.
- **HA MCP** (optional, Q-HA-TRANSPORT): HA **MCP Server** integration exposes Assist intents as MCP tools over SSE (Majordomus→HA); HA **MCP Client** connects HA to the app `/mcp` (HA Assist→Majordomus). REST is the v1 path.
- **Inbound (HA→Majordomus):** HA automation/Assist → `POST /api/dispatch` (to `pm`) or HA MCP-client → `/mcp`. Tag every inbound request `[HA REQUEST]` so PM applies the confirmation gate.

**Owns:** `majordomus-daemon/src/ha-bridge.js`, `doc/ha_integration.md`, `majordomus-daemon/test/ha-bridge.test.js`
**Never touches:** see SKILL.md.
