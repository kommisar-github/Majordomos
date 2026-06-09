---
name: ha-mcp-integration
description: Where the HA MCP integration left off — activation step pending; durable knowledge lives in doc/
metadata:
  type: project
---

**Where we left off (2026-06-09):** Majordomus→Home Assistant wiring via HA's
official MCP Server (SSE) is committed (`c3962ea` + `cb43afb`). **Activation
VERIFIED (2026-06-09):** launcher-started Claude Code session came up with the
`home-assistant` MCP server connected and the full `Hass*` toolset live. A
read-only `GetLiveContext` call returned real state across the whole home
(climate/cover/sensor/alarm/switch). Outbound read path is confirmed
end-to-end — HA-MCP integration is DONE.

**Live-exposure finding:** the HA MCP Server is currently exposing the
*destructive* tier too (`cover.*`, `climate.*` setpoints, `vacuum.*`,
`media_player.*`; tools include `HassClimateSetTemperature`, `HassTurnOff/On`,
`HassVacuumStart`, `set_shutters_to_min_light`) with **no Majordomus-side gate
built**. This makes Q-HA-WHITELIST a live safety gap, not just design polish.

Durable knowledge does NOT live here — see:
- `doc/design/ha_integration.md` — transport decision (Q-HA-TRANSPORT resolved → HA MCP Server, SSE), safety boundary, design.
- `doc/ha_GUIDELINES.md` — `/ha`'s durable conventions (entity-exposure tiers, the `${VAR}`/`.env` launcher gotcha, safety-gate posture) — populated via consolidation.

**Open:** Q-HA-WHITELIST (Majordomus-side confirmation gate) still open;
launchd plist `EnvironmentVariables` for the always-on macOS path not yet built.
