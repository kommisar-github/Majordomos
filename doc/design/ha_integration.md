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

## Safety boundary (outbound + inbound) — Q-HA-WHITELIST: RESOLVED (2026-06-09)

**Authoritative design + tier tables: [`doc/design/ha_whitelist_gate.md`](ha_whitelist_gate.md)** (operator-approved + twice `/review`-audited). Do not duplicate the tier tables here — that doc is the single source of truth; this section is the summary pointer.

**Three-tier, default-deny model (tier == reachability path):**
- **Tier A — auto-allow (exposed on the MCP Server):** reads (`GetLiveContext`/state), `light.*`, whitelisted `scene.*`, `input_boolean.*`, non-Critical `fan.*`, `media_player` transport, `notify`/`HassBroadcast`, cover **STOP-only**, `switch.*` **minus the Critical list**.
- **Tier B — confirm-required (NOT exposed on MCP; reached only via the gated loopback ha-bridge executor):** `cover.*` open/position incl. `set_shutters_to_min_light`, `climate.*` setpoints, `vacuum.*`, non-whitelisted `script.*`/`automation.*`, any Critical entity promoted by operator, any cross-project write. Confirmation = a Telegram round-trip correlated by PM (unguessable `confirm_id` + `from_agent=="telegram"`; delete-before-execute; server-time TTL 120 s inbound / 300 s outbound; no reply ⇒ never executes).
- **Tier C — default-deny (neither exposed nor bridged):** `alarm_control_panel.*`, `lock.*`, the **Critical `switch.*` list** (breakers, PV/charger contactor, water valve, door lockdown/evacuation, main-entrance-lock relay, `visonic_p1_*`, intercom door relay), any unknown domain. READ still available via REST `GET /api/states/<id>` (independent of MCP exposure).

**Precedence:** Critical (hard floor) > per-entity override (`fleet/ha_whitelist.json`, git-reviewed; never lifts a Critical entity to A) > domain default > fail-closed deny.

**Enforcement legs:** L0 HA-side exposure (hard) · PM-correlator confirm gate (N1 entropy + N2 channel-bind) · loopback executor that hard-refuses out-of-policy targets regardless of approval claims.

**Rollout:** v1 = operator un-exposes Tier B/C on the HA MCP Server (zero code — see `doc/runbooks/ha_v1_exposure.md`); v2 = build the loopback executor + PM correlation to re-enable Tier B via the gated path only; v3 = quiet-hours/audit log.
