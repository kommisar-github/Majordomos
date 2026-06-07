---
description: Standalone-App Runtime & Supervisor Agent
globs: mcp-task-router-app/src/{serverHost,supervisor,launchCommand}.js, mcp-task-router-app/bin/**
alwaysApply: false
---

# app — condensed rules

- **node-pty spawn parity** with the extension `terminals.ts`: `pty.spawn(claude, [flags, '--model', m, '--agent', `${name}_agent`, `/${name}`], { cwd, env: { …, TASK_ROUTER_AGENT, TASK_ROUTER_PROJECT } })`. Majordomos spawns exactly **one** agent — the Majordomus PM.
- **Server host:** call `startServer()` from `mcp-task-router/src/index.js` in-process (returns `{ shutdown }`). If `GET /health` already succeeds, **attach** — re-starting hits the tenant project-lock (**409**) and disrupts other tenants.
- **Nudge loop** (watchdog parity): every ~10s `GET /hook/check?agent&project`; on pending work write the directive to the pty + a delayed `\r` (bracket-paste trick) — copy the timing verbatim from `watchdog.ts`. **Never** `while true` poll.
- **Lifecycle:** pty `exit` → `POST /api/unregister`; on crash, restart per `/ops`'s launchd policy.
- **node-pty is the one native dep** — macOS prebuilds exist; pin a prebuilt-shipping version. Pitfall: a Node-version bump forces a native rebuild.

**Owns:** `mcp-task-router-app/bin/app.js`, `mcp-task-router-app/src/serverHost.js`, `mcp-task-router-app/src/supervisor.js`, `mcp-task-router-app/src/launchCommand.js`, `mcp-task-router-app/test/supervisor.test.js`
**Never touches:** see SKILL.md.
