# host ops

## Abstract
**TL;DR:** macOS always-on host runbook — provisioning, headless claude auth, launchd, Tailscale.
**Load when:** macOS, launchd, LaunchAgent, plist, KeepAlive, ThrottleInterval, launchctl, bootstrap, headless, ANTHROPIC_API_KEY, claude auth, provision, preflight, Tailscale, restart policy, bounded restart, G1, G2
**Key facts:** claude must be non-interactively authed (G1); launchd KeepAlive+Throttle; bounded periodic restart safe via compaction-resume.
**Owner:** /ops   **Related:** doc/design/app_runtime.md

---

macOS host runbook (Phase 0 + Phase 6). Preflight (`host/provision.sh`) asserts Node, git, **headless `claude` auth**, Tailscale; launchd plist for always-on with throttled restart.
