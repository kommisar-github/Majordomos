# PM_LOCAL_BACKENDS — creating & routing to local-model agents

## Abstract

**TL;DR:** The self-sufficient rulebook for a fleet PM to **create, configure, route to, and operate** a
local-model agent — either a **C-1 backend** (~12B, one bounded `json_schema` call per task) or a **C-2
harness** (~31B driving the Pi/OpenCode coding CLI). A local model *is* the agent: fast, free, private,
offline-capable — but with a **hard capability envelope** and real operational obligations (it is a
resident process). Read this **when a local `backend`/`harness` agent exists, OR when you are evaluating
whether to add one.**

**Load when:** create a local agent, add a local-model agent, C-1 backend, C-2 harness, pi/opencode, route
to a local model, local-model limitations, what capabilities to give a local agent, `TASK_ROUTER_BACKEND_*`,
`TASK_ROUTER_HARNESS_*`.

**Provenance:** capability numbers are from **our own execution-graded benchmark**
(`doc/plans/LOCAL_MODEL_CODING_BENCHMARK.md`) + stress test — not a consumer report. Where a claim is a
prediction rather than a measurement, it says so.

**Key rule:** match the task to the envelope, or route it to a Claude agent instead. `json_schema`
guarantees *format*, never *content*; `exit 0` from a coding CLI is not *correctness*. Both are safety
controls, not niceties.

---

## Step 0 — Is this a local agent at all? Route by output SHAPE, pick the class.

| | **C-1 backend (~12B)** | **C-2 harness (~31B, pi/opencode)** |
|---|---|---|
| **Does** | one forced-`json_schema` call per task | drives a coding CLI agentically in a git worktree |
| **Good for** | classify · extract · route · tag · short bounded summary | a **single-file / few-file** bug-fix or localized refactor, scoped up front |
| **Never** | multi-step reasoning, prose, unbounded lists | large/cross-cutting features, redesigns, anything where a plausible-but-wrong diff is costly |

Everything outside those two boxes stays on Claude. Route by **output SHAPE**, not by topic.

### The capability envelope (measured)

A **~12B backend** was measured at parity with a frontier cloud model on the ✅ rows and **failed** the ❌
rows. A **31B-tier harness** additionally clears **bounded agentic coding** (§Step 1); the ❌ *Coding* row
is a **~12B** limit, not a local-model limit.

| Route to the local agent (✅) | Keep on Claude (❌) |
|---|---|
| **Enum / typed-scalar classification** (triage, priority, route-to) | **Multi-step / abstract reasoning** (dependency logic, planning) — it self-contradicts |
| **Structured extraction** into typed fields | **Coding** beyond a scoped single-/few-file edit (that's C-2's bounded lane) |
| **Bounded mapping** (NL command → structured call) | **Open-ended generation** (free-form prose, long narratives) |
| **Short bounded summaries** | **Unbounded lists** (uncapped arrays) — it repeats/hallucinates |
| **Tagging with a capped / enum'd vocabulary** | Anything where a wrong-but-valid answer is costly |

---

## Step 1 — Pick and VERIFY the model (architecture, not size).

- **Measured (C-2 coding benchmark):** on hard *compositional* coding only the **dense `gemma-4-31b-qat`**
  was both reliable and correct (110/110 assertions). The low-active-parameter MoEs (`qwen3.6-35b-a3b`
  3B-active, `gemma-4-26b-a4b-qat` 4B-active) **fail to converge** (reason-spiral / over-generate — no
  output budget fixes it); the small `nemotron-3-nano` was **confidently wrong** on the composite.
  The 31B's **nominal** window is **~95K** (a separate retrieval stress-probe found recall correct within
  it) — but the coding benchmark did **not** exercise long context, so treat large-input agentic
  performance as **unmeasured** (likely the 31B's weak axis; keep C-2 inputs shortlisted, rule 3).
  **Architecture predicts reliability better than parameter count.**
- **The rule that follows:** for **C-2** pick a **dense ~31B**; treat any low-active-parameter MoE (a
  `…-a3b`/`…-a4b` id, whatever its headline size — e.g. a `…-14b-a3b` is *predicted* to fail, though we did
  not benchmark that exact model) as the fail class and do NOT route agentic coding to it unproven. For
  **C-1** the envelope is *output SHAPE* — a small model handling bounded single-shot classes was **not**
  part of the coding benchmark, so treat C-1 sizing as guidance, not a measured tier.
- **Pilot first (mandatory):** run one small execution-graded task (a test that must pass) on the actual
  model before routing real work — the only way to turn the architecture *prediction* into a fact.

---

## Step 2 — Know that a local agent is a RESIDENT PROCESS (nothing in the seed restarts it).

A local agent is `local-runner.js` (C-1) / `harness-runner.js` (C-2): it **self-registers**, then
**resident-polls** its inbox. It is **not** just a config block — it is a daemon that must exist and stay
alive.

- **Launcher mode** (VS Code extension or the standalone App): the launcher reads the `agents.json`
  `backend`/`harness` block, sets the env below, spawns `node …/<runner>.js`, and supervises it. Normal
  path.
- **C-0 (seed-only / `--reseed`, no VSIX/App):** *no launcher ships in the seed.* The operator sets the
  `TASK_ROUTER_{BACKEND,HARNESS}_*` env by hand, starts the runner, and keeps it alive — **nothing restarts
  it if it dies** (the server's TTL will *detect* a dead agent, but nothing *respawns* it). Plan for that.
- **C-2 also needs:** the `pi` (or `opencode`) CLI installed on the **harness host** (the box running the
  runner + CLI), and a reachable **inference host** (LM Studio's OpenAI-compatible endpoint — may be a
  *different* machine on the LAN; the harness host needs only the CLI binary + LAN reach, not the GPU).

---

## Step 3 — CARVE A NEW narrow agent — do not divert an existing specialist.

An agent's model pin and its `capabilities` move together, so repinning an existing specialist routes its
**entire** scope to the local model — including the work the envelope excludes. **Create a new agent with
one narrow capability; leave the domain owner on Claude.**

A local agent needs **none** of the frontier Claude-skill machinery from the agent-add recipe: no **frontier
`SKILL.md`** (the full Startup Sequence / Memory Policy / Code Review operating manual — a local agent never
loads Claude Code). Only an `agents.json` entry is required. (It MAY have an **optional `local_SKILL.md`** — a
small ≤4 KB domain-rules card injected per task by `skill-injector.js`, a DIFFERENT artifact from the frontier
`SKILL.md`; see `LOCAL_FLEET_RUNBOOK.md` §3.2.) A `doc/<name>_GUIDELINES.md` + DOC_OWNERSHIP_MATRIX row is
optional documentation, not a runtime requirement.

---

## Step 4 — Write the `agents.json` block.

```jsonc
// C-1 backend (~12B) — bounded, one json_schema call
"triage": { "role": "specialist", "capabilities": ["classify"],
  "backend": { "kind": "openai-compatible", "endpoint": "http://192.168.1.50:1234/v1",
               "model": "gemma-4-12b", "api_key_env": "LM_STUDIO_API_KEY", "driver": "minimal" } }

// C-2 harness (~31B) — agentic coding via pi (recommended) or opencode
"local-coder": { "role": "specialist", "capabilities": ["code"],
  "harness": { "kind": "pi", "endpoint": "http://192.168.1.50:1234/v1", "model": "gemma-4-31b",
               "api_key_env": "LM_STUDIO_API_KEY", "timeout_ms": 900000 } }
```

- `endpoint` = the **inference host** (`192.168.1.50` is a fictional example). `backend`/`harness`/
  `launcher` are **mutually exclusive** — one block per agent (a schema-level safety invariant).
- **`kind`:** C-2 `kind` is **required** and has **no default** — omit it in C-0 and the runner exits with
  an error; under the launcher, omitting it silently falls through to a plain Claude launch. **`pi` is the
  recommendation** (see §pi-vs-opencode). C-1 `kind` is effectively fixed: the only accepted value is
  `"openai-compatible"`.
- `driver` (C-1) accepts only `"minimal"`. `api_key_env` is the env-var **NAME**, never the key.
- **C-2 workspace:** by default the harness edits a **git worktree of the project root**; set
  `harness.project_dir` to point at a different repo. If the resolved dir is **not a git repo**, the
  harness runs text-only (no diff — §Step 7).

### The env-var table (what the runner actually reads)

The runners read config **only** from env — they never read `agents.json`. The launcher translates the
block above into these; in C-0 you set them by hand. **When `agents.json` and the running env disagree, the
env wins until the process is relaunched.**

| `agents.json` field | Backend env | Harness env |
|---|---|---|
| `.kind` | `TASK_ROUTER_BACKEND_KIND` | `TASK_ROUTER_HARNESS_KIND` |
| `.endpoint` | `TASK_ROUTER_BACKEND_ENDPOINT` | `TASK_ROUTER_HARNESS_ENDPOINT` |
| `.model` | `TASK_ROUTER_BACKEND_MODEL` | `TASK_ROUTER_HARNESS_MODEL` |
| `.api_key_env` | `TASK_ROUTER_BACKEND_API_KEY_ENV` | `TASK_ROUTER_HARNESS_API_KEY_ENV` |
| `.driver` | `TASK_ROUTER_BACKEND_DRIVER` | — |
| `.temperature` | `TASK_ROUTER_BACKEND_TEMPERATURE` | — |
| `.timeout_ms` | — | `TASK_ROUTER_HARNESS_TIMEOUT_MS` |
| `.first_token_ms` | — | `TASK_ROUTER_HARNESS_FIRST_TOKEN_MS` (kill a silent/hung model early) |
| `.project_dir` | — | `TASK_ROUTER_HARNESS_PROJECT_DIR` (git repo for the worktree) |
| `agentConfig.capabilities` | `TASK_ROUTER_BACKEND_CAPABILITIES` | `TASK_ROUTER_HARNESS_CAPABILITIES` |

**Ambient-only** (NOT mapped from `agents.json` — set in the runner's shell env if you need them):
`TASK_ROUTER_{BACKEND,HARNESS}_POLL_MS`, `_HOST_ALLOW` (extra allowed endpoint hosts), `..._BIN` (override
the CLI binary), and `TASK_ROUTER_BACKEND_MAX_TOKENS` (C-1 output cap, default 800).

**Output `max_tokens` — one knob per role; a low cap silently TRUNCATES (`finish_reason=length`).** A local
model that hits its request `max_tokens` stops mid-output — which masquerades as a *capability* failure (a
design missing its acceptance criteria, malformed HTML with unclosed tags, or a review verdict cut off so it
parses as `FAIL, "no reason parsed"`). `max_tokens` is a **ceiling, not a target** (the model still stops
naturally when done), so set it generously:

| Role | Env | Default | Note |
|---|---|---|---|
| C-1 backend / classify | `TASK_ROUTER_BACKEND_MAX_TOKENS` | 800 | fine for a BOUNDED classify/tag (a tight cap is a safety bound — a weak/MoE model spirals with a big budget) |
| C-1 `arch` / **design** | `TASK_ROUTER_BACKEND_MAX_TOKENS` | 800 (override) | a design is unbounded — **set 16000** (24000+ for big designs); the 800 default is for classify, not design |
| C-2 harness / coder | `TASK_ROUTER_HARNESS_MAX_TOKENS` | 16000 | the proxy raises the CLI's own low per-request cap to this FLOOR (`0` disables) so the coder can't truncate the file it writes |
| `/review` | `TASK_ROUTER_REVIEW_MAXTOK` | 16000 | a low cap truncates the verdict → a false `FAIL, "no reason parsed"` on large diffs (raised from 4000, which did exactly this) |

**Free-form C-1 (`TASK_ROUTER_BACKEND_NO_SCHEMA=1`).** Emits a plain-text completion (no forced
`json_schema`) — for a text/design role (a local `arch`), or for an engine that can't compile the
schema→grammar (LM Studio + gemma 400 "failed to parse grammar"). Opt-in; it weakens the structured-output
contract but lets a local `arch` produce a written design.

⚠ **Endpoints MUST include the `/v1` path** — `http://<host>:<port>/v1`, not `…:<port>`. The loopback harness
proxy uses the endpoint's pathname as its base, so without `/v1` the CLI (pi/opencode) hits `/chat/completions`,
LM Studio 404s it, and the task completes as a silent **`[TEXT-ONLY]` — harness made no file changes**.
Applies to `TASK_ROUTER_{HARNESS,BACKEND,PM}_ENDPOINT`. (Tell: the PM works but harness specialists return
`[TEXT-ONLY]` — the PM endpoint had `/v1` and the harness ones did not.)

**Opt-in build/test validation (C-2 harness only, OFF by default — RCE-grade).** After the harness captures
the worktree diff, it can run the project's build/tests *in the worktree, before teardown*, and stamp a
`validated: PASS|FAIL|not-run` line into the `[FILE RESULT]` — which the PM reads to report the REAL outcome
(a PASS says "executed and passed, still unapplied"; a FAIL says "does NOT pass its tests"; otherwise "not
compiled/tested here"). It **executes model-generated code** (build scripts, test bodies), so it is disabled
unless you explicitly turn it on **on a trusted local fleet**:

| Env | Meaning |
|---|---|
| `TASK_ROUTER_HARNESS_VALIDATE=1` | Master switch. Unset/anything-else ⇒ never runs (`validated: not-run`). |
| `TASK_ROUTER_HARNESS_VALIDATE_CMD` | Explicit command (wins over auto-detect), run via `sh -lc` / `cmd /c` in the worktree. |
| `TASK_ROUTER_HARNESS_VALIDATE_TIMEOUT_MS` | Per-run cap (default 240000; keep below `TASK_ROUTER_TTL`). |

With no explicit `_CMD`, the ecosystem is auto-detected from the worktree: `Cargo.toml`→`cargo test`,
`go.mod`→`go test ./...`, `pyproject.toml`/`pytest.ini`/`setup.py`→`pytest`, a `package.json` `test`
script→`npm test`; none detected ⇒ `validated: not-run`. The captured output tail is marker-neutralized
before it enters the `[FILE RESULT]`, and the command runs **async** so the runner keeps heartbeating
(the default timeout stays below the agent TTL as a backstop; if you raise it, raise `TASK_ROUTER_TTL` too).

⚠ **Precondition — a self-contained, offline-buildable HEAD.** Validation runs in a fresh
`git worktree add --detach HEAD` checkout with a redirected `HOME`: it sees only *tracked* files (no
`node_modules/`, `target/`, `venv/`, or `~/.cargo`/`~/.npm` caches). So `npm test` with uninstalled deps,
`pytest` with missing packages, or an offline `cargo test`/`go test` will report **FAIL for environmental
reasons, not a code bug** — and the PM will then say "the code does NOT pass its tests." Enable this only
where the toolchain **and** the project's dependencies build offline from a clean HEAD (vendored deps, or a
`_CMD` that installs first, e.g. `npm ci && npm test`). Because it can only over-warn (never under-warn),
it is safe-by-default off; a false-FAIL costs trust, not safety.

---

## Step 5 — Capabilities / skills to assign.

Give **one narrow capability** matching the envelope — C-1: `classify` / `summarize` / `extract` / `tag`;
C-2: `code` (scoped to bounded edits). That is the whole capability surface — a local agent has no frontier
Claude skill file (its optional per-task domain rules come from a `local_SKILL.md`, §3.2 of the runbook, not a
frontier `SKILL.md`). Registered capabilities come from `TASK_ROUTER_*_CAPABILITIES` (the launcher maps the array;
in C-0 you set the env). **Rule 1: only route a task whose class is in the agent's `capabilities`.**

---

## The shaping rules

**C-1 (backend) — rules 2 & 3 (mandatory):**
2. **Bound the OUTPUT.** Every C-1 task is a bounded `json_schema` (enums, `maxLength`, `maxItems`). The
   runtime enforces this: a plain-text or schema-less payload gets a `maxLength`-bounded default, and a
   payload-supplied schema is force-bounded (strings capped, arrays capped, objects closed). The real
   output ceiling is `max_tokens` (operator-set, never payload-influenceable). See the payload contract
   below.
3. **Bound the INPUT.** Do **not** hand the model a large corpus — a big candidate list makes prefill
   latency-fatal. Retrieve / shortlist upstream to a small set before dispatching.

**C-2 (harness) — the acceptance rule (mandatory; rules 2–3 don't apply — a coding CLI emits free-form
text, there is no schema backstop):**
- **Bound the ACCEPTANCE.** Never route a C-2 task without an execution-graded acceptance signal — a test
  that must pass. **A clean `exit 0` from the CLI is NOT that signal** (sparser-MoE / smaller models fail
  *silently* — confident and wrong). `/review` every consequential diff.

**Both — GATE consequences (rule 4).** Send any consequential local output through `/review` before it
drives an irreversible action.

**Both — STATELESS per dispatch.** The runtime is stateless: each dispatch runs in a **fresh throwaway
workspace whose config-home is discarded** (pi additionally with `--no-session`). There is **no cross-task
memory**. The ~95K nominal window bounds a **single dispatch**, not an accumulated session, so **front-load
every fact into each payload**; nothing persists between tasks routed to the same agent name. Correctness + knowledge
front-loading are the goal; latency (prefill-linear) is the accepted trade — keep each dispatch's input
shortlisted (rule 3).

---

## Step 6 — The C-1 payload contract (adjacent to rule 2).

A C-1 task payload is either **plain text** (→ a `maxLength`-bounded default `{result}`) or a **JSON
object** `{ system?, prompt|user, schema? }` supplying its own bounded schema. A worked bounded example:

```jsonc
{
  "system": "Classify the ticket. Respond only via the schema.",
  "prompt": "Ticket: \"Login button does nothing on Safari\"",
  "schema": {
    "type": "object", "additionalProperties": false,
    "properties": {
      "category": { "type": "string", "enum": ["bug", "feature", "question", "duplicate"] },
      "reason":   { "type": "string", "maxLength": 120 },
      "tags":     { "type": "array", "items": { "type": "string" }, "maxItems": 3 }
    },
    "required": ["category"]
  }
}
```

**Security of the payload channel (M5).** The payload's `schema` is force-bounded and its `system` is
**appended** to a pinned base (never replaces it), so a payload can't dissolve the output bound or hijack
the guardrail. But if your dispatch path lets **attacker-influenced text** (e.g. a chat bridge, an HA
request) reach a backend payload verbatim, the **dispatcher must re-wrap it** into a controlled
`{system,prompt,schema}` — never pass untrusted text through as the payload.

---

## Step 7 — Verify, and read the C-2 result.

- **Preflight (automatic):** the harness runner refuses to register if the `pi`/`opencode` CLI isn't on
  PATH, and kills a silent/hung model early (`first_token_ms`) instead of a 15-minute per-task hang. Still
  run the Step-1 **pilot** before real work.
- **Reading a C-2 result:** on success with file changes the harness returns a **`[FILE RESULT]` block**
  (a `path:` to a captured, sandboxed `git diff` of the worktree vs HEAD) — hand it to `/review` to audit
  and apply; the harness does **not** auto-apply. No changes → `[TEXT-ONLY]`. A failed run is marked
  `[HARNESS-FAILED exit=…]` (so you never mistake it for a clean result). **Same-host caveat:** the
  `[FILE RESULT]` `path:` is on the harness host — a `/review` agent on another host/container can't read
  it directly.

---

## Two kinds of local agent — `backend` (C-1) vs `harness` (C-2)

**`backend` (C-1)** — `local-runner.js` fulfils each task with one forced-`json_schema`
`/v1/chat/completions` call. Works on a ~12B.

> **A THIRD, model-LESS kind — the integrator (`scm`, `scm-runner.js`).** Not a `backend` or `harness`: it
> makes **no model call**. It composes the fleet's reviewed diffs into an isolated **branch + commit** (never
> merges/pushes) via a **structural git allowlist**. Its `agents.json` block has neither a `backend` nor a
> `harness` (`metadata.integrator:true` + `TASK_ROUTER_SCM_PROJECT_DIR`). Full definition + env in
> **`LOCAL_FLEET_RUNBOOK.md` §5.4**; the coordinator host-synthesizes its step (you don't plan it).

**`harness` (C-2)** — `harness-runner.js` is a resident supervisor that, per task, runs a one-shot `pi`/
`opencode` CLI inside a **git worktree** of the project, pointed at a **loopback security proxy** the
supervisor owns. Security lives in the runner and must not be regressed: the proxy **resolves-and-pins**
the upstream IP (DNS-rebind safe, metadata-denied unconditionally), a **per-runner client token** (minted once) gates it
while the **real model key is injected only at the proxy** (never in the CLI config), the child gets an
**allow-listed scrubbed env** (no host secrets), the untrusted payload arrives on **stdin, never argv**,
and all runner-side `git` is **sandboxed** (no hooks/filters/textconv) with the captured diff excluding the
harness's own config + scrubbing the token. (Shared SSRF/key controls live in `local-model-security.js`.)

### pi vs opencode

Both are validated on a 31B; the security layer is adapter-agnostic. But the **result contracts differ** —
so "the PM just routes" is not quite true: **pi** returns *reduced* assistant text (thinking stripped) from
its structured `--mode json` stream; **opencode** returns cleaned raw stdout (no structured mode). On
adapter-robustness grounds **pi is the recommendation**, not merely the default. (This is about the adapter
carrying the result, not code quality — the model drives the coding.)

---

## `/pm audit`

This contract is checked **only when a local `backend`/`harness` agent is present**. A Claude-only fleet is
exempt. See `doc/plans/LOCAL_MODEL_BACKEND_PLAN.md` §2 C-PM-TASKSHAPING.