# PM_LOCAL_BACKENDS — task-shaping for local-model agents

## Abstract

**TL;DR:** How the PM must scope and shape tasks routed to a **local-model backend agent** (an agent with a
`backend` or `harness` block in `agents.json` — e.g. an LM Studio / ~12B GGUF model). A local model *is* the
agent; it is fast, free, and private but has a **hard capability envelope**. This doc is **loaded lazily** —
only when such an agent exists — so a fleet without one pays no context for it.

**Load when:** a local `backend`/`harness` agent is present and you are about to route work to it.

**Key rule:** match the task to the envelope below, or route it to a Claude agent instead. `json_schema`
guarantees *format*, never *content* — a bounded schema is a safety control, not a nicety.

---

## The capability envelope (measured)

A ~12B local model was measured **at parity with a frontier cloud model** on the ✅ rows and **failed** on the
❌ rows. Route by **output SHAPE**, not by topic:

| Route to the local agent (✅) | Keep on Claude (❌) |
|---|---|
| **Enum / typed-scalar classification** (triage, priority, route-to) | **Multi-step / abstract reasoning** (dependency logic, planning) — it self-contradicts |
| **Structured extraction** into typed fields | **Coding** (any multi-file or non-trivial edit) |
| **Bounded mapping** (NL command → structured call) | **Open-ended generation** (free-form prose, long narratives) |
| **Short bounded summaries** | **Unbounded lists** (uncapped arrays) — it repeats/hallucinates |
| **Tagging with a capped / enum'd vocabulary** | Anything where a wrong-but-valid answer is costly |

## The four shaping rules (mandatory)

1. **Whitelist by capability.** Only route a task whose class is in the agent's `capabilities`. If in doubt,
   it is not whitelisted.
2. **Bound the OUTPUT.** Every task must be `json_schema`-outputable with a **bounded** schema — enums,
   typed scalars, `maxItems` on arrays, `maxLength` on strings. An unbounded field is a footgun: the model
   degenerates into repetition/hallucination even on an easy task. Prefer a `reason` field that is short or
   absent; route rich narration to Claude.
3. **Bound the INPUT.** Do **not** hand the model a large corpus — a big candidate list makes prefill
   latency-fatal (a full fleet listing ≈ minutes per call). Retrieve / shortlist upstream to a small set
   before dispatching.
4. **Gate consequences.** Send any **consequential** local output through `/review` before it drives an
   irreversible action — `json_schema`-valid is not correctness.

## Turnaround expectation

Turnaround ≈ **prefill(prompt tokens) + generation(output tokens)**. Small bounded tasks land in ~seconds to
low-tens-of-seconds; a big prompt blows this up via prefill. Keep both ends bounded and the local agent is a
fast, free, offline substitute for the whitelisted classes — and only those.

## Two kinds of local agent — `backend` vs `harness`

A local agent carries exactly one of these mutually-exclusive `agents.json` blocks (`backend`, `harness`, or
a custom `launcher`):

**`backend` (C-1) — one forced-`json_schema` call per task.** For the bounded classes above (classify /
extract / route / tag / summarize). Works on a ~12B.

```jsonc
"summarizer": { "role": "specialist", "capabilities": ["summarize"],
  "backend": { "kind": "openai-compatible", "endpoint": "http://192.168.1.50:1234/v1",
               "model": "gemma-4-12b", "api_key_env": "LM_STUDIO_API_KEY", "driver": "minimal" } }
```

**`harness` (C-2) — a local model drives Pi/OpenCode for agentic coding.** A resident supervisor spawns a
one-shot CLI per task through a security proxy. **`kind`** = `"pi"` (default) or `"opencode"`.
**Capability note: agentic coding is a 31B-tier task — a ~12B cannot drive the loop (it hangs), so scope a
harness agent to a capable model.**

```jsonc
"coder": { "role": "specialist", "capabilities": ["code"],
  "harness": { "kind": "pi", "endpoint": "http://192.168.1.50:1234/v1", "model": "gemma-4-31b",
               "api_key_env": "LM_STUDIO_API_KEY", "timeout_ms": 900000 } }
```

`api_key_env` is the env-var NAME, never the key. Security (SSRF allow-list on the *resolved* IP, redirect
refusal, key non-exfil, child-env scrub) is enforced inside the runner. The harness CLI (`pi` / `opencode`)
must be installed on the fleet host.

## `/pm audit`

This contract is checked **only when a local `backend`/`harness` agent is present**. A Claude-only fleet is
exempt (no findings). See `doc/plans/LOCAL_MODEL_BACKEND_PLAN.md` §2 C-PM-TASKSHAPING.
