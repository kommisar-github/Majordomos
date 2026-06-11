---
description: Standalone-App Runtime & Supervisor Agent
globs: majordomus-daemon/src/{serverHost,supervisor,launchCommand}.js, majordomus-daemon/bin/**
alwaysApply: false
---

# app — condensed rules

- **node-pty spawn parity** with the extension `terminals.ts`: `pty.spawn(claude, [flags, '--model', m, '--agent', `${name}_agent`, `/${name}`], { cwd, env: { …, TASK_ROUTER_AGENT, TASK_ROUTER_PROJECT } })`. Majordomos spawns exactly **one** agent — the Majordomus PM.
- **Server host:** call `startServer()` from `mcp-task-router/src/index.js` in-process (returns `{ shutdown }`). If `GET /health` already succeeds, **attach** — re-starting hits the tenant project-lock (**409**) and disrupts other tenants.
- **Nudge loop** (watchdog parity): every ~10s `GET /hook/check?agent&project`; on pending work write the directive to the pty + a delayed `\r` (bracket-paste trick) — copy the timing verbatim from `watchdog.ts`. **Never** `while true` poll.
- **Lifecycle:** pty `exit` → `POST /api/unregister`; on crash, restart per `/ops`'s launchd policy.
- **node-pty is the one native dep** — macOS prebuilds exist; pin a prebuilt-shipping version. Pitfall: a Node-version bump forces a native rebuild.

**Owns:** `majordomus-daemon/bin/app.js`, `majordomus-daemon/src/serverHost.js`, `majordomus-daemon/src/supervisor.js`, `majordomus-daemon/src/launchCommand.js`, `majordomus-daemon/test/supervisor.test.js`
**Never touches:** see SKILL.md.
