# start-majordomos.ps1 — launch the headless Task Router host for this project
# on Windows, using the app bundled inside your installed Task Router extension. No
# per-project server/app copy: the app finds the extension's bundled server and starts
# a shared, detached :3100 server if one isn't already up.
#
#   Right-click -> Run with PowerShell, or:   pwsh -File .\start-majordomos.ps1
#   Second project on its own UI port:         $env:UI_PORT=3201; .\start-majordomos.ps1
#   Restart the shared server on start:        .\start-majordomos.ps1 -RestartServer
#   No-IDE box: set $env:TASK_ROUTER_APP to ...\app\bin\app.js
param([switch]$RestartServer)
$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ProjectName = 'majordomos'
$UiPort = if ($env:UI_PORT) { $env:UI_PORT } else { '3200' }

# Load repo-root .env into the process environment so ${VAR} references in .mcp.json
# (e.g. HA_BASE_URL / HA_TOKEN) resolve at MCP-connection time. Claude Code expands
# ${VAR} from the process environment only — it does not read .env itself.
$envFile = Join-Path $ProjectRoot '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
    }
  }
}

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

# First-use prerequisites: the VSIX ships the app WITHOUT the native node-pty (its ABI
# must match the system Node), so install it for this platform the first time. node-pty
# powers the headless agent terminals; if it can't be built we still launch — the
# supervisor reports it cleanly and the rest of the app works.
$AppDir = Split-Path -Parent (Split-Path -Parent $App)
Push-Location $AppDir; node -e "require('node-pty')" 2>$null; $ptyOk = ($LASTEXITCODE -eq 0); Pop-Location
if (-not $ptyOk) {
  $setup = Join-Path $AppDir 'scripts\setup-app.ps1'
  if (Test-Path $setup) {
    Write-Host "First run: installing headless-terminal prerequisites (node-pty) for this platform..."
    try { & $setup -Install }
    catch { Write-Warning "prerequisite install reported issues - continuing; agent terminals may be unavailable" }
  }
}

$cliArgs = @('--project', "$ProjectName=$ProjectRoot", '--ui-port', "$UiPort")
if ($RestartServer -or $env:RESTART_SERVER -eq '1') { $cliArgs += '--restart-server' }
Write-Host "majordomos host -> http://127.0.0.1:$UiPort  (app: $App)"
& node $App @cliArgs @args
