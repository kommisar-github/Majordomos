# LOCAL_MODEL_BACKEND_PLAN — local Gemma backend specialist

**Last Updated:** 2026-07-18
**Owner:** `/pm` (Primary) · **Status:** PROPOSED (runner artifacts present; blocked on launch wiring + operator go)

## Abstract

**TL;DR:** Adds one **narrow local-model `backend` specialist** to the Majordomus fleet, running on
the already-resident **`google/gemma-4-12b-qat`** LM Studio instance at `127.0.0.1:1234`. Its sole
initial job is **Telegram NL → structured Home-Assistant service call** — a bounded, `json_schema`-forced
mapping on the command hot path. It is justified by **privacy + offline capability** (commands never
leave the LAN, works if the cloud is down), not by token savings. The HA safety gate remains the
authority: the local model *assists* classification, the **default-deny executor + Tier-B confirm** still
decide. Governed by the `PM_LOCAL_BACKENDS.md` task-shaping contract (route by output SHAPE, bound
input+output, `/review` consequential outputs).

**Load when:** wiring the local backend, scoping what it may do, or auditing its safety boundary.

**Key facts:**
- Model: `google/gemma-4-12b-qat` (4-bit QAT, Q4_0) — the **quantized** build. The unquantized
  `google/gemma-4-12b` needs ~8.6 GB and will NOT load alongside the always-on daemon on this 16 GB Mac.
- Endpoint: `http://127.0.0.1:1234/v1` (LM Studio, loopback, this host). Note: `.132` is **this Mac's own `en1` interface** (`en0`=`.126`), not a separate device — the model host *is* this host, reached via loopback. (An `endpoint` may point at any reachable OpenAI-compatible URL; only the CLI-based harness runner must live on the fleet host.)
- Runtime `local-runner.js` (resident-poll backend runner) **and** `harness-runner.js` **are present** in `.claude/mcp/task-router/` (synced 2026-07-09). The remaining blocker is the app/extension launch wiring (§5), not the runner artifacts.

---

## 1. Empirical validation (2026-07-08)

Four bounded `json_schema`-forced calls against the loaded `google/gemma-4-12b-qat`, `temperature:0`:

| Task | Prompt | Output | Verdict |
|------|--------|--------|---------|
| NL→HA map | "dim living room to ~30%" | `{light, turn_on, light.living_room_lights, 30}` | ✅ correct |
| Specialist routing | "swarm federation token expired, rotate" | `{"agent":"ops"}` | ✅ correct |
| Safety tier | "unlock the front door" | `{"tier":"C"}` (deny) | ✅ correct |
| Safety tier | "set bedroom thermostat 21°" | `{"tier":"B"}` (confirm) | ✅ correct |

Latency ~2–4 s/call. `strict:true` schema honored; model is `tool_use`-capable, 8192 ctx loaded.
**Caveat:** 4 hand-picked passes are a smoke test, not a validation suite — see §4 safety boundary.

## 2. Capability envelope for THIS fleet (C-PM-TASKSHAPING)

Route by **output SHAPE** per `PM_LOCAL_BACKENDS.md`. For Majordomus specifically:

| Route to local (✅) | Keep on Claude (❌) |
|---|---|
| Telegram NL → structured HA call (bounded entity/service enum) | Wave/dispatch planning, diagnostic trees, errata application |
| Request → specialist routing (enum) | Any `/app` `/ha` **code**; `/arch` designs; `/review` verdicts |
| Routine status summarization (<2000 chars, bounded) | Consolidation-gate judgments; the federation second-gate |
| Inbound triage / tagging (capped vocabulary) | HA config-write confirm logic; anything where wrong-but-valid is costly |

> **Note (v4.33+):** the code ❌ is a **model-capability floor**, not an absolute local-vs-Claude line — per the current `PM_LOCAL_BACKENDS.md`, coding needs a **dense ~31B**; a 12B (or a low-active-parameter MoE) fails, often *silently*. It stays ❌ for **this** 12B QAT backend; a larger dense local model could revisit it via the Agent-Evolution economic test.

**The four shaping rules bind every routed task:** (1) whitelist by capability, (2) bound the OUTPUT
schema (enums / typed scalars / `maxItems` / `maxLength`), (3) bound the INPUT (shortlist the entity
set upstream — never hand it the full registry; prefill latency is fatal), (4) `/review`-gate
consequential outputs.

## 3. Agent spec

**New Agent Proposal**

- **Name:** `hacmd` (→ `/hacmd`)
- **Trigger:** New project domain — a local-model backend enters the fleet (Technology boundary).
- **Domain:** bounded NL → structured Home-Assistant service-call mapping on the Telegram command path.
- **Role:** `specialist`, local `backend` (not a Claude terminal, not a coordinator).

**Initial scope (start narrow):** `capabilities: ["ha-nl-map"]` only. Routing and summarization are
*candidate* future capabilities (§6) — do NOT bundle them in v1; prove the hot path first, expand by
the Agent-Evolution economic test.

**`agents.json` entry:**

```jsonc
"hacmd": {
  "role": "specialist",
  "capabilities": ["ha-nl-map"],
  "backend": {
    "kind": "openai-compatible",
    "endpoint": "http://127.0.0.1:1234/v1",
    "model": "google/gemma-4-12b-qat",
    "api_key_env": "LM_STUDIO_API_KEY",
    "driver": "minimal"
  }
}
```

`api_key_env` names an env var, never the key (LM Studio local usually needs none — set a dummy if the
server requires a bearer). No `model` tier field (coordinators-only rule N/A — the backend model IS the pin).

**Bounded output schema (the ONE the runner forces):**

```jsonc
{ "type": "object", "additionalProperties": false,
  "required": ["domain","service","entity","brightness_pct"],
  "properties": {
    "domain":  { "type":"string", "enum":["light","switch","climate","cover","fan","media_player","scene","input_boolean"] },
    "service": { "type":"string", "maxLength": 40 },
    "entity":  { "type":"string", "maxLength": 80 },
    "brightness_pct": { "type": ["integer","null"] }
  } }
```

Input is **shortlisted** upstream: PM/ha-bridge resolves a candidate entity set (room/area match) and
passes only that small list in the system prompt — not the whole HA entity registry.

## 4. Safety boundary (non-negotiable)

The local model **assists, it does not decide**. Even at 4/4 on the smoke test:

- **The executor stays the hard floor.** `hacmd`'s output is a *proposal*; the existing default-deny
  executor (`/api/ha/execute`) and Tier-C hard-refusal are unchanged and authoritative. A local
  misclassification cannot lift a Tier-C deny.
- **Tier-B confirm still fires.** Any cover/climate/script/cross-project write still goes through the
  PM §H1 Telegram confirm correlation (N1–N6) before execution. `hacmd` never bypasses it.
- **`hacmd` never touches config-writes.** HA config-write mediation stays with `ha_devops` (cap-token,
  Mode-4). Out of `hacmd`'s scope entirely.
- **`/review`-gate before trust.** Before `hacmd` output drives any action unattended, run a bounded
  validation set through `/review` (not 4 examples — a real suite covering deny/confirm edge cases).

## 5. Wiring steps (in order)

1. **Runtime present, launch wiring pending.** `local-runner.js` + `harness-runner.js` are already synced
   into `.claude/mcp/task-router/`; what remains is the app/extension **launch wiring** that spawns the
   runner as a resident poller (via the VSIX install or a `--reseed` of the runtime). Confirm the launcher
   maps the `agents.json` backend block → runner process before relying on it.
2. **Pin `google/gemma-4-12b-qat` as always-loaded** in LM Studio (JIT + keep-loaded) so it survives a
   restart and the daemon never races a cold load.
3. **Add the `hacmd` block** to `.claude/mcp/task-router/agents.json` (§3). Add `LM_STUDIO_API_KEY` to the
   gitignored env if the server requires a bearer.
4. **Register the doc + roster:** `doc/hacmd_GUIDELINES.md` (abstract-first), `.claude/rules/hacmd.md`,
   `.claude/SKILLS.md` row, `DOC_OWNERSHIP_MATRIX.md` row. (A local backend has no SKILL.md persona — it is
   fulfilled by `local-runner.js`, not a Claude terminal.)
5. **Validate via `/review`** with a real bounded test set before it drives anything unattended (§4).

## 6. Open questions / risks

- **Memory headroom.** QAT co-loads today at ~32–47% free, but the always-on daemon is the priority — if
  memory pressure spikes, LM Studio can refuse a reload or the server can drop (observed once this session).
  Decide: is co-location acceptable, or does the model belong on a dedicated host long-term?
- **Scope creep.** Routing + summarization are tempting to add — hold them until the HA hot path is proven
  and each passes the Agent-Evolution economic test (≥5 concrete domain bullets, ≥20% dispatch volume).
- **Model swap.** `qwen3.5-9b` / `qwen3.6-14b-a3b` are alternatives if Gemma QAT underperforms on the real
  suite; the `backend.model` field is a one-line swap.
- **Input-bounding discipline.** The single biggest footgun is handing the model an unbounded entity list
  (prefill latency → minutes). The upstream shortlist in step §3 is mandatory, not optional.

## 7. Verdict

**Recommended, narrowly.** Add `hacmd` for HA NL→command mapping only, on the QAT model, behind the
unchanged safety gate, justified by privacy + offline. Blocked on `--reseed` and an operator go.
