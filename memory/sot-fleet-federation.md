---
name: sot-fleet-federation
description: Majordomus is the home SoT, federated to 3 dev fleets (swarm/dragon-vlm/jetson-protect) on 192.168.1.111:3100; wiring, gotchas, rotation-pending
metadata:
  type: project
---

**Majordomus = home Source-of-Truth (SoT).** As of 2026-06-14 Majordomus federates to
three dev fleets so PM can `remote-execute` into each fleet's PM (SoT→fleet active-pull,
ENTERPRISE_GUIDEBOOK §7). The guidebook lives locally at
`~/Work/claude-task-router-releases/ENTERPRISE_GUIDEBOOK.md` (OneDrive-synced; the operator's
`D:\…` path is the Windows mirror).

**The 3 fleets — all one multi-tenant Task Router at `http://192.168.1.111:3100`** (routed by
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
--url=http://192.168.1.111:3100 --project=<lower> --token-env=FED_TOK_<NAME>`.

**ROTATION PENDING (operator's plan = wire-now-rotate-after).** All 3 tokens were exposed in
cleartext chat 2026-06-14, so re-mint each `pm` grant on its fleet, then swap the new values
into `fleet/fleet.secrets.env`. Tokens are auth-healthy (no 401/403) — this is hygiene, not a fix.

**DEFERRED (operator chose "federation handles only" first pass).** Full SoT bootstrap not yet
done: Majordomus has NO `.claude/mcp/task-router/fleet.json` → not yet a `role=sot` enterprise
fleet. To complete: `init.sh … --role=sot --enterprise-project=ent:home` (guidebook §3), then
anti-distillation quota (§6: `TASK_ROUTER_DISTILL_QUOTA`), topic ownership (§7). For consumer
fleets to read FROM the SoT, also bind non-loopback (`TASK_ROUTER_HOST`).

**OPEN doc task (/ops flagged).** `doc/federation.md` (ops Primary) doesn't exist — only a
14-line `doc/design/federation.md`. The added `project` field + the lowercase/case-sensitivity
rule should be consolidated into the schema doc via the PM→/review gate. See [[ha-devops-hard-gate]]
for the federation-is-delegation / second-gate model.
