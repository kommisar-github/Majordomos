#!/usr/bin/env bash
# Majordomus host preflight + secrets injection (macOS).
#
# Usage:
#   bash host/provision.sh                  # Phase 0: assert prerequisites (read-only)
#   bash host/provision.sh --inject-secrets # Phase 0 + Phase 2: also patch launchd plists
#
# Run Phase 0 alone first; resolve every FAIL before running --inject-secrets.
set -u
fail=0
ok()  { printf '  OK   %s\n' "$*"; }
bad() { printf '  FAIL %s\n' "$*"; fail=1; }
warn(){ printf '  WARN %s\n' "$*"; }

echo "=== Majordomus host preflight (macOS) ==="

# Node >= 18
if command -v node >/dev/null 2>&1; then
  v=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$v" -ge 18 ]; then ok "node $(node -v)"; else bad "node $(node -v) < 18"; fi
else bad "node not found"; fi

# git
if command -v git >/dev/null 2>&1; then ok "git $(git --version | awk '{print $3}')"; else bad "git not found"; fi

# claude CLI + NON-INTERACTIVE auth (G1 — a headless host cannot do a browser login)
if command -v claude >/dev/null 2>&1; then
  ok "claude present ($(claude --version 2>/dev/null | head -1))"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then ok "ANTHROPIC_API_KEY set (headless auth)"
  else warn "no ANTHROPIC_API_KEY — confirm a stored credential exists; the always-on PM cannot do an interactive login (G1)."; fi
else bad "claude CLI not found (required to run agents)"; fi

# Tailscale (G3 mesh)
if command -v tailscale >/dev/null 2>&1; then
  if tailscale status >/dev/null 2>&1; then ok "tailscale up ($(tailscale ip -4 2>/dev/null | head -1))"; else bad "tailscale installed but not up (run: tailscale up)"; fi
else warn "tailscale not found — required for the federation/HA mesh (G3) unless using LAN + TLS."; fi

# majordomus-daemon Node dependencies (ha-bridge.js requires 'ws' at module load)
# package-lock.json is committed → use npm ci; fall back to npm install if lock absent.
REPO_ROOT_PROV="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DEP_DIR="$REPO_ROOT_PROV/majordomus-daemon"
if [ -d "$APP_DEP_DIR" ]; then
  if [ -d "$APP_DEP_DIR/node_modules" ]; then
    ok "majordomus-daemon node_modules present"
  else
    printf '  INFO  majordomus-daemon/node_modules absent — installing...\n'
    if [ -f "$APP_DEP_DIR/package-lock.json" ]; then
      ( cd "$APP_DEP_DIR" && npm ci --silent ) \
        && ok "majordomus-daemon npm ci done" \
        || bad "majordomus-daemon npm ci failed — run manually: ( cd majordomus-daemon && npm ci )"
    else
      ( cd "$APP_DEP_DIR" && npm install --silent ) \
        && ok "majordomus-daemon npm install done" \
        || bad "majordomus-daemon npm install failed"
    fi
  fi
else
  warn "majordomus-daemon dir not found at $APP_DEP_DIR"
fi

# node-pty build toolchain (optional dep) — informational
# NOTE: a Node version bump forces a native rebuild of node-pty (the one native dep).
# After any Node upgrade, re-run install in majordomus-daemon/ and the global node-pty:
#   ( cd majordomus-daemon && npm ci )   # project deps
#   npm install -g node-pty                # or run start-majordomos.sh which auto-reinstalls
warn "node-pty native build needs Xcode Command Line Tools: xcode-select --install"

echo ""
if [ "$fail" = 0 ]; then echo "Preflight PASS — host ready to run the Majordomus app."; else echo "Preflight FAIL — resolve the FAIL items before enabling always-on."; fi

# ─── Phase 2 — inject secrets into launchd plists (opt-in) ───────────────────
if [ "${1:-}" = "--inject-secrets" ]; then
  echo ""
  echo "=== Phase 2: inject secrets into launchd plists ==="

  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  ROOT_ENV="$REPO_ROOT/.env"
  TG_ENV="$REPO_ROOT/.claude/mcp/telegram-bridge/.env"
  PLIST_DIR="$REPO_ROOT/host/launchd"
  TR_PLIST="$PLIST_DIR/com.majordomus.taskrouter.plist"
  TG_PLIST="$PLIST_DIR/com.majordomus.telegram.plist"
  PB="/usr/libexec/PlistBuddy"

  if [ ! -f "$ROOT_ENV" ]; then bad ".env not found at $REPO_ROOT/.env — create it first (see doc/design/host_ops.md)"; exit 1; fi
  # Load root .env
  set -a; . "$ROOT_ENV"; set +a

  # Load telegram .env if present
  if [ -f "$TG_ENV" ]; then set -a; . "$TG_ENV"; set +a
  else warn "telegram .env not found at $TG_ENV — telegram plist will have placeholder values"; fi

  pb_set() {
    # Usage: pb_set <plist> <key-path> <value>
    "$PB" -c "Set $2 $3" "$1" 2>/dev/null || "$PB" -c "Add $2 string $3" "$1"
  }

  HOME_DIR="$HOME"

  # ── Task Router plist ────────────────────────────────────────────────────────
  if [ ! -f "$TR_PLIST" ]; then bad "Task Router plist not found: $TR_PLIST"; else
    echo "  Patching $TR_PLIST ..."
    # ProgramArguments[2] = script path
    "$PB" -c "Set :ProgramArguments:2 ${REPO_ROOT}/start-majordomos.sh" "$TR_PLIST"
    pb_set "$TR_PLIST" ":WorkingDirectory" "$REPO_ROOT"
    pb_set "$TR_PLIST" ":EnvironmentVariables:ANTHROPIC_API_KEY" "${ANTHROPIC_API_KEY:-}"
    pb_set "$TR_PLIST" ":EnvironmentVariables:TASK_ROUTER_API_KEY" "${TASK_ROUTER_API_KEY:-}"
    pb_set "$TR_PLIST" ":EnvironmentVariables:HA_BASE_URL" "${HA_BASE_URL:-}"
    pb_set "$TR_PLIST" ":EnvironmentVariables:HA_TOKEN" "${HA_TOKEN:-}"
    pb_set "$TR_PLIST" ":EnvironmentVariables:HOME" "$HOME_DIR"
    pb_set "$TR_PLIST" ":StandardOutPath" "${HOME_DIR}/Library/Logs/majordomus/taskrouter.log"
    pb_set "$TR_PLIST" ":StandardErrorPath" "${HOME_DIR}/Library/Logs/majordomus/taskrouter.err"
    ok "Task Router plist patched"
  fi

  # ── Telegram bridge plist ────────────────────────────────────────────────────
  if [ ! -f "$TG_PLIST" ]; then bad "Telegram plist not found: $TG_PLIST"; else
    echo "  Patching $TG_PLIST ..."
    BOT_JS="${REPO_ROOT}/.claude/mcp/telegram-bridge/bot.js"
    "$PB" -c "Set :ProgramArguments:3 exec node ${BOT_JS}" "$TG_PLIST"
    pb_set "$TG_PLIST" ":WorkingDirectory" "${REPO_ROOT}/.claude/mcp/telegram-bridge"
    pb_set "$TG_PLIST" ":EnvironmentVariables:TELEGRAM_BOT_TOKEN" "${TELEGRAM_BOT_TOKEN:-}"
    pb_set "$TG_PLIST" ":EnvironmentVariables:TELEGRAM_ALLOWED_USER" "${TELEGRAM_ALLOWED_USER:-}"
    pb_set "$TG_PLIST" ":EnvironmentVariables:TASK_ROUTER_API_KEY" "${TASK_ROUTER_API_KEY:-}"
    pb_set "$TG_PLIST" ":EnvironmentVariables:HOME" "$HOME_DIR"
    pb_set "$TG_PLIST" ":StandardOutPath" "${HOME_DIR}/Library/Logs/majordomus/telegram.log"
    pb_set "$TG_PLIST" ":StandardErrorPath" "${HOME_DIR}/Library/Logs/majordomus/telegram.err"
    ok "Telegram bridge plist patched"
  fi

  # ── Create log directory ─────────────────────────────────────────────────────
  mkdir -p "${HOME_DIR}/Library/Logs/majordomus"
  ok "Log directory ready: ~/Library/Logs/majordomus/"

  echo ""
  echo "Phase 2 complete. Next steps:"
  echo "  1. Verify: plutil -lint host/launchd/com.majordomus.taskrouter.plist"
  echo "  2. Load:   launchctl bootstrap gui/\$(id -u) \\"
  echo "               \"\$PWD/host/launchd/com.majordomus.taskrouter.plist\""
  echo "  3. Load:   launchctl bootstrap gui/\$(id -u) \\"
  echo "               \"\$PWD/host/launchd/com.majordomus.telegram.plist\""
  echo "  4. Check:  launchctl list | grep majordomus"
  echo "  NOTE: the patched plists contain secrets — do NOT commit them after patching."
fi

exit "$fail"
