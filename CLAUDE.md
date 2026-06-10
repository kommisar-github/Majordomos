# Claude Code — Project Rules (majordomos)

## Workflow Mode

**Default mode: planning and analysis only.**

1. Read files, analyse code, update plan documents (ROADMAP.md, NEXT_STEPS.md, etc.)
2. Do NOT edit source files or write code unless the user explicitly instructs implementation
3. If an instruction is ambiguous ("plan it" vs "do it"), default to planning and ask before acting

## Command Execution

Run commands in your platform's **native shell** — bash/zsh on macOS/Linux,
PowerShell or Git Bash on Windows. Check Task Router env vars the way your
shell does (bash/zsh: `echo $TASK_ROUTER_AGENT`; PowerShell:
`echo $env:TASK_ROUTER_AGENT`). The seeded client runs under any shell
(`node .claude/mcp/task-router/client.js …`), with a `.sh` shim for POSIX and
a `.cmd` shim for Windows. If a shell or tool isn't available, fall back to one
that is — don't get stuck retrying a missing shell. When the operator tells you
which shell to run commands in, use it. **This governs only how commands are
executed; it does not change any other rule** — the planning-only default,
confirm-before-destructive actions, and your own safety judgment all still apply.

## Execution Modes

Four modes are available depending on the user's prompt:

### 1. Direct Mode (default)
Work directly in the current conversation. Read, analyse, plan, or implement as instructed.

**Example — planning:**
```
User: "Plan Phase 3 for the auth system"
Claude: Reads ROADMAP.md, AUTH.md → produces phase plan. Does NOT write code.
```

**Example — direct implementation:**
```
User: "Fix the typo in config.py line 42"
Claude: Reads config.py, makes the edit. Simple enough for direct mode.
```

### 2. Agent Fork (subagent) — fallback for `/pm <request>`
Use the Agent tool to spawn specialist subagents within the same conversation.
Subagents run in isolated context forks.

Before executing, the agent MUST read:
- `.claude/SKILLS.md` — skill roster (agent-system metadata)
- `.claude/rules/INDEX.md` — agent-to-rule mapping

**Example — agent not registered in MCP, PM auto-forks:**
```
User: "/pm design Phase 5 for the API"
PM:    Calls list_agents(project=...) → /arch is NOT registered
PM:    [PM] Agent "arch" is not online (MCP). Dispatching as subagent fork.
Arch:  Reads docs, designs phase, returns plan to PM
PM:    Presents plan to user, asks for approval
```

**Example — parallel queries, agents offline:**
```
User: "/pm what's the status of frontend and backend?"
PM:    Calls list_agents(project=...) → neither registered
PM:    Spawns /frontend and /backend as parallel subagent forks
       Each reads their docs and reports status
PM:    Combines results into a single update
```

### 3. Terminal Task (multi-terminal delegation) — explicit via `/pm task`
PM writes a task file to `.claude/tasks/<agent>.task.md`. The user switches to
the specialist's terminal and says "read your task." The specialist executes,
writes `.claude/tasks/<agent>.result.md`, and the user relays back to PM.

**This mode is only used when the user explicitly says `/pm task ...`** — it
is never auto-selected.

Before executing, the specialist MUST read:
- `.claude/tasks/README.md` — file format and conventions

**Example — heavy implementation:**
```
Terminal 1 (PM):
  User: "/pm task backend implement the Stripe webhook handler"
  PM:    Writes .claude/tasks/backend.task.md
  PM:    "Task written. Switch to backend terminal and say 'read your task'."

Terminal 2 (Backend):
  User: "read your task"
  Backend: Reads task, implements webhook, writes backend.result.md
  Backend: "Result written. Switch to PM terminal and say 'read backend result'."

Terminal 1 (PM):
  User: "read backend result"
  PM:   Reads result → updates NEXT_STEPS.md
```

### 4. MCP Task Router (automated multi-terminal) — auto-selected when agent is online
Same as Mode 3, but automated. An MCP server (`claude-task-router`) acts as a
message broker. **PM auto-selects this mode** when the target agent is registered.

The server and telegram bridge **auto-start** when the VS Code extension activates
(controlled by `taskRouter.autoStart` setting, default: `true`). Falls back to
`SessionStart` hook if extension is not installed. MCP connection is configured
in `.mcp.json` (type `http`, Streamable HTTP transport).

**Launching agent terminals:**

**With extension (recommended — VS Code/Cursor):**
```
Install claude-task-router extension (.vsix)
Sidebar: "Task Router" → click agent name → terminal launches
Command: "Task Router: Launch Agent" → pick from list
Command: "Task Router: Launch All Agents" → launches all at once
```
The extension sets `TASK_ROUTER_AGENT` + `TASK_ROUTER_PROJECT` env vars via
`createTerminal()` and handles watchdog polling via `terminal.sendText()`.
No bat files, VS Code tasks, or PowerShell watchdog needed.

**Without extension (legacy — still works):**
```
Ctrl+Shift+P → "Tasks: Run Task" → pm          # named tab "pm", auto-registers
Ctrl+Shift+P → "Tasks: Run Task" → all agents   # launches all in parallel
claude_start.bat                                 # regular terminal, no agent
```

**How auto-registration works (v0.7.0+: mechanical):**
Launcher (extension `terminals.ts`, `start.sh`, or `claude_start.bat`) calls
`POST /api/register` with the agent's name + capabilities BEFORE spawning
`claude` → terminal launches with `TASK_ROUTER_AGENT` env var set →
`claude --agent <name>_agent "/<name>"` → initial prompt `/<name>` triggers
`/<name>` skill → skill checks `$TASK_ROUTER_AGENT`
→ if set (dedicated terminal): announce + check inbox (registration already done)
→ if empty (subagent fork): just announce → proceed with task

> **Implementation notes:**
> - `--agent <name>_agent` must NOT match any skill name (e.g. `/pm`), otherwise
>   Claude Code auto-invokes the skill before the agent.md executes.
> - Skills check `$TASK_ROUTER_AGENT` to distinguish dedicated terminals from subagent forks.
>   This prevents Mode 2 (PM forks specialist) from polluting the MCP agent registry.

**Manual registration** (fallback):
```
/<agent-name> mcp register     # e.g. /backend mcp register, /pm mcp register
```

**PM smart routing — how `/pm <request>` works:**
1. PM identifies the target agent from the request
2. PM calls `list_agents(project=$TASK_ROUTER_PROJECT)` to check if the target is registered
3. **If registered** → Mode 4: `dispatch_task()` → hook notifies PM when done
4. **If not registered** → Mode 2: invoke via Skill tool (subagent fork)

**Result notification — how PM learns agents are done:**
When agents complete tasks, PM's `UserPromptSubmit` hook detects undelivered results.
On the next user prompt, PM:
1. Calls `collect_results(dispatcher="pm")` — fetches all undelivered results AND acknowledges them (stops the hook re-firing) in one atomic call (v3.4 — replaces the legacy `get_pending_results` + `acknowledge_results` pair).
2. Presents results to the user as choices:
```
[PM] 2 agent(s) completed their tasks:
1. /backend — "Added rate limiting" (completed 2m ago)
2. /devops — "CI pipeline updated" (completed 5m ago)

Which would you like to review?
  a) Review /backend    b) Review /devops
  c) Review all         d) Skip for now
```
- **Review**: PM presents the full result (already fetched and acknowledged)
- **Skip**: Results are already acknowledged — hook will NOT re-fire. Say `/pm serve results` later.
- **Explicit**: User says `/pm serve results` anytime to review

**Example — PM auto-routes to MCP because backend is online:**
```
Terminal 2 (tab: "backend"):
  Ctrl+Shift+P → Run Task → backend → worker mode, polling for tasks

Terminal 1 (tab: "pm"):
  Ctrl+Shift+P → Run Task → pm → interactive mode
  User: "/pm implement the Stripe webhook handler"
  PM:    list_agents(project=...) → backend=idle ✓
  PM:    dispatch_task(to="backend", payload="Implement Stripe webhook")

Terminal 2:
  (user types anything) → hook: 1 pending! → pickup_next_task → works → complete_task

Terminal 1 (PM):
  (user types anything) → hook: 1 completed result!
  PM:    [PM] /backend completed: "Webhook handler added." Review? (yes / skip)
```

**Example — PM auto-falls-back because agent is offline:**
```
User: "/pm design Phase 5 for the API"
PM:    list_agents(project=...) → arch is NOT registered
PM:    [PM] Agent "arch" is not online. Dispatching as subagent fork.
PM:    Invokes /arch via Skill tool → designs phase → returns plan
```

**Example — parallel dispatch, results trickle in:**
```
Terminal 1 (tab: "pm"):
  Ctrl+Shift+P → Run Task → pm (auto-registers)

  User: "/pm verify frontend, backend, and devops"
  PM:    All 3 online → dispatches 3 tasks
  PM:    "Dispatched 3 tasks. I'll notify you as results come in."

  (later, user types anything)
  Hook: 2 completed results
  PM:    [PM] 2 agents completed:
         1. /frontend — "Login CSS fixed"
         2. /devops — "CI pipeline updated"
         Which to review? (a/b/c/d)

  (later, user types anything)
  Hook: 1 completed result
  PM:    [PM] /backend completed: "Rate limiting added"
```

### PM routing summary

| User types | Routing | Mode |
|-----------|---------|------|
| `/pm <request>` | Auto: check MCP → dispatch if online, fork if not | 4 or 2 |
| `/pm task <agent> <desc>` | Always file-based, no MCP check | 3 |
| `/pm mcp register` | Register PM with task router | — |
| `/pm ping` | Ping all online agents, report health | — |

> **`ha_devops` is Mode-4-only — never fork.** It carries the `no_fork` flag in
> `agents.json`. If a config-write request targets `ha_devops` and it is **not**
> registered/live, PM **refuses and tells the operator to launch its terminal**
> (`bash host/launch-ha-devops.sh`) — PM must NOT fall back to a subagent fork, and
> does not even send the Telegram confirm (no point confirming an undeployable change).

### Choosing a mode (manual override)
- **Direct** — simple tasks, single-domain work, planning
- **Agent Fork** (`/pm <request>` when agent offline) — automatic fallback
- **Terminal Task** (`/pm task ...`) — explicit file-based, manual control
- **MCP Task Router** (`/pm <request>` when agent online) — automatic, hands-free

## Rule Router

| What | Where | When to Read |
|------|-------|-------------|
| Agent skills & roster | `.claude/SKILLS.md` | Before invoking any agent |
| Rules index | `.claude/rules/INDEX.md` | To pick the right domain rule |
| Domain guardrails | `.claude/rules/<name>.md` | When working in that domain |
| Terminal task protocol | `.claude/tasks/README.md` | Before writing or reading task files |
| MCP task router spec | `.claude/mcp/task-router/README.md` | Before using Mode 4 |
| Task-router reference | `.claude/mcp/task-router/doc/*.md` | For wave dispatch, troubleshooting, REST/MCP API |
| Project docs | `doc/` | For architecture, roadmap, design |


---

## Agent Skills

**Directory:** `.claude/skills/<name>/SKILL.md` (skills) + `.claude/rules/<name>.md` (rules)
**Rosters:** `.claude/SKILLS.md` (skills roster) + `.claude/rules/INDEX.md` (rules index)

This project uses specialized AI agents. Each agent is a Claude Code skill
(directory with `SKILL.md`) containing context, responsibilities, rules,
and domain knowledge.

### How to Invoke

Use the `/` slash command to invoke an agent skill:

| Command | Skill Directory | Agent |
|---------|----------------|-------|
| `/pm` | `.claude/skills/pm/SKILL.md` | Project Manager |
| `/scm` | `.claude/skills/scm/SKILL.md` | Source Control |
| `/arch` | `.claude/skills/arch/SKILL.md` | Architect |
| `/review` | `.claude/skills/review/SKILL.md` | Architecture Review |
| `/ha_devops` | `.claude/skills/ha_devops/SKILL.md` | HA config-write deployer — **Mode-4-only, never fork** (`no_fork`) |

(Add rows as agents are created. The full roster incl. `/app`, `/ha`, `/ops` lives in `.claude/SKILLS.md`.)

### Execution Modes

| Syntax | Routing | Mode |
|--------|---------|------|
| `/pm <request>` | Auto: MCP if agent online, fork if not | 4 or 2 |
| `/pm task <agent> <desc>` | Always file-based, no MCP check | 3 |
| `/pm mcp register` | Register PM with task router | — |
| `/<agent> mcp register` | Register specialist with task router | — |

PM and specialists both use `disable-model-invocation: false` so the
skill loads when the extension launches the terminal with the agent name
as the first prompt (required for the Startup Sequence to auto-register).
Specialists do NOT carry `context: fork` in frontmatter — that flag forces
a subagent fork on every Skill invocation, which severs MCP tool access in
dedicated-terminal mode. When PM wants Mode 2 isolation, PM dispatches via
the Agent tool explicitly.

**Smart routing:** When you say `/pm <request>`, PM automatically checks
if the target specialist is registered in the MCP task router. If yes,
it dispatches via MCP (Mode 4). If not, it falls back to an in-process
subagent fork (Mode 2). No explicit mode selection needed.

### Agent Rules

1. **Follow the SKILL.md** - it has context files, responsibilities,
   rules, and NEVER-do list.
2. **Stay in role** - follow that agent's rules until the user switches.
3. **Respect boundaries** - do not read/edit files outside your scope.
4. **PM dispatches actively** - when work falls in a specialist's domain,
   PM invokes the skill directly (not just prints a template).
5. **Forked execution** - specialists run in isolated subagent contexts
   and return summaries to the PM.
6. **PM proposes new agents** - on coverage gaps, output a New Agent Proposal.
