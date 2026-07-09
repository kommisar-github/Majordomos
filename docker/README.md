# Run Task Router in containers (Docker)

Run the fleet as containers — **server + web dashboard + in-house agents** — so a box needs only
**Docker** (no per-machine Node / node-pty / tmux / `claude` install). One image, two services: a durable
`server` and an attaching `app` that shares the server's network namespace.

> **In-house agents only.** The container has no tmux, so *detached* agents are out of scope. Launch
> in-house agents from the dashboard.

## 1. Prerequisites

- **Docker** (Desktop or Engine) with Compose v2.
- **A bootstrapped repo** to work on — its parent (`TR_WORKSPACE`) is bind-mounted at the **same host
  path**, with the repo at `$TR_WORKSPACE/$TR_PROJECT` (see §3); it must already be seeded
  (`.claude/mcp/task-router/agents.json` + `.mcp.json` present).
- **Claude auth** — either a `claude setup-token` OAuth token, or your local `~/.claude` mounted in
  (see step 3).

## 2. Get the image (`docker load` — no registry)

The image is a gzipped tarball (~198 MB) hosted on **Google Drive** — it is **not** in this repo (only its
checksum is). Download it, verify, and load:

```bash
# Download task-router-2.1.10.tar.gz from Google Drive:
#   <<< GOOGLE DRIVE LINK: PASTE THE SHARE LINK / FILE ID HERE >>>
#   e.g. with gdown (pip install gdown):   gdown "<FILE_ID>" -O task-router-2.1.10.tar.gz
#   or with rclone:                        rclone copy gdrive:task-router/task-router-2.1.10.tar.gz .
#   or the Drive web UI / Google Drive for Desktop.

sha256sum -c task-router-2.1.10.tar.gz.sha256    # the checksum in this folder
docker load < task-router-2.1.10.tar.gz          # loads the tag  task-router:2.1.10
docker images task-router                        # confirm it's present
```

## 3. Configure + run

Copy `.env.example` to `.env` in this folder and fill in the token + your project location (`.env`
holds a token/paths — **don't commit it**):

```ini
TR_IMAGE=task-router:2.1.10                 # the tag from `docker load`
TR_WORKSPACE=/absolute/path/to/parent      # parent dir to bind-mount at the SAME path; holds the project at $TR_WORKSPACE/$TR_PROJECT
TR_PROJECT=myapp                           # .mcp.json ?project=<name> AND the project's subfolder name under TR_WORKSPACE
CLAUDE_TOKEN=<from: claude setup-token>    # OR leave empty and use the creds mount below
UID=1000                                   # host repo owner's `id -u` / `id -g` (or let start.sh fill it)
GID=1000
```

**Easiest — let `start.sh` fill the machine-specific bits and bring it up** (Linux Docker host):

```bash
./start.sh                 # sets UID/GID to the repo owner + this host's LAN IP, then `up -d`
./start.sh --help          # all options (--dry-run, --no-up, --recreate, --chown, --host-ip, --creds)
./start.sh --recreate      # after changing .env / the image (down && up -d)
```

It auto-fills `UID`/`GID` (to the project-dir owner — the id the server must write the DB as) and adds
this host's LAN IP to `TASK_ROUTER_UI_ALLOWED_HOSTS`. It does **not** expose anything on its own; remote
access is still the deliberate step in §4. Or run it by hand:

```bash
docker compose -p tr up -d          # dashboard: http://127.0.0.1:3200
docker compose -p tr logs -f app    # watch agents / attach
docker compose -p tr down           # stop (your DB stays in the repo)
```

**Auth without a token:** leave `CLAUDE_TOKEN` empty and mount your local credentials — copy
`creds.override.example.yml` to `creds.override.yml`, set the path to your `~/.claude`, and add it:

```bash
docker compose -p tr -f docker-compose.yml -f creds.override.yml up -d
```

## 4. Trust boundary (read this)

Two surfaces, published on the `server` service:
- **`:3200` dashboard/UI** — full read-write control (keystroke injection, process launch, terminal). It is
  **UNAUTHENTICATED and RCE-grade**.
- **`:3100` server/federation** — when exposed, only `/api/federation/*` (each **`trtok_` grant-gated**) +
  `/health`; the rest stays loopback-only.

**Default = both host-loopback only**, plus a dedicated Docker network (`trnet` — keep no untrusted
co-tenants). To reach a surface from another machine:

| Surface | Expose with | Gate with (REQUIRED) |
|---|---|---|
| Dashboard `:3200` | `TR_UI_PUBLISH_HOST=0.0.0.0`/LAN IP | `TASK_ROUTER_UI_IP_ALLOWLIST` + `TASK_ROUTER_UI_ALLOWED_HOSTS` |
| Federation `:3100` | `TR_FED_PUBLISH_HOST=0.0.0.0` **+** `TASK_ROUTER_HOST=0.0.0.0` | `trtok_` grants + `TASK_ROUTER_SERVER_IP_ALLOWLIST` |

The IP allow-list + Host check are the **only** access control (no TLS, no reverse proxy). Two hard caveats:

- **⚠ The allow-list needs the REAL client IP.** Works on **native Linux Docker** (published-port DNAT
  preserves it); **Docker Desktop hides it** behind a NAT gateway IP, so the allow-list is bypassed there —
  **do not expose the dashboard from a Docker Desktop host.**
- **No confidentiality** — cleartext on the LAN (tokens, terminal stream, files). The dashboard is
  unauthenticated, so an allow-listed IP has full RCE.

Safest: expose only `:3100` (token-gated); keep `:3200` loopback and reach it via an **SSH port-forward**
(`ssh -L 3200:127.0.0.1:3200 host` — a tunnel, not a reverse proxy). Never expose `:3200` with an empty
`TASK_ROUTER_UI_IP_ALLOWLIST`.

## 5. Database — single source of truth

The server writes your project's **own** DB in-repo (`$TR_WORKSPACE/$TR_PROJECT/.claude/mcp/task-router/task-router.db`) —
no separate copy. **Run this project in exactly ONE runtime at a time** (this container **or** a host
IDE/App, never both): two servers doing full-file-snapshot writes to one DB file corrupt each other.

*(Edge case: if your workspace is on a cloud-sync/FUSE mount where DB writes fail, use a native volume via a
`--db-dir` override — ask the maintainer for the snippet.)*

## 6. Optional settings (in `.env`)

- The same **`TASK_ROUTER_*`** settings the IDE start scripts use (server/dashboard bind, errata channel,
  claude flags, model-by-role, API key). Keep `TASK_ROUTER_UI_HOST=0.0.0.0`.
- **Pass-through to `claude`** (forwarded only when set): `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  (proxy/gateway), `ANTHROPIC_CUSTOM_HEADERS`, `NODE_EXTRA_CA_CERTS` (CA bundle for TLS inspection —
  preferred), `NODE_TLS_REJECT_UNAUTHORIZED`, `DISABLE_TELEMETRY`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. See the comments in `.env.example`.

## 7. Lifecycle gotchas

- **Recreate the App whenever you recreate the `server`.** The `app` borrows the `server`'s network
  namespace, so recreating `server` (image bump / crash-recreate) orphans the App's networking. A plain
  `restart` is fine; a recreate means `down` + `up` (or `up -d` both).
- **Agent `git commit`** needs an identity — set `user.name`/`user.email` in the mounted repo's `.git/config`
  if your agents commit.
- **Files owned by the wrong user / git "dubious ownership"** → set `UID`/`GID` to the host repo owner. The
  image already sets `safe.directory '*'` and a writable `HOME`.
