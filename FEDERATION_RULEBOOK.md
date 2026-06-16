# Federation Rulebook

> **Canonical, project-shipped rules for cross-fleet federation.** This file is the **single source of
> truth** for how this project participates in federation — both as a **consumer** (reaching other fleets)
> and as a **provider** (a Source-of-Truth fleet others reach). The PM follows these rules; they override
> any project-local improvisation. Operational how-to lives in the PM skill (`PM_TEMPLATES.md`); the
> *policy* lives here.

---

## 1. Federation basics

**Federation = authorized, gated PM-to-PM access between two task-router fleets.** Each fleet is a
project with its own MCP server, roster, and PM.

**Load-bearing rules:**

- **PM-to-PM only.** The **only externally reachable agent is your `pm`.** Every inbound federated
  request lands on the PM; no external caller can address a specialist directly. When you call out, you
  go through the remote fleet's PM.
- **Two gates, always.**
  1. **Server token gate** — the remote server verifies the caller's `trtok_` token grants the requested
     capability on the named agent *before* the request becomes a task. Out-of-grant calls are rejected.
  2. **PM second gate** — even when the server allows it, the request lands as a `pm` task and **you may
     decline, clarify, or re-scope** anything unsafe or off-convention. Say why in your result.
- **Tokens are credentials.** A grant token (`trtok_…`) is minted by the **provider** and shared
  out-of-band. The consumer stores it **only** in `.claude/mcp/task-router/federation.env` (gitignored,
  read by the *server*). **Never** inline a token in a payload, doc, commit, log, or `agents.json`. Commit
  only the **env-var name**.

### Access model — R / W / X capabilities

A grant is a **per-agent map** within one project: `{ "<agent>": "<level>" }`. A **level is a set of
capabilities** over **R / W / X** (a lattice, not a ladder):

| Capability | Meaning |
|---|---|
| **R** | read a file from the agent (server-mediated; lands in your temp staging) |
| **W** | write a file to the agent (server-mediated; the remote PM audits + places it) |
| **X** | execute a prompt against the agent and get a response |

| Level | Capabilities |
|---|---|
| **RO** | {R} |
| **RW** | {R, W} |
| **XO** | {X} |
| **RX** | {R, X} |
| **RWX** | {R, W, X} |

Operations and the capability each needs: **`read_file` → R**, **`write_file` → W**, **`execute` → X**.
Access is **set membership**: `read_file` needs R, etc. A `pm` (fleet) grant covers the **whole roster**
at that level. (Legacy `RWE` = `RWX`; `read_guidelines`/`write_guidelines` = `read_file`/`write_file`.)

---

## 2. PM ↔ PM interaction (a federated peer fleet)

A peer fleet's PM is declared in `agents.json` as **`role:"federated-pm"`** with a `remote` block
(`url`, `project`, `target_agent:"pm"`, `grant`/`level`, `tokenRef:"env:FED_TOK_<NAME>"`).

**Outbound (you dispatch to a peer):**

- The PM **registers every `role:"federated-pm"` peer at startup** (they have no terminal, so the
  launcher never does — the PM does, via `register_agent` with the roster `remote` block verbatim).
- Reach a peer with a normal **`dispatch_task(to="<peer>")`** — **Mode 4 federated**: the *server* forwards
  it over the gate to the remote PM and mirrors the result back into a local task.
- **Never Mode-2-fork a federated peer.** A peer has no local skill to fork. **"Offline" = the remote
  link is down** → the task mirrors back `remote_unreachable`; **report the link down**, do not fork.

**Inbound (a peer dispatches to you):** a `pm` task whose payload begins `# [FEDERATED REQUEST]` arrived
from an external PM. You are the **second gate**:

- Parse `Caller`, `Requested agent`, `Operation`, `Payload`. The server already verified the token grants
  the stated capability — but you may decline / re-scope anything unsafe (say why).
- **Always attribute the external caller** in your result and complete the task normally so the caller's
  long-poll resolves. **Never expose an agent or doc the request didn't name.**
- A **fleet grant** (`Requested agent: pm (FLEET)`) means access to your **entire roster** — handle at
  fleet scope, still as the gate.

---

## 3. PM ↔ SoT-agent interaction (you are the consumer)

A **SoT agent** is a non-PM remote agent (e.g. a knowledge library) you hold a graded grant on. Declare
it in `agents.json` as **`role:"federated-sot"`** with a `remote` block carrying the granted `level`.

- **Register once.** Use the App's **"Add SoT agent"** (or the IDE command) — it writes the
  `role:"federated-sot"` entry, stores the token in `federation.env`, and registers it, so it appears as a
  **📚 card with its level** and a grant-aware reachability **Check**. The PM also registers such entries
  at startup.
- **Access it by name.** Call **`federated_read_file({ agent: "<name>" })`** /
  **`federated_write_file({ agent, source_path })`** — the tools resolve `url`/`project`/`token_env` from
  the registration. For an **execute (X)** grant, `dispatch_task(to="<name>")`.
- **Bytes never enter your context.** File transfers move **server-to-server** through temp staging
  (`.claude/mcp/task-router/fed-stage/`). On a read, **audit** the staged files, then **move** them into
  **`doc/sot/<agent>/`** (the canonical home for SoT-sourced files). Prefer the `federated_*` tools over
  the direct `remote-*` client verbs, which print bytes to stdout (into your context).
- **Respect your granted level.** Don't attempt an operation your level doesn't include — the server
  rejects it (`insufficient_permission`), and it's a convention breach.

---

## 4. SoT-agent rules (you are the provider / source of truth)

When your fleet **serves** an agent to others (you minted a grant on it), follow these when fulfilling an
inbound request for that agent:

- **Catalog + book tree.** An agent's knowledge is its catalog `doc/<agent>_GUIDELINES.md` plus, if it
  exists, a per-topic book tree `doc/<agent>/**.md`.
- **`read_file` (R)** — copy the catalog (and, if present, every `doc/<agent>/**.md` book — or the named
  file) into `.claude/mcp/task-router/fed-stage/out/<handle>/` with a **shell copy** (do *not* read the
  bytes into your context); the server streams them to the caller. The whole tree counts as **one** read
  (one anti-distillation unit).
- **`write_file` (W)** — the caller staged file(s) in `fed-stage/in/<handle>/`. **Audit** them, then move
  the appropriate ones into `doc/<agent>/` and **update the catalog**. Back up first; **cite the external
  caller** in the commit.
- **`execute` (X)** — `dispatch_task(to="<agent>", …)` and return the result. **Read-only by default —
  do NOT persist any knowledge change.** Only if the grant is **RWX** may you persist a prompt-driven
  update, routed through your **`/review`** consolidation gate (back up; cite the caller).
- **Never over-serve.** Return only what the grant + named agent cover. Never expose another agent's docs,
  secrets, or files the request didn't name.

---

## 5. Security & least-privilege rules

- **Grant minimally.** Issue per-agent grants at the **lowest level** that does the job; prefer scoped
  agent grants over a fleet (`pm`) grant; set an **expiry**; **revoke** when no longer needed.
- **MCP-to-MCP only.** Route real work through `dispatch_task` / the `federated_*` MCP tools so the
  *server* forwards it (a local mirror task tracks it). Avoid the direct `remote-execute` client verb for
  routed work — it bypasses your local server (no tracking, bytes to stdout).
- **Token hygiene.** Tokens live in `federation.env` (gitignored, server-resolved). Never inline, never
  commit, never log. The provider stores only `SHA-256(token)`; plaintext is shown once.
- **Anti-distillation.** Non-`pm` grants are **budgeted** on reads (a fixed window quota) so a token can't
  bulk-reconstruct the corpus; a `pm` (fleet) grant is trusted/unlimited. Don't design flows that hammer
  reads; consolidate.
- **You are the gate.** On any inbound request, decline / re-scope anything unsafe or off-convention and
  explain why — the server's token check is necessary, not sufficient.

---

## 6. Quick Do / Don't

**Do**
- Register `federated-pm` / `federated-sot` peers at startup; reach them by name.
- Dispatch to a peer over the gate; report "remote link down" when unreachable.
- Place pulled SoT files in `doc/sot/<agent>/`; keep tokens in `federation.env`.
- Grant least-privilege, scoped, with expiry; attribute external callers.

**Don't**
- Mode-2-fork a federated peer, or treat "offline" as "fork".
- Inline a token anywhere, or commit `federation.env`.
- Serve an agent or doc a request didn't name; persist knowledge on a non-RWX execute.
- Use `remote-execute` for routed work when a registered peer + `dispatch_task` will do.

---

## 7. Enterprise installation & multi-fleet operation

Federation also scales to **many fleets across an organization**, grouped into **Enterprise Projects**
and federated into one or more **Source-of-Truth (SoT) fleets**. Enterprise features are **additive** — a
fleet with no `enterprise_project_id` behaves exactly like a normal single fleet and only ever receives
**global** errata. Most of the wiring is **automatic** (register a SoT with the App's *Add SoT agent*;
reach it by name with the `federated_*` tools — §3). These are the installation basics; the user-facing
walkthrough is in the **User Manual** (`USER_MANUAL.md`, federation & enterprise section).

**Concepts**

- **Fleet** — one task-router project (a PM + its roster). Its identity is **`fleet_id`**, a UUID minted
  **once** at bootstrap into `.claude/mcp/task-router/fleet.json` and **preserved across re-runs** — never
  hand-edit it.
- **Enterprise Project (`enterprise_project_id`)** — groups fleets and **scopes errata + knowledge**. One
  fleet belongs to exactly one Enterprise Project; the id comes from the **admin bootstrap plan**.
- **SoT fleet** — a fleet (role `sot`) holding canonical knowledge that other fleets **federate into**
  using the `trtok_` grants of §1–§3. You can run **one or several** (e.g. one per domain).

**Bootstrap a fleet with enterprise identity** — run `init.sh` with the enterprise flags (the project id
must equal the workspace folder name):

```bash
bash <seed>/init.sh <project-name> --enterprise-project=ent:payments --role=dev   # or --role=sot
```

This writes `fleet.json` (`fleet_id`, `enterprise_project_id`, `role`, `seed_version`). Already
bootstrapped? Use the **identity-only** mode — it writes *only* `fleet.json`, touching nothing else:
`bash <seed>/init.sh <project-name> --set-identity --enterprise-project=ent:payments --role=dev`.
Every federated call then automatically carries this fleet's `fleet_id` / `enterprise_project_id` so the
SoT registers it on first contact.

**Wire a fleet to a SoT (grants)** — on the **SoT**, mint a token for the consumer and share it
out-of-band; the consumer stores it in `federation.env` (§1) and reaches the SoT by the rules of §3:

```bash
task-router grant-access --project <sot-project> --grant pm=RO --label "<consumer-fleet>"   # → trtok_…
```

`pm=<level>` is whole-fleet (trusted) access; a scoped `<agent>=RO` is budgeted by anti-distillation (§5).

**Enterprise-scoped errata** — an erratum tagged `enterprise_project_id: "ent:payments"` is applied
**only** by fleets with that id; an untagged (or `"*"`) erratum stays **global**. (Authoring is the normal
errata flow.)

**Active (demand-driven) pull** — a SoT can pull knowledge when it sees recurring demand: the
**topic-owning fleet mints a grant *into* itself for the SoT** (direction reversed from §3), and the SoT
dispatches research to it — preferably by registering that fleet's PM as a `role:"federated-pm"` peer and
using `dispatch_task` (MCP-to-MCP, §5), not a one-off `remote-execute`.

---

*Deeper operator/maintainer detail (endpoints, token lifecycle, anti-distillation tuning, active-pull
operations) lives in the maintainer's `FEDERATION_RUNBOOK.md` in the Task Router dev repo; the user-facing
walkthrough is in `USER_MANUAL.md`. This rulebook is the consumer-facing authority; when in doubt, follow
it.*
