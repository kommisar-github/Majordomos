#!/usr/bin/env bash
# start-majordomos — launch the headless Task Router host for this project,
# using the app bundled inside your installed Task Router extension. No per-project
# server or app copy: the app finds the extension's bundled server and starts a
# shared, detached :3100 server if one isn't already up (the extension and other
# projects' apps attach to that same server).
#
#   Finder (macOS): double-click start-majordomos.command
#                   (first time: right-click -> Open to clear Gatekeeper).
#   Terminal:       ./start-majordomos.sh
#
# Several projects on one machine: give each its own UI port (they share :3100):
#   UI_PORT=3201 ./start-majordomos.sh
# Restart the shared server on start (e.g. after an extension update):
#   RESTART_SERVER=1 ./start-majordomos.sh   (or pass --restart-server)
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="majordomos"
UI_PORT="${UI_PORT:-3200}"

# Load repo-root .env into the environment so ${VAR} references in .mcp.json
# (e.g. HA_BASE_URL / HA_TOKEN) resolve at MCP-connection time. Claude Code expands
# ${VAR} from the process environment only — it does not read .env itself.
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

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
  echo "  TASK_ROUTER_APP=/path/to/extracted-vsix/app/bin/app.js  ./start-majordomos.sh" >&2
  exit 1
fi

echo "majordomos host -> http://127.0.0.1:$UI_PORT  (app: $APP)"
if [ "${RESTART_SERVER:-}" = "1" ]; then
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" --restart-server "$@"
else
  exec node "$APP" --project "$PROJECT_NAME=$PROJECT_ROOT" --ui-port "$UI_PORT" "$@"
fi
