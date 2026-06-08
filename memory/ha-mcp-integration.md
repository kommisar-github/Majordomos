---
name: ha-mcp-integration
description: How Majordomus connects to Home Assistant (official HA MCP Server, SSE) and what's left to finish
metadata:
  type: project
---

Majordomus connects to the operator's Home Assistant via HA's **official "Model
Context Protocol Server" integration** (SSE), with Majordomus as the MCP
**client** — NOT a custom `ha-bridge.js`. This resolved Q-HA-TRANSPORT (see
`doc/design/ha_integration.md`). Operator's HA: `http://192.168.2.125:8123`,
verified live (HTTP 200 + SSE handshake at `/mcp_server/sse`), starter entities
exposed (2026-06-09).

**Wiring done:** `.mcp.json` has a `home-assistant` server (`type: "sse"`,
`url: ${HA_BASE_URL}/mcp_server/sse`, `Authorization: Bearer ${HA_TOKEN}`). All
three launchers (`start-majordomos.ps1/.sh/.command`) now load the gitignored
repo-root `.env` (holds `HA_BASE_URL` + the live long-lived `HA_TOKEN`) into the
process env before launching `claude` — required because Claude Code expands
`${VAR}` from the process env, it is not a dotenv loader.

**To activate:** restart Claude Code via the launcher, then `/mcp` should show
`home-assistant` connected with `Hass*` tools. A session launched before the
edits won't have the token in env.

**Open / follow-ups:**
- Q-HA-WHITELIST (Majordomus-side confirmation gate) still OPEN. v1 safety
  boundary = HA-side entity exposure only; the MCP path has NO Majordomus-side
  whitelist. First-expose: reads + `light`/`switch`/`scene`/`input_boolean`;
  withhold `lock`/`alarm_control_panel`/`cover`/`climate` setpoints/`script`/
  `automation` until the gate exists.
- Always-on macOS path: launchd plist doesn't exist yet; when created it needs an
  `EnvironmentVariables` dict populated from `.env` at provision time (launchd
  won't read repo `.env`). `host/run-majordomos.sh` has the same `.env` gap.
- The bundled Task Router app (extension 0.9.19) has NO HA code; this integration
  is purely client-side via `.mcp.json` — no app rebuild needed.

**Security:** the live HA long-lived token was pasted into chat on 2026-06-09;
if that transcript is ever shared, rotate the token in HA (Profile → Long-lived
tokens). Token expires ~2036.
