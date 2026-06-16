---
name: sot-fleet-federation
description: Majordomus is the home SoT, federated to 3 dev fleets (swarm/dragon-vlm/jetson-protect) on 192.168.1.131:3100; wiring, gotchas, rotation-pending
metadata:
  type: project
---

**Majordomus = home Source-of-Truth (SoT).** As of 2026-06-14 Majordomus federates to
three dev fleets so PM can `remote-execute` into each fleet's PM (SoT→fleet active-pull,
ENTERPRISE_GUIDEBOOK §7). The guidebook lives locally at
`~/Work/claude-task-router-releases/ENTERPRISE_GUIDEBOOK.md` (OneDrive-synced; the operator's
`D:\…` path is the Windows mirror).

**The 3 fleets — all one multi-tenant Task Router at `http://192.168.1.131:3100`** (routed by
`?project=`; host may change per-fleet later). Registry: `fleet/fleet.config.json`
(committed, `{name, url, grant, project, tokenRef}`, tokenRef = env-var name ONLY — no raw
tokens; verify `grep -i trtok fleet/fleet.config.json` is empty):

| name (display) | project (server, **lowercase**) | grant | tokenRef env var |
|---|---|---|---|
| Swarm | `swarm` | pm = **RWE** | FED_TOK_SWARM |
| Dragon-VLM | `dragon-vlm` | pm = **RWE** | FED_TOK_DRAGON_VLM |
| Jetson-Protect | `jetson-protect` | pm = **RWE** | FED_TOK_JETSON_PROTECT |

**GOTCHA — project ids are case-sensitive + lowercase on the server.** Title case
(`Swarm`) → HTTP 404 `project_not_registered`. Always use the lowercase `project` field.

**Secrets.** Raw `trtok_` grants live ONLY in `fleet/fleet.secrets.env` (gitignored via
`*secret*` + `*.env`; NEVER commit, NEVER put in a dispatch payload). Source before client
calls: `set -a; . fleet/fleet.secrets.env; set +a`. Operationally: `node
.claude/mcp/task-router/client.js remote-{list-agents,read-guidelines,write-guidelines,execute}
--url=http://192.168.1.131:3100 --project=<lower> --token-env=FED_TOK_<NAME>`.
**Operator declined token rotation** (private LAN; tokens stay). Raw tokens stay out of git
regardless — committing them was explicitly NOT done.

**KEY (verified by /review against client.js, 2026-06-14): `fleet.config.json` is descriptive
metadata — NO code reads it.** `client.js` never parses it; federation tokens resolve only
CLI-side via `--token-env=FED_TOK_<NAME>` (**bare** name; the `tokenRef:"env:FED_TOK_<NAME>"`
in the file is a human pointer — the `env:` prefix is STRIPPED on the CLI; passing
`--token-env=env:FED_TOK_<NAME>` fails). The `grant:"pm"` field = the grantee **agent**, NOT
an access level; the level (RWE) is server-side, shown by `remote-list-agents` as `{"pm":"RWE"}`.
`/health?project=` really does return `{version, tenants:N}` (SERVER_API.md). Don't conflate
`fleet/fleet.config.json` (federation registry) with `.claude/mcp/task-router/fleet.json` (SoT identity).

**ROTATION: declined by operator** (private LAN). Tokens stay as-is in `fleet.secrets.env`.

**SoT bootstrap DONE (2026-06-14).** `.claude/mcp/task-router/fleet.json` created (hand-authored
because `init.sh` is destructive on this customized fleet — it needs `--force`, which overwrites
all skills/agents.json/CLAUDE.md/matrix; NEVER run it here). Contents: `role:"sot"`,
`enterprise_project_id:"ent:home"`, permanent `fleet_id:67f700a1-526f-4a28-b930-abd928e81797`,
`seed_version:"4.13"`. Anti-distillation defaults set in gitignored `.env`
(`TASK_ROUTER_DISTILL_QUOTA=60`, `TASK_ROUTER_DISTILL_WINDOW_MS=60000`; PM-grant callers unlimited).
**Topic ownership (§7) NOT in v4.13 client** — deferred until a seed ships it AND there's canonical
knowledge to own.

**NETWORK BINDING — still loopback (127.0.0.1); operator DECISION PENDING.** Active-pull
(Majordomus→fleets) works as-is. For the PASSIVE direction (fleets read FROM the SoT), bind
non-loopback (`TASK_ROUTER_HOST=0.0.0.0`/LAN/Tailscale) + open 3100 for `/api/federation/*` only
(owner endpoints + UI stay loopback, G3). /ops recommends Tailscale. Left commented in `.env` — do
NOT enable without operator sign-off.

**FEDERATION-BRIDGE AGENTS created (2026-06-14, agent-per-PM, operator-chosen "structural" approach).**
`/swarm`, `/dragon-vlm`, `/jetson-protect` — local **bridge** skills (NOT MCP workers) that relay a
request INTO each fleet's remote PM via `client.js remote-execute` and own that fleet's SoT canon
(`doc/<name>_GUIDELINES.md`). Each: SKILL.md + rules/<name>.md + GUIDELINES + rows in agents.json
(role:`federated-pm`, `remote` block, **NO model field** per operator) + SKILLS.md + INDEX.md + matrix
+ PM roster. **Offline in the dashboard by design** (no launcher/terminal; operator accepted). Designed
to optionally become **online bridge-workers** later (a launched terminal polls PM dispatches → remote-execute)
without needing the unshipped native remote-registration. **KEY:** v4.13 has NO native federated-agent
registration (`register_agent` `remote:` block + `MAJORDOMUS_RUNBOOK.md` are referenced in the seed PM
skill but DON'T ship) — the bridge skill IS the workaround.

**Maintainer feedback filed:** `doc/feedback/federation_bootstrap_feedback.md` (FEEDBACK_TEMPLATE.md
structure; 6 gaps + proposed fixes, what-worked, what-not-to-change; A3 + Appendix A carry our
bridge-agent pattern as the proposed native `role:"federated-pm"` design). /ops Primary.

**SoT KNOWLEDGE-TOPIC AGENTS — still deferred by operator directive:** define them AFTER gathering
common knowledge from the federated projects (read across swarm/dragon-vlm/jetson-protect, find shared
themes, THEN create the SoT knowledge-topic agents). Distinct from the bridge agents above. The gathering
phase fills each bridge agent's `doc/<name>_GUIDELINES.md`. Next phase once committed.

**Doc consolidation DONE (2026-06-17).** Federation is now governed by a single canonical SoT:
`FEDERATION_RULEBOOK.md` (project root, seed-shipped via errata v4.21/v4.22 — R/W/X access model,
federated-pm/federated-sot roles, SoT-agent obligations, security, §7 enterprise install). The
operational wiring procedure lives in `.claude/skills/ops/SKILL.md` ("Federation wiring procedure").
The former `doc/design/federation.md` + `doc/federation.md` were **removed** (folded into those two).
See [[ha-devops-hard-gate]] for the federation-is-delegation / second-gate model.
