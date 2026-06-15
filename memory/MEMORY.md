# Memory — index

Auto-memory for agents resuming work on this repo. This `memory/` folder is the
**single canonical memory store** — version-controlled with the project. Read
and write memory only here, never the harness-managed auto-memory directory.

Canonical project facts (architecture, decisions, failure modes) belong in
`doc/`; memory holds durable working rules and where the last session left off.

## Files

- [HA MCP integration](ha-mcp-integration.md) — how Majordomus connects to Home Assistant (official HA MCP Server, SSE); wiring done, what's left
- [HA devops hard gate](ha-devops-hard-gate.md) — operator rule: no ha_devops terminal running ⇒ zero HA changes; ha_devops is Task-Router-only, never forked; enforced at executor layer
- [HA devops launcher](ha-devops-launcher.md) — ha_devops uses agents.json `launcher` (host/launch-ha-devops.sh) to mint its cap-token (v4.13); auto-runs only on v1.4.0+ bundle, else launch manually
- [Majordomus daemon naming](majordomus-daemon-naming.md) — host package renamed mcp-task-router-app → majordomus-daemon (2026-06-11, e7b9a2f); launch + what the daemon bundles
- [Battery SoH config-write](battery-soh-config-write.md) — AGM SoH calculator (Pass 2) deployed via gated config-write; operator HA-UI enable steps, executor lessons (object_id=numeric-not-slug, NEW-1 _isDeliberateCritical), Pass-2 audit-gap verdict (executeConfigWrite never called — process gap); remediation #1-#3 done (c2bc62c), #4 smoke test pending :3101 daemon start; KEY: :3101 has NO GET /health route — use empty-body POST reachability probe

- [SoT fleet federation](sot-fleet-federation.md) — Majordomus = home SoT federated to 3 dev fleets (swarm/dragon-vlm/jetson-protect) on 192.168.1.131:3100; lowercase case-sensitive project ids, RWE pm grants, tokens in gitignored fleet.secrets.env (rotation pending), full SoT bootstrap deferred
- [Fleet check before routing](fleet-check-before-routing.md) — operator feedback: re-call list_agents fresh before EVERY dispatch (never reuse startup snapshot); federated peers (v4.18) register at startup + dispatch over the gate (Mode 4 federated), NEVER fork or inline remote-execute
- [Jetson SoT](../doc/sot/jetson_orin_baseline.md) — first SoT pass (2026-06-15): all 3 fleets on Orin Nano 8GB; cross-fleet canon at doc/sot/jetson_orin_baseline.md + per-fleet doc/<fleet>_GUIDELINES.md §"NVIDIA Jetson baseline"; committed 2d339ca

## Update protocol

Each memory file carries YAML frontmatter (`name`, `description`, `metadata.type`
of user/feedback/project/reference). Add one index line per file above. Keep
entries to one line; promote stable findings to `doc/`. Commit `memory/` to git.
