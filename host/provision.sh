#!/usr/bin/env bash
# Majordomus host preflight (Phase 0 / gap G1). Run on the macOS host BEFORE
# enabling always-on. Read-only: it asserts prerequisites, changes nothing.
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

# node-pty build toolchain (optional dep) — informational
warn "node-pty native build needs Xcode Command Line Tools: xcode-select --install"

echo ""
if [ "$fail" = 0 ]; then echo "Preflight PASS — host ready to run the Majordomus app."; else echo "Preflight FAIL — resolve the FAIL items before enabling always-on."; fi
exit "$fail"
