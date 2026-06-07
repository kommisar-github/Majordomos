# Task Router seed feedback — consumer template

## What this is

A copy-paste template for producing a feedback document after your project has bootstrapped with the Task Router seed (`BOOTSTRAP_PROMPT.md` + `PM.md` + `PM_TEMPLATES.md` + `init.sh`). The resulting doc is what the maintainer ingests into [`doc/seed/CONSUMER_FEEDBACK.md`](CONSUMER_FEEDBACK.md) — a well-structured input shortens the triage loop from hours to minutes and makes the difference between *"nice note, some of this may ship"* and *"17 items shipped in one release, nothing dropped."*

Hand this template to an agent on your side (your project's PM agent, a general-purpose agent, or your own note-taking) to produce the feedback doc, or fill it yourself. The final doc is consumer-private — the maintainer strips identifying names and copies the shape into the shipped log.

## Why structure matters

Unstructured feedback loses items. A maintainer reading *"a few things worked and a few things didn't, here are some thoughts"* has to do three jobs — parse out discrete items, classify severity, and decide what's actionable. Structured feedback has already done the first two and leaves only the third. The seed's own oscillation-check protocol (see [`CONSUMER_FEEDBACK.md`](CONSUMER_FEEDBACK.md) → *How to Use This Log* → *Check for oscillation*) operates on discrete classified items — prose forces the maintainer to invent the structure before they can apply the protocol, and some items get dropped in the translation.

Consumers who produce feedback in this shape have landed 15+ items per release with zero drift. Consumers who produce prose have landed 3–5 items per release with the rest becoming "maybe next round" and often forgotten.

---

## Template — copy everything below this line into your feedback doc

```markdown
# Consumer feedback — Task Router bootstrap seeding round

**Date:** YYYY-MM-DD
**Source artifacts:** `BOOTSTRAP_PROMPT.md` v<version>, `PM.md` v<version> (<date>), `PM_TEMPLATES.md` v<version> (<date>), extension v<extension-version>. (Version numbers live in the file headers or CHANGELOG.)
**Produced:** Describe in one or two lines what your bootstrap round produced — scale (agent count, doc count, chapter count), shape (single-repo / multi-platform / scripting-platform-monolith / etc.), domain density (standard-stack / quirk-dense / platform-specific).
**Signal classification:** Default every item below to **Additive** unless you have evidence from `CONSUMER_FEEDBACK.md` that a prior round addressed the same section. If you have not read the feedback log, say so — the maintainer re-classifies on ingestion using the five-way protocol (Additive / Reinforcing / Extending / Oscillating / Stale-draft reaction). See note below.

---

## What worked — please keep / reinforce

**(Required — do not skip this section.)** List the things that landed cleanly enough that you want them named so they don't get softened in a future revision. This block is load-bearing: refinement rounds drift toward "what's wrong," and without explicit reinforcement signal, things that are working get refined-away by accident. Aim for 5–10 bullets.

- **<Short named concept>** — one or two sentences on why it landed, what it prevented, or what it replaced. **Reinforcing** / **Additive-preservation**.
- **<...>**
- **<...>**

---

## Friction — severity-rated and actionable

**De-duplicate across severity buckets.** A given item belongs in exactly one bucket — do not list "project invariants" in both MEDIUM and in "Suggested additions." Pick the most actionable framing and put it once.

### HIGH — blocks or materially slows a producer agent

**H1. <Short item name — half a sentence>.** One paragraph describing the concrete friction: what you were trying to do, what blocked you, what you had to do instead, and what it cost (time, context, missed detail). Use file paths (`PM_TEMPLATES.md:1194`), version numbers (`post-v0.3.18`), and numeric metrics where possible.

*Proposed fix:* One concrete fix. If you have two candidates (a minimum fix vs. a structural fix), state both and flag which you prefer. If the fix is genuinely a maintainer-side design decision, say so rather than prescribing.

**H2. <...>.** <...>

**H3. <...>.** <...>

### MEDIUM — would improve output quality or reduce consumer friction

**M1. <Short item name>.** <Paragraph.>

*Proposed fix:* <Concrete fix.>

**M2. <...>.** <...>

### LOW — polish suggestions

**L1. <Short item name>.** <Shorter paragraph — polish items warrant less prose.>

*Proposed fix:* <One-liner is fine.>

**L2. <...>.** <...>

---

## Possible documentation bugs

**(Optional — include only if relevant.)** Separate from friction items, because these are "document says X, reality is Y" rather than "the design could be better."

- **<Doc:file:line or Doc:section>** — <one-line description of the apparent bug>. Note if you're uncertain whether it's really a bug vs. your misreading; maintainer confirms on ingestion.

---

## Suggested additions

**(Optional — include only if relevant.)** New patterns you wanted and didn't find. Distinct from friction (where the current seed has a concrete blocker) — these are gaps where the seed is silent.

**A1. <Short name of pattern>.** <Describe the pattern, where you'd expect it to live, what problem it would solve, and a rough sketch of the shape (doc structure / heading scheme / rule).>

**A2. <...>.** <...>

---

## What not to change — explicit preservation

**(Highly encouraged.)** Things you want protected from future refinement. Different from "What worked" — that section reinforces; this section pre-empts future regression. Use when you suspect a future reviewer might push the opposite direction on something you found load-bearing.

- **<Short name>** — the concrete thing (wording, structure, example, rule) that should stay. One line on *why* it's load-bearing so a future round that challenges it has the prior reasoning.

---

## Numbers from this bootstrap round

**(Highly encouraged.)** Quantitative signal the maintainer uses for calibration (session-floor tables, length-tier floors, contract-count proxies).

- **Source docs consumed:** ~NK tokens (BOOTSTRAP_PROMPT.md ~NK, PM.md ~NK, PM_TEMPLATES.md via grep+offset ~NK, your project brief ~NK).
- **Output:** ~N lines, ~NK tokens. Monolithic / multi-file.
- **Agent roster:** N coordinators + M specialists = T total.
- **Interface contracts produced in §7:** N.
- **Chapters / phases in §8 wave map:** N. Mostly serial / M parallel opportunities.
- **Non-delegable waves flagged:** N (if Learning-First declared; omit if not).
- **Static pre-flight / pre-handoff checks authored:** N.
- **Time to produce the plan once source docs were loaded:** one extended conversation turn / N iterations / etc.

---

## Meta-note

**(Optional.)** One paragraph on how the feedback loop feels from your side — what you wish was different about the process itself (not the seed), anything that felt unusually good or bad about the round, or forward-looking risks you want the maintainer to be aware of that aren't item-shaped.
```

---

## End of template

Everything above the end marker is what you paste into your feedback doc. Below the marker are notes on how to fill it out — those stay here, not in your feedback doc.

---

## Pre-submission checklist

Before handing the doc to the maintainer, verify:

- [ ] **Every "gap" or "missing" item was `grep`-checked against the current seed.** A large class of feedback items turn out to be stale-draft reactions — the thing you want already exists but is (a) at a different heading level, (b) in a different file, or (c) cross-referenced from somewhere you didn't look. Five seconds of `grep -rn <keyword> PM.md PM_TEMPLATES.md doc/seed/BOOTSTRAP_PROMPT.md` per item catches most of them and re-classifies the item from "gap" to "navigability" — different fix.
- [ ] **De-duplicated across severity buckets and sections.** A given concept lives in exactly one section. If you find yourself writing *"as mentioned above in M3"* or *"see suggestion A1"*, you have a duplicate — consolidate into one bullet and drop the other reference.
- [ ] **Proposed fix per friction item.** Each item in HIGH / MEDIUM / LOW has a concrete *Proposed fix:* line. Items without a proposed fix read as complaints; items with one read as collaborative decisions.
- [ ] **"What worked" section exists and has 5+ bullets.** Without this block, a round's signal is asymmetric and the seed drifts. Include it even if the round was mostly frustrating.
- [ ] **"What not to change" section exists.** At minimum one bullet for something you suspect is under-appreciated. Load-bearing for preventing regression.
- [ ] **Scale metrics are present in the Numbers block.** Even if they feel trivial ("3-agent solo, 400-line plan") — the maintainer uses them for calibration tables (session-floor ranges, length-floor tiers). Round numbers are fine.
- [ ] **Items use stable citations.** `file:line` references, version numbers (`v0.3.18 / round 4`), exact heading text quoted in backticks. Vague pointers (*"somewhere in the prompt"*, *"the PM skill template"*) slow triage because the maintainer has to re-locate what you meant.
- [ ] **No inline conclusions of the form "and this is declined."** Let the maintainer classify and decide. Your job is to report; the oscillation-check protocol handles classification.

## Anonymization

**You do not need to pre-anonymize the consumer-side feedback doc.** The maintainer strips project names, reviewer identities, domain-specific proper nouns (library names, hardware SKUs, product codenames), and identifying file paths before the entry lands in the shipped `CONSUMER_FEEDBACK.md` log. Keeping real names in your private doc makes it easier for you to reference; the maintainer handles the anonymization on ingestion.

If you want to pre-anonymize anyway (e.g., the doc will pass through an untrusted review), replace:

- Project names / codenames → `proj-example` or a neutral placeholder.
- Domain-specific library / hardware / vendor names → generic category nouns (*"model-architecture internals,"* *"an external-API schema,"* *"embedded-hardware project"*).
- Signature file paths (`<project>/doc/DESIGN_FEATURE.md`) → scale-only descriptions (*"a ~600-line design doc"*).
- Agent names tied to a specific project (`/vlm`, `/jetson`, `/gas`) → neutral placeholders (`/core`, `/platform-a`, `/specialist`).

Scale metrics (*~9 agents, ~10 docs, multi-phase*) are fine — they are signal, not identity.

## Notes for the agent filling this out

If you are an agent filling this template on the consumer's behalf:

- **Ground every item in a concrete artifact.** File:line / exact heading text / version number. Do not generalize unless you can cite a pattern across two or more concrete instances.
- **Don't speculate past the evidence.** If you have one data point, say *"one-off, may not generalize."* Let the maintainer decide whether the sample size is enough to act on.
- **Include the quantitative data.** Count agents in `.claude/mcp/task-router/agents.json`. Count lines in the produced `BOOTSTRAP_PLAN.md`. Estimate tokens (4 chars ≈ 1 token). Numbers are signal.
- **Cross-check "possibly stale" references.** If you're flagging something as a doc bug, grep the current seed for the heading. If the heading exists at a level your initial grep missed (e.g., `###` instead of `##`), re-classify as a navigability issue, not a stale reference.
- **Do not claim an item is Oscillating** unless you have actually read the relevant prior entries in `CONSUMER_FEEDBACK.md`. Default to Additive; the maintainer re-classifies.
- **Preserve the consumer's voice in "What worked" and "What not to change."** Those sections are subjective — transcribe the consumer's framing rather than neutralizing it. The maintainer reads enthusiasm as calibration signal.

## Example of a well-structured feedback round

The sixth-round entry in [`CONSUMER_FEEDBACK.md`](CONSUMER_FEEDBACK.md) (2026-04-24) is an example of feedback produced in roughly this shape. Eighteen discrete items, explicit severity tiering, proposed fix per item, "what worked" + "what not to change" blocks, scale metrics in the numbers section, and self-classification of most items as Additive. Seventeen items shipped in a single release as a result; two deferred with explicit rationale. Prior rounds that produced less-structured feedback landed fewer items per release.
