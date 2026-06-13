# /ha — Agent Guidelines
**Last Updated:** 2026-06-13

## Abstract

**TL;DR:** Durable, project-specific guidelines for the `/ha` agent (Home
Assistant integration — bidirectional REST/WebSocket/MCP bridge with an inbound
confirmation gate). This file is the agent's **only** sanctioned write target
for notes that should survive across sessions. The agent appends here **only
when PM or the user explicitly asks** — never as a side effect of doing work.
Resolved transport choices, entity-exposure conventions, and the safety-gate
policy live here once formalised; live design detail stays in
`doc/design/ha_integration.md`.

**Load when:** the `/ha` agent starts a session, or when PM is auditing roster
consistency via `/pm audit`.

**Key facts:**
- Owner: `/ha` (Primary), `/pm` (Secondary) — per DOC_OWNERSHIP_MATRIX.md
- Write trigger: explicit PM/user request only, gated through `/review` consolidation. Cite the request verbatim in the commit message.
- All other auto-memory writes by specialists are forbidden (see SKILL.md `## Memory Policy`).
- Design source of truth (not this file): `doc/design/ha_integration.md`.

**Owner:** `/ha` (Primary per DOC_OWNERSHIP_MATRIX.md)
**Related:** `.claude/skills/ha/SKILL.md`, `doc/design/ha_integration.md`, `DOC_OWNERSHIP_MATRIX.md`

---

## Conventions

- **Env-var expansion in `.mcp.json` is process-env only.** Claude Code
  substitutes `${HA_BASE_URL}` and `${HA_TOKEN}` from the environment of the
  running `claude` process — it is NOT a dotenv loader. If the vars are absent,
  the `home-assistant` MCP server will not authenticate against HA; diagnose
  this as a connect-time auth failure (no successful tool calls), not as a
  Claude Code-level error. Launchers (`start-majordomos.ps1`, `.sh`, `.command`)
  must load `.env` before invoking `claude`; the launchd plist must have
  `EnvironmentVariables` populated at provision time. (Launcher/secret wiring
  owned by `/ops`.)

- **HA-side entity exposure IS the v1 safety boundary on the MCP path.** There
  is no Majordomus-side whitelist for MCP-path outbound calls — the operator
  controls which entities the HA MCP Server integration exposes. The
  confirmation gate applies to inbound (HA→Majordomus) requests and to outbound
  calls against withheld domains via the gated loopback executor. The
  canonical tier tables + gate design live in
  `doc/design/ha_whitelist_gate.md` (summarised in
  `doc/design/ha_integration.md § Safety boundary`) — reference those docs;
  do not duplicate the lists here (update them when the tiers change).

- **ha-bridge.js executor — entry-point contract (`/app` wires this, loopback-only).**
  `loadWhitelist()` once at server startup; then:

  | Export | Signature | Returns |
  |---|---|---|
  | `loadWhitelist(filePath?)` | validates + caches whitelist | whitelist object |
  | `classify(domain, service, entity)` | resolver (see precedence below) | `'A'` \| `'B'` \| `'C'` |
  | `classifyCustomTool(name)` | classifies non-domain HA custom tools | `'A'` \| `'B'` \| `'C'` |
  | `mintConfirmId()` | UUIDv4 — 122-bit CSPRNG (N1: unguessable confirm secret) | UUID string |
  | `executeApprovedAction({domain, service, entity, data?})` | loopback executor — hard-refuses C/Critical/unknown before any HTTP; trusts PM invocation for Tier-B approval bit (N5/G3) | `{ tier, status, data }` |
  | `classifyEntity(entity)` | **service-agnostic** body-entity classifier (Critical-floor → per-entity override → domain-default → fail-closed C). **Use this for bare entity_ids extracted from an automation/script body; do NOT use `classify`** (it needs a `service` arg and mis-handles a bare entity_id). | `'A'` \| `'B'` \| `'C'` |
  | `executeConfigWrite({op, payload, confirm_id}, capToken)` | gated config-write verb — **cap-token validation is STEP 1, before any HA I/O**. Supported `op` set (`CONFIG_WRITE_OPS`): `helper_create\|update\|delete`, `template_sensor_create\|delete`, `automation_upsert\|delete`, `script_upsert\|delete`, `undo_config_write`; anything else ⇒ `[UNSUPPORTED-OP]`. | see config-write contract below |

  *(`classify`/`classifyEntity` take the loaded whitelist as an implicit module-cached final arg; the signatures above omit it.)*

  `/app` mounts `executeApprovedAction` as a loopback-only POST route. **PM's runtime call contract:**

  ```
  POST http://127.0.0.1:3101/api/ha/execute
  Body: { domain, service, entity, data? }

  200  { ok: true,  tier, status, data }   — action executed
  403  { ok: false, error }                — [HARD-REFUSE]: Tier-C / Critical / unknown
  502  { ok: false, error }                — HA transport error (network / 4xx from HA)
  ```

  **Config-write contract** (`ha_devops` is the only caller; cap-token required — distinct path from `/execute`):

  ```
  POST http://127.0.0.1:3101/api/ha/config-write
  Authorization: Bearer <ha_devops cap-token>
  Body: { op, payload, confirm_id }

  200  { ok: true,  op, applied, audit_id, created_disabled, overwrote }
  400  { ok: false, error }   — [UNSUPPORTED-OP]
  401  { ok: false, error }   — [CAP-TOKEN]: absent / invalid / stale token
  403  { ok: false, error }   — [BODY-SCAN-DENY]: body-scan hard-deny — DISTINCT from [HARD-DENY]
  403  { ok: false, error }   — [FLEET_ENABLE_DENY]: cause-to-fire (any of the 7 forms)
  403  { ok: false, error }   — [HARD-DENY]: disable-scope / NEW-1 overwrite protection
  502  { ok: false, error }   — HA transport error
  ```

  `[BODY-SCAN-DENY]` and `[HARD-DENY]` are **distinct** 403 sentinels — do not conflate when reporting.
  Attach-don't-restart pattern applies (no 409); port overridable via `HA_EXEC_PORT` (default 3101).

- **Resolver precedence — `classify(domain, service, entity) → tier`.** Most-specific wins:
  1. **Critical-entity list** — hard Tier-C floor (M7: per-entity allow cannot lift a Critical entity; only `promote_critical: true` raises it to Tier B, never A; git-reviewed only, never runtime-settable).
  2. **Per-entity override** (non-Critical entities only).
  3. **Domain+service override** (e.g. `cover.stop_cover → A` — abort is always safe).
  4. **Domain default** (`fleet/ha_whitelist.json` `domain_defaults` map).
  5. **Fail-closed → Tier C.** Unknown domain/entity/anything unclassified ⇒ deny.

- **`fleet/ha_whitelist.json` schema conventions.** Top-level keys (current v1 schema):

  | Key | Purpose |
  |---|---|
  | `version: 1` | **Required** — loader throws `Unsupported whitelist version` without it. Bump to gate breaking schema changes. |
  | `glob_support: true` | Enables trailing-`*` prefix entity matching. When `false`, the loader **MUST reject** any `*`-containing entry — a non-glob loader silently matches nothing, silently de-classifying Critical entities (M5 hard requirement). |
  | `ttl.inbound_seconds: 120` | Confirm TTL for HA-originated (inbound) Tier-B requests. |
  | `ttl.outbound_seconds: 300` | Confirm TTL for PM-initiated outbound Tier-B actions (operator may be away). |
  | `critical_entities` | Hard Tier-C floor. Each entry `{ entity_id, operator_finalize: true, promote_critical?: true }`; `promote_critical` only promotes to Tier B, git-reviewed only. |
  | `domain_defaults` | Primary tier map by HA domain (`light→A`, `cover→B`, `lock→C`, …). Fallback after Critical + per-entity checks. |
  | `domain_service_overrides` | Per-`(domain, service)` tier exceptions (e.g. `cover.stop_cover → A`). Beats `domain_defaults`. |
  | `custom_tools` | Tier map for custom HA MCP tools with no HA domain (e.g. `set_shutters_to_min_light → B`). |
  | `per_entity_overrides` | Allow/deny overrides for specific non-Critical entities (e.g. `script.goodnight → A`). Cannot lift a Critical entity (M7). |

- **Custom HA MCP tools bypass the domain classifier — hunt them explicitly.**
  Tools like `set_shutters_to_min_light` are custom HA integrations, not standard `Hass*`
  intents; they are not reachable via `domain_defaults`. Classify with `classifyCustomTool(name)`.
  In v1 exposure pruning, **list them explicitly in the runbook** — a "remove all destructive
  `Hass*` tools" sweep silently leaves custom tools live (W3, design §3.2).

- **`fleet_enable_deny` — 7 cause-to-fire forms (not "enable-only").** Hard-denied at both the
  requested-service check AND the in-body recursive body-scan (§4(i) — an upserted body that itself
  calls a deny-listed service is refused). "Enable-only" is bypassable (`automation.trigger` fires a
  *disabled* automation; `script.toggle` starts a stopped script). Full list + rationale:
  `doc/design/ha_config_write.md` §3.3 — hold the **7-form** footprint, do not re-narrate it here.

- **Automation upsert force-disable.** `automation_upsert` force-injects `initial_state:false` on the
  resolved body (create AND update) + verify→`automation.turn_off` backstop + `state_anomaly` audit;
  `script_upsert` skips it (the run-deny is the whole control for scripts). Spec: `ha_config_write.md` §3.1.

- **NEW-1 overwrite-protection — GET-first prior-body classify.** `automation_upsert`/`script_upsert`
  onto a pre-existing object whose *prior* body references a **deliberate** Critical entity ⇒ `[HARD-DENY]`,
  even with a benign new body (`scanBody(prior)` runs first; blocks "launder a neuter" of a safety interlock).
  A genuine create (`prior === null`) is unaffected. **`_isDeliberateCritical` discriminator (commit 11f1d73):**
  gates only on entities that are *deliberately* Critical — (a) the `critical_entities` list (exact + glob),
  (b) `per_entity_overrides` with `tier: C`, or (c) `domain_defaults` with value `C` (e.g. `lock.*`,
  `alarm_control_panel.*`). **Does NOT fire on fail-closed-unknown Tier-C** — domains absent from
  `domain_defaults` (`sensor.*`, `input_number.*`, `binary_sensor.*`, …) that `classifyEntity` floors to
  Tier C because they are unclassified are NOT safety interlocks and MUST NOT gate delete/upsert. A passive
  battery-capacity calculator referencing only `sensor.*`/`input_number.*` is freely replaceable.
  Spec: `ha_config_write.md` §3.4 / §5.2-4.

- **WS client is command-type scoped — never `call_service`.** The one-shot WS client (`_scopedWsSend`)
  rejects any `type` outside the enumerated config-command set **at the client boundary, before any network
  I/O** (`[WS-SCOPE-VIOLATION]`). A `{type:"call_service"}` payload over WS would reach HA and bypass the
  REST `classify()` + `fleet_enable_deny` gate. The guard must run first in every send path — **including
  when `opts.wsCmd` is injected in tests** (structural, not test-bypassable).

- **Execute-time prior capture for drift-safe undo.** Capture `prior` + `prior_hash` **immediately before
  the write**, not at PM's confirm-time (a confirm-time snapshot is stale if a concurrent change lands).
  Undo drift check: GET current config, compare `sha256(current) === post_hash` (the recorded post-write
  hash); mismatch ⇒ `[UNDO-DRIFT]` refuse and surface to PM.

- **§5.5 standing constraint — no raw out-of-band trigger verb.** Never add a raw event-fire
  (`POST /api/events/<type>`), MQTT-publish, or Supervisor verb: any of them can trip a *pre-existing,
  enabled* automation (via `platform: event`/MQTT trigger) without calling an automation service at all,
  bypassing `fleet_enable_deny` entirely. The WS `call_service` ban is the same family. **Any such addition
  requires fresh `/review`.** Full text: `ha_config_write.md` §5.5.

- **Storage-based helper delete/undo — two-step WS resolve.** `input_number`,
  `input_boolean`, `input_text`, `input_select`, `input_datetime`, `input_button`,
  `counter`, `timer`, `schedule` (the **9** storage-backed helper types in
  `WS_ALLOWED_TYPES`) carry `config_entry_id: null` — they cannot be deleted via a
  config-entry `entry_id`. Delete (and `undo_config_write` of a `helper_create`)
  requires a two-step WS resolve: (1) `<type>/list {}` → match the entry by the
  **normalized** entity_id (`e.entity_id.toLowerCase()`, or construct `<type>.<e.id>`);
  (2) `<type>/delete { <type>_id: <match.id> }` — the key is e.g. `input_number_id`,
  **NOT** `entity_id` and **NOT** `entry_id` (HA hard-errors on the wrong key:
  `extra keys not allowed @ data['entity_id'] … required key not provided @
  data['input_number_id']`). Fail-closed on **no** match (`[HELPER-NOT-FOUND]`);
  duplicate entity_ids cannot occur (HA enforces entity_id uniqueness), so the
  `.find` takes the single exact match.

- **`template_sensor_create` uses HA REST config-flow — WS `config_entries/flow/*`
  is unsupported** (`config_entries/flow/init` → `{"code":"unknown_command"}`).
  Three-step flow (verified live):

  | Step | Request | Response |
  |---|---|---|
  | init | `POST /api/config/config_entries/flow {"handler":"template"}` | `{type:"menu", flow_id, step_id:"user"}` |
  | select | `POST /api/config/config_entries/flow/<flow_id> {"next_step_id":"sensor"}` | `{type:"form", step_id:"sensor", last_step:true}` |
  | submit | `POST /api/config/config_entries/flow/<flow_id> {name, state, unit_of_measurement?, device_class?, state_class?}` | `{type:"create_entry", entry_id}` |
  | abort | `DELETE /api/config/config_entries/flow/<flow_id>` | best-effort on any error — no orphan flow |

  NEW-1: `_slugify(name)` → `sensor.<slug>`, `GET /api/states/sensor.<slug>` before
  init, hard-deny if pre-existing + Critical. Body-scan (`_scanTemplateSensor`):
  extract entity refs from `state`/`name`/`availability`, classify via `_isCritical`;
  template sensors are read-only (state templates cannot call services) so `hard_deny`
  is **always false** — `critical_refs` are surfaced to the audit record / Telegram
  confirm banner, not denied.

- **Entity-id normalization invariant — all mutation paths, before `_isCritical`.**
  Build `` `${helper_type}.${(object_id||'').trim()}`.toLowerCase() `` — trim the
  **object_id segment before concatenation**, then lowercase the full result. An
  outer-string trim (`` `${x}.${y}`.trim() ``) is insufficient: it leaves *interior*
  whitespace (`" master_safety"`) that makes the Critical check silently miss. After
  the check passes, bind every subsequent I/O (list → resolve → delete) to the
  **same** normalized entity_id that cleared the check — no TOCTOU; the resolve step
  runs **after** the Critical check, never before. Fail-closed on no match.

- **Automation/script REST config API — `object_id` is the numeric internal ID, NOT the slug.**
  `GET/POST/DELETE /api/config/automation/config/<object_id>` expects the **numeric** config ID
  (e.g. `1773779229092` for `automation.battery_state_of_health_calculator`), not the slug
  (`battery_state_of_health_calculator`). Using the slug 404s on GET → the executor treats it as a
  genuine create → **duplicate** object instead of an overwrite (bit both a helper and an automation
  this session). Resolution (GET-first, mandatory for updates and deletes): `GET /api/config/automation/config`
  (list all) → match by `alias` → extract the numeric `id`. Same two-round resolve as the WS helper
  pattern (`<type>/list` → match entity_id → use `id`). For creates, HA generates the numeric id.
  Same applies to the script config API. Never assume `slug == numeric id`. *(Endpoint mechanics are
  /ha-verified implementation detail; the durable invariant is "object_id is numeric, GET-first".)*

- **Known executor debt (recorded to prevent re-discovery):**

  | Item | Risk | Location |
  |---|---|---|
  | `template_sensor_delete` still uses WS `config_entries/remove` | untested against live HA; may break if HA drops that WS command | `_templateSensorDelete` |
  | `_slugify` uses `[^a-z0-9]+→_` — diverges from HA's Python `slugify` | NEW-1 false negatives on non-ASCII sensor names (accented / CJK) | `_slugify` |
  | `_scanTemplateSensor` misses the `states.<domain>.<object>` dotted attribute-access form (and does not expand `group.*`/`expand()` membership). The function-call forms `states('x.y')`, `is_state('x.y',…)`, `state_attr('x.y',…)` and the bracket form `states['x.y']` ARE caught. | Critical refs written in the dotted form won't appear in `critical_refs` (label-only — read-only ⇒ no safety action) | `_scanTemplateSensor` |
  | `undo_config_write` of a `helper_create` has no drift check | storage helpers have no REST-readable `post_hash`; concurrent edits between create and undo go undetected | `_executeUndo` helper_create branch |
  | `availability` template scanned for Critical refs but not forwarded to HA | the config-flow sensor form doesn't accept `availability`; the field is silently dropped | `_templateSensorCreate` |

## Decisions

- **2026-06-09 — Q-HA-TRANSPORT: RESOLVED → official HA MCP Server (SSE).**
  Majordomus is the MCP client of Home Assistant's "Model Context Protocol
  Server" integration. Endpoint: `${HA_BASE_URL}/mcp_server/sse`. Client wiring:
  `.mcp.json` `home-assistant` entry, `type: "sse"`. No custom `ha-bridge.js`
  for the **outbound** path — superseded (ha-bridge.js is still in scope for the
  inbound gate). Full rationale in `doc/design/ha_integration.md § Transport`.

- **2026-06-09 — Q-HA-WHITELIST: RESOLVED → three-tier default-deny gate.**
  Operator-approved + twice `/review`-audited. Authoritative design + tier
  tables: `doc/design/ha_whitelist_gate.md`. Model: **tier == reachability
  path** — Tier A exposed on the MCP Server (auto); Tier B NOT exposed,
  reached only via the gated loopback ha-bridge executor with a PM-correlated
  Telegram confirm (unguessable `confirm_id` + `from_agent=="telegram"`,
  delete-before-execute, server-time TTL 120 s/300 s, no-reply ⇒ never runs);
  Tier C neither exposed nor bridged (alarm/lock/Critical `switch.*`/unknown),
  READ-only via REST `GET /api/states`. Critical-entity list is a hard Tier-C
  floor in git-reviewed `fleet/ha_whitelist.json` (operator finalises exact
  entity_ids). Rollout: v1 zero-code exposure-pruning
  (`doc/runbooks/ha_v1_exposure.md`); **v2 gate core BUILT (2026-06-09):**
  `fleet/ha_whitelist.json` (tier map + Critical list + TTL defaults),
  `majordomus-daemon/src/ha-bridge.js` (resolver + loopback executor +
  confirm_id mint), 36 tests passing. Entry-point contract + schema conventions:
  see § Conventions. PM confirm-correlation (save_memory, reply-parsing, TTL,
  N2 channel-bind, delete-before-execute) remains **PM policy — not /ha code**.
  Accepted defaults: vacuum=B, media=confirm-after-hours, lock/alarm stay C,
  `set_shutters_to_min_light`=B, TTL 120/300.

- **2026-06-10 — Q-HA-CONFIGWRITE: RESOLVED → gated config-write executor + `ha_devops` runtime layer.**
  Operator-approved; `/review` 8.5/10 ("linchpin AIRTIGHT"). Authoritative design: `doc/design/ha_config_write.md`
  (v4). Key outcomes: (1) `/ha` owns `executeConfigWrite` in `ha-bridge.js` — cap-token-gated verb to
  create/update/delete helpers, template sensors, automations, scripts; (2) `ha_devops` is the runtime-only
  deployer (Mode-4-only, `no_fork`, per-session cap-token in `fleet/ha_devops_session.json`); (3) agent-created
  automations deploy **force-disabled** + verified; (4) the fleet is hard-denied from ever causing any
  automation/script to fire (7 `fleet_enable_deny` forms); (5) NEW-1 overwrite-protection guards pre-existing
  Critical interlocks; (6) drift-safe undo via append-only `fleet/ha_config_audit.jsonl`. **Scope = config-writes
  only** — Tier-B service calls keep the existing PM Telegram path. Entry-point + sentinel contract: see § Conventions.

## Open Questions

- **Critical-entity list finalisation — OPEN (operator).** Exact `entity_id`s
  for the Tier-C Critical list (breakers, PV/charger contactor, water valve,
  door lockdown/evacuation, main-entrance-lock relay, `visonic_p1_*`, intercom
  door relay) must be confirmed by the operator + siblings hunted, then written
  to `fleet/ha_whitelist.json`. Seed list in `doc/design/ha_whitelist_gate.md §3.3`.

- **Env-loading gap for always-on path — RESOLVED (`/ops`, 2026-06-09).**
  `host/launchd/com.majordomus.taskrouter.plist` (Task Router app) and
  `host/launchd/com.majordomus.telegram.plist` (Telegram bridge) created as
  templates with `__INJECT_AT_PROVISION__` sentinels. `host/provision.sh
  --inject-secrets` reads root `.env` + `.claude/mcp/telegram-bridge/.env`
  and patches both plists via PlistBuddy at provision time (secrets never
  committed). Full wiring doc: `doc/design/host_ops.md`.
