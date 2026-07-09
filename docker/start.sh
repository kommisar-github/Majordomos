#!/usr/bin/env bash
# start.sh - prepare .env and bring up the Task Router container stack.
#
# Auto-fills the machine-specific bits of .env before `docker compose up`, so a
# fresh Linux Docker host "just works":
#   - UID / GID  -> the owner of the project dir ($TR_WORKSPACE/$TR_PROJECT): the
#                   user the SERVER must run as to write the in-repo DB (else EACCES).
#   - TASK_ROUTER_UI_ALLOWED_HOSTS -> ensures this host's primary LAN IP is present,
#                   so a browser hitting http://<this-host-ip>:3200 is accepted.
# Then runs `docker compose -p tr up -d` (unless --no-up).
#
# LINUX DOCKER HOST ONLY. The container's IP allow-list / host-IP model needs native
# Linux Docker (Docker Desktop's NAT hides the client IP - see README "Trust boundary").
# This helper uses id/stat/chown/ip-route/hostname (Unix); there is no .ps1 counterpart.
#
# It does NOT expose anything by itself: it only fills UID/GID and the allowed Host
# name. Remote exposure stays a deliberate manual step (TR_UI_PUBLISH_HOST +
# TASK_ROUTER_UI_IP_ALLOWLIST) - see README "Trust boundary".
#
# Usage: ./start.sh [options]
#   -h, --help       Show this help and exit (no side effects).
#   -n, --dry-run    Print what would change in .env + the compose command; write/start nothing.
#       --no-up      Update .env but do NOT start the container.
#       --recreate   Recreate containers (down && up -d) instead of up -d (picks up user:/env changes).
#       --chown      chown -R the project tree ($TR_WORKSPACE/$TR_PROJECT) to the resolved UID:GID
#                    (fixes a root-owned / mis-owned repo). Uses sudo when not already root.
#       --host-ip IP Use IP as this host's address instead of auto-detecting it.
#       --uid N      Force UID (default: owner of the project dir, else `id -u`).
#       --gid N      Force GID (default: owner of the project dir, else `id -g`).
#       --creds      Add -f creds.override.yml (mount local ~/.claude instead of a token).
#   Reads TR_WORKSPACE / TR_PROJECT from .env to locate the project. No env vars required.
set -euo pipefail

usage() { tail -n +2 "$0" | sed -n '/^#/!q; s/^# \{0,1\}//p'; exit 0; }
case "${1:-}" in -h|--help) usage ;; esac

cd "$(dirname "$0")"                          # operate beside .env + docker-compose.yml

DRY=0; NOUP=0; RECREATE=0; DOCHOWN=0; USECREDS=0
FORCE_IP=""; FORCE_UID=""; FORCE_GID=""
while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY=1 ;;
    --no-up)      NOUP=1 ;;
    --recreate)   RECREATE=1 ;;
    --chown)      DOCHOWN=1 ;;
    --creds)      USECREDS=1 ;;
    --host-ip)    FORCE_IP="${2:?--host-ip needs a value}"; shift ;;
    --uid)        FORCE_UID="${2:?--uid needs a value}"; shift ;;
    --gid)        FORCE_GID="${2:?--gid needs a value}"; shift ;;
    -h|--help)    usage ;;
    *) echo "start.sh: unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

ENV_FILE=".env"
COMPOSE_PROJECT="tr"

# read the uncommented value of KEY from a file ('' if unset/commented); strips a trailing ' #...'.
get_env() { # get_env FILE KEY
  awk -v k="$2" '
    $0 ~ "^" k "=" { s=substr($0, length(k)+2); sub(/[[:space:]]+#.*/,"",s); print s; exit }
  ' "$1"
}
# upsert KEY=VALUE in a file: replace the first "KEY="/"#KEY=" line, else append. Value is literal.
upsert_env() { # upsert_env FILE KEY VALUE
  local f="$1" k="$2" v="$3" tmp
  tmp="$(mktemp)"
  awk -v k="$k" -v v="$v" '
    BEGIN { done=0 }
    !done && $0 ~ "^#?" k "=" { print k "=" v; done=1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
}

# --- ensure a .env to work from (create from example on a first run) ---
if [ ! -f "$ENV_FILE" ]; then
  [ -f ".env.example" ] || { echo "start.sh: no .env and no .env.example in $(pwd)" >&2; exit 1; }
  echo "[start] no .env - creating from .env.example (fill CLAUDE_TOKEN / TR_WORKSPACE / TR_PROJECT)" >&2
  [ "$DRY" -eq 1 ] || cp .env.example "$ENV_FILE"
fi
SRC="$ENV_FILE"; [ -f "$SRC" ] || SRC=".env.example"    # dry-run before first create reads the example

TR_WORKSPACE="$(get_env "$SRC" TR_WORKSPACE)"
TR_PROJECT="$(get_env "$SRC" TR_PROJECT)"
PROJ_DIR=""
[ -n "$TR_WORKSPACE" ] && [ -n "$TR_PROJECT" ] && PROJ_DIR="$TR_WORKSPACE/$TR_PROJECT"

# --- resolve UID/GID: the project-dir owner is who the server must run as ---
if   [ -n "$FORCE_UID" ]; then NEW_UID="$FORCE_UID"
elif [ -n "$PROJ_DIR" ] && [ -e "$PROJ_DIR" ]; then NEW_UID="$(stat -c '%u' "$PROJ_DIR")"
else NEW_UID="$(id -u)"; fi
if   [ -n "$FORCE_GID" ]; then NEW_GID="$FORCE_GID"
elif [ -n "$PROJ_DIR" ] && [ -e "$PROJ_DIR" ]; then NEW_GID="$(stat -c '%g' "$PROJ_DIR")"
else NEW_GID="$(id -g)"; fi
if [ -z "$PROJ_DIR" ] || [ ! -e "$PROJ_DIR" ]; then
  echo "[start] WARN: project dir '${PROJ_DIR:-<unset>}' not found; using invoking user's ids ($NEW_UID:$NEW_GID)." >&2
  echo "        Set TR_WORKSPACE (parent) + TR_PROJECT (subfolder) in .env, then re-run." >&2
fi

# --- detect this host's primary LAN IP (not a docker bridge) ---
if [ -n "$FORCE_IP" ]; then HOST_IP="$FORCE_IP"
else
  HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  [ -n "$HOST_IP" ] || HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

# --- merge HOST_IP into TASK_ROUTER_UI_ALLOWED_HOSTS (append if missing; never clobber existing) ---
CUR_HOSTS="$(get_env "$SRC" TASK_ROUTER_UI_ALLOWED_HOSTS)"
NEW_HOSTS="$CUR_HOSTS"
if [ -n "$HOST_IP" ]; then
  case ",$CUR_HOSTS," in
    *",$HOST_IP,"*) : ;;
    *) [ -n "$CUR_HOSTS" ] && NEW_HOSTS="$CUR_HOSTS,$HOST_IP" || NEW_HOSTS="$HOST_IP" ;;
  esac
fi

echo "[start] UID=$NEW_UID GID=$NEW_GID  host-ip=${HOST_IP:-<none>}"
echo "[start] TASK_ROUTER_UI_ALLOWED_HOSTS: '${CUR_HOSTS}' -> '${NEW_HOSTS}'"

if [ "$DRY" -eq 1 ]; then
  echo "[start] dry-run: no .env writes, no compose start."
  exit 0
fi

# --- write .env ---
upsert_env "$ENV_FILE" UID "$NEW_UID"
upsert_env "$ENV_FILE" GID "$NEW_GID"
[ -n "$HOST_IP" ] && upsert_env "$ENV_FILE" TASK_ROUTER_UI_ALLOWED_HOSTS "$NEW_HOSTS"
echo "[start] .env updated."

# --- optional ownership fix (follow a symlinked project dir to its real target) ---
if [ "$DOCHOWN" -eq 1 ] && [ -n "$PROJ_DIR" ] && [ -e "$PROJ_DIR" ]; then
  TARGET="$(readlink -f "$PROJ_DIR")"
  echo "[start] chown -R $NEW_UID:$NEW_GID $TARGET"
  if [ "$(id -u)" = "0" ]; then chown -R "$NEW_UID:$NEW_GID" "$TARGET"
  else sudo chown -R "$NEW_UID:$NEW_GID" "$TARGET"; fi
fi

if [ "$NOUP" -eq 1 ]; then
  echo "[start] --no-up: .env prepared; not starting."
  exit 0
fi

# --- bring it up. `env -u UID -u GID` so compose reads .env, not an exported shell UID/GID
#     (bash sets $UID automatically; if it leaks to the child it overrides the .env value). ---
FILES=(-f docker-compose.yml)
[ "$USECREDS" -eq 1 ] && FILES+=(-f creds.override.yml)
compose() { env -u UID -u GID docker compose -p "$COMPOSE_PROJECT" "${FILES[@]}" "$@"; }

[ "$RECREATE" -eq 1 ] && compose down
compose up -d
echo "[start] up. dashboard: http://127.0.0.1:3200${HOST_IP:+  (or http://$HOST_IP:3200 once exposed)}"
compose ps
