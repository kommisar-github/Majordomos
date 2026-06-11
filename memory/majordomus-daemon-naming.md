---
name: majordomus-daemon-naming
description: The always-on host package is majordomus-daemon (renamed from mcp-task-router-app 2026-06-11); launch + what it bundles
metadata:
  type: reference
---

The Majordomus always-on host process lives in `majordomus-daemon/` (package
name `majordomus-daemon`). It was renamed from the misleading
`mcp-task-router-app` on 2026-06-11 (commit `e7b9a2f`, on `origin/main`) —
**any older path referencing `mcp-task-router-app/` is stale.**

It is not "just the task router." One always-on process bundles three concerns:
- the in-process Task Router **server host** (`src/serverHost.js`, attaches :3100 — never restart, 409 project-lock),
- the node-pty **agent supervisor** (`src/supervisor.js`),
- the HA **config-write executor** (`src/ha-bridge.js`, loopback-only **:3101**, cap-token gated). `/ha` owns the bridge; `/app` owns the host.

Launch the executor host: `node majordomus-daemon/bin/app.js` (default mode
attaches to :3100 + mounts :3101). Mental model: `majordomus-daemon` = "the
Majordomus daemon." Relates to [[ha-devops-hard-gate]] (the :3101 executor is
the hard floor) and [[ha-mcp-integration]].
