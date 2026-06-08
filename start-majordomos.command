#!/usr/bin/env bash
# start-majordomos.command — macOS double-clickable launcher that starts the Claude
# Task Router standalone host for THIS project (Majordomos).
#
# Self-contained: the project root is this script's own folder, and the host is invoked
# as the installed `task-router-app` command — exactly like this project already depends
# on `node`, `git`, and `claude`. There are NO references to any task-router source repo.
#
# One-time install of the host command (from your claude-task-router checkout):
#   npm install -g ./mcp-task-router-app        # or, for dev:  cd mcp-task-router-app && npm link
# (`task-router-app` is the bin declared by mcp-task-router-app/package.json.)
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

command -v node >/dev/null 2>&1 || { echo "node not found on PATH. Install Node.js >= 18 (e.g. 'brew install node')." >&2; exit 1; }
command -v task-router-app >/dev/null 2>&1 || {
  echo "'task-router-app' is not on PATH. Install the standalone host once:" >&2
  echo "  npm install -g <your claude-task-router checkout>/mcp-task-router-app   # or: npm link" >&2
  exit 1
}

if [ ! -f "$PROJECT_ROOT/.claude/mcp/task-router/agents.json" ]; then
  echo "warning: $PROJECT_ROOT is not bootstrapped (no .claude/mcp/task-router/agents.json) — the roster will be empty." >&2
fi

echo "Majordomos host → http://127.0.0.1:$UI_PORT  (server :$PORT)"
echo "Project root    → $PROJECT_ROOT"

# Optionally pop the dashboard once the UI port answers (backgrounded; never blocks).
if [ "${OPEN_BROWSER:-0}" = "1" ] && command -v open >/dev/null 2>&1; then
  ( for _ in $(seq 1 40); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$UI_PORT/app/info" 2>/dev/null; then open "http://127.0.0.1:$UI_PORT"; break; fi
      sleep 0.5
    done ) &
fi

exec task-router-app --project "$PROJECT_NAME=$PROJECT_ROOT" --port "$PORT" --ui-port "$UI_PORT"
