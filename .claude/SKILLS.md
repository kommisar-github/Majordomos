# SKILLS.md - Agent Skill Definitions and Usage Guide
**Last Updated:** 2026-06-07
**Locations:** .claude/skills/<name>/SKILL.md + .claude/rules/

## Overview
| System | Location | Trigger | Best For |
|--------|----------|---------|----------|
| Claude Code Skills | .claude/skills/<name>/SKILL.md | Manual (/name) | CLI |
| Project Rules      | .claude/rules/*.md             | Read by Task Router agents via the `Read` tool | Domain guardrails referenced from skills + matrix |

## Quick Reference
| Skill | CLI Invoke | Rule File | Domain |
|-------|-----------|-----------|--------|
| Project Manager | /pm | project.md (always) | Planning, tracking |
| Source Control | /scm | *(manual invoke)* | Git, commits, PRs |
| Architect | /arch | *(manual invoke)* | Phase design, architecture |
| Architecture Review | /review | *(manual invoke)* | Audit plans, challenge decisions |
| Hardware Library | /hw_lib | hw_lib.md | SoT hardware-knowledge curation |
(Table grows as agents are added by PM)

## How to Use

### Mode 1-2 (Direct / Agent Fork)
- /pm - Plan, triage, track progress, propose new agents
- /scm - Commit, push, create branches, PRs
- /arch - Design new phases, propose architecture
- /review - Audit and challenge architect designs
- /<agent> - Invoke a specialist directly
- /<agent> <description> - Invoke with task context

### Mode 3 (Terminal Task)
- /pm task <agent> <description> - PM writes task file for specialist
- "read your task" - Specialist reads and executes in their terminal
- "read <agent> result" - PM reads result in their terminal

### Mode 4 (MCP Task Router)
- Launch: Ctrl+Shift+P → "Tasks: Run Task" → agent name (or "all agents")
- Skills auto-register via $TASK_ROUTER_AGENT env var check (no manual step needed)
- Manual fallback: /<agent> mcp register
- /pm <request> - PM auto-dispatches via MCP if agent is online
- Hook auto-polls inbox (specialists) and results (PM) on every prompt
- /pm serve results - Explicitly review completed results anytime

## Adding New Agents
The PM agent (/pm) proposes new agents when it detects coverage gaps.
You can also request: /pm propose an agent for <domain>.


| app | `/app` | `majordomus-daemon/src/{serverHost,supervisor,launchCommand}.js`, `majordomus-daemon/bin/**` | node-pty supervisor + in-process server host | claude-sonnet-4-6 |
| ha | `/ha` | `majordomus-daemon/src/ha-bridge.js`, `doc/ha_integration.md` | Home Assistant bidirectional bridge | claude-sonnet-4-6 |
| ops | `/ops` | `host/**`, `fleet/**`, `doc/{federation,host_ops}.md` | Federation wiring, launchd, Tailscale, secrets | claude-sonnet-4-6 |
| ha_devops | `/ha_devops` | *(no source)* — `doc/runbooks/ha_deploy.md` | HA config-write runtime deployer — **Mode-4-only, never fork** (`no_fork`) | claude-sonnet-4-6 |
| hw_lib | `/hw_lib` | `doc/hw_lib_GUIDELINES.md`, `doc/hw_lib/**` | **SoT hardware-library curator** — catalog of per-platform hardware "books" (edge/embedded compute + attached sensors/MCUs) | claude-sonnet-4-6 |
| swarm | `/swarm` | `doc/swarm_GUIDELINES.md` | **Federation bridge** → remote `swarm` PM (192.168.1.131:3100); holds SoT canon about swarm | *(federated-pm; offline)* |
| dragon-vlm | `/dragon-vlm` | `doc/dragon-vlm_GUIDELINES.md` | **Federation bridge** → remote `dragon-vlm` PM; holds SoT canon about dragon-vlm | *(federated-pm; offline)* |
| jetson-protect | `/jetson-protect` | `doc/jetson-protect_GUIDELINES.md` | **Federation bridge** → remote `jetson-protect` PM; holds SoT canon about jetson-protect | *(federated-pm; offline)* |
