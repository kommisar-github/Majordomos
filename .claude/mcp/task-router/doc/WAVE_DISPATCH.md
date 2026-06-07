# Wave Dispatch Protocol

The Wave Dispatch system enables crash-resilient multi-agent orchestration. It structures work into ordered waves with dependency gates, persists state to the MCP server's SQLite database, and supports full recovery after terminal restarts.

---

## Overview

When an architect or reviewer produces an ordered execution plan, the PM converts it into **waves** — groups of tasks that can run in parallel, with dependency gates between them.

```
Wave 0 "Immediate" ──→ Wave 1 "After C0" ──→ Wave 2 "Phase 1" ──→ Wave 3 "Final"
  [parallel tasks]       [blocked on C0]       [blocked on W1]     [blocked on W2]
  [user actions]         [2 tasks]              [1 task]            [1 task]
```

Each wave tracks:
- **Tasks** with agent assignments, MCP task IDs, and completion status
- **User actions** (manual steps that gate the next wave)
- **Dependency gates** referencing specific tasks or waves

---

## Schema

The dispatch plan is stored as a JSON string in the PM's MCP memory (`save_memory(agent="pm", key="dispatch_plan", value=<JSON>)`).

```json
{
  "source": "/review dispatch order, approved 2026-04-03",
  "created_at": "2026-04-03T14:30:00Z",
  "status": "draft|active|completed|abandoned",
  "waves": [
    {
      "id": "wave-0",
      "name": "Immediate (parallel)",
      "status": "pending|dispatched|completed",
      "blocked_on": [],
      "tasks": [
        {
          "ref": "P0-A",
          "agent": "x3",
          "task_id": "abc-123",
          "summary": "X3 Phase 0 bringup",
          "status": "pending|dispatched|accepted|completed|failed",
          "result_summary": null
        }
      ],
      "user_actions": [
        {
          "ref": "P0-H",
          "description": "MPU-6050 wiring verification",
          "done": false
        }
      ]
    },
    {
      "id": "wave-1",
      "name": "After C0",
      "status": "blocked",
      "blocked_on": ["wave-0:C0", "wave-0:user_actions"],
      "tasks": [
        {
          "ref": "C1",
          "agent": "nav",
          "task_id": null,
          "summary": "API rate limiting + auth middleware",
          "status": "pending",
          "result_summary": null
        }
      ],
      "user_actions": []
    }
  ],
  "decisions": [
    {
      "at": "2026-04-03T14:35:00Z",
      "decision": "User approved plan, skipped OctoMap decoder for now",
      "context": "wave-0 dispatch"
    }
  ]
}
```

### Field Reference

| Field | Description |
|-------|------------|
| `source` | Provenance: who created the plan, when approved |
| `status` | Plan lifecycle: `draft` → `active` → `completed` or `abandoned` |
| `waves[].blocked_on` | Dependency refs: `"wave-0:C0"` = task C0 in wave-0; `"wave-0:user_actions"` = all user actions in wave-0; `"wave-1"` = entire wave-1 |
| `tasks[].ref` | Label from the architect/reviewer plan (e.g., "P0-A", "C0") |
| `tasks[].task_id` | `null` before dispatch, set to MCP task ID after `dispatch_task` |
| `tasks[].status` | Lifecycle: `pending` → `dispatched` → `accepted` → `completed`/`failed` |
| `tasks[].result_summary` | One-line summary copied from agent result |
| `user_actions[].done` | Set to `true` when user confirms the action |
| `decisions[]` | Append-only log of user choices during execution |

---

## Lifecycle

### 1. Plan Creation (Draft)

When an architect or reviewer produces an ordered plan, the PM:

1. Parses it into waves with dependency chains
2. **Saves immediately as `draft`** — before even presenting to the user
3. Presents the wave structure for approval

```
[PM] Parsed dispatch plan into 4 waves (saved as draft):
  Wave 0 "Immediate" — 3 tasks (x3, backend, devops) + 2 user actions
  Wave 1 "After C0" — 2 tasks, blocked on wave-0:C0 + user_actions
  Wave 2 "X3 Phase 1" — 1 task, blocked on wave-1
  Wave 3 "Final" — 1 task, blocked on wave-2

Approve and dispatch Wave 0? (yes / edit)
```

> **Why save as draft?** If the session dies between plan production and user approval, the draft survives recovery. This was the #1 data loss scenario before wave dispatch was implemented.

### 2. Wave Dispatch

On user approval, PM:

1. Updates status from `draft` → `active`
2. Calls `list_agents(project=$TASK_ROUTER_PROJECT)` to check availability
3. Calls `dispatch_task()` for each task in the wave
4. Updates task IDs and statuses
5. **Saves to memory immediately**
6. Reports dispatch summary

### 3. Result Tracking

As results arrive via hooks:

1. Match each result to a task by `task_id`
2. Update task status to `completed`, copy `result_summary`
3. If failed/timed out: set `failed`, log reason in `decisions[]`
4. **Save after every status change**
5. Present results to user

### 4. Gate Evaluation

After each result or user action completion:

1. Parse `blocked_on` refs for each blocked wave
2. If all conditions met → wave status changes from `blocked` to `ready`
3. Notify user: "Wave N is unblocked. Dispatch? (yes / skip / edit)"
4. **Never auto-dispatch** — always ask

### 5. User Action Tracking

```
User: "P0-H wiring is done"
PM:   Updates user_actions[ref="P0-H"].done = true
      Saves dispatch_plan
      Checks if this unblocks any waves
```

### 6. Completion

When all waves reach `completed`:

```
[PM] Dispatch plan complete: "<source>"
  Wave 0: 3/3 tasks, 2/2 user actions
  Wave 1: 2/2 tasks
  Wave 2: 1/1 tasks
  Decisions: 5 recorded
```

---

## Save Triggers

State is saved after **every** meaningful change. The critical rule: **save early, save often.**

| # | Trigger | Status |
|---|---------|--------|
| 0 | Plan produced by architect/reviewer | `draft` |
| 1 | User approves plan | `active` |
| 2 | Wave dispatched (task IDs assigned) | `active` |
| 3 | Result acknowledged | `active` |
| 4 | Task failed/timed out | `active` |
| 5 | User action confirmed done | `active` |
| 6 | User decision recorded | `active` |
| 7 | Wave completed | `active` |
| 8 | All waves completed | `completed` |
| 9 | User abandons plan | `abandoned` |

---

## Recovery (Reconciliation)

On PM startup, if a `dispatch_plan` exists in memory:

1. **Load** the saved plan
2. **Reconcile** each in-flight task against the actual database:
   - Call `check_results(task_id)` for each task with a `task_id` (max 10 to save tokens)
   - Update statuses: DB says `completed` → mark completed + copy result
   - DB says `timed_out`/`cancelled` → mark failed
   - DB says `accepted` → keep as-is (still running)
3. **Re-evaluate** wave statuses and gate conditions
4. **Save** the reconciled plan
5. **Present** recovery summary:

```
[PM] Recovered dispatch plan: "/review dispatch order"
  Wave 0 "Immediate": 2/3 completed, 1 accepted. User actions: 1/2 done.
  Wave 1 "After C0": blocked (waiting on C0 + user actions)
  Wave 2 "X3 Phase 1": blocked (waiting on Wave 1)

Continue with this plan? (yes / fresh start)
```

For `draft` plans:
```
[PM] Recovered DRAFT plan (not yet approved). Review and approve?
```

---

## Failure Handling

| Scenario | Response |
|----------|---------|
| Task failed/timed out | Log in decisions, ask user: retry / skip / abort wave |
| Agent offline at dispatch time | Fall back to subagent fork for that task |
| User says "abandon plan" | Set status to `abandoned`, keep in memory for audit |
| Session dies mid-dispatch | Recovery reconciles on next startup |

---

## Migration from Flat Plans

The `save plan` command converts older flat plan formats:

```
/pm save plan
```

This gathers all plan context from the current conversation and saves it in the wave format. Use before relaunching a PM terminal that has in-flight state from an older session.
