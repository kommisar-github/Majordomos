---
name: fleet-check-before-routing
description: Always re-call list_agents fresh before every dispatch/routing decision; never reuse the startup roster snapshot. Route fleet work through the owning agent, not inline.
metadata:
  type: feedback
---

Two routing-discipline corrections the operator made forcefully during the
2026-06-15 Jetson-SoT session — both are standing rules, not one-offs.

**1. Re-list the fleet fresh before EVERY routing decision.**
PM took the session-start roster (only `pm`+`telegram`) as durable truth and
later asserted "/scm, /ops offline → fork" without re-listing. The whole fleet
(`app/arch/ha/ops/review/scm`) had come green in the meantime. The SKILL's
Step 2 is explicit: `list_agents` is MANDATORY before naming a delivery mode,
and the startup snapshot races the watchdog and is pre-quorum — NEVER route on
it, including the first dispatch of the session.

**Why:** routing on the stale snapshot wrongly falls back to Mode-2 forks for
agents that are actually registered — wasting their warm terminal context and
surfacing the wrong agent to the user.

**How to apply:** call `list_agents(project=$TASK_ROUTER_PROJECT)` immediately
before each `dispatch_task` and each `/pm ping`. Treat any in-context roster as
expired. If I'm about to say "<agent> is offline," re-list first — that sentence
is unearned until a fresh `list_agents` confirms it.

**2. Federated peers: dispatch over the gate (Mode 4 federated) — never fork, never inline `remote-execute`.**
SUPERSEDED by seed erratum **v4.18** (applied 2026-06-16). The earlier rule
("fork the `/swarm` `/dragon-vlm` `/jetson-protect` bridge skill to relay") is
now WRONG for *execution/relay*. A `role:"federated-pm"` peer is reached
MCP-to-MCP over the federation gate; it has no local skill to fork.

**How to apply (v4.18):**
- The peers are declared in `.claude/mcp/task-router/agents.json` with
  `role:"federated-pm"` + a `remote` block. They have NO terminal, so the
  launcher never registers them — **PM registers them at startup** (and any time
  they're missing from `list_agents`):
  `register_agent(name=<peer>, project=Majordomos, metadata={role:"federated-pm", remote:<roster block verbatim>})`.
  The server canonicalizes the roster shorthand (`agent`/`grant`/`tokenRef:"env:X"`
  → `target_agent`/`token_env`/`operation:"execute"`). Verified the VSIX
  normalization IS installed on this host (2026-06-16).
- To relay/execute: **`dispatch_task(to=<peer>, from="pm")`** — returns
  `federated:true` + a LOCAL mirror task (busy/in-flight signal on the dashboard).
  Then END the turn; result arrives via the `[TASK-ROUTER]` completion hook →
  `collect_results`.
- **Never** Mode-2-fork a federated peer. **Never** call `client.js remote-execute`
  for routed work (it bypasses the local server → no mirror task). Reserve the
  direct `remote-read-guidelines`/`remote-write-guidelines` verbs for one-off
  low-level doc reads/writes only.
- An unreachable peer mirrors back `remote_unreachable` → **report "remote link
  down"** (name peer + URL); do NOT fork as a fallback.
- The bridge skill still owns the per-fleet canon + `doc/<fleet>_GUIDELINES.md`;
  consolidation drafts belong to it, the `/review` gate + commit are PM's. But
  that ownership is about KNOWLEDGE, not the relay transport — the relay is the
  gated `dispatch_task` above.

See [[sot-fleet-federation]] for the federation wiring this applies to.
