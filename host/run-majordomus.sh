#!/usr/bin/env bash
# Run the Majordomus app against THIS project.
# The standalone app (+ the reused mcp-task-router server) is installed from the
# seed repo — NOT vendored here (Q-APP-VENDORING resolved: install-on-host). The
# app's serverHost imports the server via a sibling path, so point SEED_REPO at a
# full claude-task-router clone.
set -eu
SEED_REPO="${SEED_REPO:-$HOME/GitHub/claude-task-router}"
MAJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$SEED_REPO/mcp-task-router-app"
[ -d "$APP" ] || { echo "seed app not found at $APP — set SEED_REPO to your claude-task-router clone"; exit 1; }
[ -d "$SEED_REPO/mcp-task-router" ] || { echo "server not found at $SEED_REPO/mcp-task-router (the app imports it via ../../)"; exit 1; }
( cd "$APP" && [ -d node_modules ] || npm install )
# Loopback for v1: outbound federation (PM is the client) + HA outbound need no
# inbound exposure. HA inbound + federation binding move to Tailscale in Phase 4/5.
exec node "$APP/bin/app.js" --project "majordomos=$MAJ_ROOT" --api-key-env TASK_ROUTER_API_KEY "$@"
