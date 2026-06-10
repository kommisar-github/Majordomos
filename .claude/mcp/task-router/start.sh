#!/usr/bin/env bash
# Auto-start claude-task-router if not already running, then register this
# session's project as a tenant (v0.4.0 multi-tenant).
# Called by Claude Code SessionStart hook.

PORT=${TASK_ROUTER_PORT:-3100}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Resolve repo root (two parents above .claude/mcp/task-router/)
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DB_PATH="$SCRIPT_DIR/task-router.db"

# Pre-seed OAuth token so Claude Code sessions auto-connect without browser auth
seed_oauth() {
  node "$SCRIPT_DIR/seed-oauth.js" 2>/dev/null
}

# v0.4.0: register this workspace as a tenant. Idempotent — subsequent calls
# with the same dbPath return 200 (or 409 with a clear message if dbPath
# differs). Skips silently if TASK_ROUTER_PROJECT is unset (caller is responsible).
register_tenant() {
  if [ -z "$TASK_ROUTER_PROJECT" ]; then
    return
  fi
  curl -s -o /dev/null -X POST \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$TASK_ROUTER_PROJECT\",\"root\":\"$REPO_ROOT\",\"dbPath\":\"$DB_PATH\"}" \
    "http://127.0.0.1:${PORT}/projects/register" 2>/dev/null
}

# v0.6.2: deterministic pre-launch agent registration. Idempotent on
# (agent, project). When this hook runs as part of a dedicated agent terminal
# (TASK_ROUTER_AGENT set), we register the agent BEFORE Claude Code loads
# its skill. The skill's Startup Sequence then hits an already-registered
# row — works even if the model can't reliably call the MCP register_agent
# tool (Haiku confabulates; pre-register makes it a non-issue).
preregister_agent() {
  if [ -z "$TASK_ROUTER_AGENT" ] || [ -z "$TASK_ROUTER_PROJECT" ]; then
    return
  fi
  local hdrs=(-H "Content-Type: application/json")
  if [ -n "$TASK_ROUTER_API_KEY" ]; then
    hdrs+=(-H "X-Task-Router-Key: $TASK_ROUTER_API_KEY")
  fi
  curl -s -o /dev/null -X POST \
    "${hdrs[@]}" \
    -d "{\"name\":\"$TASK_ROUTER_AGENT\",\"project\":\"$TASK_ROUTER_PROJECT\",\"capabilities\":[]}" \
    "http://127.0.0.1:${PORT}/api/register?project=${TASK_ROUTER_PROJECT}" 2>/dev/null
}

# Check if server is already running
if curl -s "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
  seed_oauth
  register_tenant
  # v4.0: deterministic SessionStart banner. Lets `/pm audit` and human
  # operators detect "agent running against a stale seed" without log spelunking.
  SEED_STATE_FILE="$REPO_ROOT/.claude/mcp/task-router/seed-state.json"
  if [ -f "$SEED_STATE_FILE" ]; then
    SEED_VER=$(grep -o '"seed_version"[^,}]*' "$SEED_STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/' || echo "unknown")
  else
    SEED_VER="unknown"
  fi
  CLIENT_PATH="$REPO_ROOT/.claude/mcp/task-router/client.js"
  if [ -f "$CLIENT_PATH" ]; then
    CLIENT_PROTO=$(grep -oE "node/v[0-9]+\.[0-9]+" "$CLIENT_PATH" 2>/dev/null | head -1)
    CLIENT_LABEL="${CLIENT_PROTO:-present}"
  else
    CLIENT_PROTO=""
    CLIENT_LABEL="missing"
  fi
  echo "[task-router] seed=v${SEED_VER} client=${CLIENT_LABEL} base=http://127.0.0.1:${PORT}"
  # Layer 1 (SEED_ARTIFACT_SYNC_PLAN): warn when the local seeded client.js is
  # behind the version this server bundles — the project's bundle-delivered
  # runtime artifacts have drifted behind its errata-delivered SKILLs.
  EXPECTED_PROTO=$(curl -s "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -oE '"expected_client_protocol":"node/v[0-9]+\.[0-9]+"' | grep -oE "node/v[0-9]+\.[0-9]+" | head -1)
  if [ -n "$CLIENT_PROTO" ] && [ -n "$EXPECTED_PROTO" ] && [ "$CLIENT_PROTO" != "$EXPECTED_PROTO" ]; then
    lv=$(echo "$CLIENT_PROTO"   | sed -E 's#node/v([0-9]+)\.([0-9]+)#\1 \2#')
    ev=$(echo "$EXPECTED_PROTO" | sed -E 's#node/v([0-9]+)\.([0-9]+)#\1 \2#')
    lnum=$(( ${lv%% *} * 100 + ${lv##* } )); enum=$(( ${ev%% *} * 100 + ${ev##* } ))
    if [ "$lnum" -lt "$enum" ]; then
      echo "[task-router] WARNING: seeded client ${CLIENT_PROTO} is behind the server's ${EXPECTED_PROTO} — your runtime artifacts (client.js) have drifted behind your seed. Re-run init.sh from the latest seed bundle (or /pm sync seed). See doc/plans/SEED_ARTIFACT_SYNC_PLAN.md." >&2
    fi
  fi
  exit 0
fi

# Start server in background, detached from terminal
cd "$SCRIPT_DIR"
nohup node bin/cli.js --port "$PORT" --ttl 3600 --task-timeout 10800 > task-router.log 2>&1 &

# Wait up to 3 seconds for server to be ready
start_telegram_bridge() {
  BRIDGE_DIR="$(cd "$(dirname "$0")/../telegram-bridge" 2>/dev/null && pwd)"
  if [ -z "$BRIDGE_DIR" ] || [ ! -f "$BRIDGE_DIR/.env" ]; then
    return
  fi
  # Already running?
  if pgrep -f "node.*telegram-bridge/bot.js" > /dev/null 2>&1; then
    return
  fi
  cd "$BRIDGE_DIR"
  [ ! -d "node_modules" ] && npm install --silent 2>/dev/null
  nohup node bot.js > telegram-bot.log 2>&1 &
  echo "telegram-bridge: started (PID $!)"
}

for i in 1 2 3; do
  sleep 1
  if curl -s "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
    seed_oauth
    register_tenant
    preregister_agent
    start_telegram_bridge
    exit 0
  fi
done

echo "task-router: failed to start on port ${PORT}" >&2
exit 1
