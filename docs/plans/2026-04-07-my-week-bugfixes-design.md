# My Week Bug Fixes — Design

**Date:** 2026-04-07
**File:** `src/my-day.js`

## Problems

1. **Cross-day duplicates:** Tasks appear on multiple days because `closedAt` merge creates phantom entries alongside scheduled entries. Dragging these phantoms creates duplicates since the drag handler can't find them in `weekData`.
2. **Assignee bleed:** Scheduled sections show tasks no longer assigned to the viewer — stale cleanup only checks `done` status, not assignee.
3. **`myEmail`/`targetEmail` inconsistency:** Event handlers hardcode `myEmail` in `saveDailyFocus` calls. If any code path fires while viewing another person, it writes to the wrong user's data.

## Fixes

### Fix 1: Remove `closedAt` merge from day sections

Delete the `doneByDate` map and its merge into `weekDayTasks`. Each day only shows tasks from `dailyFocus`. Done tasks that were scheduled stay with their checkmark. The "done today" stat is unaffected (uses its own independent filter).

Remove:
- `doneByDate` map construction (lines 132–142)
- Merge into `weekDayTasks` and `weekTaskIdSet` addition (lines 150–157)

### Fix 2: Assignee filter on scheduled sections

When building `weekDayTasks`, filter out tasks no longer assigned to `targetEmail`:

```js
const scheduled = wd.taskIds
  .map((id) => tasks.find((t) => t.id === id))
  .filter((t) => t && (t.assignees || []).includes(targetEmail))
```

### Fix 3: Assignee check in stale cleanup

Expand cleanup to also remove tasks no longer assigned to the user:

```js
const cleaned = taskIds.filter((id) => {
  const t = tasks.find((task) => task.id === id)
  return t && t.status !== 'done' && (t.assignees || []).includes(targetEmail)
})
```

### Fix 4: `myEmail` → `targetEmail` in all save calls

All `saveDailyFocus` calls in event handlers use `targetEmail` instead of `myEmail`. Drag/interaction is already disabled when `!isOwnDay`, so this is a correctness safeguard.

Affected locations:
- `onSave` handlers (unschedule, move, drop/pick, new-task)
- Remove-from-weekday handler
- Drop zone handler
- Add-to-focus handler
- Remove-from-focus handler

### No changes

- `closedAt` on task model — unchanged
- Standup/scrum usage of `closedAt` — unchanged
- Modal closed date field — unchanged
- `db.js` done task query — unchanged
- "Done today" counter in My Week — unchanged
