# INDEX.md - Project Rule Roster
**Last Updated:** 2026-06-07
**Location:** `.claude/rules/*.md` (files) + this index

## Purpose

This index lists every rule file in the project, what domain it covers, which glob patterns the rule applies to, and which Claude Code skill it mirrors. PM consults this index when dispatching domain work and includes the relevant rule path in the dispatch payload's `Context docs:`.

## Quick Reference

| Rule | Globs | Domain | Matching Skill |
|------|-------|--------|----------------|
| `project.md` | `alwaysApply: true` | Global planning-only default, phase isolation | (global) |
| `<name>.md` | `<glob>`, `<glob>` | <one-line domain> | `.claude/skills/<name>/SKILL.md` |

(Add rows as PM proposes new specialist agents. Each new `.claude/skills/<name>/SKILL.md` should get a paired `.claude/rules/<name>.md` with a row here.)

## Convention

- **Specialist rules** (per-agent): `<name>.md`, `alwaysApply: false`, globs document which files the rule applies to (informational).
- **Global rules**: `alwaysApply: true` (e.g., `project.md`).
- **Rule content** is a condensed version of the agent's SKILL.md — key pitfalls, NEVER-touches, naming conventions. Full domain knowledge lives in the SKILL.md under `.claude/skills/<name>/`.
- **Sync rule**: whenever `agents.json` or `.claude/SKILLS.md` gain an agent, add a matching `.claude/rules/<name>.md` and a row here.

## See Also

- `.claude/SKILLS.md` — Claude Code skill roster (the agent-system roster counterpart to this file)
- `.claude/skills/<name>/SKILL.md` — full agent definitions
- `CLAUDE.md` — top-level project rules, agent routing, execution modes


| /app | `.claude/rules/app.md` | node-pty supervisor + server host |
| /ha | `.claude/rules/ha.md` | Home Assistant bidirectional bridge |
| /ops | `.claude/rules/ops.md` | Federation, launchd, Tailscale, secrets |
| /ha_devops | `.claude/rules/ha_devops.md` | HA config-write runtime deployer (Mode-4-only, never fork) |
| /hw_lib | `.claude/rules/hw_lib.md` | SoT hardware-library curator — catalog of per-platform hardware books |
| /swarm | `.claude/rules/swarm.md` | Federation bridge → remote swarm PM (federated-pm, offline) |
| /dragon-vlm | `.claude/rules/dragon-vlm.md` | Federation bridge → remote dragon-vlm PM (federated-pm, offline) |
| /jetson-protect | `.claude/rules/jetson-protect.md` | Federation bridge → remote jetson-protect PM (federated-pm, offline) |
