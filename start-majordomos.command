#!/usr/bin/env bash
# start-majordomos.command — macOS double-clickable launcher that starts the Claude
# Task Router standalone host for THIS project (Majordomos).
#
# It lives in the Majordomos repo, so the project root is simply this script's folder —
# nothing to configure for the project. It only needs to find your separate
# `claude-task-router` checkout (which contains the standalone app, mcp-task-router-app).
#
# Usage:
#   • Finder: double-click. First time, right-click → Open to clear Gatekeeper,
#     or run once:  chmod +x start-majordomos.command
#   • Terminal:  ./start-majordomos.command
#
# Dashboard: http://127.0.0.1:3200  •  router server: :3100 (attaches if already live).
# Stop with Ctrl+C (or close the Terminal window).
set -euo pipefail

PROJECT_NAME="majordomos"   # the name shown in the dashboard's Project dropdown
UI_PORT=3200                # web dashboard (127.0.0.1 only)
PORT=3100                   # router server (attaches if one is already live here)
OPEN_BROWSER=1              # 1 = open the dashboard in your browser once it's up

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"  # this script sits at the Majordomos repo root

# ============================ EDIT ME (only if auto-detect fails) ============================
# Path to your claude-task-router checkout — the repo that holds
# mcp-task-router-app/bin/app.js. Leave blank to auto-detect (sibling of this repo,
# then common macOS / OneDrive paths).
TASK_ROUTER_DIR="${TASK_ROUTER_DIR:-}"     # e.g. "$HOME/Documents/GitHub/claude-task-router"
# ============================================================================================

command -v node >/dev/null 2>&1 || { echo "node not found on PATH. Install Node.js >= 18 (e.g. 'brew install node')." >&2; exit 1; }

# ---- RESOLVE the standalone app entry (bin/app.js in the claude-task-router checkout) ----
CANDIDATES=()
[ -n "${TASK_ROUTER_DIR:-}" ] && CANDIDATES+=("$TASK_ROUTER_DIR")
CANDIDATES+=(
  "$(dirname "$PROJECT_ROOT")/claude-task-router"     # sibling checkout (the usual layout)
  "$HOME/Library/CloudStorage/OneDrive-HomeOffice/MyProjects/GitHub/claude-task-router"
  "$HOME/Library/CloudStorage/OneDrive-Personal/MyProjects/GitHub/claude-task-router"
  "$HOME/OneDrive - Home Office/MyProjects/GitHub/claude-task-router"
  "$HOME/MyProjects/GitHub/claude-task-router"
  "$HOME/GitHub/claude-task-router"
  "$HOME/Projects/claude-task-router"
  "$HOME/claude-task-router"
)

ENTRY=""
for c in "${CANDIDATES[@]}"; do
  if [ -f "$c/mcp-task-router-app/bin/app.js" ]; then ENTRY="$c/mcp-task-router-app/bin/app.js"; break; fi
done

if [ -z "$ENTRY" ]; then
  echo "Could not find your claude-task-router checkout (mcp-task-router-app/bin/app.js). Tried:" >&2
  for c in "${CANDIDATES[@]}"; do echo "  - $c/mcp-task-router-app/bin/app.js" >&2; done
  echo "Set TASK_ROUTER_DIR (in the EDIT ME block or the environment) to the checkout path, e.g.:" >&2
  echo "  TASK_ROUTER_DIR=\"\$HOME/path/to/claude-task-router\" \"$0\"" >&2
  exit 1
fi

if [ ! -f "$PROJECT_ROOT/.claude/mcp/task-router/agents.json" ]; then
  echo "warning: $PROJECT_ROOT is not bootstrapped (no .claude/mcp/task-router/agents.json) — the roster will be empty." >&2
fi

echo "Majordomos host → http://127.0.0.1:$UI_PORT  (server :$PORT)"
echo "Project root    → $PROJECT_ROOT"
echo "App entry       → $ENTRY"

# Optionally pop the dashboard once the UI port answers (backgrounded; never blocks).
if [ "${OPEN_BROWSER:-0}" = "1" ] && command -v open >/dev/null 2>&1; then
  ( for _ in $(seq 1 40); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$UI_PORT/app/info" 2>/dev/null; then open "http://127.0.0.1:$UI_PORT"; break; fi
      sleep 0.5
    done ) &
fi

exec node "$ENTRY" --project "$PROJECT_NAME=$PROJECT_ROOT" --port "$PORT" --ui-port "$UI_PORT"
