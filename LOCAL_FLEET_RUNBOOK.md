# LOCAL_FLEET_RUNBOOK — standing up & operating a local-model fleet

## Abstract

**TL;DR:** The operator's end-to-end guide to running a **fleet of local models** — a **coordinator** (a local
PM) that plans and dispatches to **specialists** (a designer, coder specialists, a reviewer), all as
model-agnostic clients of the unchanged Task Router server. Covers how to define the roster, the role of each
agent, the **multi-file / multi-discipline** decomposition pattern, **model tuning** (output budgets, reasoning
/ "thinking" mode, temperature, timeouts), and the **gotchas** that turn a working fleet into a silently-broken
one. It is the fleet-level companion to **`PM_LOCAL_BACKENDS.md`** (which is the per-agent "define & operate one
local agent" rulebook — read it for the `agents.json` block, the env-var table, the C-1 payload contract, and
`pi`-vs-`opencode`). This doc composes those agents into a fleet.

**Load when:** stand up a local fleet, define a local coordinator/PM, add local specialists, multi-file local
build, capability descriptions, skill injection, `reasoning_effort`/thinking mode, tune `max_tokens`, local
fleet gotchas, `TASK_ROUTER_PM_*`, `TASK_ROUTER_REVIEW_*`.

**Provenance:** capability numbers trace to our own execution-graded benchmark (see `PM_LOCAL_BACKENDS.md`
Provenance); the fleet-behaviour notes are from piloting complete multi-file builds end-to-end on a dense 31B
(`gemma`-class) via LM Studio. Where a claim is a prediction, it says so.

**Key rule:** a local fleet **drafts and self-reviews**; it does not merge. Every local `[FILE RESULT]` is an
**UNAPPLIED** diff, and a same-tier local reviewer is **defense-in-depth, not an oracle** — a frontier `/review`
+ human sign-off remains the real gate before anything irreversible.

---

## 1. The mental model — coordinator + specialists

A local fleet mirrors the frontier Task Router fleet: one **coordinator** talks to the human and dispatches
short, reviewed legs to **field-expert specialists**. Every agent is a resident process that self-registers and
polls the server (the server is unchanged — a local runner is just a third client kind; see
`PM_LOCAL_BACKENDS.md` Step 2).

| Role | Runner | Kind | Job |
|---|---|---|---|
| **coordinator** (`pm`) | `pm-runner.js` | direct model call | plan · decompose by discipline · dispatch ONE step at a time · review every producer · report. *(A local PM when `agents.json` gives `pm` a `local_pm` block — no flag; else a frontier Claude PM.)* |
| **designer** (`arch`) | `local-runner.js` | C-1 **text** (`NO_SCHEMA`) | write the **design + interface contract** the implementers share — NEVER code. |
| **coder specialist(s)** | `harness-runner.js` | C-2 (`pi`/`opencode`) | implement a **scoped, disjoint file set** in a git worktree; return an UNAPPLIED `[FILE RESULT]` diff. |
| **reviewer** (`review` / `/review`) | `review-runner.js` | direct model call | an **in-context review + a clean-room review** of each producer's artifact; one conservative verdict. |
| **integrator** (`scm`) | `scm-runner.js` | direct git (**no model**) | compose the reviewed disjoint diffs → validate the union (opt-in) → **branch + commit; NEVER merge/push**. A terminal, host-synthesized step. **EXPERIMENTAL, opt-in.** |

**The honesty ledger (never regress it):** local drafts are unapplied; the harness never auto-applies; the
local reviewer is same-tier (a PASS = "no defect found by a fresh local reader", not proof). Keep the frontier
`/review` as the gate.

**The one lesson that dominates everything below:** *the fleet's output quality is bounded by the **design**.*
A gap in `arch`'s contract propagates verbatim into every implementer. The highest-leverage lever is a
**precise `arch` contract + a working review gate**, NOT a stronger coder.

---

## 2. Prerequisites

1. **An inference host** — an OpenAI-compatible server (e.g. LM Studio) reachable over the LAN. It may be a
   *different* machine than the agents; the agent hosts need only network reach (+ the coding CLI for C-2).
2. **⚠ Every endpoint MUST include the `/v1` path** — `http://<host>:<port>/v1`. Without it the harness proxy
   404s and the task silently completes as `[TEXT-ONLY] — harness made no file changes`. Applies to
   `TASK_ROUTER_{PM,BACKEND,HARNESS,REVIEW}_ENDPOINT`. (See `PM_LOCAL_BACKENDS.md` Step 4 and Gotchas below.)
3. **The right model, verified.** For C-2 coding use a **dense ~31B** (a low-active-parameter MoE — a `…-a3b`
   id — is the fail class); run one execution-graded pilot before real work (`PM_LOCAL_BACKENDS.md` Step 1).
4. **The coding CLI** (`pi` recommended, or `opencode`) installed on each C-2 agent's host.
5. **Keep the model host awake + serving.** A sleeping LM Studio box drops mid-request; a busy leg needs the
   full context window loaded.

---

## 3. Define the roster (`agents.json`)

Each agent is one `agents.json` block; see **`PM_LOCAL_BACKENDS.md` Step 4** for the exact block shape and the
full env-var table. A minimal multi-specialist roster:

```jsonc
{
  "pm":       { "role": "coordinator", "backend": { /* direct-call; see §4 */ } },
  "arch":     { "role": "specialist", "capabilities": ["design"],
                "backend": { "kind": "openai-compatible", "endpoint": "http://192.168.1.50:1234/v1",
                             "model": "gemma-4-31b", "api_key_env": "LM_STUDIO_API_KEY" },
                "description": "Lead designer: writes the shared WRITTEN DESIGN + interface contract (file layout, module signatures, API shapes, per-file acceptance criteria) the implementers build against. NEVER writes code." },
  "backend":  { "role": "specialist", "capabilities": ["code"],
                "harness": { "kind": "pi", "endpoint": "http://192.168.1.50:1234/v1", "model": "gemma-4-31b",
                             "api_key_env": "LM_STUDIO_API_KEY", "timeout_ms": 900000, "skills_dir": ".claude/skills" },
                "description": "Backend/server specialist: HTTP server, routing, business logic, persistence (server.js, lib/*). Does NOT write the browser UI (public/*) or test files." },
  "frontend": { "role": "specialist", "capabilities": ["code"], "harness": { /* … */ },
                "description": "Frontend/UI specialist: HTML, CSS, DOM/fetch JS (public/*). Does NOT write server code, business logic, or tests." },
  "test":     { "role": "specialist", "capabilities": ["code"], "harness": { /* … */ },
                "description": "Test specialist: automated test files (test/*). Writes ONLY tests; not the server, logic, or UI." },
  "scm":      { "role": "specialist", "capabilities": ["scm", "integrate"], "metadata": { "integrator": true },
                "runner": "scm-runner.js",
                "description": "SCM integrator: composes the reviewed diffs into an isolated branch + commit (never merges/pushes). Makes no model calls — no backend/harness block; set TASK_ROUTER_SCM_PROJECT_DIR to the git repo." }
}
```

**The integrator (`scm`) needs NO model** — it is deterministic host git, so its `agents.json` block has neither
a `backend` nor a `harness` (unlike every other role). It needs the git repo to commit into
(`TASK_ROUTER_SCM_PROJECT_DIR`, defaults to `TASK_ROUTER_HARNESS_PROJECT_DIR`) and must be **co-located with that
repo**. The coordinator adds the scm step itself (§5.4) — you do NOT plan it.

Standing up specialist roles is **per-project config — no `seed_version` bump, no runner change** (same as
`arch`). The two levers that make one specialist differ from another:

### 3.1 Capability descriptions — the routing lever (the single most important field)

The coordinator routes by each agent's `description` (registered as `metadata.description`). Adjacent code
roles (backend / frontend / data / test) are exactly where a bare name mis-routes. **Write each description to
say what the role OWNS and — critically — what it does NOT own.** A rich, disjoint description set is what lets
a weak coordinator pick the right specialist.

### 3.2 Skill injection — the per-task expertise (`skill-injector.js`)

A specialist's domain rules come from a `local_SKILL.md` injected at dispatch. **⚠ Note the filename: it is
`local_SKILL.md`, NOT `SKILL.md`.** `SKILL.md` is the *frontier* Claude-agent skill (init.sh writes it; Claude
Code loads it as a full operating manual with Startup Sequence + Memory Policy). A **local** injected skill is a
different, smaller artifact — so it has a different name, so (a) Claude Code's skill discovery ignores it and
(b) the injector never accidentally injects a truncated frontier skill into a local task.

- Put `.claude/skills/<name>/local_SKILL.md` in the project (YAML frontmatter `name` + a **≤4 KB** body). Set
  `skills_dir` on the agent's block (launcher auto-defaults it to `.claude/skills` if present). `skill-injector.js`
  reads **`local_SKILL.md` only** — it never reads `SKILL.md`.
- **Turn injection ON.** It is gated by `TASK_ROUTER_{HARNESS,BACKEND}_SKILL_MODE`, which defaults to **`off`
  in the raw runner** — with `off`, a `skills_dir` + a payload tag inject **nothing**. Set it to **`scripted`**
  (explicit-tag; the safe default) for a C-0 fleet. (The launcher sets it for you when a skills dir exists.)
- Injection is **explicit-tag, per-task** — the *dispatcher* prefixes the task payload with a leading
  `skill: <name>` line; the harness strips it and prepends the body (stdin, never argv). It does **not**
  auto-attach just because the task went to that agent. (The experimental coordinator emits the tag; under C-0
  you tag the payload yourself.)
- Front-load the rules for a weak, non-browsing model: name the exact conventions, and end with
  "create ONLY your files; import other modules at the EXACT paths/names the shared contract gives."

---

## 4. The coordinator (local PM)

**Which PM you get is DEFINED BY `agents.json`, not a flag:** give the `pm` agent a `local_pm` block and it is a
local PM (this runner); leave it out and it is a frontier (Claude) PM. There is no separate enable/pilot switch —
your `agents.json` entry is the choice. (A Claude PM is still the stronger coordinator; pick a local PM when you
want a fully-local fleet and can supply a capable model.)

The local PM (`pm-runner.js`) is an **event-driven** coordinator: it ACKs the operator instantly, proposes the
full decomposition ONCE, then the host executes it **one short leg at a time** (dispatch → assess the result →
dispatch the next), reviewing every producer. One pending dispatch at a time keeps its heartbeat alive so a
minutes-long local leg is not swept off the roster. The host bounds a weak model's limited judgment — the
routing + structural **design gate** plus **mandatory clean-room review** on every producer — so a bad plan
can't ship silently.

Key env (all set by the launcher from the `local_pm` block; in addition to `TASK_ROUTER_PM_ENDPOINT`/`_MODEL`):

| Env | Default | Purpose |
|---|---|---|
| `TASK_ROUTER_PM_MAXTOK` | 16000 | planning output budget (raised from 4000; §7.1). A thinking model *also* needs reasoning off (§7.2). |
| `TASK_ROUTER_PM_REASONING_EFFORT` | unset | set to `none` to disable "thinking" on the planning call (§7 — often required) |
| `TASK_ROUTER_PM_MAX_REDESIGN` | 1 | revise-on-FAIL cycles before a goal fails (raise for more revision attempts) |
| `TASK_ROUTER_PM_ARTIFACTS` | off | `1` = maintain a live doc tree (design docs + ROADMAP/NEXT_STEPS/matrix) |
| `TASK_ROUTER_PM_SKILLS_DIR` | `./.claude/skills` if present | dir holding the PM's own `pm/local_SKILL.md` rulebook (see below); absent/empty → the built-in default |
| `TASK_ROUTER_PM_TIMEOUT_MS` | 300000 | per model-call request timeout |

**The design gate is automatic.** The PM reviews EVERY producer: a depended-on producer (a design) gates its
dependents; a terminal producer (code) is the final gate. On a review FAIL it re-dispatches the same step with
the reviewer's reason appended (accumulating, bounded by `MAX_REDESIGN`) — so `arch` revises with feedback.
You do NOT plan review tasks; correct `depends_on` wiring is what applies the gate.

**Run the coordinator with reasoning OFF.** Its planning prompt is the most complex call in the fleet; a
thinking model reasons past the request timeout on it. Set `TASK_ROUTER_PM_REASONING_EFFORT=none` (§7).

**The PM's planning rulebook is externalizable (`pm/local_SKILL.md`).** The local PM is the local-fleet parallel
to the frontier `pm/SKILL.md`: its planning prompt ships as the built-in `DEFAULT_PM_RULEBOOK` and is
**operator-overridable** via `.claude/skills/pm/local_SKILL.md` (same `local_SKILL.md` convention as a specialist
skill, §3.2 — YAML frontmatter `name: pm` + a Markdown body). The host loads it and substitutes the token
`{{ROSTER}}` with the LIVE roster (roster ids are runtime data the host always owns — if your body omits the
token the host appends a canonical roster block anyway). An **absent or empty** file falls back to the built-in
default, so default behaviour is unchanged. **Editing this skill cannot weaken safety:** every plan is still
host-gated by `validateRouting` (roster ids / no-dup / DAG) *and* the structural **design gate**
(`validateDesignGate` — multi-implementer work must route through a design step its coders `depends_on`), so a
weakened rulebook can at worst degrade plan *quality* (which the propose→revise loop recovers), never bypass the
design-first or routing guarantees. To start from the canonical text, copy `DEFAULT_PM_RULEBOOK` out of
`pm-runner.js` into the skill body and edit from there.

---

## 5. The specialists in detail

### 5.1 `arch` — the DESIGNER (this is where quality is won or lost)

`arch` is a **C-1 text backend** (`TASK_ROUTER_BACKEND_NO_SCHEMA=1`), **not** a code harness — because (a) a
code harness "designs" by writing truncatable code, and (b) only a **text** result is threaded verbatim into
the implementers' tasks. Give it a generous budget (`TASK_ROUTER_BACKEND_MAX_TOKENS=8000..16000`) and a system
prompt that demands a **precise interface contract**, since separate specialists implement against it in
parallel without seeing each other's code:

> *"…produce a WRITTEN DESIGN that pins an exact interface contract: every file path; for each module its exact
> exported names + function signatures AND the exact `require()`/import path other files use; the exact API
> request/response shapes; a numbered build order; per-file acceptance criteria. Name real functions/paths
> (e.g. `lib/shortener.js` exports `shorten(url)->code`; `server.js` does `require('./lib/shortener')`). Do NOT
> write code."*

Measured: a vague contract → each specialist invents its own module layout → the pieces don't wire together. A
precise contract → they line up. **This is the single highest-leverage tuning in the whole fleet.**

### 5.2 Coder specialists (C-2 harness)

One per discipline (`backend`, `frontend`, `test`, …). Each is a standard C-2 harness agent
(`PM_LOCAL_BACKENDS.md`) plus a scoped `description` (§3.1) and a `local_SKILL.md` (§3.2). They run in isolated git
worktrees and return UNAPPLIED diffs — see §6 for how that constrains multi-file work.

### 5.3 `review` — the clean-room reviewer

`review-runner.js` runs **an IN-CONTEXT review + a CLEAN-ROOM review** of each artifact (mirroring the frontier
`/review` + `peer-reviewer` split): the in-context pass sees the acceptance criteria + the shared design
contract (correctness + criteria + exact contract adherence); the clean-room pass sees ONLY the artifact (a
fresh reader's independent second opinion). It combines conservatively — a grounded FAIL from EITHER blocks, and
an errored/empty/no-verdict pass is a **hard blocking FAIL** (it cannot approve). Reliability hardening you
should keep enabled:

- **Evidence grounding** — a FAIL must quote real line(s) from the artifact (multi-fragment allowed for a
  cross-line bug); an unquotable, uncorroborated FAIL is DROPPED (surfaced, non-blocking).
  `TASK_ROUTER_REVIEW_REQUIRE_EVIDENCE=0` disables.
- **Cross-pass corroboration** — the two passes (in-context + clean-room) agreeing on the same unquotable
  defect block anyway; because they are DIFFERENT lenses, identical phrasing corroborates too (unlike N
  identical clean-room passes, where byte-identical findings were a systematic error). `TASK_ROUTER_REVIEW_CORROBORATE`
  (floor, default 2).
- **Budget** — `TASK_ROUTER_REVIEW_MAXTOK` (raise for a thinking model, §7; a truncated verdict reads as a
  false `FAIL, "no reason parsed"`).

A same-tier reviewer catches real bugs AND hallucinates; grounding + corroboration is the mitigation, not a
promotion to oracle.

### 5.4 `scm` — the INTEGRATOR + committer (`scm-runner.js`) — **EXPERIMENTAL, opt-in**

The compose-and-commit tail of §6 (union the reviewed diffs, validate, commit) was a manual operator step. The
`scm` specialist automates it. It is a **direct git runner that makes NO model calls** — the
compose→apply→commit path is pure host code, so a weak model can't corrupt it.

**What it does.** The coordinator **host-synthesizes** ONE terminal scm step (you never plan it, exactly like
review) whenever a live integrator agent is in the roster. That step `depends_on` **every** prior step, so it
runs only after they all resolve and a review FAIL on any producer transitively **skips** it. At dispatch the
coordinator threads the **file-producing** legs' REAL diffs (filtered to `[FILE RESULT]` legs — a design /
`[TEXT-ONLY]` / `[NO-CAPTURE]` leg is excluded so prose never reaches `git apply`) into scm's payload. scm then,
on a **fresh detached worktree** of the repo's HEAD: `git apply`s each disjoint diff, creates a **fresh branch**
`tr/local-fleet/<slug>-<stamp>`, and **commits** with the mandated footer — optionally building/testing the
composed tree first.

**The honesty ledger holds because the boundary is STRUCTURAL, not prompted.** scm **commits to a fresh,
isolated branch off HEAD — it never merges, never pushes, never moves a shared ref**; a commit is a reversible
materialization of the same unapplied draft, and a frontier `/review` + a human merge remain the real gate. The
guardrails are enforced in code, not by instruction:
- a **git-subcommand allowlist** makes `push`/`merge`/`rebase`/`tag`/`reset`/force-ref-update **unreachable**;
- the target **branch must not already exist** (a human's or a prior run's is refused);
- **no remote** is ever contacted; work happens in a detached linked worktree so the operator's checkout is untouched;
- the task-router **DB + `agents.json`** are excluded from the commit (a task-router-anchored pathspec — a
  legit *app-level* `agents.json` a coder produced is still committed);
- the **commit footer** is appended by host code, not the model.

**Enable it.** Register an `scm` agent (§3 — no `backend`/`harness`; `metadata.integrator:true`), co-located
with the repo, and set `TASK_ROUTER_SCM_PROJECT_DIR` (defaults to `TASK_ROUTER_HARNESS_PROJECT_DIR`). The
coordinator wires the step automatically; `TASK_ROUTER_PM_SCM=0` disables synthesis. Key env:

| Env | Default | Purpose |
|---|---|---|
| `TASK_ROUTER_SCM_PROJECT_DIR` | `=HARNESS_PROJECT_DIR` | the git repo scm commits into (must be co-located) |
| `TASK_ROUTER_SCM_BRANCH_PREFIX` | `tr/local-fleet` | integration-branch namespace (NOT `feat/*`, which humans own) |
| `TASK_ROUTER_SCM_EXCLUDE` | `.claude/mcp/task-router` | comma paths kept OUT of the commit (DB + runtime agents.json) |
| `TASK_ROUTER_SCM_VALIDATE` | off | `1` = build/test the composed tree before commit — **RCE-grade** (runs model-authored code; trusted fleet only) |
| `TASK_ROUTER_SCM_MAXTOK` *(on the PM)* — `TASK_ROUTER_SCM_MAX_BODY` | 800 KB | PM-side cap on the composed diff payload vs the server's ~1 MB body limit; over-cap → deferred to a frontier integrator, never silently truncated |
| `TASK_ROUTER_PM_SCM` | on | `0` disables the host-synthesized scm step |

**What it does NOT solve.** scm confirms the pieces *compose* and (opt-in) that the union builds/tests — it is
**not** a merge and **not** a frontier review. A same-tier reviewer already passed each leg; the composed-tree
build is the first place cross-file wiring is checked, but the branch is still an unmerged, same-tier draft.

---

## 6. Multi-file / multi-discipline builds — **EXPERIMENTAL**

The hard constraint: **each harness task runs in a fresh `git worktree --detach HEAD` and returns an UNAPPLIED
diff**, so specialist B never sees specialist A's uncommitted files. The pattern that works:

1. **Contract-first.** `arch` writes the interface contract (§5.1); every implementer `depends_on` it, so the
   contract is threaded into each payload.
2. **Disjoint-file ownership.** Each specialist owns a NON-OVERLAPPING file set ("create ONLY these files: …;
   do NOT create or modify any other file"). Disjoint paths ⇒ the N diffs `git apply` without conflict ⇒ the
   union is a clean whole. Assign any shared/scaffold file (e.g. `package.json`) to exactly ONE owner.
3. **Thread the real interface to consumers.** A step that imports another's code (e.g. `test` importing the
   modules it tests) must `depends_on` that implementation step — the host then hands it that step's REAL
   produced interface (actual file paths + exported names, parsed from the diff), so it imports the real
   modules instead of guessing an entry point/API. *(Without this, a weak model defaults to inventing
   `require('../index')` and the build won't wire up — the single most common multi-file failure.)*
4. **Compose + validate once.** The reviewed disjoint diffs compose into the final tree; run the build/tests on
   the **composed** tree (per-leg validation false-FAILs, because a leg's worktree lacks the other legs' files
   — keep `TASK_ROUTER_HARNESS_VALIDATE` off for split builds; validate the union). **With an `scm` integrator
   registered (§5.4) this step is automated** — the coordinator composes the reviewed diffs into a branch+commit
   and (opt-in) validates the union; without one, the operator composes by hand as before.

**What per-diff review can and can't do:** it catches a leg's *local* defects and scope violations, but it
CANNOT verify cross-file wiring (each diff is reviewed in isolation). Integration coherence rests on the
contract + interface threading; the composed-tree build/test (or a frontier `/review`) is where it's confirmed.

---

## 7. Model tuning (the knobs that decide success)

### 7.1 Output budget (`max_tokens`) — set it GENEROUSLY; a low cap silently truncates

A model that hits `max_tokens` stops mid-output (`finish_reason=length`) — and it does NOT look like
truncation, it looks like a **capability failure**: a design missing its acceptance criteria, malformed HTML
with unclosed tags, or a review verdict cut off so it parses as `FAIL, "no reason parsed"`. This bit *every*
role at some point in piloting. Because `max_tokens` is a **ceiling, not a target** (the model stops naturally
when done), a *high* ceiling costs nothing on short outputs and only prevents truncation on long ones. The
dense 31B's window is **~92K** (piloted to ~70K input+output), so **~16000 is a safe default with large
headroom**; the per-request TIMEOUT — not a low cap — is what bounds a runaway model.

**Recommended operational values (what to actually run):** ~**16000** for `/review`, the coordinator, and
`arch`-as-designer; the C-2 coder floor is already 16000. Go to **24000–32000** for `arch` or `/review` on
large work — you have the budget.

| Role | Env | Code default | **Run with** | Note |
|---|---|---|---|---|
| C-1 **classify** | `TASK_ROUTER_BACKEND_MAX_TOKENS` | **800** | 800 | INTENTIONAL — a tight cap is a *safety* bound on a bounded classify task; a weak/MoE model spirals with a big budget (measured — see the coding benchmark). Keep it low for classify. |
| C-1 **`arch`/design** | `TASK_ROUTER_BACKEND_MAX_TOKENS` | 800 | **16000** (24000+ for big designs) | the 800 default serves classify; a DESIGN role MUST override it — an under-budgeted design truncates its tail and every implementer inherits the gap. |
| C-2 coder | `TASK_ROUTER_HARNESS_MAX_TOKENS` | **16000** | 16000 (24000+ large multi-file) | proxy FLOOR raising the CLI's own low cap (`0` disables). |
| `/review` | `TASK_ROUTER_REVIEW_MAXTOK` | **16000** | 16000 | raised from 4000, which truncated verdicts on real diffs → false `"no reason parsed"` FAILs. |
| coordinator | `TASK_ROUTER_PM_MAXTOK` | **16000** | 16000 | raised from 4000 (a complex plan / a thinking model exceeded it → empty plan). Also set `reasoning_effort:none` (§7.2). |

**The one place a low cap is right** is a bounded C-1 **classify** task (enum/typed output) on a weak or MoE
model — there a tight ceiling guards against reasoning-runaway (the low-active MoEs spiral and consume any
budget; more budget just buys more spiral). Everywhere else — design, coding, review, planning — the work is
unbounded and **16000+ is the correct call**, well inside the ~92K window.

### 7.2 Reasoning / "thinking" mode — the highest-impact gotcha of all

A **"thinking" model** (returns `message.reasoning_content`) spends its budget/time on hidden reasoning BEFORE
the answer. Two failure modes:

1. **Empty output at a low `max_tokens`** (all budget spent reasoning) → raise the per-role cap.
2. **Request TIMEOUT on a complex call even with a generous cap** — e.g. the coordinator's planning prompt →
   `"…request timeout after 300000ms"` → no plan, the run never starts. Raising `max_tokens` does not help
   (the reasoning itself is the cost).

**Disable it per-request with `reasoning_effort: "none"`** (verified on `gemma`-class via LM Studio). What does
**NOT** work: `reasoning_effort:"low"`, `chat_template_kwargs:{enable_thinking:false}`, top-level
`enable_thinking:false`, `reasoning:{enabled:false}`, a `/no_think` tag (that reasoned *more*). A **system
message** "do not produce reasoning / no `<think>` block" also works.

The Task Router coordinator wires this through `TASK_ROUTER_PM_REASONING_EFFORT` — **set it to `none`** (the
planning call is where thinking hurts most). The fleet is tuned for a non-thinking local model; leave reasoning
on only where you've *measured* it helps (plausibly `arch`/`review`, where deliberation pays; never the
coordinator's routing). **Diagnose** by a direct `/v1/chat/completions` and checking for non-empty
`message.reasoning_content`.

### 7.3 Temperature, timeouts, TTL, first-token

- **Temperature:** the review runs at temp 0 (deterministic); its two passes differ by PROMPT (in-context vs
  clean-room), not by sampling. Keep producers low/deterministic.
- **Request timeout:** `TASK_ROUTER_{PM,REVIEW}_TIMEOUT_MS` (default 300000); the harness has
  `TASK_ROUTER_HARNESS_TIMEOUT_MS` (default 900000).
- **Agent TTL:** a slow local leg can cross the 300s agent TTL and be swept. The runners heartbeat, but raise
  `TASK_ROUTER_TTL` (e.g. 1800) on the **server** as a backstop.
- **First-token kill:** `TASK_ROUTER_HARNESS_FIRST_TOKEN_MS` kills a silent/hung model early instead of a
  15-minute hang.

---

## 8. Gotchas — the consolidated list

- **`/v1` missing on an endpoint** → silent `[TEXT-ONLY]` from the harness (PM may work, harness specialists
  don't — the tell). Put `/v1` on every `*_ENDPOINT`.
- **Thinking-model empty / timeout** → §7.2. `reasoning_effort:"none"` on the coordinator.
- **`max_tokens` truncation** → §7.1. Generous per-role ceilings.
- **Agent TTL sweep** of a busy leg → raise `TASK_ROUTER_TTL` on the server.
- **UNAPPLIED diffs don't compose unless disjoint** → single-writer-per-path ownership; validate the composed
  tree, not each leg (§6).
- **The design is the ceiling** → a gap in `arch`'s contract propagates into every implementer verbatim.
  Invest in the contract's precision and the review gate, not the coder.
- **The consumer-guesses-the-API failure** (a weak model writes `require('../index')` against a non-existent
  entry point) → thread the dependency's real interface into the consumer's task (§6.3).
- **A weak reviewer both false-FAILs and misses bugs** → grounding + corroboration (§5.3); the frontier
  `/review` is still the gate.
- **Same-host `[FILE RESULT]` path** — the diff path is on the harness host; a reviewer on another host/container
  can't read it directly.
- **`pi` vs `opencode` result contracts differ** — `pi` returns reduced (thinking-stripped) text and is the
  recommendation (`PM_LOCAL_BACKENDS.md`).
- **A local agent is a resident process** — under C-0 nothing respawns a dead runner; an N-specialist fleet is
  N processes to keep alive.
- **Stateless per dispatch** — no cross-task memory; front-load every fact into each payload.

---

## 9. Worked example — a multi-file app fleet

For a "build a small URL shortener (server + lib + browser UI + tests)" goal:

1. **Roster:** `pm` + `arch` + `backend` + `frontend` + `test` (§3), each with a disjoint description and a
   `local_SKILL.md`; `pm` gets a `local_pm` block (that's what makes it local — no flag) + `TASK_ROUTER_PM_REASONING_EFFORT=none`.
2. **The PM plans:** `arch` (contract) → `backend` (`server.js`,`lib/*`), `frontend` (`public/*`), `test`
   (`test/test.js`), each `depends_on arch`; `test` also `depends_on backend` (to get its interface).
3. **The gate fires:** `arch`'s contract is reviewed; on a FAIL it revises; then the specialists run, each
   reviewed.
4. **Compose + validate:** union the disjoint diffs; run `node test/test.js` on the composed tree.

Measured outcome across iterations: with a vague contract the pieces don't integrate; with a precise contract +
disjoint ownership + interface threading, the composed project builds and **passes its tests** — comparable to
a single strong model, which a context-bound generalist coder (handed the whole spec at once) cannot reach.

---

## 10. Verify & troubleshoot

- **Always pilot** one execution-graded task per model before real work.
- **Roster check:** confirm every agent is registered + `idle` (a dead runner shows absent/stale).
- **Symptom → cause:**

| Symptom | Likely cause |
|---|---|
| harness returns `[TEXT-ONLY]` but PM works | endpoint missing `/v1` on the harness agents |
| PM ACKs then never dispatches ("I'm here…") / planning times out | thinking model — set `TASK_ROUTER_PM_REASONING_EFFORT=none` (§7.2) |
| design missing its tail / malformed HTML / verdict "no reason parsed" | `max_tokens` too low for that role (§7.1) |
| multi-file build won't run (`MODULE_NOT_FOUND`) | consumer guessed the API — thread the real interface (§6.3) |
| N diffs conflict on compose | ownership not disjoint — one shared file has two writers (§6.2) |
| agent vanishes mid-task (shows `external`/blue) | TTL sweep — raise `TASK_ROUTER_TTL` on the server |
| every specialist produces different, non-lining-up APIs | `arch` contract too vague — tighten it (§5.1) |

---

## References

- **`PM_LOCAL_BACKENDS.md`** — per-agent definition & operation (the `agents.json` block, full env table, C-1
  payload contract, C-2 acceptance rule, `pi` vs `opencode`). The prerequisite read.
- `doc/design/LOCAL_FLEET.md` — the architecture + the four capabilities (descriptions, skill injection,
  coordinator, clean-room review) + the honesty ledger.
- `doc/runbooks/CONTAINER_DEPLOY.md` §8.4 — cross-host deployment gotchas (`/v1`, thinking-model,
  `max_tokens`, TTL) in the container context.