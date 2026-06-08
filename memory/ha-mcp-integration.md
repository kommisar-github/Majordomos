---
name: ha-mcp-integration
description: Where the HA MCP integration left off — activation step pending; durable knowledge lives in doc/
metadata:
  type: project
---

**Where we left off (2026-06-09):** Majordomus→Home Assistant wiring via HA's
official MCP Server (SSE) is committed (`c3962ea` + `cb43afb`). **Activation
still pending:** operator must restart Claude Code via the launcher
(`start-majordomos.ps1`, now loads `.env`), then verify `/mcp` shows
`home-assistant` connected with `Hass*` tools.

Durable knowledge does NOT live here — see:
- `doc/design/ha_integration.md` — transport decision (Q-HA-TRANSPORT resolved → HA MCP Server, SSE), safety boundary, design.
- `doc/ha_GUIDELINES.md` — `/ha`'s durable conventions (entity-exposure tiers, the `${VAR}`/`.env` launcher gotcha, safety-gate posture) — populated via consolidation.

**Open:** Q-HA-WHITELIST (Majordomus-side confirmation gate) still open;
launchd plist `EnvironmentVariables` for the always-on macOS path not yet built.
