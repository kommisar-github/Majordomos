#!/usr/bin/env bash
# launch-ha-devops.sh — Operator entry-point to start the ha_devops privileged terminal.
#
# Mints a per-session cap-token (trha_<32hex>, 128-bit CSPRNG entropy), writes the
# SHA-256 hash (NEVER the raw token) to fleet/ha_devops_session.json, registers
# ha_devops with the Task Router, then launches claude with HA_DEVOPS_CAP_TOKEN in
# env.  On exit: unregisters ha_devops and deletes the session file (fail-closed gate).
#
# Usage:
#   bash host/launch-ha-devops.sh
#
# Prerequisites (see doc/runbooks/ha_deploy.md §1):
#   - Task Router running on localhost:3100
#   - HA_BASE_URL and HA_TOKEN set in .env (or exported already)
#   - claude CLI in PATH and authenticated
#
# /ops W4 deliverable — Q-HA-CONFIGWRITE §2.3.
# /app W4b flag: supervisor.js / launchCommand.js must replicate this mint + inject
# logic in Node when spawning the ha_devops agent terminal. See ha_deploy.md §8.

set -euo pipefail

PORT=${TASK_ROUTER_PORT:-3100}
PROJECT=${TASK_ROUTER_PROJECT:-Majordomos}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SESSION_FILE="${REPO_ROOT}/fleet/ha_devops_session.json"

# ── Load .env (fallback for manual launch; launchd / extension inject env directly) ──
ROOT_ENV="${REPO_ROOT}/.env"
if [ -f "${ROOT_ENV}" ]; then
  # shellcheck source=/dev/null
  set -a; . "${ROOT_ENV}"; set +a
fi

# ── Preflight ─────────────────────────────────────────────────────────────────
if ! curl -s "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
  echo "[ha-devops] ERROR: Task Router not running on port ${PORT}." >&2
  echo "[ha-devops] Start it first: bash .claude/mcp/task-router/start.sh" >&2
  exit 1
fi

if ! command -v claude > /dev/null 2>&1; then
  echo "[ha-devops] ERROR: claude CLI not found in PATH." >&2
  exit 1
fi

if ! command -v node > /dev/null 2>&1; then
  echo "[ha-devops] ERROR: node not found — required to mint cap-token." >&2
  exit 1
fi

# ── Mint cap-token (trha_ + 32 hex chars = 128-bit CSPRNG entropy) ────────────
# Node is guaranteed available (it runs the Task Router).
# Raw token injected ONLY into this process's env — never logged, never written to disk.
RAW_HEX=$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
CAP_TOKEN="trha_${RAW_HEX}"

# SHA-256 hash: value passed via env var to avoid any shell-quoting risk.
TOKEN_HASH=$(HA_DEV_RAW="${CAP_TOKEN}" node -e \
  "process.stdout.write(require('crypto').createHash('sha256').update(process.env.HA_DEV_RAW).digest('hex'))")

REGISTERED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── Write session file BEFORE POST /api/register (§2.3 ordering) ─────────────
# Avoids a window where ha_devops is registered but executeConfigWrite would reject it.
# Only the hash goes to disk — raw token never touches the filesystem.
mkdir -p "${REPO_ROOT}/fleet"
printf '{"cap_token_hash":"%s","agent":"ha_devops","registered_at":"%s"}\n' \
  "${TOKEN_HASH}" "${REGISTERED_AT}" > "${SESSION_FILE}"
chmod 600 "${SESSION_FILE}"

# ── Register ha_devops with Task Router ──────────────────────────────────────
TR_HEADERS=(-H "Content-Type: application/json")
if [ -n "${TASK_ROUTER_API_KEY:-}" ]; then
  TR_HEADERS+=(-H "X-Task-Router-Key: ${TASK_ROUTER_API_KEY}")
fi
curl -s -o /dev/null -X POST "${TR_HEADERS[@]}" \
  -d "{\"name\":\"ha_devops\",\"project\":\"${PROJECT}\",\"capabilities\":[\"ha-config-deploy\"]}" \
  "http://127.0.0.1:${PORT}/api/register?project=${PROJECT}" 2>/dev/null || true

echo "[ha-devops] Session ready — cap-token minted, hash written, ha_devops registered."
echo "[ha-devops] Gate is OPEN: config-writes permitted for this session."

# ── Cleanup on exit (pty exit handler — restores fail-closed gate) ────────────
# Note: trap fires on normal exit and SIGTERM/SIGINT. Does NOT fire on SIGKILL.
# If killed: manually delete fleet/ha_devops_session.json to close the gate.
_ha_devops_cleanup() {
  echo ""
  echo "[ha-devops] Closing session..."
  rm -f "${SESSION_FILE}" 2>/dev/null || true
  curl -s -o /dev/null -X POST "${TR_HEADERS[@]}" \
    -d "{\"name\":\"ha_devops\",\"project\":\"${PROJECT}\"}" \
    "http://127.0.0.1:${PORT}/api/unregister?project=${PROJECT}" 2>/dev/null || true
  echo "[ha-devops] Session file deleted. ha_devops unregistered. Gate is CLOSED."
}
trap _ha_devops_cleanup EXIT

# ── Launch claude as ha_devops agent ─────────────────────────────────────────
# HA_DEVOPS_CAP_TOKEN is exported here — raw token lives only in this env scope.
# Not using exec so the EXIT trap fires when claude exits (exec would replace the
# bash process and lose the trap).
#
# SECURITY: strip HA secrets from the child env BEFORE launching claude.
# ha_devops must reach HA only through the loopback cap-token executor (port 3101),
# not via raw curl with HA_TOKEN. The executor (app serverHost) holds HA_TOKEN
# separately — ha_devops does not need it. Unset here makes the bypass
# "structurally impossible" rather than "behaviorally unlikely".
unset HA_TOKEN HA_BASE_URL

export TASK_ROUTER_AGENT=ha_devops
export TASK_ROUTER_PROJECT="${PROJECT}"
export HA_DEVOPS_CAP_TOKEN="${CAP_TOKEN}"

claude --agent ha_devops_agent /ha_devops "$@"
