# launcher-rev: 6   (bump when this template changes; the IDE auto-refreshes a project's
#                    launchers when the bundled rev is higher — seedSync.ts. Absent = rev 0.)
# start-Majordomos.ps1 — launch the headless Task Router host for this project
# on Windows, using the app bundled inside your installed Task Router extension. No
# per-project server/app copy: the app finds the extension's bundled server and starts
# a shared, detached :3100 server if one isn't already up.
#
#   Right-click -> Run with PowerShell, or:   pwsh -File .\start-Majordomos.ps1
#   Second project on its own UI port:         $env:UI_PORT=3201; .\start-Majordomos.ps1
#   Restart the shared server on start:        .\start-Majordomos.ps1 -RestartServer
#   Launch kind is chosen PER AGENT in the dashboard (In-house: live terminal here, dies
#     with the App / Detached: own window, survives the App). These switches only set the
#     DEFAULT kind for "Launch All" / a card's primary click:
#       .\start-Majordomos.ps1 -Inhouse    default in-house (this is the default)
#       .\start-Majordomos.ps1 -Detached   default detached (alias: -Observe)
#     Either way you can pick the other per agent.
#   Take over a dashboard already running on this UI port (instead of an EADDRINUSE error):
#       .\start-Majordomos.ps1 -RestartApp
#   Start / restart the Telegram bridge with the App (headless parity with the IDE):
#       .\start-Majordomos.ps1 -Bridge          (or $env:TASK_ROUTER_BRIDGE=1)
#       .\start-Majordomos.ps1 -RestartBridge   (stop a running bridge, start fresh)
#   No-IDE box: set $env:TASK_ROUTER_APP to ...\app\bin\app.js
#   Remote access (default local-only): bind to a LAN IP or 0.0.0.0. The server's
#   remote surface is /api/federation/* (grant tokens) + /health only; the
#   dashboard (UI host) has NO auth, so use a trusted network only:
#     $env:TASK_ROUTER_HOST='0.0.0.0'; $env:TASK_ROUTER_UI_HOST='0.0.0.0'; .\start-Majordomos.ps1
param([switch]$RestartServer, [switch]$RestartApp, [switch]$Bridge, [switch]$RestartBridge, [switch]$Inhouse, [switch]$Detached, [switch]$Observe, [switch]$StopHost)
$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ProjectName = 'Majordomos'
$UiPort = if ($env:UI_PORT) { $env:UI_PORT } else { '3200' }
$BindHost = if ($env:TASK_ROUTER_HOST) { $env:TASK_ROUTER_HOST } else { '127.0.0.1' }  # router server bind
$UiHost   = if ($env:TASK_ROUTER_UI_HOST) { $env:TASK_ROUTER_UI_HOST } else { '127.0.0.1' } # dashboard bind (NO auth)

# --- Config inherited from the IDE extension (taskRouter.* workspace settings) ---
# The extension's launcher generator (seedSync.ts) BAKES the workspace settings into the
# __PLACEHOLDERS__ below; the headless host can't read VS Code settings at runtime. Each is
# overridable at launch via its TASK_ROUTER_* env var. See APP_STARTUP_SCRIPTS_GUIDEBOOK.md.
if (-not $env:TASK_ROUTER_ERRATA_CHANNEL)    { $env:TASK_ROUTER_ERRATA_CHANNEL = 'folder:/Users/akolesni/Work/claude-task-router-releases/errata' }
if (-not $env:TASK_ROUTER_ERRATA_PUBKEY_PATH){ $env:TASK_ROUTER_ERRATA_PUBKEY_PATH = '' }
if (-not $env:TASK_ROUTER_CLAUDE_FLAGS)      { $env:TASK_ROUTER_CLAUDE_FLAGS = '--dangerously-skip-permissions' }
if (-not $env:TASK_ROUTER_MODEL_BY_ROLE)     { $env:TASK_ROUTER_MODEL_BY_ROLE = '{}' }
if (-not $env:TASK_ROUTER_IDLE_SHUTDOWN)     { $env:TASK_ROUTER_IDLE_SHUTDOWN = '0' }
# Defensive: if a generator left a placeholder unsubstituted (still contains "__"), reset to a safe default.
if ($BindHost -like '*__*')                       { $BindHost = '127.0.0.1' }
if ($env:TASK_ROUTER_ERRATA_CHANNEL -like '*__*') { $env:TASK_ROUTER_ERRATA_CHANNEL = 'disabled' }
if ($env:TASK_ROUTER_ERRATA_PUBKEY_PATH -like '*__*') { $env:TASK_ROUTER_ERRATA_PUBKEY_PATH = '' }
if ($env:TASK_ROUTER_CLAUDE_FLAGS -like '*__*')   { $env:TASK_ROUTER_CLAUDE_FLAGS = '--dangerously-skip-permissions' }
if ($env:TASK_ROUTER_MODEL_BY_ROLE -like '*__*')  { $env:TASK_ROUTER_MODEL_BY_ROLE = '{}' }
if ($env:TASK_ROUTER_IDLE_SHUTDOWN -notmatch '^[0-9]+$') { $env:TASK_ROUTER_IDLE_SHUTDOWN = '0' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node not found on PATH. Install Node.js >= 18.'; exit 1
}

# Locate the bundled app: an explicit override, otherwise the NEWEST installed Task
# Router extension (across IDEs) that actually bundles app\bin\app.js.
$App = $env:TASK_ROUTER_APP
if (-not $App) {
  $roots = @(
    "$env:USERPROFILE\.cursor\extensions",
    "$env:USERPROFILE\.vscode\extensions",
    "$env:USERPROFILE\.vscode-server\extensions",
    "$env:USERPROFILE\.antigravity\extensions"
  )
  $cands = foreach ($r in $roots) {
    if (Test-Path $r) {
      Get-ChildItem -Path $r -Directory -Filter 'kommisar.claude-task-router-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'app\bin\app.js') } |
        ForEach-Object {
          $v = $_.Name -replace '.*-', ''
          try { [pscustomobject]@{ Path = $_.FullName; Ver = [version]$v } } catch {}
        }
    }
  }
  $best = $cands | Sort-Object Ver | Select-Object -Last 1
  if ($best) { $App = Join-Path $best.Path 'app\bin\app.js' }
}
if (-not $App -or -not (Test-Path $App)) {
  Write-Error "Task Router app not found. Install the Task Router extension (it bundles the headless host), or set `$env:TASK_ROUTER_APP to an extracted VSIX's app\bin\app.js."
  exit 1
}

# First-use prerequisites: node-pty (the headless agent-terminal driver) is a SYSTEM
# dependency installed once with `npm install -g`, NOT bundled in the VSIX - so it survives
# extension updates. If it doesn't resolve from the global npm root, run the bundled installer
# once. If it can't be installed we still launch - the supervisor reports it cleanly.
$AppDir = Split-Path -Parent (Split-Path -Parent $App)
$gRoot = ""; try { $gRoot = (npm root -g 2>$null | Out-String).Trim() } catch {}
$uRoot = Join-Path $env:USERPROFILE '.claude-task-router\native\node_modules'   # no-admin fallback
$ptyOk = $false
if ($gRoot) { node -e "require('$(( $gRoot -replace '\\','/' ))/node-pty')" 2>$null; $ptyOk = ($LASTEXITCODE -eq 0) }
if (-not $ptyOk) { node -e "require('$(( $uRoot -replace '\\','/' ))/node-pty')" 2>$null; $ptyOk = ($LASTEXITCODE -eq 0) }
if (-not $ptyOk) {
  $setup = Join-Path $AppDir 'scripts\setup-app.ps1'
  if (Test-Path $setup) {
    Write-Host "First run: installing headless-terminal prerequisites (node-pty, global)..."
    try { & $setup -Install }
    catch { Write-Warning "prerequisite install reported issues - continuing; agent terminals may be unavailable" }
  }
}

$cliArgs = @('--project', "$ProjectName=$ProjectRoot", '--ui-port', "$UiPort", '--host', $BindHost, '--ui-host', $UiHost)
if ($RestartServer -or $env:RESTART_SERVER -eq '1') { $cliArgs += '--restart-server' }
if ($RestartApp) { $cliArgs += '--restart-app' }
if ($Bridge -or $env:TASK_ROUTER_BRIDGE -eq '1') { $cliArgs += '--bridge' }
if ($RestartBridge) { $cliArgs += '--restart-bridge' }
# Default launch kind (per-agent choice lives in the dashboard; this only sets the default
# for "Launch All" / a card's primary click). Explicit switches (passing raw --flags through
# PowerShell is unreliable). $env:TASK_ROUTER_APP_MODE (inhouse|detached) is also honored.
$wantDetached = $Detached -or $Observe -or ($env:TASK_ROUTER_APP_MODE -in @('detached','observe','observer'))
if ($Inhouse) { $cliArgs += '--inhouse' }
elseif ($wantDetached) { $cliArgs += '--detached' }
if ($StopHost) { $cliArgs += '--stop-host' }
$UiUrlHost = if ($UiHost -eq '0.0.0.0') { '<this-host-ip>' } else { $UiHost }
Write-Host "Majordomos host -> http://${UiUrlHost}:$UiPort  (app: $App)"
if ($BindHost -ne '127.0.0.1') { Write-Host "  remote federation enabled on ${BindHost}:3100 - callers need a grant token (trtok_...); open the firewall port." -ForegroundColor Yellow }
if ($UiHost -ne '127.0.0.1') { Write-Host "  WARNING: dashboard exposed on $UiHost with NO auth - trusted network only." -ForegroundColor Red }
& node $App @cliArgs @args
