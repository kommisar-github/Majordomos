# ha integration

## Abstract
**TL;DR:** bidirectional Home Assistant bridge (REST/WS/MCP) with an inbound confirmation gate.
**Load when:** home assistant, HA, entity_id, states, call_service, light, climate, script, notify, bearer token, long-lived token, websocket, subscribe_events, MCP server, MCP client, Assist, ha_get_state, ha_call_service, inbound, whitelist, confirmation, H1
**Key facts:** REST first (states + services); WS for live state; MCP optional; inbound default-deny + Telegram confirm for destructive/cross-project.
**Owner:** /ha   **Related:** doc/design/federation.md, PM SKILL (mediation)

---

## Inbound action whitelist

*(to be finalized — Q-HA-WHITELIST.)* Proposed default: reads + non-destructive `light`/`scene`/`notify` are **immediate**; `lock`/`alarm_control_panel`/`cover`/`climate` setpoints + any cross-project write require **Telegram confirmation** via PM.
