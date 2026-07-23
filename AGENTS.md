# Agent instructions

## Turn lifecycle: Sense at start & Moment at end

1. **Sense at start of turn**:
   - At the start of every turn, call the MCP sensing tool (`sense()`) to perceive the active graph context, current space, active task, and node environment.
2. **Moment creation at end of turn**:
   - At the end of every turn, record a `Moment` node capturing the cognitive/operational episode (summary of actions, ISO timestamp, actor `actor-nlr-ai`, space `space-l2-autonomous-cognition`) via the L1/L2 message API or graph ingestion tick.


## L1 task wakes and Telegram blockers

When a task is selected through `next_l1_task_wake`, use the returned objective data and never substitute a hard-coded task or wake cadence.

After reporting a wake through `report_l1_task_wake`:

1. If the result contains `notification.required: true`, call `mcp__mind.send` in the same turn with `platform: "telegram"` and the exact `notification.message`.
2. Report that the blocker notification was sent only after the Telegram MCP call succeeds.
3. If Telegram MCP is unavailable or fails, keep the task blocked and surface the notification failure to the user; never silently treat it as delivered.
4. A `progressed` task must declare its next wake before the current cycle ends. A `completed` or `blocked` task must not invent a future wake.

## Merge to main

Once a task is complete and its work is committed on a branch or worktree, systematically merge that branch into `main`. Do not leave finished work stranded on a side branch.

1. Confirm the working tree is clean and the task's commits are in place on the current branch.
2. Merge the branch into `main` (`git checkout main && git merge <branch>`), preferring a fast-forward or a clean merge commit.
3. If the merge conflicts, resolve it before proceeding; never force or discard `main` history to make the merge pass.
4. Report the merge result — the merged branch, the resulting `main` commit, and any conflicts resolved.

If the user explicitly asks to hold a branch open (review, draft, PR-only), do not merge; state that you are holding it per their request.
