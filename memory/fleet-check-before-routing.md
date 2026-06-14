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

**2. Route fleet/bridge work THROUGH the owning agent, not inline.**
PM ran the federation `client.js remote-execute` calls itself instead of
dispatching to the `/swarm` `/dragon-vlm` `/jetson-protect` bridges that own the
relay + the per-fleet canon + `doc/<fleet>_GUIDELINES.md`. "No terminal by
design" (bridges are fork-only) does NOT mean "PM does their job" — it means
fork them. Consolidation drafts belong to the bridge; the `/review` gate and the
commit are PM's.

See [[sot-fleet-federation]] for the federation wiring this applies to.
