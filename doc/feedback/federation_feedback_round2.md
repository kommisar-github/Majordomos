# Consumer feedback — Task Router federation (post-bootstrap, round 2)

**Date:** 2026-06-15
**Source artifacts:** `client.js` `PROTOCOL_VERSION = 'node/v4.6'`; server v1.4.10; seed v4.13. Extension: claude-task-router v1.4.10 (IDE extension, macOS).
**Context:** Post-bootstrap feedback discovered AFTER the initial federation + SoT bootstrap round. The bootstrap-round feedback was delivered separately in `federation_bootstrap_feedback.md` — do not duplicate those entries here.
**Signal classification:** **Additive** on all items.

---

## Friction — post-bootstrap discoveries

### MEDIUM — would improve output quality or reduce consumer friction

**1. Federated `read_guidelines(agent=X)` only serves `doc/X_GUIDELINES.md`; the agent's doc tree (`doc/X/**`) is unreachable over federation.** `read_guidelines(agent=X)` resolves to exactly `doc/X_GUIDELINES.md` (USER_MANUAL.md ~502–503, AGENT_PROTOCOL.md 141/150, PM_TEMPLATES.md 876; `upgrade.ps1` preserves the flat `doc/*_GUIDELINES.md` pattern). There is no tree, glob, or readdir path. A SoT "library" agent whose knowledge spans a catalog (`doc/X_GUIDELINES.md`) plus per-topic books (`doc/X/<topic>.md`) cannot serve the full corpus to federated consumers under a single agent token — only the catalog file is reachable. Per-book tokens are not in the federation schema, so there is no workaround that uses the existing token primitives. Observed with the `/hw_lib` SoT agent (seed `node/v4.6`, 2026-06-15): catalog served, 10+ per-platform hardware book docs in `doc/hw_lib/` unreachable over federation. **Additive.**

*Proposed fix:* When `doc/<agent>/` exists, treat `read_guidelines(agent)` as a tree read: return the catalog `doc/<agent>_GUIDELINES.md` plus the content (concatenated or enumerated) of `doc/<agent>/**.md`. Anti-distillation quota still applies (maintainer's call whether to count as one read or per-file). Backward-compatible: agents without a `doc/<agent>/` subdirectory behave exactly as today. Minimum alternative: expose a `read_guidelines_file(agent, path)` verb that resolves `doc/<agent>/<path>` under the same RO grant — allows a consumer to enumerate and fetch books individually at the cost of N round-trips.

*Current workaround:* Catalog inlines the highest-value cross-platform laws so RO federation gets the shared canon; local / same-repo agents read the full tree directly. Book depth over federation awaits this feature.
