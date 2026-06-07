# Task Router project bootstrap — copy-paste prompt

Give this prompt to **another agent** once you have a **planned project** (goal, scope, tech stack, rough milestones) and want a **Task Router bootstrap plan**: specialist roster with domain knowledge, Document Ownership Matrix, interface contracts between specialists, roadmap → wave dispatch mapping, and a step-by-step bootstrap checklist.

The output is a **single long Markdown document** (typically 600–1200 lines for a 4–9 agent project). It does **not** produce code, SKILL.md files, or `agents.json` — those are executable artifacts generated later by `init.sh` + manual edits, **informed** by this plan.

Attach (or point the agent at):

- **`./PM.md`** — concept guide. The agent must read this.
- **`./PM_TEMPLATES.md`** — template library (matrix, skill shape, agents.json schema, CLAUDE.md, SKILLS.md, rules INDEX, task protocol). The agent must read this. **This is the template you fill with project-specific content** — the actionable artifact.
- **`./doc/design/DOC_OWNERSHIP_MATRIX.md`** (if it exists in your seed) — design & implementation guide for the matrix pattern. **This is the rationale — read it for understanding, not for copy-paste.** The paste-ready template lives in `PM_TEMPLATES.md`; the design doc explains why that template is shaped the way it is.
- **Your project plan** — design docs, architecture, roadmap, or a one-page brief.

**Reproduce structure, not commentary.** When the output asks you to produce something from a `PM_TEMPLATES.md` template (matrix, skill block, roster table), reproduce the template's **structure** — section headers, table schema, field names — with **project-specific content in the fills**. Do **not** reproduce the template's explanatory commentary, usage instructions, or meta-notes verbatim; those are for the reader, not for the consumer's final artifact. When in doubt: if removing a line would make the artifact harder for a downstream *consumer agent* to use, keep it; if removing it only loses the human-facing teaching, drop it.

Repository root below is **`./`**. A successful prior output from a 9-agent multi-domain project was ~970 lines of domain-specific density — **use that as the floor**, not the ceiling. See `PM_TEMPLATES.md` → `## Worked Single-Repo Matrix Example` for an anonymized filled-in matrix at the expected density.

**Length floor varies with roster size and domain density:** plan for **400+ lines** for a default-only roster (pm/arch/review/scm with no domain specialists), **600+ lines** once one or two domain specialists are added, **800+ lines** for a 7-plus-agent project, **900–1100+ lines** at the quirk-dense upper end. A 7-agent project in a quirk-dense platform (many vendor-specific idioms, multiple pitfalls unique to the platform) legitimately lands near the top of that band; a 7-agent project in a standard-stack domain (conventional REST, typical frameworks) legitimately lands lower. The single-number "600–1200" band in prior versions of this prompt was too tight for both ends — follow the tiered guidance above.

---

## Prompt (paste below the line into the other chat)

---

### Context

You are producing a **Task Router bootstrap plan** for a project I have already planned. The plan (or its summary) is in this conversation, either pasted below or in files I attached. Your job is **not** to re-design the product, re-argue the tech stack, or rewrite the brief — it is to turn the plan into **operational artifacts** so I can run a PM-led multi-agent setup with clear ownership, docs, and role boundaries.

Your deliverable must align with Task Router conventions. **Read these first** (they define the defaults you must not contradict):

- **`./PM.md`** — PM behavior, bootstrap checklist, matrix ownership, reconciliation protocol, dispatch payload convention, Context Loading Bifurcation.
- **`./PM_TEMPLATES.md`** — canonical templates you are specializing: `CLAUDE.md`, `SKILLS.md`, rules `INDEX.md`, PM / SCM / Architect / Review skill templates, `DOC_OWNERSHIP_MATRIX.md` template, Task File Protocol, Project Rule.

Where **`PM.md`** or **`PM_TEMPLATES.md`** specifies behavior, **follow it** — do not re-invent it. Your job is to **fill the blanks**, not to replace the seed.

### Non-negotiable conventions (from successful prior seedings)

- **1M Opus preservation for coordinators.** `pm`, `arch`, and `review` get `role: "coordinator"` in `agents.json` and **no `model` field** — omitting `--model` gives Claude Code's default 1M context window. Setting `model: "claude-opus-4-6"` (or similar) silently downgrades to 200K. Coordinators need 1M.
- **Specialists set `model` explicitly in `agents.json`.** Every specialist entry carries a `model` field — typically `"claude-sonnet-4-6"`, or `"claude-haiku-4-5"` for mechanical work like `/scm`. The roster documents its own tiering instead of relying on IDE-level settings. (The `taskRouter.modelByRole` extension setting still works as a fallback for omitted `model` fields, but the explicit form is preferred for shipped rosters.)
- **File locations (consumer layout, v0.3.11+):**
  - Agent infrastructure: `.claude/SKILLS.md`, `.claude/skills/<name>/SKILL.md`, `.claude/mcp/task-router/agents.json`.
  - Rules index: `.claude/rules/INDEX.md` (plus per-specialist `.claude/rules/<name>.md`).
  - **Project design docs live in `doc/`** — do not leave them at repo root.
  - **Task-router internal docs stay in `.claude/mcp/task-router/doc/`** (shipped by `init.sh`: `WAVE_DISPATCH.md`, `TROUBLESHOOTING.md`, `SERVER_API.md`). Do **not** duplicate server reference docs into the consumer's `doc/`.
- **Abstract standard.** Every design doc in `doc/` opens with an `## Abstract` block containing `**TL;DR:** …`, `**Load when:** <keyword list>`, `**Key facts:** <bullets>`, `**Owner:** /<agent>`, `**Related:** …`. Forks skim abstracts to decide what to fully load.
- **Dispatch Payload Convention.** PM cites `**Context docs:**` by path in every dispatch payload — specialists re-read those docs fresh rather than relying on stale copies.
- **Context Loading Bifurcation.** Dedicated terminals amortize Primary-doc loads at startup. Subagent forks load only the matrix + docs cited in `Context docs:`. Every specialist plan must acknowledge both modes.

### Project shape — declare first, **default is single-repo**

**Most new projects are single-repo. Treat single-repo as the default path; multi-platform is an advanced annex.** Multi-platform-first framing in earlier seeds was a maintainer-internal assumption — do not let it leak into your output. State the shape explicitly at the top of the deliverable.

**Single-repo** *(default)*
- One code tree, one shared `doc/`, one shared `ROADMAP.md` owned by PM.
- Matrix uses the single-repo sections only (sections 1 → 4 in the current `PM_TEMPLATES.md`). Skip the multi-platform / hardware appendices entirely — don't write them as empty stubs.
- Solo-developer and learning-focused projects fall here. Per-agent model-tier optimization is a legitimate solo use case; you don't need three human operators to benefit.
- Wave-dispatch maps **will often be mostly serial** — most solo projects do not have enough genuinely parallel file-disjoint work to sustain 3+ concurrent specialists. That is correct, not a failure.

**Multi-platform** *(only when truly distinct runtimes exist)*
- Distinct build systems / deploy targets (e.g., Python backend + iOS app + Android app + embedded firmware) where each platform has its own roadmap and lead specialist.
- Matrix uses all sections including the platform-specific and hardware appendices.
- Only choose this shape if you would genuinely publish a separate ROADMAP per platform. If one shared ROADMAP covers the work, it's single-repo.

**Hybrid** *(rare)*
- Single repo with multiple deployment targets that share most code (e.g., desktop + web build from the same source). Call out explicitly which directories fork. Default back to single-repo conventions except where the fork demands otherwise.

**Throughout the rest of this prompt, sections flagged `*(multi-platform only)*` should be omitted or collapsed to a single line for single-repo projects.** Do not invent multi-platform structure that doesn't exist in the project.

---

## Required deliverable — one Markdown document, the sections below, in order

**Save as `doc/BOOTSTRAP_PLAN.md`** for the monolithic default. If the plan uses the multi-file split (see *Constraints → Large-plan split* below), save the index at `doc/BOOTSTRAP_PLAN.md` and per-section files under `doc/BOOTSTRAP_PLAN/NN_section.md`. Do not save the plan at the repo root or under `.claude/` — it is a design document and lives alongside the other design docs in `doc/`, with a matrix row owned by `/pm`.

Generic command-style section titles are fine; the **depth** is what matters. Each section's minimum content is listed. If your draft is shorter than the floor, you are producing a summary, not a bootstrap plan — expand.

### 1. Project synthesis (5–15 bullets)

What we are building, v1 boundary, hard constraints (hardware, compliance, latency, budget), explicit non-goals. No fluff — tuned so PM and specialists share one picture when they spawn.

**Prerequisite-question callout (optional, only when gating content).** If any Section 12 `Q:` bullet materially gates the content of an earlier section — e.g., a MEMORY-seeding decision would change whether the matrix has a `MEMORY.md` row, or a comment-markers decision (see Section 7) would change whether the plan instructs the user to edit shared files during bootstrap — surface those dependencies as a small callout under this Section 1, each entry forward-referencing the specific `Q:` in Section 12. Format: `- §N depends on §12 Q-label — <one-line consequence if decided either way>`. If no Section 12 questions gate earlier content, omit the callout entirely; do not invent dependencies to fill the slot. This keeps Section 12 at the end of the deliverable (where open questions belong) while making gating dependencies visible up front.

### 2. Design principles (prose, ~30–60 lines)

Explain **for this specific project**:

- **Why specialists (not just parallelism).** Grouping is by **knowledge domain**, not file ownership. Each specialist's value is domain context kept warm across tasks — API idioms, config key names, coordinate systems, mathematical formulas, common pitfalls. If a proposed specialist's domain collapses to "runs a few scripts," merge it into another specialist.
- **Context economy via the matrix.** Abstracts (~50 tokens each) plus `Context docs:` citations in dispatch payloads shrink a typical fork from ~100K tokens down to 30–50K. Call out the project-specific savings (e.g., "a `/frontend` fork doing a calibration-UI task loads only `gui_2d.md` + matrix, not `configuration.md` or `gui_3d.md`").
- **Relationship to default agents.** `PM.md` provides four defaults: **pm**, **arch**, **review**, **scm**. These stay structurally the same; they just get project-specific context injected (PM gets the roster + interface contracts + roadmap; `arch` gets the design docs; `review` gets a checklist of project-specific risks; `scm` usually needs zero customization). List, in a small table, **exactly** what you're injecting into each default.

### 3. Agent roster — full block per agent (this is the heart of the document)

For **each agent** (defaults + domain specialists), produce the following block. **Every field is required.** A one-line capabilities list is not sufficient — the SKILL.md domain knowledge section is what makes a specialist worth running.

```
#### <agent-id> — <One-line title>

**Role:** coordinator | specialist
**Model:** (coordinator — omit from agents.json for 1M Opus) | claude-sonnet-4-6 | claude-haiku-4-5 | ...
**Capabilities:** <short comma list — matches agents.json>

**Owns (files):**
- `path/to/file.py` — one-line description of why
- `dir/subdir/` — directory ownership

**Context (tiered doc loading):**
- `doc/design/DOC_OWNERSHIP_MATRIX.md` — always read first
- **Dedicated terminal:** read all Primary docs from matrix (list them)
- **Subagent fork:** read only matrix + docs PM cited in `Context docs:` field

**Never touches:**
- `<path>` — <which agent owns it>
- ... (at least 2–4 entries; this is load-bearing for clean boundaries)

**SKILL.md domain knowledge** (bullet-dense — this is the specialist's permanent context):
- <API signatures, config key names, mathematical formulas, coordinate systems, tool idioms>
- <Common pitfalls specific to the domain>
- <Default parameters, magic constants, platform quirks>
- ... aim for 8–15 dense bullets per project-specific specialist on a **platform-quirk-dense** domain (many vendor-specific idioms, versioning gotchas, undocumented API behavior); **5–8 bullets** is honest for **standard-stack** specialists (conventional REST, typical web frameworks, well-documented libraries); **3–6** for a lightly customized default. Aim for honest density, not a fixed count.

**Cursor rule globs:** `<comma-separated globs matching Owns>`
```

**Minimum bullets for the SKILL.md domain knowledge field:**

- Project-specific specialists in a **platform-quirk-dense** domain (e.g., `deepstream`, `cv`, embedded-SDK specialists, long-tail scripting platforms): **8–15 bullets** covering API surfaces, config formats, coordinate systems, default constants, and at least 2 common pitfalls unique to the domain.
- Project-specific specialists in a **standard-stack** domain (e.g., a conventional `backend` over a well-documented web framework, a `frontend` specialist on a mainstream UI stack): **5–8 bullets** of genuine project-or-platform-specific content is honest. Pushing to 8+ by padding generic software-engineering advice is worse than landing at 6 with real pitfalls.
- Lightly-customized defaults (`pm`, `arch`, `review`): 3–6 bullets or explicit interface/checklist lists.
- `scm`: usually no domain knowledge block — git is git.

**Hard qualifier — unchanged across all domain types:** if you cannot name at least **5 concrete API/config/idiom bullets** for a proposed specialist, that specialist is not yet a specialist. Merge it into an adjacent role or drop it. This floor is **not** relaxed for standard-stack domains — it is the quality gate that separates "specialist" from "dumping-ground role."

**Fake-specialist failure modes — use these to audit your own draft.** A role is **not yet a specialist** if any of the following describes its proposed SKILL.md:

- **Domain-knowledge bullets are generic software-engineering advice.** "Use proper error handling," "write tests," "log meaningful messages." Replace with project-specific API names, config keys, magic constants, or protocol quirks.
- **Pitfalls are at the "remember to test" level.** A real pitfall has *teeth*: it would trip a competent engineer who lacks domain experience. "Forgot to flush the buffer before closing the socket" is a pitfall. "Be careful with async code" is not.
- **Bullets could be written by any competent engineer reading Wikipedia.** Real domain knowledge is hard-won: undocumented API quirks, vendor-specific config syntax, numerical gotchas, load-bearing default parameters, sequence ordering that only matters for this library.
- **Owned files are scattered across domains with no unifying knowledge.** If the role owns three unrelated directories because each one was unclaimed, you have a dumping ground, not a specialist.
- **Never-touches list is short or absent.** A specialist without explicit boundaries is a PM role wearing a specialist hat.

**Pitfall quality heuristic:** A pitfall is unique if it has saved time in a real prior project — or would trip a competent engineer who lacks this specific domain's experience. If the pitfall sounds like advice you'd give any engineer on any codebase, it does not count toward the minimum.

**Bootstrap the full roster.** This is the firm default, not a negotiable recommendation.

Specialists exist primarily because each one is a **knowledge hub** for its domain — a persistent holder of API idioms, config keys, formulas, pitfalls, vendor quirks, and coordinate-system conventions that PM's dispatch routing delivers the right task to the right knowledge-holder. The entire seed is built around this: the Document Ownership Matrix maps every doc to a Primary knowledge-holder; PM's `Context docs:` citations are knowledge-routing decisions; the Abstract standard + Context Loading Bifurcation are knowledge-economy mechanisms that let forks pay for only the knowledge they need. **Knowledge routing is the primary rationale** for splitting specialists — a small, focused SKILL.md per specialist beats a larger multi-domain SKILL.md on load time, token cost per dispatch, and reasoning quality, regardless of what model tier each agent runs on.

Two valuable consequences fall out of having distinct knowledge-holders, both **secondary but real**:

- **Per-agent model tiering** — Opus for decision-heavy knowledge-holders (coordinators, reasoning-heavy specialists), Sonnet for competent execution, Haiku for mechanical work. Real cost savings for long-running projects, especially solo ones, and load-bearing enough for some projects to warrant explicit tuning — but it does not by itself justify the seed's complexity if knowledge routing didn't pay off first.
- **True parallelism** — N terminals = N simultaneous reasoners, each with full domain context. Benefits multi-operator teams; for solo operators, largely moot (one person has one attention head — see the honest parallelism rule in Section 8).

Collapsing specialists to save bootstrap effort breaks knowledge routing (the primary mechanism the whole seed is organized around), and loses the tiering and parallelism consequences as a side effect. The full-roster default stands on knowledge economy first.

**Still produce a "minimum vs nice-to-have" breakdown** so the user knows which agents are strictly load-bearing for v1 (drop and you lose a project goal) and which are earned-later niceties (drop and you accept some context bloat in adjacent agents until the work grows). But **recommend bootstrapping all of them.** The cost of an unused agent is near-zero (an entry in `agents.json`, a lightly-stubbed SKILL.md) compared to the friction of retrofitting one mid-project.

**The only exception** is a genuinely exploratory pre-v1 project where the domain shape is unknown and specialists can't yet be named with 5+ concrete SKILL.md bullets each. In that case, bootstrap defaults + the 1–2 most load-bearing specialists, and earn additional agents through PM's agent-evolution mechanism as the domain stabilizes. State this caveat only if the project plan actually matches it; do not offer it as a default escape hatch.

**Common specialist candidates — evaluate each explicitly.** Beyond the four defaults (pm / arch / review / scm), the candidates below recur often enough across real bootstrap rounds that the seed prompts you to **consider each one and state an include-or-decline decision with rationale**, rather than leave them implicit. These are *candidates*, not defaults — including them creates a ghost specialist in project shapes where they have no domain knowledge, which violates the 5-bullet hard qualifier. But **not considering them at all** is the more common failure: consumers frequently retrofit `/devops` or `/db` mid-project after the first deploy or first migration surfaces the gap, at friction cost the bootstrap could have avoided.

For each candidate below, your deliverable's Section 3 must either produce a full specialist block (same shape as every other specialist — Owns / Never-touches / SKILL.md domain knowledge / Cursor globs) or a one-line explicit decline with reason. Do not silently omit. Example decline: *"`/devops` — declined. Project is a single-file scripting monolith with manual deploy; deploy mechanics are one bullet in `/scm`'s SKILL.md, not a specialist domain."*

| Candidate | Include when | Decline when |
|---|---|---|
| **`/devops`** — deploy / CI / environments / secrets / infra-as-code | Project has any CI pipeline, containerization (Docker / K8s), managed cloud deploys, multi-environment promotion (dev → staging → prod), secrets management worth its own rules, or infra-as-code (Terraform / CloudFormation / Pulumi). | Single-file scripting monolith with manual deploy; exploratory project with no deploy yet; library whose release mechanics are covered by `/scm` + tag-and-push. |
| **`/db`** — schema design / migrations / query tuning | Project has a data layer with dedicated schema work, migrations as distinct tasks, query optimization concerns, or a data model complex enough that schema changes touch multiple specialists' work. | Data access is trivial (ORM the backend specialist already owns), schema is small and static, or the project has no persistent storage. |
| **`/security`** — auth / secrets handling / threat modeling / audit | Project is auth-heavy (OAuth / SSO / multi-tenant), handles PII or regulated data (HIPAA / PCI / GDPR), has compliance requirements, or ships a product where security audit is a recurring task distinct from `/review`'s architecture review. | Standard "don't log secrets, use parameterized queries" baseline that `/review` + canonical rule ownership already cover. Security is a cross-cutting invariant here, not a specialist domain. |
| **`/perf`** — profiling / optimization / latency SLOs | Project has explicit latency SLOs, throughput targets, a tight resource envelope (embedded / mobile / real-time), or performance is a recurring cross-specialist topic that accumulates real domain knowledge (profiler output interpretation, known hot paths, allocation quirks). | Performance is "fast enough" baseline; optimization is one-off rather than a domain; no SLOs. |
| **`/release`** — versioning / changelog / publishing cadence | Project publishes on a cadence to a registry (NPM / PyPI / Docker Hub / SDK distribution), API-versions externally, or has release mechanics non-trivial enough to warrant a knowledge hub (semver discipline, deprecation windows, release notes convention). | `/scm` + tag-and-push covers it; no external publishing cadence. |

**Apply the fake-specialist failure modes.** If an included candidate would land with fewer than 5 concrete domain-knowledge bullets (API names, config keys, pitfalls unique to that specialist's work), decline it instead and fold the handful of bullets into the nearest existing specialist (`/devops` → `/scm`; `/db` → `/backend` or `/core`; `/security` → `/review`'s checklist; `/perf` → the specialist owning the hot path; `/release` → `/scm`). The 5-bullet hard qualifier does not relax for these candidates — they earn specialist status the same way every other specialist does.

**Why these five?** Recurring-gap signal — `/devops` and `/db` in particular have appeared as retrofits across multiple consumer projects; `/security` shows up in regulated / auth-heavy work; `/perf` in latency-sensitive domains; `/release` in SDK / library projects. They are not an exhaustive list — your project may have its own recurring-gap specialist (e.g., `/ml`, `/hardware`, `/docs`) that belongs in the same category. Evaluate those too, with the same include-or-decline-with-rationale format.

### 4. `agents.json` — fenced JSON block

Exact content for `.claude/mcp/task-router/agents.json`. Follow the schema in `PM.md` → "agents.json Schema".

**Reserved agent names — reject and rename before producing the JSON.** The extension launches each terminal with `claude ... --agent <name>_agent "<name>"`; Claude Code's CLI intercepts bare positional args that match (or are one edit-distance away from) one of its subcommands and exits before the skill loads. Any roster containing `agent`, `agents`, `auth`, `auto-mode`, `doctor`, `install`, `mcp`, `plugin`, `plugins`, `setup-token`, `update`, or `upgrade` is broken on contact. Pick a synonym that reflects the domain (e.g., a voice-assistant skill → `voice` / `assistant` / `wakeword`, not `agent`). See `PM.md` → "agents.json Schema" → *Reserved agent names* for the full rationale. After the JSON, include a **Model resolution notes** block explaining, per agent, which of the four branches of **`PM.md` → "Model field — decision tree for `agents.json`"** applies:

1. **Coordinator (no `model`, 1M Opus).** `pm`, `arch`, `review` — always this branch.
2. **Specialist needing Opus for decision-heavy reasoning** (`model: "claude-opus-4-6"` or `"claude-opus-4-7"`, 200K context). Justify in one sentence.
3. **Mechanical specialist** (`model: "claude-haiku-4-5"`). `scm` is the canonical case.
4. **Default specialist** (`model: "claude-sonnet-4-6"`). The correct answer for ~80% of specialists — set Sonnet explicitly in `agents.json`.

No workspace setting is required. Every specialist in `agents.json` carries an explicit `model` field so the roster is self-describing. (The IDE-level `taskRouter.modelByRole` setting remains functional as a fallback for agents that omit `model`, but do not rely on it in seeded rosters.)

**Do not invent per-agent Opus overrides unless the workload genuinely requires it.** When in doubt, use Sonnet.

### 5. `SKILLS.md` roster table

Target: `.claude/SKILLS.md`. Columns: Skill, CLI, Cursor Globs, Domain, Model. One row per agent. Keep it scannable — it is the agent-system index, not a specifications dump.

### 6. Document Ownership Matrix (ready to paste into `doc/design/DOC_OWNERSHIP_MATRIX.md`)

Use the template from `PM_TEMPLATES.md` → `## DOC_OWNERSHIP_MATRIX.md Template`. Match the template's section numbering exactly (Section 1 docs, Section 2 load rules, Section 3 Abstract standard, Section 4 Quick-reference). **Single-repo projects stop at Section 4 — do not invent Appendix A or Appendix B.** Multi-platform / hardware projects add Appendix A (platform-specific) and/or Appendix B (hardware reference) with their own doc tables.

**Reproduce the template's structure, not its commentary.** Keep every structural element the template specifies (section headers, table schema, field names, the Abstract-block shape) and fill each with project-specific content. Drop the template's prose that explains *why* the structure exists — that commentary is for someone reading `PM_TEMPLATES.md`, not for the consumer project's matrix file. A healthy matrix paste-block in your Section 6 is mostly tables + Abstract blocks + a few crisp load-rule sentences; it is not a re-explanation of the matrix pattern.

Within your bootstrap-plan Section 6, produce these sub-sections. **Use the `§6.N` labels below — not bare `Section N`** — so references to "Section 3" unambiguously refer to the matrix template's own Section 3 (format spec), not a plan sub-section. The user pastes each `§6.N` into its matching matrix slot.

**§6.1 — Fill for matrix Section 1 (cross-cutting design + architecture table).** A 5-column table (Document, Type, Primary, Secondary, Notes). Rows for every doc that exists or will exist in the project: `ROADMAP.md`, `NEXT_STEPS.md`, `MEMORY.md`, `DOC_OWNERSHIP_MATRIX.md`, every design doc, and the bootstrap plan itself. The **Notes** column must state **what changes trigger an update** (not just what's in the doc).

**§6.2 — Fill for matrix Section 2 (cross-cutting load rules).** Restate the tiered loading (terminal-mode vs fork-mode) in project-specific terms with a worked example (e.g., "a `/cv` fork dispatched for triangulation work reads matrix + `gui_3d.md` + `architecture.md` ≈ 50K tokens; without the matrix it would load all 4 design docs ≈ 120K"). Include the ownership-transfer protocol from the template verbatim (do not re-derive).

**§6.3 — Abstract payloads for each design doc (destination: the design docs themselves, not the matrix).** Produce the actual `## Abstract` markdown for every design doc in the project, including generous `Load when:` keyword lists (15–30 terms — they are the primary retrieval signal for forks). Keep keyword-list generation honest: if the project has 3 design docs, produce 3 Abstract blocks; do not invent docs to match example counts.

> **Destination note — read carefully.** The Abstract blocks produced in `§6.3` go into **each design doc's own file** (top of `doc/architecture.md`, `doc/gui_2d.md`, etc.) — *not* into `DOC_OWNERSHIP_MATRIX.md` itself. The matrix template has its own **Section 3 — Abstract standard (format spec)** slot that holds the format definition, copied verbatim from `PM_TEMPLATES.md`. Plan sub-sections use `§6.N` labels precisely so bare "Section 3" refers only to the matrix template's Section 3; plan `§6.3` produces *payloads* destined for individual design docs.

**§6.4 — Fill for matrix Section 4 (Quick-reference "which agent for which topic").** PM uses this for `Context docs:` picks at dispatch time. Columns: "If the task is about…", "Delegate", "Context docs". One row per topic domain. Cover every capability claimed by every specialist in Section 3 of this bootstrap plan.

**(Optional) Appendix A / Appendix B.** Only include if the project is genuinely multi-platform or has dedicated hardware docs. Otherwise omit entirely.

### 7. Interface contracts between specialists

The **data shapes** that cross specialist boundaries. Use the project's idiomatic form (Python `@dataclass`, TypeScript `interface`, Go `struct`, Protobuf / JSON Schema — pick one and stay consistent). For each contract, state the producer → consumer pair.

**Write one contract per real boundary — not one per arrow in a diagram.** Multi-platform production systems that stream typed structures between processes typically have 5–10 meaningful contracts. **Solo projects, learning projects, and single-repo tools often have far fewer** — specialists may collaborate mostly by exchanging file paths, JSON metadata, or shared config. In those cases:

- If your specialists exchange **file paths and metadata** (e.g., "backend writes `data/experiments/<id>/config.json`; eval reads it"), write **one** contract for the directory layout — do not split it into five thin contracts for each field.
- If a boundary is literally "here's what an experiment directory looks like," it may be a **layout convention**, not a data contract. Document it in the design doc the layout belongs to, and mention it here only if the layout is hot enough that a specialist changing it would break other specialists silently.
- Three thin contracts that restate the same shape are worse than one real contract plus a note explaining why the others are trivial. **Pad neither the contract count nor any individual contract.**

Examples of the kinds of contracts this section exists to fix in place — pick only those that apply:

**Cross-process / typed-data boundaries** (multi-platform production systems):
- Detection events streamed between pipeline stages (e.g., pipeline → behavior)
- 3D object state or spatial data (e.g., cv → frontend, cv → behavior)
- WebSocket / IPC message envelopes (e.g., backend → frontend)
- Alert triggers or notification payloads (e.g., behavior → backend)
- External API event shapes that the project re-emits (e.g., backend → pipeline)

**Shared-filesystem / single-process boundaries** (ML projects, single-repo tools, scripting-platform monoliths):
- Experiment / run-directory layouts (common in ML / learning projects) — one layout contract for `data/experiments/<id>/{config.json, metrics.csv, checkpoints/}` beats five thin field contracts.
- Shared configuration or schema files consumed by multiple specialists — e.g., a single `config/pipeline.yaml` read by `/backend` and `/eval`; document the contract as "keys owned by /backend, consumed by /eval."
- **Shared-scope function interfaces in a single-process runtime** (scripting platforms like Google Apps Script, legacy scripting monoliths, single-file Python tools) — functions defined in one specialist's file and called from another specialist's file. Contract shape: "function name, argument shape, return shape, owning specialist, caller specialist(s)." Even though there is no process boundary, the *ownership* boundary is real and PM enforces it.
- **File-level ownership boundaries in a monolithic codebase** — when a single file houses logic from multiple concerns and cannot practicably be split, document the sections (by line range, comment marker, or exported-symbol prefix) each specialist owns within the file. Example: `app.gs` lines 1–200 owned by `/auth`, lines 201–600 owned by `/gui`.

  **Default: insert in-file comment markers.** For any file shared across two or more specialists, **recommend inserting section banners** (`// === /auth section — lines 1–200 — owner: /auth ===` … `// === end /auth ===`) as a one-time edit during bootstrap. The matrix documents the ownership; the in-file markers make the boundary visible to whichever fork has the file open, with no cross-check cost. Skip the markers only when the shared file is genuinely read-only during the project's remaining lifetime, or when the project's lint/style pipeline forbids banner comments. This default flipped (from "skip by default" → "insert by default") in v0.3.18 after a consumer project spent ongoing allow-list cross-checking cost because the one-time marker step had been deferred.

  **Dispatch-time coordination.** When line-range ownership is in effect, PM cites the owned range in every dispatch payload alongside `Context docs:` — e.g., `Owns: data.gs:201–600`. Specialists re-confirm the range from the in-file banner before editing; if the banner disagrees with the payload, the specialist surfaces the mismatch rather than silently editing. Line-range drift is caught by `review` during its normal pass, not by a file-level lock — the task router does not mediate file access.

These are the boundaries PM enforces. When a specialist proposes a change, PM evaluates cross-cutting impact against this section before approving. **The point is not typed data streaming — it is any cross-specialist contract that can be silently broken.** A directory layout, a shared function, a section of a shared file — all qualify.

### 8. Roadmap → wave dispatch mapping

Map the project's roadmap (phases, milestones, epics — whatever the project actually uses) to Task Router waves. **Do not invent phases** the project doesn't have. For each roadmap unit, produce a small table:

```
### <Phase / Milestone N> — <name> (optional: step range)

**Active agents:** pm, <specialist>, ...
**Parallelism:** Serial | 2-way | 3-way | 4-way

| Wave | Tasks | Agent(s) | Dependencies |
|------|-------|----------|--------------|
| N.1 | <concrete deliverable> | <agent> | — |
| N.2 | <concrete deliverable> | <agent> | N.1 |
| ...
```

For any wave with multiple agents marked `parallel`, explicitly note whether they share files (must be serialized) or are file-disjoint (truly parallel). This is what PM uses to build `dispatch_plan` payloads.

**Honest parallelism rule.** Mark a wave `parallel` only when (a) the work is genuinely file-disjoint and (b) the operator is likely to actually run both dispatches concurrently. Solo and single-terminal-operator projects **do not reward heavy parallelism** — even file-disjoint work typically runs serially because the operator has one attention head. Marking many waves as "3-way" or "4-way" when a one-person team will in practice run them serially is a false promise. Default to `Serial`; upgrade to parallel only when there is a concrete case for it (multi-operator team, or a solo operator explicitly running multiple dedicated terminals with disjoint file scopes). The common-deviations appendix licenses mostly-serial maps for solo/learning projects — use that license when it applies.

**Non-delegable work (Learning-First projects).** Projects that declare the Learning-First Delegation rule (see `PM.md` → *System Concepts → Learning-First Delegation*) mark specific waves as **author by the operator, not delegated to a specialist**. Use the canonical syntax from PM.md verbatim — do not invent a variant:

- Wave **agent column:** `(author, /learn reviews)` — exactly this string, so PM can grep for it at dispatch time.
- Wave description may prepend `[NON-DELEGABLE]` as a structural tag when the whole wave is non-delegable. Partial-wave cases go in the agent column only.
- PM's dispatch-time check: if a proposed dispatch's agent column reads `(author, /learn reviews)`, PM refuses to auto-dispatch and instead instructs the operator to author the work manually, with `/learn` advising and journaling the outcome.

Consistent syntax matters because every Learning-First project's PM relies on grepping the wave map to enforce the rule. Invented variants (`author (user)`, `manual`, `NON-DELEGABLE:`) will silently defeat the check. If the project is not Learning-First, skip this entirely.

**Worked single-repo example — all-serial is correct:**

```
### Phase 3 — Session-management rework (steps 14–17)

**Active agents:** pm, gas, auth, gui
**Parallelism:** Serial (solo operator, single repo, shared-scope runtime)

| Wave | Tasks | Agent(s) | Dependencies |
|------|-------|----------|--------------|
| 3.1 | Define new session-token shape in shared util file | gas | — |
| 3.2 | Wire auth pathway to use new session-token shape | auth | 3.1 |
| 3.3 | Update GUI login + logout flows to new session state | gui | 3.2 |
| 3.4 | End-to-end manual test, resolve discovered gaps | pm (driving), all | 3.3 |
```

Four serial waves for a four-step phase, one specialist per wave, no parallel dispatches — this is a **complete and correct** wave map for a solo-operator single-repo project. The fact that every wave is `Serial` is not a planning shortfall; it is an honest reflection of one-operator / shared-scope constraints. Do not invent parallel waves to match the multi-platform examples. If your project has one operator and one shared-scope runtime, expect most phases to look like this.

### 9. Agent interaction map (optional ASCII diagram)

A small ASCII graph showing PM at the top and arrows between specialists that have interface contracts. Helps readers grok the topology in 5 seconds. If the project has more than 7 specialists, split by phase rather than trying to cram everything into one diagram.

### 10. Bootstrap checklist (numbered, actionable)

Step-by-step execution plan for applying this bootstrap. Follow the `PM.md` Bootstrap Checklist shape. Every step must be something a human or agent can **check off** — no "design the thing" steps; those have already been done by this document.

**Bootstrap state — fresh vs. incremental.** Before listing the steps, state which mode applies:

- **Fresh bootstrap** — no `.claude/skills/`, `.claude/mcp/`, `.claude/SKILLS.md`, or `.claude/rules/` exists yet. Follow the full step list below; every file is a fresh write.
- **Incremental bootstrap** — one or more of `.claude/skills/<agent>/SKILL.md`, `.claude/rules/<agent>.md`, `.claude/SKILLS.md`, `.claude/mcp/task-router/agents.json` **already exists** (typically from a prior `init.sh` run, or a previous partial bootstrap). In this mode the plan is **appended**, not overwritten.

State the detected mode at the top of the deliverable. In incremental mode, annotate every file-write step below with `[APPEND]`, `[REPLACE-ROWS]`, `[MERGE]`, or `[FRESH]` so the executor knows exactly what to do. The per-artifact merge rules are:

| Artifact | Incremental-mode rule | Why |
|---|---|---|
| `.claude/skills/<agent>/SKILL.md` (from `init.sh` defaults) | `[APPEND]` — add a new `## Project Knowledge (injected)` section at the end. **Do NOT** rewrite Startup Sequence, Task File Mode, or MCP registration blocks. | Those are canonical from `init.sh` — overwriting breaks auto-registration. |
| `.claude/skills/<new-specialist>/SKILL.md` (no prior file) | `[FRESH]` — write the full skill file from the plan. | New specialist, no prior canonical content to preserve. |
| `.claude/mcp/task-router/agents.json` | `[MERGE]` — expand `capabilities` arrays on existing entries in place; add new specialist entries; never remove coordinator entries (`pm`/`arch`/`review`). Preserve their omitted `model` field (1M Opus). | Overwriting loses coordinator 1M-context config; silently shortening capabilities breaks agent routing. |
| `.claude/SKILLS.md` | `[APPEND]` — add new specialist rows to the roster table. | Existing rows from `init.sh` are still authoritative for the defaults. |
| `.claude/rules/INDEX.md` | `[APPEND]` — add rows for new specialists; replace placeholder rows (e.g., `/<platform-agent>`) with real ones. | Template stubs use placeholders intended for replacement; real rows accumulate. |
| `CLAUDE.md` | `[MERGE]` if it exists — keep the `init.sh`-generated content as canonical base; splice in any plan-specific sections at the end. `[FRESH]` only if missing. | `init.sh` builds from `PM_TEMPLATES.md`; plan content usually adds rather than replaces. |
| `doc/design/DOC_OWNERSHIP_MATRIX.md` | `[REPLACE-ROWS]` — keep the template's structural skeleton (section headers, table schemas, Abstract-standard spec in matrix Section 3, ownership-transfer protocol) and **replace the placeholder rows** (`<one-line purpose>`, `/<platform-agent>`, etc.) with project-specific rows from plan `§6.1` / `§6.2` / `§6.4`. | Template scaffolds exist to be filled; format spec is shared across projects. |
| `doc/plans/ROADMAP.md`, `doc/NEXT_STEPS.md` (stub form, e.g., "Phase 1 — TBD") | `[REPLACE-ROWS]` — same pattern: keep the document's structural headings, replace placeholder rows with real roadmap / next-step entries. If the file already has non-placeholder content (user has started editing), `[MERGE]` instead: preserve user edits, inject plan content in a new section. | Same rationale as matrix — scaffolds meant to be filled. |
| Design doc Abstract blocks (plan `§6.3` payloads) | `[APPEND]` at top of each design doc if no Abstract present; never overwrite a human-edited Abstract without surfacing the diff. | Author-edited Abstracts are authoritative; silent overwrite loses intent. |

Required steps (at minimum — add more if the project needs them):

1. Prerequisites (Task Router server installed, VS Code extension, `.mcp.json` at root).
2. Directory structure — one `mkdir` per directory for portability across cmd / PowerShell / bash (brace expansion is bash-specific and fails on native Windows shells):
   ```
   mkdir -p .claude/skills/pm
   mkdir -p .claude/skills/scm
   mkdir -p .claude/skills/arch
   mkdir -p .claude/skills/review
   mkdir -p .claude/skills/<specialist1>
   mkdir -p .claude/skills/<specialist2>
   mkdir -p .claude/tasks
   mkdir -p .claude/rules
   mkdir -p doc
   ```
   In incremental mode, skip any directory that already exists; `mkdir -p` is idempotent on POSIX but a PowerShell `New-Item -ItemType Directory -Force` equivalent is needed for native PS sessions.
3. `CLAUDE.md` from `PM_TEMPLATES.md → CLAUDE.md Template`. Global placeholders to fill (same across every template in `PM_TEMPLATES.md` — `init.sh` substitutes these five):
   - `<PROJECT_NAME>` — human-readable project name (e.g., `proj-example`).
   - `<DOC_DIR>` — project doc directory, usually `doc`.
   - `<SHARED_DOC_DIR>` — cross-cutting doc directory; for single-repo projects this collapses to `doc` (same as `<DOC_DIR>`); for multi-platform projects it is the shared parent (e.g., `doc/shared`).
   - `<DATE>` — the bootstrap date in ISO form (e.g., `2026-04-24`). Used in "Last Updated" headers.
   - `<YYYY-MM-DD>` — same ISO date, used in example payloads that show a date format.

   Other placeholders (`<FEATURE>`, `<NAME>`, `<TASK_TAG>`, `<PLATFORM_A_DOC_DIR>`, `<DEVICE>`, etc.) are **local to specific template blocks** — leave them as-is in the template body and fill at paste time when the block actually applies. Merge-rule: see table above.
4. `.claude/SKILLS.md` from Section 5. Merge-rule: `[APPEND]` new rows if file exists.
5. `.claude/rules/INDEX.md` from `PM_TEMPLATES.md → Rules INDEX Template`. Merge-rule: `[APPEND]` / `[REPLACE-ROWS]` per table above.
6. `doc/design/DOC_OWNERSHIP_MATRIX.md` from Section 6 (plan `§6.1` → matrix Section 1, `§6.2` → Section 2, Abstract standard stays from template, `§6.4` → Section 4). Merge-rule: `[REPLACE-ROWS]` on the template stub if present.
7. Abstract blocks inserted into design docs (from this plan's `§6.3` — payloads destined for each design doc, not for the matrix). Merge-rule: `[APPEND]` at top of each design doc; never overwrite author-edited Abstracts.
8. Default skills (pm/arch/review/scm) from `PM_TEMPLATES.md` — referenced by exact `##`-level headings (grep-stable; do not paraphrase):
   - `## PM Skill Template` (for `/pm`)
   - `## SCM Skill Template` (for `/scm`)
   - `## Architect Skill Template` (for `/arch`)
   - `## Architecture Review Skill Template` (for `/review`)
   Merge-rule: `[APPEND]` project knowledge under `## Project Knowledge (injected)` if `init.sh` already wrote the default skill file; `[FRESH]` otherwise.
9. Domain specialist skills — one per specialist in Section 3, each with the owns / never-touches / domain knowledge / tiered-load blocks filled from this plan. Shape sourced from these `PM_TEMPLATES.md` anchors (referenced by exact heading text for grep-stability — do not paraphrase):
   - `### Startup Sequence Template` (inside `## Agent Evolution — Proposing New Skilled Agents`) — the specialist canonical Startup Sequence block is under `**For specialists (canonical template — copy exactly):**`; copy the fenced template verbatim.
   - `### Task Router Auto-Execute Template` (same parent section) — the Ping handler + Reconciliation handler template; every specialist needs it.
   - `### Agent Design Principles` (same parent section) — canonical-rule-ownership guidance and specialist-shape constraints to honor when drafting the SKILL.md body.
   Merge-rule: `[FRESH]` for new specialist names; `[APPEND]` for any that already exist under `.claude/skills/`.
10. Per-specialist rule files (`.claude/rules/<name>.md`) with condensed rules + globs (in YAML frontmatter, informational — these are read by Task Router agents via the `Read` tool, not auto-attached by the IDE).
11. `agents.json` from Section 4. Merge-rule: `[MERGE]` per table above (expand capabilities on existing entries; add new specialists; preserve coordinator `model`-omission).
12. VS Code workspace settings (`taskRouter.modelByRole`) — optional; prefer explicit per-agent `model` in `agents.json` (see Section 4).
13. **Static pre-flight verification** (runs before step 14; catches wiring mismatches before the first MCP call):
    - Every agent name in `agents.json` has a matching `.claude/skills/<name>/` directory with a `SKILL.md` inside.
    - Every specialist in `agents.json` (role: `specialist`) has a matching `.claude/rules/<name>.md` file. Coordinators (pm/arch/review) may omit the rule file; note the exception explicitly.
    - Every SKILL.md contains the canonical Startup Sequence (grep for `## Startup Sequence`) and Task Router Auto-Execute (grep for `## Task Router Auto-Execute`) sections — missing either means the agent won't auto-register.
    - Every specialist in `agents.json` has an explicit `"model"` field; coordinators (pm/arch/review) do NOT have a `"model"` field (critical for 1M Opus context).
    - Produce a sorted-diff report: `agents.json names` vs. `.claude/skills/*/` dirs vs. `.claude/rules/*.md` stems. Any asymmetry is a bootstrap error — fix before proceeding to step 14.
14. Runtime verify: start PM terminal → `/pm` registers and lists agents → `/pm ping` returns healthy for all specialists → start one specialist terminal → subagent fork dispatch reads only `Context docs:` (not all Primary docs).

**Ordering note — steps 9 / 11 are interchangeable, but both must precede step 13 (static pre-flight) and step 14 (runtime verify).** The executable state depends on (a) `agents.json` listing the agent, (b) the agent's SKILL.md existing at its declared path, and (c) the rule file existing for specialists. Either file missing makes step 14's registration fail. Consumers running the hand-fill as a one-shot edit session can write steps 2–12 in any order they prefer, but **must not start terminals (step 14) until all of steps 2–12 are complete**, and should run step 13's static pre-flight diff immediately before step 14 to catch wiring typos cheaply.

### 11. Implementation notes

Short, dense. Must cover:

- **Context token budget.** Estimate the SKILL.md size per agent (rule of thumb: lightly-customized default ≈ 1K tokens, project-specific specialist with full domain knowledge ≈ 3–4K tokens, PM with interface contracts ≈ 6–8K tokens). State whether PM fits comfortably in 1M Opus (answer is almost always yes).

  **SKILL.md additions vs. practical session floor — report both.** The rule-of-thumb numbers above are the *project-specific injections* the bootstrap plan adds. A running PM session's actual floor is higher because it includes `CLAUDE.md` (~2–4K), the full default `/pm` SKILL.md shipped by `init.sh` (~4–6K of Startup Sequence + reconciliation protocol + task-file protocol + memory loads), the `PM.md` seed if referenced, and auto-memory. Produce a two-column mini-table for the PM agent:

  ```
  | Component                                | Plan minimum | Practical floor |
  |------------------------------------------|--------------|-----------------|
  | Project-specific SKILL.md injections     | ~6–8K        | ~6–8K           |
  | Default /pm SKILL.md (init.sh baseline)  | —            | ~4–6K           |
  | CLAUDE.md + rules INDEX.md               | —            | ~3–5K           |
  | Auto-memory load at startup              | —            | ~5–15K          |
  | Matrix + Abstract blocks                 | —            | ~3–6K           |
  | Total PM session floor                   | ~6–8K        | **~25–40K**     |
  ```

  Specialist floors are lower (no reconciliation, no matrix pre-load) — typically 10–20K practical floor. Report a similar table if the project's PM has a large roster or several interface contracts; single-specialist projects can skip the table and state the PM floor inline. The point is that `1M – 40K = 960K` headroom is still comfortable — the honest number should reassure, not alarm.

  **Typical PM practical-floor ranges by roster size** (calibration only — always produce the project-specific number via the table above rather than using these as-is):
  - **3-agent solo project** (defaults + one specialist, few docs) — ~12–18K practical floor.
  - **6-agent single-repo project** (defaults + 2–3 specialists, ~5–8 docs) — ~20–28K practical floor.
  - **9-plus-agent quirk-dense project** (defaults + 5+ specialists, 8+ docs, multi-phase roadmap) — ~28–40K practical floor.
  - **12-plus-agent multi-domain project** (coordinators-plus-domain-leads-plus-support, 10+ docs, interface-contract-heavy) — ~35–50K practical floor.

  These ranges are for **calibration** — a project whose practical floor comes out dramatically higher or lower than the band for its size likely has either a matrix that loads too much on every dispatch (too high) or missing doc-loading rules (too low). Flag the mismatch in the plan rather than silently reporting the number.
- **Terminal vs fork trade-off.** For each phase in Section 8, recommend which agents get dedicated terminals and which are fine as one-shot forks. A small table indexed by phase is useful.
- **Scaling-down table.** Which terminals are strictly needed per phase — so the user doesn't run 9 terminals during phase 1. `arch`, `review`, `scm` rarely need persistent terminals; one-shot forks are sufficient unless the user is in a heavy design/review cycle.
- **Relationship to existing design docs.** State explicitly: the design docs remain the source of truth for **what** to build; this bootstrap plan + resulting SKILL.md files define **how agents collaborate to build it**.
- **Expected agent-system growth.** Enumerate, one line each, which `PM.md` agent-evolution triggers are likely to fire over this project's lifetime — *coverage gap*, *context overload*, *recurring cross-cutting concern*, *new project domain*, *user friction*, *technology boundary*. For each, say **likely / possible / unlikely** for this specific project, with a one-line rationale.

  **Calibration for the three labels** (use consistently — "likely" means *high prior*, not *might happen*):
  - **Likely** — foreseeable within the next 1–2 roadmap chapters / phases given the planned scope. Expect to act on it.
  - **Possible** — foreseeable over the project's full lifetime, but avoidable with planning or by scope choices the team will probably make. Worth naming so the plan is honest; not worth acting on pre-emptively.
  - **Unlikely** — would require a change in project scope or entry into a domain the project doesn't currently touch. Name it only if a plausible triggering scope-change exists; otherwise omit.

  State an expected-count for new agents over the project's lifetime (e.g., *"0–1 new agents expected; if one appears, likely `/serve` for inference-time optimization in Phase 11+"*). Self-awareness about roster stability is a healthy pattern — it tells PM whether to be skeptical of future roster-change proposals.

  **Agent retraction / merge is also a growth direction.** Roster evolution runs in both directions: specialists merge back (e.g., `/auth` folds into `/gas` when the auth domain turns out to be one file's worth of quirks rather than a full domain). When the plan enumerates likely growth triggers above, also name any **plausible retraction/merge paths** in one line each — e.g., *"if `/auth` stays under 5 SKILL.md bullets through Phase 4, merge into `/gas`."* The retraction protocol itself (which files to archive vs. delete, how to fold domain knowledge into the receiving specialist's SKILL.md, how to update `agents.json` + `SKILLS.md` + `.claude/rules/INDEX.md` + matrix ownership rows) lives in `PM_TEMPLATES.md` → `## PM Skill Template` → `### Agent Retraction / Merge` (it is a `###` heading under the PM Skill Template, not a top-level `##` — a plain `grep '^## '` will miss it). Cross-reference it rather than re-deriving.

- **Canonical ownership for cross-cutting rules.** When a project-wide rule applies to several specialists (version-bump protocol, commit-message convention, test-naming rule, secret-handling policy), **name one canonical owner** — typically `/scm` or `/pm` — and have every other specialist's SKILL.md / rule file **link** to the canonical statement rather than restate it. Triplicating a rule across three specialists guarantees drift the first time it's updated. Only the canonical owner carries the full rule text; other specialists reference it by location (e.g., `See /scm SKILL.md → "Version-bump protocol" — /scm is the canonical source`).

### 12. Open gaps (`Q:` bullets)

Decisions only **the user** can make. Prefix every bullet with `Q:`. Do **not** hide guesses as facts. Examples:

- `Q:` Does this project have a separate staging environment, or does every specialist deploy straight to prod?
- `Q:` Is there a bot / alerting channel the `review` agent should post to on critical findings?
- `Q:` Which specialist owns database migrations — `backend`, or does this warrant a dedicated `db` specialist?

---

## Constraints (applied to your output)

- **Length floor (tiered):** **400+ lines** for a default-only roster (pm/arch/review/scm, no domain specialists); **600+ lines** once one or two domain specialists are added; **800+ lines** for a 7-agent project; **900–1100+ lines** for 7-plus agents on a platform-quirk-dense domain. If your draft is under 300 lines, you are producing a summary — expand. If it is between 300 and the tier floor, you are close but missing depth in one or more sections; iterate by adding concrete pitfalls, domain bullets, or Abstract-block keyword lists rather than prose.
- **Do not duplicate `PM_TEMPLATES.md` content.** Reference sections by name and let the user copy from there. This document is the **project-specific fill-in**, not a template library.
- **Do not seed server reference docs into `doc/`.** `init.sh` places `WAVE_DISPATCH.md` / `TROUBLESHOOTING.md` / `SERVER_API.md` under `.claude/mcp/task-router/doc/`. Keep them there.
- **Prefer paths and files over URLs.** `./doc/architecture.md`, `./.claude/skills/pm/SKILL.md` — concrete, grep-able, stable across machines.
- **One deliverable, clear `##` headings per section above, in the order given** — *with one exception: large-plan split below*.
- **Large-plan split — optional output mode for plans estimated >25K tokens.** A monolithic `BOOTSTRAP_PLAN.md` over ~25K tokens / ~1000 lines can exceed file-read limits in some harnesses (notably Claude Code's 25K-token Read limit), forcing the project-side application agent to paginate. The token count is only knowable after drafting; to decide *before* drafting, use this fast proxy:

  **Use multi-file** if the project has any of: (a) **8 or more agents** in the roster (defaults + specialists), (b) **5 or more interface contracts** expected in Section 7, (c) multi-platform shape with real appendices in Section 6. **Use monolithic** otherwise. The token count is the final tiebreaker — if the proxy says monolithic and the draft ends up >25K tokens anyway, reshape into multi-file before handing the deliverable off.

  For plans at that scale you **may** emit a multi-file output instead of one monolithic file:
  - `BOOTSTRAP_PLAN.md` at the root — a short (≤300-line) index that enumerates the sections with one-sentence summaries each and links to per-section files.
  - `BOOTSTRAP_PLAN/01_synthesis.md`, `BOOTSTRAP_PLAN/02_design_principles.md`, `BOOTSTRAP_PLAN/03_roster.md`, `BOOTSTRAP_PLAN/04_agents_json.md`, `BOOTSTRAP_PLAN/05_skills_md.md`, `BOOTSTRAP_PLAN/06_matrix.md`, `BOOTSTRAP_PLAN/07_interface_contracts.md`, `BOOTSTRAP_PLAN/08_wave_mapping.md`, `BOOTSTRAP_PLAN/09_interaction_map.md` *(optional)*, `BOOTSTRAP_PLAN/10_checklist.md`, `BOOTSTRAP_PLAN/11_implementation_notes.md`, `BOOTSTRAP_PLAN/12_open_gaps.md` — one file per plan section, each self-contained and readable in a single Read call (target: ≤10K tokens per file).
  - Per-section files use their own top-level `## Section N` heading so they stand alone when read in isolation.
  - Default to monolithic for plans ≤25K tokens (simpler for web-chat and cursor consumers with no Read limit). Use the multi-file split for larger plans, and state the choice explicitly in the output: *"Monolithic output — estimated ~18K tokens, fits in one file-read call"* or *"Multi-file output under `BOOTSTRAP_PLAN/` — estimated ~43K tokens, split for Read-limit harnesses."*
- **Cite `PM.md` by section title** (e.g., "per `PM.md` → System Concepts → Document Ownership Matrix") when you invoke a convention — do not paraphrase silently.

---

## Appendix: Common deviations from the template and when they are correct

This prompt is **mostly normative** — it tells you what to produce, at what length, in what order. That framing is deliberate (it blocks lazy summaries), but it can make an honest executor feel they have no license to deliver less than the full shape when the project genuinely doesn't need it. The following deviations are **expected and correct** for certain project shapes. Call them out in your deliverable; do not silently produce them and hope no one notices.

- **Mostly-serial wave dispatch maps.** Solo and learning-focused projects often lack enough file-disjoint work to sustain 3+ concurrent specialists. A roadmap where every wave is `Serial` or `2-way` is a truthful map of the work, not a deficiency. State it: *"Wave parallelism is mostly serial because the v1 scope has one load-bearing specialist per milestone."*
- **Fewer Abstract blocks in Matrix Section 3 than the multi-platform examples suggest.** If the project has 3 design docs, you produce 3 Abstract blocks. Do not invent design docs to match an example count.
- **Shorter SKILL.md for a specialist whose domain genuinely has less surface area.** A 2K-token SKILL.md is correct when the domain is narrow (e.g., a project's `/tools` agent whose whole responsibility is a few scripts with known APIs). Padding to hit 4K is wrong. The 8–15 bullet guidance is a **floor for specialists with real domain knowledge**, not a minimum for every role. State it: *"`/tools` SKILL.md is 6 bullets because the domain is `uv` + three CLI tools; padding would dilute signal."*
- **Fewer interface contracts than agents.** Most solo projects end up with 1–3 real contracts plus one directory-layout contract. Do not split a layout into five thin field-level contracts.
- **Collapsed or absent Section 9 (Agent interaction map).** If the map would show only PM → everyone (fan-out without cross-specialist arrows), the ASCII diagram is noise. Skip Section 9 or replace with one sentence — for example: *"All specialists dispatch through PM; cross-specialist contracts are enumerated in §7. No standing cross-specialist arrows worth diagramming."*
- **Multi-platform sections omitted entirely for single-repo projects.** Do not leave empty "Platform-specific" or "Hardware reference" stubs in the matrix. Delete them.
- **`scm` with an empty domain-knowledge block.** Acceptable. Git is git. Do not invent project-specific git pitfalls.

**Rule of thumb:** if honest output is shorter than the template's example density, say why in one line and move on. If it's shorter because you didn't do the work, that's different — the length floor and depth gates are still in force for sections that apply.

---

## Pre-handoff self-check — rubric for the design agent

Before handing the deliverable off, run these grep/count checks against your own output. They are cheap, deterministic, and catch the most common shape errors at the stage where fixing them is free. This is the **producer-side** counterpart to Section 10's static pre-flight (which runs at **application** time against the filesystem).

Work through each check and note the result in one line at the end of your deliverable (e.g., *"Pre-handoff checks: 6/6 pass"*). If a check fails, fix the plan before handoff — do not hand over a plan that flunks its own rubric.

1. **Agent count matches across artifacts.** The number of agents in `agents.json` (Section 4) equals the number of `#### <agent-id>` blocks in Section 3 equals the number of rows in Section 5's SKILLS.md table. Any drift is a bootstrap bug — one of the three is out of sync.
2. **Coordinators have no `model` field.** Grep Section 4's `agents.json` block for `"pm"`, `"arch"`, `"review"` entries and confirm none carries a `"model"` key. Any `"model"` field on a coordinator silently downgrades it from 1M to 200K context.
3. **Every specialist has a `model` field.** Conversely, every specialist entry in `agents.json` carries an explicit `"model"` value — typically `"claude-sonnet-4-6"`, `"claude-opus-4-6"`, or `"claude-haiku-4-5"`. Missing `"model"` on a specialist means it inherits from `modelByRole` — acceptable as a fallback but not the seeded primary path.
4. **Chapter / phase count matches roadmap.** Section 8's wave map covers every chapter / phase / milestone named in Section 1's project synthesis. A missing phase means the wave map is incomplete; an extra phase means you invented scope.
5. **Non-delegable waves present iff the project is Learning-First.** If Section 1 declares the Learning-First rule, Section 8 contains at least one wave with `(author, /learn reviews)` in the agent column. Conversely, if Section 1 does not declare Learning-First, Section 8 contains **no** `(author, /learn reviews)` markers. Mismatch = scope confusion.
6. **Every specialist's SKILL.md block has at least 5 concrete bullets.** Grep Section 3 for *SKILL.md domain knowledge* blocks; each block has 5 or more bullets, none of them generic software-engineering advice (fake-specialist failure modes — see Section 3's audit list). Fewer than 5 = merge into an adjacent role or drop.
7. **Every common specialist candidate has an explicit include-or-decline decision.** Grep Section 3 for `/devops`, `/db`, `/security`, `/perf`, `/release` — each must appear either as a full specialist block or as a one-line decline with rationale. Silent omission is a Section 3 incompleteness. Any additional recurring-gap candidates relevant to the project's domain (`/ml`, `/hardware`, `/docs`, etc.) get the same treatment.

If the project uses the multi-file output split, run the same checks on the per-section files rather than the monolithic index — and additionally verify that the index `BOOTSTRAP_PLAN.md` lists every per-section file with a one-sentence summary.

---

## My project plan (fill in below, or say "see attached")

[Paste project brief / design docs summary / roadmap here.]

---

## End of paste block

---

## After the agent responds (user checklist)

1. **Skim for depth.** Does each specialist in Section 3 have a density that matches its domain — **8+ bullets for quirk-dense platforms**, **5+ bullets for standard-stack domains**, **at least 5 concrete bullets as the universal hard qualifier** — with concrete API names / config keys / formulas? If not, push back — a one-line "handles GPU stuff" specialist is useless. A 6-bullet standard-stack specialist with real pitfalls beats a 10-bullet specialist padded with generic advice; apply the fake-specialist failure-modes checklist in Section 3 to decide.
2. **Check the never-touches lists.** Every specialist must explicitly disclaim the files other specialists own. Silent overlaps produce merge conflicts during parallel dispatch.
3. **Run the 1M Opus gate.** `agents.json` must have **no `model` field** for `pm` / `arch` / `review`. Any explicit model there silently downgrades them to 200K context.
4. **Verify the matrix has an Abstract block** for every design doc — `Load when:` keyword lists are what makes forks cheap.
5. **Diff against `PM.md` Bootstrap Checklist.** The bootstrap checklist in Section 10 of the output should map 1:1 to `PM.md`'s steps, with project-specific fills.
6. **Apply via `init.sh` (optional) then hand-fill.** `init.sh` is scaffolding that ships in the `claude-task-router` seed repo — **it is not a prerequisite for your own consumer project**. If you have a fresh clone of the task-router seed available, run `init.sh` for the baseline (skills, templates, rules INDEX.md, matrix stub). Otherwise, produce the same baseline by copying the skill templates from `PM_TEMPLATES.md`, the Rules INDEX template, and the matrix stub directly into your consumer project. Either way, the hand-fill step is the same: edit the skill files per Section 3, paste the matrix per Section 6, set up `agents.json` per Section 4. `init.sh` does **not** produce this plan's content — that is the point of this prompt.

7. **Incremental bootstrap — verify the plan declared the mode.** If your project already had `.claude/skills/` or `.claude/mcp/task-router/agents.json` before this bootstrap round (typically from a prior `init.sh` run or a partial earlier bootstrap), the plan's Section 10 should declare "Incremental bootstrap" at the top and annotate each file-write step with `[APPEND]` or `[FRESH]`. If it instead reads as a clean-slate checklist, push back: *"The project has existing `.claude/skills/pm/SKILL.md` from a prior `init.sh` run. Re-emit Section 10 in Incremental mode — inject project knowledge under a `## Project Knowledge (injected)` anchor rather than overwriting the default SKILL.md files."* Overwriting an `init.sh`-generated SKILL.md loses the canonical Startup Sequence and Task File Mode sections.

If the agent's draft is thin, paste it back with: "Expand Section 3 (agent roster) — every domain specialist needs **at least 5 concrete SKILL.md domain-knowledge bullets** (API names, config keys, formulas, pitfalls), targeting **5–8 for standard-stack domains** and **8–15 for platform-quirk-dense domains**. Current bullets are too generic." Iterate until depth is there.
