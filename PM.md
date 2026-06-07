# PM.md — Generic Project Manager Seed

**Purpose:** Project-agnostic PM agent template. Copy into a new project and customize.
**Creates:** `.claude/skills/pm/SKILL.md` + `.claude/rules/project.md` + `.claude/SKILLS.md` + `.claude/rules/INDEX.md` + MCP task router
**Version:** 4.9 (2026-06-07)
**Templates:** All copy-paste templates are in **`PM_TEMPLATES.md`** (companion file).

---

## How to Use

1. Copy `PM.md` + `PM_TEMPLATES.md` into your new project repo
2. Run through the **Bootstrap Checklist** below
3. Replace all `<PLACEHOLDERS>` with project-specific values
4. The PM will then self-evolve — proposing new specialist agents as the project grows

---

## Multi-Agent Architecture Assessment

This section compares the terminal-bound agent + MCP approach (implemented in this seed) against pure Claude Code automatic agents (the `Agent` tool with ephemeral subagents). **Read this first** to decide which approach fits your project.

### Architecture Comparison

| | **Terminal + MCP (this seed)** | **Pure Claude Agents (Agent tool)** |
|---|---|---|
| **Topology** | N persistent Claude instances in VS Code terminals, connected via MCP task router | 1 main Claude instance spawning ephemeral subagents on demand |
| **Lifecycle** | Long-lived — agents stay running, accumulate context, accept multiple tasks | Ephemeral — agent spawns, does one task, returns result, dies |
| **Communication** | MCP server (HTTP), task dispatch/results, webhook notifications | Parent-child only — parent sends prompt, child returns text |
| **Context** | Each agent loads SKILL.md + domain files on startup. Persistent across tasks | Fresh context per spawn. Must re-read files every time |
| **Parallelism** | True parallel — N terminals = N simultaneous Claude instances with full reasoning | Subagents run in parallel but share the parent's API rate limits |
| **User interaction** | Each agent is interactive — user can talk to it, clarify, guide mid-task | Subagents are autonomous — no user interaction until they return |
| **Cost** | N concurrent sessions x context tokens (high baseline even when idle) | Pay only when working (spawned agents only) |
| **Orchestration** | PM agent + MCP task router + VS Code extension (or legacy watchdog) | Single `Agent` tool call with a prompt string |

### Terminal + MCP Strengths

1. **Persistent specialized context** — Agents load domain files once, keep them across multiple tasks. No re-reading, no re-learning, no wasted tokens on context setup.
2. **Interactive mid-task guidance** — Walk up to any terminal and redirect the agent mid-task. Pure subagents run blind until done.
3. **True multi-model parallelism** — 10 terminals = 10 simultaneous Claude instances, each with full reasoning capacity. Pure agents share parent's API connection.
4. **Observability** — See what each agent is doing in real time (scrolling terminal output). Pure subagents are black boxes until return.
5. **Stateful across tasks** — Agent remembers SSH errors, container logs, previous fixes. Next task benefits from accumulated context.

### Pure Claude Agent Strengths

1. **Zero setup cost** — `Agent(prompt="fix the bug")` vs 15 steps of MCP/terminal ceremony.
2. **No idle cost** — Agents only exist when there's work. No tokens burned on idle terminals.
3. **No infrastructure** — No MCP server, extension, hooks, result acknowledgment.
4. **Simpler failure modes** — One failure mode (agent returns error) vs fewer moving parts.
5. **Better for quick one-off tasks** — "Check if this import is used" doesn't need a specialized terminal.
6. **Automatic context management** — Each agent gets exactly the context it needs per task.

### When to Use Which

| Scenario | Better approach |
|---|---|
| Single complex task in one domain | Terminal + MCP (persistent context, interactive) |
| Quick research/exploration | Pure Agent (spawn, search, return) |
| Multi-domain parallel work | Terminal + MCP (true parallelism, each agent focused) |
| One-off simple question | Pure Agent (no setup overhead) |
| Long debugging session | Terminal + MCP (accumulating context, user guidance) |
| CI/CD automation | Pure Agent (no terminals needed, scriptable) |
| Team of humans + agents | Terminal + MCP (each human talks to their agent) |
| Solo developer, one task at a time | Pure Agent (simpler, cheaper) |
| Solo developer on a long multi-domain project, using per-agent model tiers to control cost | Terminal + MCP (specialists are primarily knowledge hubs for their domains — the seed's matrix, dispatch routing, and Abstract standard all organize around that; per-agent model tiering is a valuable secondary benefit that falls out of having distinct knowledge-holders) |
| Solo learning-focused project (training / deep study) where some work must NOT be delegated | Terminal + MCP **with the learning-first delegation rule** (see System Concepts → Learning-First Delegation) |

### Pragmatic Hybrid (Recommended)

Use terminal agents for heavy domain work (3+ file reads to rebuild context). Use pure Agent spawns for quick queries, exploration, and one-off tasks. The PM's smart routing (Mode 2 fallback to Agent Fork) already implements this — when a specialist terminal isn't running, PM automatically forks a pure subagent instead.

### Multi-Platform Projects

For projects with multiple deployment targets or product lines sharing infrastructure, consider a shared directory pattern:

```
project/
├── shared/              # Docs, common scripts, shared libraries
│   ├── doc/             # Cross-product docs
│   ├── config/          # Shared configuration
│   ├── scripts/         # Common deployment scripts
│   └── debug/           # Common test/debug scripts
├── product_a/           # Product A specific code, Dockerfiles, start/stop
├── product_b/           # Product B specific code, Dockerfiles, start/stop
├── dashboard/           # Shared UI (all products)
└── server/              # Shared backend (all products)
```

Each product gets its own agent (`/product_a`, `/product_b`), while shared agents (`/backend`, `/frontend`, `/dashboard`, `/devops`) operate across all products. Product agents own product-specific code; shared agents own infrastructure and cross-product logic.

---

## Step 0: Create Directories

Run once in the **new project root** (Bash or PowerShell) to create all required directories.

**Bash (Git Bash / WSL / macOS / Linux):**
```bash
mkdir -p .claude/skills/{pm,scm,arch,review} .claude/tasks .claude/rules
mkdir -p "<DOC_DIR>"
# If DOC_DIR is "doc/":
mkdir -p doc
```

**PowerShell:**
```powershell
New-Item -ItemType Directory -Force -Path .claude/skills/pm, .claude/skills/scm, .claude/skills/arch, .claude/skills/review, .claude/tasks, .claude/rules
New-Item -ItemType Directory -Force -Path doc
# If your DOC_DIR is different, create that path instead of doc
```

---

## Bootstrap Checklist

### Core (Modes 1-3)
- [ ] **Step 0:** Run the directory creation script above
- [ ] Copy CLAUDE.md Template from `PM_TEMPLATES.md` into repo root `CLAUDE.md`
- [ ] Copy PM Skill Template from `PM_TEMPLATES.md` into `.claude/skills/pm/SKILL.md`
- [ ] Copy SCM Skill Template from `PM_TEMPLATES.md` into `.claude/skills/scm/SKILL.md`
- [ ] Copy Architect Skill Template from `PM_TEMPLATES.md` into `.claude/skills/arch/SKILL.md`
- [ ] Copy Architecture Review Skill Template from `PM_TEMPLATES.md` into `.claude/skills/review/SKILL.md`
- [ ] Copy Project Rule from `PM_TEMPLATES.md` into `.claude/rules/project.md`
- [ ] Copy SKILLS.md Template from `PM_TEMPLATES.md` into `.claude/SKILLS.md` (agent roster — agent-system metadata, not a planning doc)
- [ ] Copy Rules INDEX Template from `PM_TEMPLATES.md` into `.claude/rules/INDEX.md` (rule index — counterpart to `.claude/SKILLS.md`)
- [ ] Copy Task File Protocol from `PM_TEMPLATES.md` into `.claude/tasks/README.md`
- [ ] Copy DOC_OWNERSHIP_MATRIX.md Template from `PM_TEMPLATES.md` into `doc/design/DOC_OWNERSHIP_MATRIX.md`
- [ ] Create initial planning docs: `doc/plans/ROADMAP.md`, `doc/NEXT_STEPS.md`
- [ ] **Place your project's design docs in `doc/`** (not at repo root) so `DOC_OWNERSHIP_MATRIX.md` can index them consistently
- [ ] Verify: start Claude Code, type `/pm` — agent loads

### MCP Task Router (optional, for Mode 4 — automated dispatch)
- [ ] Follow `doc/runbooks/USER_MANUAL.md` (install VSIX → run `init.sh` → open project; extension handles server + agents.json + hooks)
- [ ] Verify: `/mcp` shows Connected, `/pm ping` shows agents responding

### First Use
- [ ] Run `/pm` and describe your project in 2-3 sentences
- [ ] PM proposes domain-specific agents — approve the ones you want
- [ ] Start working — PM dispatches to specialists automatically

---

## Placeholders to Replace

| Placeholder | Replace With | Example |
|-------------|-------------|---------|
| `<PROJECT_NAME>` | Your project name | MyApp, DataPipeline |
| `<DOC_DIR>` | Path to planning docs | doc/, docs/, planning/ |
| `<DATE>` | Current date | 2026-03-16 |

---

## System Concepts

### Execution Modes

Four modes are available, escalating in automation:

| Mode | Name | How It Works | When Used |
|------|------|-------------|-----------|
| 1 | **Direct** | Work in the current conversation | Simple tasks, planning, single-domain |
| 2 | **Agent Fork** | PM spawns specialist as subagent (isolated context fork) | `/pm <request>` when agent is offline |
| 3 | **Terminal Task** | PM writes task file, user relays between terminals | `/pm task <agent> <desc>` (explicit) |
| 4 | **MCP Task Router** | Automated dispatch via MCP server, hook-driven polling | `/pm <request>` when agent is online |

Mode 2 and 4 are **auto-selected** by PM's smart routing — no manual mode choice needed. Mode 3 is only used when the user explicitly says `/pm task ...`.

### PM Smart Routing

When the user says `/pm <request>`, PM auto-routes:

1. **Identify** the target agent from the request (e.g., "design Phase 6" -> `/arch`)
2. **Call `list_agents(project=$TASK_ROUTER_PROJECT)`** — mandatory before every dispatch, no exceptions, no cached lists
3. **If agent is in the list** -> Mode 4: `dispatch_task()` via MCP, hook notifies PM when done
4. **If agent is not in the list** -> Mode 2: invoke via Skill tool (subagent fork)

This means the same `/pm <request>` syntax works whether agents are running in terminals or not. PM adapts automatically.

### Task Lifecycle (Mode 4)

```
v3.4 / v0.8.0 (2-call specialist lifecycle, 1-call PM collection):
PM dispatches ──> task queued ──> specialist's hook fires ──> pickup_next_task
     ──> execute ──> complete_task ──> PM's hook fires
     ──> collect_results ──> present to user

v3.3 and earlier (5-call specialist, 2-call PM — still fully supported):
PM dispatches ──> task queued ──> specialist's hook fires ──> check_inbox
     ──> accept_task ──> execute ──> submit_result ──> PM's hook fires
     ──> get_pending_results ──> acknowledge_results ──> present to user
```

**Tool disambiguation:** `collect_results(dispatcher="pm")` fetches all undelivered results AND acknowledges them in one atomic call (v0.8.0; replaces `get_pending_results` + `acknowledge_results`). `check_results(task_id)` checks a specific task's status. `pickup_next_task(agent, project)` is the v0.8.0 specialist-side composite that replaces `check_inbox + accept_task + save_memory(task_id)`; `complete_task(task_id, result, agent, project)` is the corresponding submit composite that replaces `submit_result + delete_memory(task_id)`. Compaction recovery is now server-managed — `pickup_next_task` returns any in-progress task assigned to this agent as `resumed: true` regardless of conversation context. The v3.3 5-call lifecycle keeps working alongside; consumers migrate per the v3.4 SKILL erratum on their own timeline.

### Wave Dispatch

A **wave** is a group of tasks with no inter-dependencies that can be dispatched in parallel. Waves execute sequentially — each gated on the previous wave's completion plus any required user actions.

When `/arch` or `/review` produces a multi-step plan, PM converts it into waves and executes wave-by-wave: save draft immediately, present for approval, dispatch on user "yes", track results, gate before advancing. PM never auto-advances between waves.

Full protocol: `doc/design/WAVE_DISPATCH.md`

### Task Reconciliation

Specialist agents occasionally leave tasks in `accepted` state without calling `submit_result` — historically the dominant cause was Claude Code's context compaction summarizing the `task_id` away from the conversation while preserving the work context. The agent retained *what it was doing* but lost *which `task_id` to submit against*. PM detects and recovers from this:

- **Before every dispatch:** Query `GET /tasks?to_agent=X&status=accepted` for the target agent. Classify stuck tasks as definitely-stale (agent completed newer work), suspect (older than 10 min with no completion), or possibly-running (recent, let it run).
- **At session startup:** Full-project sweep across all agents.
- **Recovery:** Dispatch a `# RECONCILE <task_id>` prompt at `priority=10`. The specialist must `submit_result` (still running) or `cancel_task` (forgot/lost context). If reconciliation itself times out, PM force-unregisters the agent and the watchdog re-registers it within 10s.

**Specialist task_id retention — server-managed since v3.4 (v0.8.0); manual in v2.14–v3.3.** Through v3.3, every specialist SKILL.md's Task Router Auto-Execute template carried a memory-retention discipline to survive Claude Code's context compaction: `save_memory(key="in_flight_task_id")` after `accept_task`, `load_memory` (with `list_tasks(to_agent=self, status="accepted")` as fallback) before `submit_result`, and `delete_memory` after submit success. **v3.4 makes this server-managed** — `pickup_next_task` returns any task this agent already owns as `resumed: true` regardless of conversation context, backed by the server-maintained `_in_progress_task` reserved key, so specialists no longer need the manual discipline. Consumers still on a pre-v3.4 SKILL keep the manual flow (fully supported) until the v3.4 erratum is applied. The reconciliation flow above stays as the safety net either way.

Zero server changes — rides entirely on existing MCP tools and REST endpoints.

### Agent Evolution

PM continuously evaluates whether the agent roster covers project needs. Six triggers for proposing a new agent:

1. **Coverage gap** — task spans files no agent claims
2. **Context overload** — agent exceeds ~15 files or ~60 rules
3. **Recurring cross-cutting concern** — same work type across multiple agents
4. **New project domain** — new subsystem introduced
5. **User friction** — user repeatedly explains context an agent should know
6. **Technology boundary** — new language/framework enters the project

PM outputs a structured proposal (name, justification, scope, globs, impact) and waits for user approval before creating the skill + rule files.

### Document Ownership Matrix

A project with more than ~5 specialist agents quickly accumulates design, reference, and planning docs faster than any one agent can track. `DOC_OWNERSHIP_MATRIX.md` is the governance artifact that solves this — one table listing every doc with a Primary owner (updates it), Secondary readers (load when relevant), and a Type (`roadmap | design | reference | analysis | plan | memory`). PM owns the matrix; specialists consult it at startup.

**Project shape — choose your path first.** Most projects are one of two shapes, and the matrix template accommodates both:

- **Single-repo (the default, most common shape)** — one codebase, shared docs under `doc/`. Fill in **Sections 1–4** of the matrix template (cross-cutting docs, load rules, Abstract standard, Quick-reference) and **omit the appendices entirely** — do not leave empty stubs. "Agent X reads its ROADMAP" translates to "agent X reads the shared `doc/plans/ROADMAP.md`" (there is only one). Solo-developer and learning-focused projects fall here.
- **Multi-platform** — multiple deployment targets with separate docs per platform (e.g., one client codebase per hardware variant). Use Sections 1–4 **plus Appendix A** (platform-specific docs) **and/or Appendix B** (hardware reference). Matrix lives under `<SHARED_DOC_DIR>/DOC_OWNERSHIP_MATRIX.md` with platform-specific docs in dedicated directories. Only choose this shape when each platform would genuinely publish a separate ROADMAP.

**Why it matters for context economy:**
- **Dedicated terminals** (long-lived, `$TASK_ROUTER_AGENT` set) amortize the doc load cost: read every Primary doc once at startup, skip re-reads for subsequent tasks in the session.
- **Subagent forks** (one-shot, `$TASK_ROUTER_AGENT` empty) do NOT auto-load anything — they read only the matrix itself plus the docs PM explicitly cited in the dispatch payload's `Context docs:` field. This is the difference between a 40K-token fork and a 300K-token fork on the same task.

**Abstract standard.** Every doc in the matrix must carry an `## Abstract` block (TL;DR, Load-when keywords, Key facts, Owner, Related) placed immediately after the title. Forks skim abstracts at ~50 tokens each to decide which full docs to load.

**PM's responsibilities:**
- Read matrix Sections 1–3 at session start so you know who owns what (single-repo: Section 1 is the main docs table, Sections 2–3 are load rules and Abstract standard).
- Update the matrix in the same commit as any new doc, rename, or ownership change. Un-matrixed docs rot within weeks.
- Use the Quick-reference table (Section 4) to pick `Context docs:` for every dispatch.
- When a doc changes Primary owner (e.g., after a refactor moves functionality between agents), follow the ownership-transfer protocol — see `doc/design/DOC_OWNERSHIP_MATRIX.md` Ownership transfer section.

**ROADMAP split — one doc or two?**

Most projects have a single `doc/plans/ROADMAP.md` owned by `/pm` containing both the phase list and the live status. This is the default.

**Split into two docs** *only* when the detailed phase plan changes on a different cadence than the status:

- **Detailed phase plan** lives in a design doc (e.g., `architecture.md` Section 11, or a dedicated `DETAILED_ROADMAP.md`) owned by `/arch` or the most relevant design doc's owner. Stable — phases are rarely redefined.
- **Live status `ROADMAP.md`** owned by `/pm`. Updates after every phase gate. **Must explicitly cite the source doc** in its matrix row's Notes column (e.g., *"Phase overview + status badges. PM updates after each phase gate. Source: `DETAILED_ROADMAP.md`."*).

Discriminator: do the phases themselves change often, or just the status? If only status → single doc. If phase definitions have their own evolution (architect rewrites them quarterly, design-driven) → split.

**See:**
- `PM_TEMPLATES.md` → `## DOC_OWNERSHIP_MATRIX.md Template` — fill-in template (covers both shapes)
- `PM_TEMPLATES.md` → `## Worked Single-Repo Matrix Example` — filled-in exemplar from a real 9-agent solo learning project
- `doc/design/DOC_OWNERSHIP_MATRIX.md` — detailed design & implementation guide (problem, principles, token economics, adoption steps, ownership-transfer protocol, failure modes, trade-offs)
- `doc/seed/CONSUMER_FEEDBACK.md` — anonymized log of feedback from prior seeding rounds (useful if you hit a friction point; the maintainer may already have context on it)

### Multi-source integration — detect opposing signals

PM integrates input from multiple sources — feedback rounds on a doc, specialists proposing opposing conventions, design-doc drift between authors. Acting on each source in isolation produces **oscillation**: the artifact churns as each round reverses the previous one.

Before acting on any item that modifies an existing rule or convention, classify it against prior decisions on the same artifact:

- **Additive** — no prior decision addressed this. Act.
- **Reinforcing** — pushes further in the direction a prior decision already moved. Act.
- **Extending** — adds a new case to an opening a prior decision made. Act.
- **Oscillating** — reverses a committed prior decision. **Do not act silently.** Decline with a cross-reference, or propose an **integrating formulation** that widens the rule with an explicit conditional so both cases are covered. Record the reasoning.
- **Stale-draft reaction** — targets wording already changed in a prior decision the source did not see. Decline with a pointer to the current state.

The goal is integrating multiple legitimate signals into a coherent final state with the integration path visible — not honoring every incoming signal, not rejecting every delta.

**Where this applies in practice:**

- **Seed maintenance** — operational protocol in `doc/seed/CONSUMER_FEEDBACK.md → Check for oscillation before acting on an item`.
- **Roster / convention evolution** — when two specialists propose opposing patterns, PM classifies and integrates rather than flipping.
- **Design-doc drift** — when multi-author edits oscillate on a convention, PM detects the loop and proposes an integrating formulation in the next revision.

**Record the classification.** When it mattered, name it in the commit message, the feedback-log Outcome, or the doc history — so a future reviewer sees *why* an input was acted on or declined. The protocol compounds only if the reasoning is durable.

### Learning-First Delegation (solo learning projects)

Solo **learning-focused** projects have a rule that general-purpose software projects do not: the operator sometimes needs to do work **personally rather than delegate**, because delegating defeats the learning goal.

When this rule applies:

- The project plan identifies specific work as **non-delegable** — typically foundational exercises (e.g., "build micrograd from scratch," "implement attention from scratch," "hand-roll LoRA on a single linear layer"). These are not delegated to specialist agents even when the specialist is perfectly capable.
- A dedicated `/learn` (or equivalent) specialist enforces the boundary: its job includes flagging any dispatch that would have a specialist do work the operator is supposed to do as an exercise.
- In `dispatch_plan` and wave maps, non-delegable work is marked with *"(author, `/learn` reviews)"* in the agent column — the specialist advises and journals, but the operator writes the code.
- PM holds the line when the operator challenges the plan mid-session ("can't you just have the specialist do this?"). Challenging is an expected pattern; PM's job is to defer to the learning rule, not to capitulate.

**Bootstrap expectation — seed a `/learn` specialist when declaring the rule.** A Learning-First project *declared but not enforced* drifts within weeks: the operator challenges the rule under deadline pressure, no specialist is authored to push back, and the rule silently degrades to "delegation is discouraged." Projects that declare Learning-First in their synthesis **should bootstrap a dedicated `/learn` (or equivalently-named) specialist** whose SKILL.md holds:

- The project's non-delegable-work list (current exercises, expected future exercises, anything the operator wants to do personally as a matter of learning goal rather than capability).
- A dispatch-time audit rule: *"if a proposed dispatch's agent column matches `(author, /learn reviews)`, refuse and instead instruct the operator to author."*
- A journal section for experiment outcomes — what was tried, what was learned, what should change in the plan as a result.

Without this enforcing specialist, the Learning-First rule lives only as a line in the plan synthesis and has nothing grepping against live dispatch payloads. The seed's routing machinery requires a named specialist to operationalize any cross-cutting rule; Learning-First is not an exception.

**Convention matters.** The non-delegable marker in the agent column is exactly `(author, /learn reviews)` — do not invent variants (`author (user) reviewing with /learn`, `NON-DELEGABLE`, `manual`). PM's grep-based dispatch check relies on the exact string; variants silently defeat the check. BOOTSTRAP_PROMPT.md §8 carries a cross-reference to this section so plan-producing agents see the canonical form at the point they're drafting wave maps.

**When this rule does NOT apply:** standard software / product projects. The rule is opt-in per project — declared in the project plan's synthesis, not assumed. Projects without a Learning-First declaration should **not** seed a `/learn` specialist; it becomes dead overhead.

### Bootstrap plan — lifecycle and archive protocol

The bootstrap plan produced by `doc/seed/BOOTSTRAP_PROMPT.md` is a **t0 snapshot** of how the agent roster, matrix, and wave mapping were *initially* designed. Once live artifacts exist (`agents.json`, `.claude/SKILLS.md`, matrix, per-agent SKILL.md files), **the live artifacts take over** as source of truth for current state. The plan fossilizes.

**What lives in the plan after bootstrap:**

- Sections that never have a better home — usually **interface contracts between specialists** (Section 7 of the plan) and **roadmap → wave dispatch mapping** (Section 8). These remain live inside the plan; the matrix row marks them Primary `/pm`.
- **Exception for interface contracts:** if the project has a strong architecture doc, contracts may migrate there under the normal ownership-transfer protocol. If they migrate, the plan's §7 is marked `SUPERSEDED BY <doc>#contracts` and left in place.
- **Exception for wave mapping:** if the project grows a dedicated `WAVE_PLAN.md` or the design roadmap absorbs the mapping, §8 migrates the same way.

**What moves out of the plan after bootstrap:**

- Roster definitions (Section 3) → `agents.json` + `.claude/SKILLS.md` + per-agent SKILL.md files. Never update Section 3 after bootstrap — update the live artifacts and the matrix row for `agents.json` instead.
- Bootstrap checklist (Section 10) → fossilized. Either completed, or explicitly abandoned.
- Open gaps (Section 12) → once resolved, captured in `MEMORY.md` or the relevant design doc.

**When the plan header gets an archive marker:**

Once the bootstrap checklist is complete and live artifacts are in place, PM prepends the plan with:

```
> **ARCHIVED <YYYY-MM-DD>** — bootstrap is complete; live artifacts are
> `agents.json`, `.claude/SKILLS.md`, `.claude/skills/*/SKILL.md`, `doc/design/DOC_OWNERSHIP_MATRIX.md`.
> Refer to those for current state. Interface contracts (§7) and wave mapping (§8)
> remain live inside this file unless migrated per matrix notes.
```

**When the plan gets refreshed (not updated in place):**

If the roster changes by more than ~2 agents (rough heuristic — add or remove 3+ specialists, or replace a coordinator), PM proposes a **full refresh** to the user rather than editing the plan's Section 3. A refresh re-runs `doc/seed/BOOTSTRAP_PROMPT.md` with the new roster, produces a new dated plan file (`doc/BOOTSTRAP_PLAN_<YYYY-MM-DD>.md`), and marks the old plan `SUPERSEDED BY <new-plan>`. Matrix row updates in the same commit.

**Silent roster edits to Section 3 are forbidden.** They drift from `agents.json` within weeks and create two competing roster definitions. If the change is small (one agent renamed, one capability added), update `agents.json` / `SKILLS.md` / the relevant SKILL.md — not the plan.

### Project invariants (privacy, safety, compliance, latency)

Some projects carry **cross-specialist invariants** that every specialist must respect regardless of which piece of work they're doing — privacy perimeters (no raw user data to cloud), safety rules (no uninspected hardware commands), compliance requirements (audit trail on every state change), latency SLOs (response path must stay under N ms), data-lineage constraints (no column X without consent flag). These are **not specialist domain knowledge** — they are project-wide rules that cut across every specialist's work.

**Without a named invariant concept**, projects end up encoding invariants ad-hoc in one specialist's SKILL.md or `/review`'s checklist, and the other specialists re-derive (or fail to derive) the same rule independently. Drift follows.

**How to declare invariants:**

1. **Name them in the project plan's Section 1 synthesis** (BOOTSTRAP_PROMPT.md). One short bullet each: *"Privacy perimeter: no raw camera frames persisted beyond 30 seconds, no frames ever leave the device."* Keep them to a handful — if the project has 10 invariants, most of them are actually specialist domain knowledge dressed up as cross-cutting rules.
2. **Assign each invariant an owner.** Typically `/review` (audits every merge against the invariant checklist) or `/pm` (enforces at dispatch time). The owner carries the full rule text and the audit procedure.
3. **Every specialist SKILL.md acknowledges the invariant** — either in the never-touches / acceptance-criteria block or as a short "Project invariants" section pointing to the canonical owner. *"Must not log raw PII — see /review SKILL.md → Privacy perimeter for the full rule."* No restatement; reference only.
4. **`/review`'s audit checklist gains a dedicated section per invariant.** *"For every changed file: does it log or persist <PII-class>? If yes, does it respect the redaction rule in doc/PRIVACY.md?"* Invariant ownership is load-bearing for the audit pass, not a passing mention.

**Invariants vs canonical rule ownership.** Both name one owner and have other specialists reference rather than restate. The distinction is scope: a cross-cutting **rule** (version-bump protocol, commit-message convention) governs *how specialists work*; an **invariant** governs *what the product may or may not do*. Rules go under `/scm` or `/pm`; invariants go under `/review` or `/pm`. Both patterns stack — a project can have both a canonical version-bump rule and a privacy-perimeter invariant.

**When NOT to promote to an invariant.** If the rule only applies to one specialist's work (e.g., "GUI animations must stay under 16ms/frame" — only `/gui` cares), it is specialist domain knowledge, not an invariant. Invariants are specifically the ones that every specialist has to consult, whether they're writing code, designing a feature, or reviewing a change.

### Telegram Bridge (optional)

A Telegram bot provides remote PM access from your phone. It registers as agent `"telegram"` via REST API — it's a bridge, not a Claude agent (zero LLM tokens). The extension auto-starts it if `.env` is configured.

PM treats telegram-originated tasks as direct user prompts and mirrors locally-originated responses back. The server's `autoForwardToTelegram` handles delivery for task lifecycle events at zero token cost — PM does NOT dispatch results back to telegram for telegram-originated tasks.

See `doc/design/TELEGRAM_BRIDGE.md` for architecture and `doc/runbooks/TELEGRAM_SETUP.md` for setup.

---

## MCP Task Router Setup

The MCP task router is **optional** — it enables Mode 4 (automated multi-terminal).
Projects can work fine with Modes 1-3 only.

> ### CRITICAL: 1M Context vs 200K Context
>
> Passing `--model claude-opus-4-6` explicitly limits the session to **200K context**.
> The **1M context** window requires the Claude Code default — **no `--model` flag at all**.
>
> This means PM, Architect, and Review agents must NOT have a `model` field in
> `agents.json` and the `coordinator` role must NOT appear in `taskRouter.modelByRole`.
> Violating this silently drops these agents from 1M to 200K context with no error message.

### What It Is

A Node.js MCP server that acts as a message broker between Claude Code terminals.
Instead of the user manually switching terminals and saying "read your task" / "read result",
the server routes tasks and results automatically via MCP tools.

### Quick Setup

See **`doc/runbooks/USER_MANUAL.md`** for the full step-by-step guide. Summary (v0.4.1+, extension-managed default):

1. Install the VS Code extension (`.vsix`) — ships server + telegram-bridge bundled inside
2. Create `.mcp.json` at repo root with `?project=<name>` (e.g., `http://127.0.0.1:3100/mcp?project=my-app`) — `init.sh` does this
3. Create `agents.json` mapping agent names to capabilities and models (see schema below)
4. Add `UserPromptSubmit` hook to `.claude/settings.local.json` (task polling on each prompt)
5. Add Startup Sequence to each skill's SKILL.md (checks `$TASK_ROUTER_AGENT`, registers if set)
6. Reload the IDE — extension auto-spawns the bundled server + bridge
7. Verify: `/mcp` shows Connected, `/pm ping` shows agents responding, `Task Router: Doctor` reports "versions match ✓"

CLI-only consumers (no extension) instead copy `mcp-task-router/` into `.claude/mcp/task-router/` and run `npm install` — `init.sh --with-server-source <name>` handles this path.

The extension **auto-starts** the task-router server and telegram bridge on activation
(`taskRouter.autoStart` setting, default: `true`). The `SessionStart` hook in `start.sh`
is a fallback for CLI-only usage without the extension. All scripts, hooks configuration,
and the OAuth provider are included in the `mcp-task-router/` package.
See `doc/runbooks/USER_MANUAL.md` for the full walkthrough. See `doc/runbooks/TROUBLESHOOTING.md` for known issues.

### MCP Tools (20)

| Category | Tools |
|----------|-------|
| Registration | `ping`, `register_agent`, `unregister_agent`, `list_agents` |
| Task Dispatch | `dispatch_task`, `check_inbox`, `accept_task`, `submit_result`, `cancel_task`, `purge_tasks`, `pickup_next_task` (v0.8.0), `complete_task` (v0.8.0), `collect_results` (v0.8.0) |
| Result Delivery | `check_results`, `get_pending_results`, `acknowledge_results` |
| Agent Memory | `save_memory`, `load_memory`, `list_memories`, `delete_memory` |
| Projects | `list_projects`, `switch_project`, `update_project` |

Most tools accept `project` param. The MCP session is bound to a project via the URL (`?project=<name>`) on connection; tool calls inherit that scope. The `project` param is **required** on `register_agent`. v0.7.0+: `accept_task` / `submit_result` / `cancel_task` also require an explicit `agent` parameter (no session-bound agent identity — registration is mechanical, performed by the launcher before the model loads).
Full API reference: `doc/reference/SERVER_API.md`

### REST API (for lightweight clients)

The server also exposes mutation endpoints at `/api/*` for clients that don't need full MCP (e.g., the Telegram bridge bot):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/register` | POST | Register an agent |
| `/api/unregister` | POST | Unregister an agent |
| `/api/dispatch` | POST | Dispatch a task |
| `/api/inbox/:agent` | GET | Check inbox + undelivered results |
| `/api/accept/:taskId` | POST | Accept a pending task |
| `/api/complete/:taskId` | POST | Submit result |
| `/api/deliver` | POST | Mark results as delivered |

### agents.json Schema

Create `agents.json` in `.claude/mcp/task-router/` to define your agent roster:

| Field | Required | Type | Values | Notes |
|-------|----------|------|--------|-------|
| `capabilities` | Yes | string[] | Domain keywords | Used by PM for routing decisions |
| `role` | Yes | string | `coordinator` or `specialist` | Informational; also drives the optional `modelByRole` fallback |
| `model` | No | string | Model ID (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5`) | Explicit per-agent model. **Never set for coordinator role** (see 1M context warning above). Recommended for specialists — set it here rather than relying on IDE-level settings. |

**Example:**
```json
{
  "pm":     { "capabilities": ["planning", "delegation"], "role": "coordinator" },
  "arch":   { "capabilities": ["architecture", "api-design"], "role": "coordinator" },
  "review": { "capabilities": ["code-review", "auditing"],  "role": "coordinator" },
  "scm":    { "capabilities": ["git", "commits", "branches"], "role": "specialist", "model": "claude-haiku-4-5" },
  "backend":{ "capabilities": ["api", "database"],          "role": "specialist", "model": "claude-sonnet-4-6" },
  "devops": { "capabilities": ["docker", "ci-cd", "scripts"], "role": "specialist", "model": "claude-sonnet-4-6" }
}
```

> **1M context reminder:** `pm`, `arch`, and `review` have no `model` field. This is intentional — they get the 1M Opus context window (Claude Code default). Adding `"model": "claude-opus-4-6"` would silently drop them to 200K.

> **Specialists get an explicit `model` field.** Set it directly in `agents.json` — it's project-local, git-tracked, and unambiguous. The IDE-level `taskRouter.modelByRole` setting still works as a fallback for agents that omit `model`, but seed docs recommend the explicit form so every roster makes its model choices visible.

> **Reserved agent names — do NOT use.** The extension launches each specialist terminal with `claude ... --agent <name>_agent "<name>"`, passing the agent name as the initial prompt to trigger the matching `/<name>` skill. Claude Code's CLI intercepts bare positional args that match (or fuzzy-match) one of its subcommands and treats them as a failed subcommand attempt, exiting before the skill ever loads. The terminal then dies and the watchdog may inject re-register prompts into the raw shell — a recovery cascade that costs a window reload and some noise in PowerShell history. Avoid naming any agent the same as — or one edit-distance away from — a Claude Code subcommand. **Reserved list (as of Claude Code 2.x):** `agent`, `agents`, `auth`, `auto-mode`, `doctor`, `install`, `mcp`, `plugin`, `plugins`, `setup-token`, `update`, `upgrade`. Note that `agent` itself is a near-match for the `agents` subcommand and therefore forbidden despite not being a subcommand proper. If your domain naturally suggests one of these (e.g., a voice-assistant skill you'd call `agent`), pick a synonym: `assistant`, `voice`, `chat`, `bot`, `wakeword`, etc. This is a seed-level convention — no CLI-side enforcement. Verify your roster's names against the reserved list at bootstrap and whenever adding a new agent.

### Model Configuration

Each agent can run on a different Claude model to optimize cost and quality. The principle: **use the strongest model for decision-making, cheapest for mechanical work.**

**Recommended model tiers:**
- **Default (1M Opus 4.6)** — coordinators and critical thinkers (PM, Architect, Review). Omit `model` field entirely.
- **Sonnet** — domain specialists (backend, frontend, devops, etc.). Competent execution of well-defined tasks.
- **Haiku** — mechanical agents (SCM). Git operations, formatting, simple scripting.

**Configuration — explicit per-agent `model` is the primary path:**

Set `model` directly on each specialist entry in `agents.json`. It's project-local, git-tracked, and reviewable — every roster makes its model choices visible.

```json
{
  "backend": { "capabilities": [...], "role": "specialist", "model": "claude-sonnet-4-6" },
  "scm":     { "capabilities": [...], "role": "specialist", "model": "claude-haiku-4-5" }
}
```

**Optional fallback:** the extension setting `taskRouter.modelByRole` (IDE-level, per-user) fills in a model for any agent that omits `model`. Useful if you want to tier every specialist with one setting change, but the explicit form in `agents.json` is preferred for shipped rosters.

Resolution order: `agents.json[agent].model` → `taskRouter.modelByRole[role]` → Claude Code default (1M Opus). **Never** add `"coordinator"` to `modelByRole` — coordinator agents need the 1M default.

### Model field — decision tree for `agents.json`

The 1M-Opus warning is loud for coordinators, but the converse ("when *should* a specialist override?") is quieter. Use this tree when defining a new agent:

1. **Is this agent a coordinator (pm / arch / review)?**
   **YES** → `role: "coordinator"` and **no `model` field, ever**. Any explicit `model` — even `"claude-opus-4-6"` — silently drops the session from the 1M default to 200K. Coordinators need 1M for long plans, matrix reads, and reconciliation sweeps.
   **NO** → continue.

2. **Is the agent's work decision-heavy reasoning that benefits from a stronger model than Sonnet?**
   Examples: fine-tuning, complex algorithm design, formal verification, cross-cutting refactors the default specialist tier can't hold.
   **YES** → set `role: "specialist"` and `model: "claude-opus-4-6"` (accepting the 200K window) or `model: "claude-opus-4-7"`. Document *why* in a comment in `agents.json` and in the skill file — per-agent Opus is expensive and needs justification.
   **NO** → continue.

3. **Is the agent's work mechanical / low-reasoning (git plumbing, file shuffling, simple templating)?**
   **YES** → set `role: "specialist"` and `model: "claude-haiku-4-5"`. `/scm` is the canonical case.
   **NO** → continue.

4. **Default path (most specialists).**
   `role: "specialist"` and `model: "claude-sonnet-4-6"` — the explicit Sonnet default. This is the correct answer for ~80% of specialists: domain experts doing competent execution, not decision-heavy reasoning and not mechanical work.

**Rule of thumb:** set `model` explicitly on every specialist so the roster documents its own tiering. Only reach for Opus (step 2) when the workload genuinely demands it, and only reach for Haiku (step 3) when the work is truly mechanical.

### Key Design Notes

- **Transport:** Streamable HTTP (`"type": "http"` in `.mcp.json`)
- **Address:** `127.0.0.1` not `localhost` (Windows IPv6 issue)
- **Storage:** sql.js (pure JS SQLite, no native compilation)
- **Agent-to-agent:** Any agent can dispatch to any other — not restricted to PM
- **Wave dispatch:** PM structures complex plans into ordered waves with dependency gates. Full protocol: `doc/design/WAVE_DISPATCH.md`

---

## Startup Sequence

Every agent has a **Startup Sequence** that runs before anything else — not as a section the agent can skip, but as the very first action. It detects whether the agent is in a dedicated terminal (`$TASK_ROUTER_AGENT` is set) or a subagent fork (`$TASK_ROUTER_AGENT` is empty).

- **Dedicated terminal:** Register with the task router, load context, check inbox
- **Subagent fork:** Skip registration, proceed directly with the task

The canonical templates are in `PM_TEMPLATES.md`:
- **PM Startup** — in the PM Skill Template (includes memory recovery and reconciliation)
- **Specialist Startup** — in the Agent Evolution section of the PM Skill Template

**Why "MUST execute first":** Earlier designs placed registration in a mid-document section that agents would sometimes skip, leading to unregistered agents that couldn't receive tasks.

---

## Template Reference

All copy-paste templates are in **`PM_TEMPLATES.md`**. Summary:

| Template | Save As | Description |
|----------|---------|-------------|
| CLAUDE.md Template | `CLAUDE.md` (repo root) | Master project rules, execution modes, routing |
| PM Skill Template | `.claude/skills/pm/SKILL.md` | Full PM agent: routing, delegation, reconciliation, evolution |
| SCM Skill Template | `.claude/skills/scm/SKILL.md` | Git operations, commits, branches, PRs |
| Architect Skill Template | `.claude/skills/arch/SKILL.md` | Phase design, architecture, component boundaries |
| Architecture Review Skill Template | `.claude/skills/review/SKILL.md` | Adversarial audit of architect proposals |
| Task File Protocol | `.claude/tasks/README.md` | File format for Mode 3 task/result exchange |
| Project Rule | `.claude/rules/project.md` | Global project rule: planning-only default, phase isolation |
| SKILLS.md Template | `.claude/SKILLS.md` | Agent roster and usage guide (agent-system metadata) |
| Rules INDEX Template | `.claude/rules/INDEX.md` | Rule index — counterpart to `.claude/SKILLS.md` |
| DOC_OWNERSHIP_MATRIX.md Template | `doc/design/DOC_OWNERSHIP_MATRIX.md` | Document governance matrix (PM owns) |
| CLAUDE.md Agent Routing Section | Append to `CLAUDE.md` | Agent invocation table and routing rules |

---

## Referenced Operational Docs

These docs are shipped by `init.sh` under `.claude/mcp/task-router/doc/` and referenced throughout this seed. One-paragraph summary each so you know what to load before consulting.

- **`GETTING_STARTED.md`** — Step-by-step first-run setup: install Node dependencies, start the task router (`node bin/cli.js --port 3100`), configure `.mcp.json`, install the VS Code / Cursor extension, launch PM terminal. Covers the optional `TASK_ROUTER_API_KEY` gate for `/api/*` bridge routes. Read this when a consumer is booting the server for the first time or when connectivity between Claude Code and the task router is broken.
- **`WAVE_DISPATCH.md`** — Crash-resilient multi-wave dispatch protocol. PM structures complex plans into ordered waves, each with explicit dependencies; the router persists wave state so a crashed PM terminal can resume without losing progress. **Key convention: waves are gated on user approval by default** — PM pauses between waves for the user to say "continue" rather than auto-advancing. This is load-bearing for the Learning-First Delegation rule (exercise gates live at wave boundaries) and for long-running plans where the operator wants to inspect intermediate results before committing to the next wave. Read this when designing Section 8 (roadmap → wave mapping) of a bootstrap plan.
- **`TROUBLESHOOTING.md`** — Common failure modes and fixes, ordered by observed frequency. Covers: agent not appearing in dashboard (TTL expiry, wrong project binding); dispatch reaching the router but not the specialist terminal (watchdog polling gap, registration stale); `accept_task` rejected with `'agent' parameter is required` (v0.7.0+ — old SKILL.md missing the agent param; needs the v0.7.0 migration erratum or a manual sed patch); `accept_task` rejected with `task is assigned to "X", not "<agent>"` (mismatched agent param); stuck `accepted` tasks (reconciliation protocol — see ARCHITECTURE for the state machine); Telegram bridge silent (missing `TASK_ROUTER_API_KEY` on either side). Read this when a specialist stops picking up work or the dashboard reports inconsistent agent state.
- **`SERVER_API.md`** — Exhaustive reference for all 20 MCP tools plus the HTTP surface (health, stats, metrics, tasks, export, purge, hook/check, projects, agents, `/api/*` bridge routes). Includes: tool schemas, error cases, the `to_agent` / `from_agent` filters on `/tasks` and `/export`, the v0.7.0+ explicit-agent-parameter contract (`accept_task` / `submit_result` / `cancel_task` require an explicit `agent` arg; `register_agent` is a thin DB-row wrapper with no session-binding side effect), the `TASK_ROUTER_API_KEY` transport order (header preferred, query string last resort), and the `/api/*` impersonation caveat (key holder can act as any agent — keep high-trust work on MCP). Read this when debugging an unexpected tool response, designing a new bridge integration, or auditing the trust boundary.

---

## First Steps After Bootstrap

1. `/pm`, `/scm`, `/arch`, `/review` are pre-created during bootstrap — every project needs these
2. Run `/pm` and describe your project in 2-3 sentences
3. The PM scans available files and proposes domain-specific agents
4. Approve the agents you want - PM creates both skill and rule files
5. Start working - Cursor rules auto-attach, CLI skills ready to invoke
6. As the project grows, PM detects gaps and proposes new agents
7. **Optional:** Set up MCP task router for Mode 4 when you have 3+ specialist terminals

---

## Example: Bootstrapping a Web App

    You: /pm This is a Next.js e-commerce app with Postgres, Stripe,
         and Vercel deployment.

    PM: Based on your stack, I propose these initial agents:
    1. /frontend - Next.js pages, components, hooks, styles
    2. /backend - API routes, Prisma models, Stripe integration
    3. /devops - Vercel config, Docker, CI/CD, env vars
    Should I create these agents?

---

## Example: PM Detects a Gap Mid-Project

    PM: I notice the last 3 tasks involved test files (*.test.ts)
    and you had to explain Jest config twice. No current agent owns testing.

    ## New Agent Proposal
    **Name:** test
    **Trigger:** Recurring cross-cutting concern (condition #3)
    **Domain:** Testing - Jest, Playwright, fixtures, coverage
    ### Justification
    Testing spans frontend and backend but requires specialized knowledge
    that neither /frontend nor /backend currently carry.
    Should I create this agent?

---

## Example: Mode 4 MCP — Parallel Dispatch with Result Triage

    Extension: "Task Router: Launch All Agents" (or click each in sidebar)
    Terminal 1 (PM):     pm        → interactive (triages results)
    Terminal 2:          frontend  → worker (auto-executes tasks)
    Terminal 3:          backend   → worker
    Terminal 4:          devops    → worker

    Terminal 1 (PM):
      User: "/pm fix login CSS, add rate limiting, and update CI"
      PM:    list_agents → frontend=idle, backend=idle, devops=idle
      PM:    dispatch_task(to="frontend", payload="Fix login CSS")
             dispatch_task(to="backend",  payload="Add rate limiting to /api/checkout")
             dispatch_task(to="devops",   payload="Update CI pipeline")
      PM:    "Dispatched 3 tasks. I'll notify you as results come in."

      (later, user types anything)
      Hook: 2 completed results
      PM:   [PM] 2 agents completed:
            1. /frontend — "Login CSS fixed"
            2. /devops — "CI pipeline updated"
            Which to review? (a/b/c/d)
      User: "c" → PM presents both results

      (later, user types anything)
      Hook: 1 completed result
      PM:   [PM] /backend completed: "Rate limiting added to /api/checkout"
