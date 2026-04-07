# My Week Bug Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix cross-day duplicates, assignee bleed, and myEmail/targetEmail save inconsistency in the My Week page.

**Architecture:** All changes are in `src/my-day.js` within the `renderMyDay` function and `bindMyDayActions` event handlers. No API, DB schema, or other file changes needed.

**Tech Stack:** Vanilla JS, Firestore (dailyFocus collection)

**Design doc:** `docs/plans/2026-04-07-my-week-bugfixes-design.md`

---

### Task 1: Remove closedAt merge from day sections

**Files:**
- Modify: `src/my-day.js:132-157`

**Step 1: Delete the `doneByDate` map construction**

Remove lines 132–142 entirely:

```js
// DELETE THIS BLOCK:
  // Build map of done tasks by closedAt date for this user
  const doneByDate = new Map() // dateStr → task[]
  for (const t of tasks) {
    if (t.status !== 'done' || !t.closedAt) continue
    if (!(t.assignees || []).includes(targetEmail)) continue
    const closed = toDate(t.closedAt)
    if (!closed) continue
    const closedStr = closed.toISOString().split('T')[0]
    if (!doneByDate.has(closedStr)) doneByDate.set(closedStr, [])
    doneByDate.get(closedStr).push(t)
  }
```

**Step 2: Simplify `weekDayTasks` construction**

Replace lines 144–157 with:

```js
  // Resolve week day tasks — only from dailyFocus (no closedAt merge)
  const weekDayTasks = {} // dateStr → task[]
  for (const [dateStr, wd] of Object.entries(weekData)) {
    weekDayTasks[dateStr] = wd.taskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter(Boolean)
  }
```

This removes the `doneThisDay` merge and the `weekTaskIdSet` addition for done tasks. The `weekTaskIdSet` built at lines 122–130 still correctly tracks scheduled tasks.

**Step 3: Verify the "done today" stat is unaffected**

Confirm that `completedToday` (lines 170–175) uses its own independent filter based on `closedAt` and does NOT depend on `doneByDate` or `weekDayTasks`. It doesn't — it's a standalone filter. No change needed.

**Step 4: Commit**

```bash
git add src/my-day.js
git commit -m "fix: remove closedAt merge from My Week day sections

Eliminates phantom duplicate entries caused by tasks appearing
both via dailyFocus schedule and closedAt date."
```

---

### Task 2: Add assignee filter to scheduled sections

**Files:**
- Modify: `src/my-day.js:146-149` (the code from Task 1's replacement)

**Step 1: Add assignee check to weekDayTasks filter**

Update the `weekDayTasks` construction (written in Task 1) to filter by assignee:

```js
  // Resolve week day tasks — only from dailyFocus, filtered by assignee
  const weekDayTasks = {} // dateStr → task[]
  for (const [dateStr, wd] of Object.entries(weekData)) {
    weekDayTasks[dateStr] = wd.taskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t) => t && (t.assignees || []).includes(targetEmail))
  }
```

This ensures tasks reassigned to someone else no longer appear in your week view.

**Step 2: Commit**

```bash
git add src/my-day.js
git commit -m "fix: filter scheduled tasks by assignee in My Week

Tasks reassigned to someone else no longer appear in your
week view."
```

---

### Task 3: Add assignee check to stale cleanup

**Files:**
- Modify: `src/my-day.js:92-101`

**Step 1: Expand the stale cleanup filter**

Change the cleanup at lines 92–101 from:

```js
    // Clean stale IDs for non-today days (remove done tasks from future, keep for past/today)
    if (tasks.length > 0 && !wd.isToday && !wd.isPast && isOwnDay) {
      const cleaned = taskIds.filter((id) => {
        const t = tasks.find((task) => task.id === id)
        return t && t.status !== 'done'
      })
```

To:

```js
    // Clean stale IDs for non-today days (remove done/reassigned tasks from future)
    if (tasks.length > 0 && !wd.isToday && !wd.isPast && isOwnDay) {
      const cleaned = taskIds.filter((id) => {
        const t = tasks.find((task) => task.id === id)
        return t && t.status !== 'done' && (t.assignees || []).includes(targetEmail)
      })
```

This auto-removes reassigned tasks from future days and persists the cleanup to Firestore (existing save at line 100 handles this).

**Step 2: Commit**

```bash
git add src/my-day.js
git commit -m "fix: stale cleanup removes reassigned tasks from future days"
```

---

### Task 4: Fix myEmail → targetEmail in all saveDailyFocus calls

**Files:**
- Modify: `src/my-day.js` — 8 locations in `bindMyDayActions`

All `saveDailyFocus` calls in event handlers should use `targetEmail` (already defined at line 435 as `const targetEmail = viewingEmail || myEmail`). This is a safety fix — drag/interaction is disabled when `!isOwnDay`, so `targetEmail === myEmail` in all current scenarios. But it prevents silent data corruption if that guard is ever bypassed.

**Step 1: Fix onSave handlers (time grid)**

Change lines 503, 510, 521 from `myEmail` to `targetEmail`:

- Line 503: `await saveDailyFocus(ctx.db, myEmail, todayStr, ...)` → `await saveDailyFocus(ctx.db, targetEmail, todayStr, ...)`
- Line 510: same change
- Line 521: same change

Line 535 already uses `targetEmail` — no change.

**Step 2: Fix add-to-focus handler**

Line 559: `await saveDailyFocus(ctx.db, myEmail, ...)` → `await saveDailyFocus(ctx.db, targetEmail, ...)`

**Step 3: Fix remove-from-focus handler**

Line 572: `await saveDailyFocus(ctx.db, myEmail, ...)` → `await saveDailyFocus(ctx.db, targetEmail, ...)`

**Step 4: Fix remove-from-weekday handler**

Lines 590, 592: both `myEmail` → `targetEmail`

**Step 5: Fix drop zone handler**

Lines 691, 693, 706, 708: all four `myEmail` → `targetEmail`

**Step 6: Commit**

```bash
git add src/my-day.js
git commit -m "fix: use targetEmail consistently in all saveDailyFocus calls

Prevents writing to wrong user's dailyFocus if viewing
another person's week."
```

---

### Task 5: Smoke test

**Step 1: Run dev server and verify**

```bash
npm run dev
```

Test the following scenarios manually:
1. Schedule a task for Monday, mark it done → it stays on Monday with checkmark, does NOT duplicate on other days
2. Reassign a task from yourself to someone else → it disappears from your week on next load
3. Drag a task from Unscheduled to Wednesday → appears only on Wednesday, not duplicated
4. Drag a task from Wednesday to Friday → moves cleanly, no ghost on Wednesday
5. Check "done today" counter still shows correct count

**Step 2: Run build**

```bash
npm run build
```

Verify no errors.

**Step 3: Final commit if any cleanup needed**
