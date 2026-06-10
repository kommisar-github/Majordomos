---
name: ha-devops-hard-gate
description: Operator-mandated hard gate for live-HA changes — no ha_devops terminal running ⇒ zero HA mutations, enforced at the executor layer
metadata:
  type: project
---

**Hard requirement (operator directive, 2026-06-10) governing the HA config-write
capability — see [[ha-mcp-integration]] and `doc/design/ha_config_write.md`.**

Live-HA changes use a two-agent split, decided by the operator (overrides /arch's
"extend /ha, no new agent" recommendation in `ha_config_write.md §4`):

- **`/ha`** = *implementer* — builds the config-write mechanism in code (executor
  verb, body-scan, WS client, audit log, tests). Never mutates the live instance.
- **`ha_devops`** (new, gated) = *deployer* — the **only** agent that applies
  changes to the live HA instance.

**The hard gate — "no agent running, no ha changes":**

1. **No `ha_devops` terminal running ⇒ zero HA config-write mutations.** Full
   stop. **Scope (operator decision 2026-06-10): config writes only** — i.e.
   create/update/delete of automations, scripts, helpers, and template sensors
   via `executeConfigWrite`. Enforced at the **executor layer** (3101 loopback)
   via the per-session cap-token, not just PM policy: the executor hard-refuses
   any config-write unless the call carries a valid `ha_devops` session
   cap-token. Structural invariant, not a convention.
   **Carve-out:** Tier-B *service* calls (open cover, set climate, start vacuum,
   etc.) are NOT config writes and keep the existing PM→`executeApprovedAction`
   Telegram-confirm path — they do **not** require `ha_devops` live. ("No agent
   running, no HA changes" = no agent running, no *config/automation* changes.)
2. **`ha_devops` is Task-Router-only (Mode 4), NEVER fork (Mode 2).** PM's
   normal offline→fork fallback is **disabled** for `ha_devops`. If it is not
   registered, PM **refuses and tells the operator to launch its terminal** —
   fail-closed.
3. **Skill self-guards:** `ha_devops` Startup Sequence refuses any deploy when
   `TASK_ROUTER_AGENT` is empty (running as a fork, not a dedicated terminal).

Defense-in-depth order: (1) capability exists only when `ha_devops` terminal up →
(2) Telegram Tier-B confirm gate → (3) executor body-scan / Critical-floor →
(4) audit-log every applied change.

**Automation-creation model — "agents draft, the human activates" (locked
2026-06-10, supersedes both /arch hard-deny and the rejected create-time
"extra confirm"):** agents may create/upsert **any** automation/script —
including ones referencing Critical entities — BUT:

- **Force-disabled on create.** The executor always deploys agent-created
  automations **disabled** (`initial_state: false`), non-overridable. A disabled
  automation cannot fire (HA skips it), so no autonomous path exists at deploy.
- 🔑 **The fleet can NEVER enable an automation.** `automation.turn_on` /
  `homeassistant.turn_on` on any `automation.*` / `script.*` entity is
  **hard-denied** for the fleet. Enabling is a **human-only** action in the HA
  UI. This is the linchpin — without it, draft-disabled is meaningless (agent
  would create-then-enable).
- **Updates re-disable.** Any agent update that changes an automation's body
  force-reverts it to disabled → human must re-enable.
- **Delete-protection stays** — deleting/disabling an existing Critical-
  referencing safety-interlock automation stays gated (/review finding).
- Body-scan's job shifts from *deny-on-Critical* to *label/surface* Critical
  refs in the Telegram confirm (full body shown + "created DISABLED").

Why this is safe: the human's enable action is a deliberate, visible act on the
firing-capable state in HA's own authoritative UI — the operator owns it. The
breaker-drop / Tier-A→Critical laundering path /review proved against the
"extra confirm" model cannot fire autonomously because the automation stays
disabled until a human enables it. Residual risk = social-engineering the human
into enabling a specific named automation; accepted (operator is the boundary).

**Why:** binds the live-mutation capability to a human-launched, registered,
auditable terminal. The fleet literally cannot change HA unless the operator
launches `ha_devops`. Never silently relax this in any design revision.

**How to apply:** any v2 design (`/arch`) and audit (`/review`) of HA config-write
MUST preserve all three points above. PM never routes a live-HA deploy to a fork.
