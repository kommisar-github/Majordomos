---
description: Global project rules - planning-only default, phase isolation
alwaysApply: true
---

# majordomos - Global Rules

## Workflow Mode
**Default mode: planning and analysis only.**
1. Read files, analyse code, update plan documents
2. Do NOT edit source files unless the user explicitly instructs implementation
3. If an instruction is ambiguous, default to planning and ask

## Phase Isolation
- Never start the next phase without user confirmation
- Current phase must be verified before planning next
- Limit retries to 2, stop and ask on 3rd failure

## Reference Docs
Planning docs live in doc/: ROADMAP.md, NEXT_STEPS.md
Agent-system metadata lives in .claude/: SKILLS.md (roster)
Rules index: .claude/rules/INDEX.md

## Agent System
See .claude/SKILLS.md for agent roster and usage.

## Execution Modes
- Mode 1 (Direct): Same conversation
- Mode 2 (Agent Fork): /pm dispatches subagents
- Mode 3 (Terminal Task): File-based multi-terminal (.claude/tasks/)
- Mode 4 (MCP Router): Automated multi-terminal (.claude/mcp/task-router/)

