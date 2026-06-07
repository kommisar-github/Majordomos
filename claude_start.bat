@echo off
set "SCRIPT_VERSION=2.0.0"
REM claude_start.bat — Claude Code agent terminal launcher (generic)
REM
REM Usage:
REM   claude_start.bat                  -- regular terminal, no agent
REM   claude_start.bat pm              -- PM terminal, auto-registers via MCP
REM   claude_start.bat devops          -- agent terminal, auto-registers via MCP
REM
REM Place in your project root. Derives TASK_ROUTER_PROJECT from the current directory name.
REM The matching skill's startup sequence reads $TASK_ROUTER_AGENT and $TASK_ROUTER_PROJECT
REM to decide whether to register with the MCP task router.

cd /d "%~dp0"
echo claude_start v%SCRIPT_VERSION%

REM Parse agent name - first non-flag argument
set "AGENT_NAME="
:parse_args
if "%~1"=="" goto done_args
echo %~1 | findstr /b /c:"--" >nul 2>&1
if errorlevel 1 (
    if not defined AGENT_NAME (
        set "AGENT_NAME=%~1"
        shift
        goto parse_args
    )
)
shift
goto parse_args
:done_args

REM No agent name — regular terminal
if not defined AGENT_NAME (
    echo Starting Claude Code - no agent
    claude -c --dangerously-skip-permissions
    goto :eof
)

REM === Agent terminal setup ===
set "TASK_ROUTER_AGENT=%AGENT_NAME%"
REM Derive project name from current directory name (matches extension's folder.name)
for %%I in ("%CD%") do set "TASK_ROUTER_PROJECT=%%~nxI"
echo [%AGENT_NAME%] Starting... (project=%TASK_ROUTER_PROJECT%)

REM v0.6.2: deterministic pre-launch agent registration. Idempotent — safe
REM to call repeatedly. Server may not be running yet (extension auto-spawns
REM it later), in which case curl returns non-zero and we just continue;
REM the agent's own Startup Sequence registers as the safety net.
set "TR_PORT=3100"
if defined TASK_ROUTER_PORT set "TR_PORT=%TASK_ROUTER_PORT%"
where curl >nul 2>&1
if not errorlevel 1 (
    if defined TASK_ROUTER_API_KEY (
        curl -s -o NUL -X POST -H "Content-Type: application/json" -H "X-Task-Router-Key: %TASK_ROUTER_API_KEY%" -d "{\"name\":\"%AGENT_NAME%\",\"project\":\"%TASK_ROUTER_PROJECT%\",\"capabilities\":[]}" "http://127.0.0.1:%TR_PORT%/api/register?project=%TASK_ROUTER_PROJECT%" 2>nul
    ) else (
        curl -s -o NUL -X POST -H "Content-Type: application/json" -d "{\"name\":\"%AGENT_NAME%\",\"project\":\"%TASK_ROUTER_PROJECT%\",\"capabilities\":[]}" "http://127.0.0.1:%TR_PORT%/api/register?project=%TASK_ROUTER_PROJECT%" 2>nul
    )
)

REM Launch Claude Code as agent. v0.7.6: prefix first prompt with "/" so the
REM CLI's subcommand parser doesn't intercept reserved names (auth, help, mcp).
claude --dangerously-skip-permissions --agent "%AGENT_NAME%_agent" "/%AGENT_NAME%"
