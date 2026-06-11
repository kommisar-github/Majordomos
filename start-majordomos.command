#!/usr/bin/env bash
# launcher-rev: 3   (bump when this template changes; the IDE auto-refreshes a project's
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
# Mode (default = control: this App owns the agents + a live terminal; closing it stops
# the fleet — the original in-house behavior):
#   ./start-Majordomos.sh --detached    agents run in their OWN terminal windows
#       (alias: --observe)                     that survive this App. On start it reconciles
#                                              against the server's live fleet (adopt vs
#                                              launch). Closing this window leaves the fleet
#                                              running; reconnect by re-running --detached.
#                                              There is no live terminal in the dashboard —
#                                              talk to an agent from its own window.
# Remote access (default is local-only): bind the server / dashboard to a LAN IP
# or 0.0.0.0. The server's remote surface is /api/federation/* (grant tokens) +
# /health only; the dashboard (UI_HOST) has NO auth, so trusted networks only:
#   TASK_ROUTER_HOST=0.0.0.0 TASK_ROUTER_UI_HOST=0.0.0.0 ./start-Majordomos.sh
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="Majordomos"
UI_PORT="${UI_PORT:-3200}"
HOST="${TASK_ROUTER_HOST:-127.0.0.1}"        # router server bind (default local-only)
UI_HOST="${TASK_ROUTER_UI_HOST:-127.0.0.1}"  # dashboard bind (NO auth — trusted net only)

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
[ "$HOST" != "127.0.0.1" ] && echo "  remote federation enabled on $HOST:3100 — callers need a grant token (trtok_…); open the firewall port."
[ "$UI_HOST" != "127.0.0.1" ] && echo "  WARNING: dashboard exposed on $UI_HOST with NO auth — trusted network only."
if [ "${RESTART_SERVER:-}" = "1" ]; then
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" --host "$HOST" --ui-host "$UI_HOST" --restart-server "$@"
else
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" --host "$HOST" --ui-host "$UI_HOST" "$@"
fi
