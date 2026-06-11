# app runtime

## Abstract
**TL;DR:** node-pty supervisor + in-process Task Router server host for the Majordomus PM.
**Load when:** node-pty, pty, supervisor, nudge, watchdog, startServer, server-host, attach, 409, lock, bracket-paste, launchCommand, argv, unregister, green, Stop hook, claude spawn, majordomus-daemon, bin/app.js
**Key facts:** one PM agent only; reuse startServer() in-process; attach if /health up; nudge ~10s; never while-true.
**Owner:** /app   **Related:** doc/design/host_ops.md, doc/design/federation.md

---

Runtime design for the headless standalone app. See `/app` SKILL.md for the domain bullets; this doc holds the detailed supervisor + server-host contracts (to be expanded in Phase 1).
