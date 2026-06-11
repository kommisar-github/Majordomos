# Memory — index

Auto-memory for agents resuming work on this repo. This `memory/` folder is the
**single canonical memory store** — version-controlled with the project. Read
and write memory only here, never the harness-managed auto-memory directory.

Canonical project facts (architecture, decisions, failure modes) belong in
`doc/`; memory holds durable working rules and where the last session left off.

## Files

- [HA MCP integration](ha-mcp-integration.md) — how Majordomus connects to Home Assistant (official HA MCP Server, SSE); wiring done, what's left
- [HA devops hard gate](ha-devops-hard-gate.md) — operator rule: no ha_devops terminal running ⇒ zero HA changes; ha_devops is Task-Router-only, never forked; enforced at executor layer
- [Majordomus daemon naming](majordomus-daemon-naming.md) — host package renamed mcp-task-router-app → majordomus-daemon (2026-06-11, e7b9a2f); launch + what the daemon bundles

## Update protocol

Each memory file carries YAML frontmatter (`name`, `description`, `metadata.type`
of user/feedback/project/reference). Add one index line per file above. Keep
entries to one line; promote stable findings to `doc/`. Commit `memory/` to git.
