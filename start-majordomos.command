#!/usr/bin/env bash
# launcher-rev: 10   (bump when this template changes; the IDE auto-refreshes a project's
#                    launchers when the bundled rev is higher — seedSync.ts. Absent = rev 0.)
# start-Majordomos — launch the headless Task Router host for this project,
# using the app bundled inside your installed Task Router extension. No per-project
# server or app copy: the app finds the extension's bundled server and starts a
# shared, detached :3100 server if one isn't already up (the extension and other
# projects' apps attach to that same server).
#
#   Finder (macOS): double-click start-Majordomos.command
#                   (first time: right-click -> Open to clear Gatekeeper).
#   Terminal:       ./start-Majordomos.sh
#
# Several projects on one machine: give each its own UI port (they share :3100):
#   UI_PORT=3201 ./start-Majordomos.sh
# Restart the shared server on start (e.g. after an extension update):
#   RESTART_SERVER=1 ./start-Majordomos.sh   (or pass --restart-server)
# Launch kind is chosen PER AGENT in the dashboard (In-house: live terminal here, dies with
# the App / Detached: own window, survives the App). These flags only set the DEFAULT kind
# for "Launch All" / a card's primary click:
#   ./start-Majordomos.sh --inhouse     default to in-house (this is the default).
#   ./start-Majordomos.sh --detached    default to detached (alias: --observe).
#                                             Either way you can pick the other per agent.
# Take over a dashboard already running on this UI port (instead of an EADDRINUSE error):
#   ./start-Majordomos.sh --restart-app
# Start / restart the Telegram bridge with the App (headless parity with the IDE):
#   ./start-Majordomos.sh --bridge          (or TASK_ROUTER_BRIDGE=1 ./start-Majordomos.sh)
#   ./start-Majordomos.sh --restart-bridge  (stop a running bridge, start fresh)
# Remote access (default is local-only): bind the server / dashboard to a LAN IP
# or 0.0.0.0. The server's remote surface is /api/federation/* (grant tokens) +
# /health only; the dashboard (UI_HOST) has NO auth, so trusted networks only:
#   TASK_ROUTER_HOST=0.0.0.0 TASK_ROUTER_UI_HOST=0.0.0.0 ./start-Majordomos.sh
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="Majordomos"

# --- Help ---
# This launcher mostly FORWARDS runtime flags to the bundled Task Router app; the
# authoritative flag set lives there. -h/--help prints local guidance and exits 0
# before any side effect (node lookup, node-pty install, launch).
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat << EOF
start-$PROJECT_NAME.sh — launch the headless Task Router host for this project,
using the app bundled inside your installed Task Router extension.

USAGE:
  ./start-$PROJECT_NAME.sh [flags]

Flags are FORWARDED to the bundled app. Common ones:
  -h, --help          Show this help and exit.
  --restart-server    Restart the shared :3100 server on start (e.g. after an
                      extension update). Alias: RESTART_SERVER=1.
  --restart-app       Take over a dashboard already running on this UI port.
  --inhouse           Default agents to in-house terminals (die with the App). Default.
  --detached          Default agents to detached windows that survive the App.
  --observe           Alias of --detached.
  --bridge            Start/restart the Telegram bridge with the App.
  --restart-bridge    Stop a running bridge and start fresh.
  --stop-host         Stop the running headless host for this project.

ENV VARS:
  UI_PORT             Dashboard port (default 3200). Give each project its own.
  RESTART_SERVER=1    Same as --restart-server.
  TASK_ROUTER_BRIDGE=1  Same as --bridge.
  TASK_ROUTER_HOST    Router server bind (default 127.0.0.1; LAN IP / 0.0.0.0 = remote).
  TASK_ROUTER_UI_HOST Dashboard bind (default 127.0.0.1; NO auth — trusted net only).
  TASK_ROUTER_APP     Path to app/bin/app.js (no-IDE box override).
  TASK_ROUTER_ERRATA_CHANNEL, TASK_ROUTER_CLAUDE_FLAGS, TASK_ROUTER_MODEL_BY_ROLE,
  TASK_ROUTER_IDLE_SHUTDOWN, TASK_ROUTER_WORKFLOW_BACKEND — advanced overrides.
EOF
      exit 0 ;;
  esac
done

UI_PORT="${UI_PORT:-3200}"
HOST="${TASK_ROUTER_HOST:-127.0.0.1}"   # router server bind (default local-only)
UI_HOST="${TASK_ROUTER_UI_HOST:-127.0.0.1}"  # dashboard bind (NO auth — trusted net only)

# --- Config inherited from the IDE extension (taskRouter.* workspace settings) ---
# The extension's launcher generator (seedSync.ts) BAKES the workspace settings into the
# __PLACEHOLDERS__ below when it writes this file; the headless host can't read VS Code
# settings at runtime. Each is still overridable at launch via its TASK_ROUTER_* env var.
# See doc/runbooks/APP_STARTUP_SCRIPTS_GUIDEBOOK.md (the SoT for these scripts).
TR_BAKED_ERRATA='folder:/Users/akolesni/Work/claude-task-router-releases/errata'; case "$TR_BAKED_ERRATA" in *__*) TR_BAKED_ERRATA="disabled";; esac  # baked from IDE settings. Guard MUST be *__* — NOT the token name: the generator global-replaces folder:/Users/akolesni/Work/claude-task-router-releases/errata EVERYWHERE, so a token-named pattern becomes the value and always matches (resetting every real value to disabled).
export TASK_ROUTER_ERRATA_CHANNEL="${TASK_ROUTER_ERRATA_CHANNEL:-$TR_BAKED_ERRATA}"  # a value inherited from your shell wins — flagged at startup
export TASK_ROUTER_ERRATA_PUBKEY_PATH="${TASK_ROUTER_ERRATA_PUBKEY_PATH:-}"
export TASK_ROUTER_CLAUDE_FLAGS="${TASK_ROUTER_CLAUDE_FLAGS:---dangerously-skip-permissions}"
export TASK_ROUTER_MODEL_BY_ROLE="${TASK_ROUTER_MODEL_BY_ROLE:-{}}"
export TASK_ROUTER_IDLE_SHUTDOWN="${TASK_ROUTER_IDLE_SHUTDOWN:-0}"  # 0 = always-on (headless contract)
# v2.0 access-control (baked from IDE settings; empty = off / loopback-only). Single-quoted + *__*-guarded
# like ERRATA above, so a leftover placeholder falls back to EMPTY — the server/App validate IPs and would
# refuse to start on a literal token. Overridable at launch via each TASK_ROUTER_* env var.
TR_BAKED_UI_IP_ALLOW=''; case "$TR_BAKED_UI_IP_ALLOW" in *__*) TR_BAKED_UI_IP_ALLOW="";; esac
export TASK_ROUTER_UI_IP_ALLOWLIST="${TASK_ROUTER_UI_IP_ALLOWLIST:-$TR_BAKED_UI_IP_ALLOW}"        # dashboard client-IP allow-list
TR_BAKED_UI_HOSTS=''; case "$TR_BAKED_UI_HOSTS" in *__*) TR_BAKED_UI_HOSTS="";; esac
export TASK_ROUTER_UI_ALLOWED_HOSTS="${TASK_ROUTER_UI_ALLOWED_HOSTS:-$TR_BAKED_UI_HOSTS}"          # dashboard extra Host names
TR_BAKED_SRV_IP_ALLOW=''; case "$TR_BAKED_SRV_IP_ALLOW" in *__*) TR_BAKED_SRV_IP_ALLOW="";; esac
export TASK_ROUTER_SERVER_IP_ALLOWLIST="${TASK_ROUTER_SERVER_IP_ALLOWLIST:-$TR_BAKED_SRV_IP_ALLOW}"  # federation client-IP allow-list
export TASK_ROUTER_WORKFLOW_BACKEND="${TASK_ROUTER_WORKFLOW_BACKEND:-auto}"          # dynamic workflows: auto | native | node
# TASK_ROUTER_WORKFLOW_MODEL — OPTIONAL workflow sub-agent ceiling. Left UNSET on purpose: the runner caps
# sub-agents at the specialist's OWN model (TASK_ROUTER_MODEL). Export it only to cap workflows cheaper
# than the specialist (e.g. claude-haiku-4-5).
# Defensive: if a generator left a placeholder unsubstituted, fall back to the safe default so
# the App/server never receives a literal token. The guard pattern MUST be *__* (any
# double-underscore) — NOT the var's own token (e.g. *folder:/Users/akolesni/Work/claude-task-router-releases/errata*). Both generators
# (the extension's substituteLauncher and init.sh's sed) global-replace each __TOKEN__
# EVERYWHERE it appears, INCLUDING inside a case pattern — so a token-named guard becomes
# *<the substituted value>* and then always matches its own value, wiping every real setting to
# the default. *__* contains no token, so it survives substitution and only fires on a genuinely
# leftover placeholder. Trade-off: a real value containing "__" (e.g. folder:/opt/errata__v2) is
# also reset — a documented, rare edge; keep "__" out of errata paths/hosts.
case "$HOST" in *__*) HOST="127.0.0.1";; esac
# (errata channel is guarded once, at its bake on the TR_BAKED_ERRATA line above — not re-guarded here)
case "$TASK_ROUTER_ERRATA_PUBKEY_PATH" in *__*) TASK_ROUTER_ERRATA_PUBKEY_PATH="";; esac
case "$TASK_ROUTER_CLAUDE_FLAGS" in *__*) TASK_ROUTER_CLAUDE_FLAGS="--dangerously-skip-permissions";; esac
case "$TASK_ROUTER_MODEL_BY_ROLE" in *__*) TASK_ROUTER_MODEL_BY_ROLE="{}";; esac
case "$TASK_ROUTER_IDLE_SHUTDOWN" in *__*|*[!0-9]*) TASK_ROUTER_IDLE_SHUTDOWN="0";; esac

command -v node >/dev/null 2>&1 || { echo "node not found on PATH. Install Node.js >= 18." >&2; exit 1; }

# Locate the bundled app: an explicit override (headless box — extract the VSIX
# and point here), otherwise the NEWEST installed Task Router extension across the
# supported IDEs.
APP="${TASK_ROUTER_APP:-}"
if [ -z "$APP" ]; then
  # Newest installed Task Router extension that ACTUALLY bundles the host
  # (app/bin/app.js) — compare by VERSION across IDEs, and skip older installs
  # that predate the bundled host. (A non-matching glob stays literal and fails
  # the -f test, so it's harmless under set -u.)
  best="" ; bestver=""
  for d in "$HOME"/.cursor/extensions/kommisar.claude-task-router-*/ \
           "$HOME"/.vscode/extensions/kommisar.claude-task-router-*/ \
           "$HOME"/.vscode-server/extensions/kommisar.claude-task-router-*/ \
           "$HOME"/.antigravity/extensions/kommisar.claude-task-router-*/ ; do
    d="${d%/}"
    [ -f "$d/app/bin/app.js" ] || continue
    ver="${d##*-}"
    if [ -z "$bestver" ] || [ "$(printf '%s\n%s\n' "$bestver" "$ver" | sort -V | tail -1)" = "$ver" ]; then
      best="$d" ; bestver="$ver"
    fi
  done
  [ -n "$best" ] && APP="$best/app/bin/app.js"
fi
if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  echo "Task Router app not found." >&2
  echo "Install the Task Router extension (it bundles the headless host), or set:" >&2
  echo "  TASK_ROUTER_APP=/path/to/extracted-vsix/app/bin/app.js  ./start-Majordomos.sh" >&2
  exit 1
fi

# First-use prerequisites: node-pty (the headless agent-terminal driver) is a SYSTEM
# dependency installed once with `npm install -g`, NOT bundled in the VSIX — so it survives
# extension updates. If it doesn't resolve from the global npm root, run the bundled installer
# once. If it can't be installed (no prebuild + no toolchain) we still launch — the supervisor
# reports it cleanly and the rest of the app works.
APP_DIR="$(dirname "$(dirname "$APP")")"
g_root="$(npm root -g 2>/dev/null || true)"
u_root="$HOME/.claude-task-router/native/node_modules"   # no-sudo fallback location
if ! { { [ -n "$g_root" ] && node -e "require('$g_root/node-pty')" >/dev/null 2>&1; } || \
       node -e "require('$u_root/node-pty')" >/dev/null 2>&1; }; then
  if [ -f "$APP_DIR/scripts/setup-app.sh" ]; then
    echo "First run: installing headless-terminal prerequisites (node-pty)…"
    bash "$APP_DIR/scripts/setup-app.sh" --install || \
      echo "  (prerequisite install reported issues — continuing; agent terminals may be unavailable)" >&2
  fi
fi

UI_URL_HOST="$UI_HOST"; [ "$UI_HOST" = "0.0.0.0" ] && UI_URL_HOST="<this-host-ip>"
echo "Majordomos host -> http://$UI_URL_HOST:$UI_PORT  (app: $APP)"
if [ "$TASK_ROUTER_ERRATA_CHANNEL" != "$TR_BAKED_ERRATA" ]; then
  echo "  errata channel: $TASK_ROUTER_ERRATA_CHANNEL  <- inherited from your shell (launcher default is '$TR_BAKED_ERRATA'). To use the default:  unset TASK_ROUTER_ERRATA_CHANNEL"
else
  echo "  errata channel: $TASK_ROUTER_ERRATA_CHANNEL"
fi
[ "$HOST" != "127.0.0.1" ] && echo "  remote federation enabled on $HOST:3100 — callers need a grant token (trtok_…); open the firewall port."
[ "$UI_HOST" != "127.0.0.1" ] && echo "  WARNING: dashboard exposed on $UI_HOST with NO auth — trusted network only."
if [ "${RESTART_SERVER:-}" = "1" ]; then
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" --host "$HOST" --ui-host "$UI_HOST" --restart-server "$@"
else
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" --host "$HOST" --ui-host "$UI_HOST" "$@"
fi
