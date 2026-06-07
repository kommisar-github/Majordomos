# Task File Convention — Multi-Terminal Agent Communication

This directory enables PM to delegate tasks to specialist agents running
in separate terminal windows (Mode 3) or via MCP task router (Mode 4).

## How It Works (Mode 3 — file-based)

1. **PM writes** `.claude/tasks/<agent>.task.md` with the task description
2. **User switches** to the specialist's terminal and says: "read your task"
3. **Specialist reads** the task file, executes, writes `.claude/tasks/<agent>.result.md`
4. **User switches** back to PM's terminal and says: "read <agent> result"
5. **PM reads** the result file and updates tracking docs

## How It Works (Mode 4 — MCP task router)

1. **PM calls** `dispatch_task(to="<agent>", payload="...", from="pm")`
2. **Specialist's** `UserPromptSubmit` hook detects the pending task → agent calls `pickup_next_task(agent="<agent>", project=...)` (v3.4 — one call, replaces `check_inbox` + `accept_task`)
3. **Specialist** executes, then calls `complete_task(task_id, result, agent="<agent>", project=...)` (v3.4 — replaces `submit_result`)
4. **PM's** `UserPromptSubmit` hook detects the completed result → PM calls `collect_results(dispatcher="pm")` (fetches + acknowledges in one atomic call) and presents triage choices to the user
5. **User chooses** which result to review

## Task File Format

```markdown
# Task for /<agent>

**From:** /pm
**Created:** <timestamp>
**Status:** PENDING

## Task
<description of what to do>

## Files to Load
- <file1>
- <file2>

## Acceptance Criteria
- <what "done" looks like>
- <verification steps>
```

## Result File Format

```markdown
# Result from /<agent>

**Completed:** <timestamp>
**Status:** COMPLETED | FAILED | BLOCKED

## Summary
<what was done>

## Files Changed
- <file1>: <what changed>

## Issues
- <any problems encountered>

## Suggested Next Steps
- <what PM should do next>
```

## Notes

- Task files are overwritten each time — only the latest task is stored
- Add `.claude/tasks/*.task.md` and `.claude/tasks/*.result.md` to `.gitignore`
- This directory should NOT be committed (ephemeral communication only)

