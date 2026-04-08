# Client Timeline View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a date-based timeline view for client users with horizontal scrolling date columns, drag-to-schedule, and a month picker.

**Architecture:** New `src/client-timeline.js` module following the same pattern as `src/client-board.js`. Receives the same `tasks` array, groups by deadline date client-side. Routing/nav wired in `main.js` and `index.html`. No new Firestore queries.

**Tech Stack:** Vanilla JS, Firestore (existing), CSS (existing variables + minimal additions)

**Design doc:** `docs/plans/2026-04-08-client-timeline-view-design.md`

---

### Task 1: Add nav tab and route wiring

**Files:**
- Modify: `index.html:46` (add nav tab after client-timesheets)
- Modify: `src/main.js:23-24` (add import)
- Modify: `src/main.js:65-66` (add route)
- Modify: `src/main.js:74` (add VIEW_TO_PATH entry)
- Modify: `src/main.js:756-762` (add switch case)

**Step 1: Add Timeline nav tab in `index.html`**

After line 46 (the client-timesheets button), add:

```html
<button class="nav-tab client-nav hidden" data-view="client-timeline"><i class="ph-fill ph-calendar-dots"></i> <span class="nav-label">Timeline</span></button>
```

**Step 2: Create empty `src/client-timeline.js` scaffold**

```js
import { STATUSES, TEAM } from './config.js'
import { updateTask } from './db.js'
import { openModal } from './modal.js'

export function renderClientTimeline(container, tasks, ctx) {
  container.innerHTML = '<div class="timeline-view"><p style="padding:20px;color:var(--text-secondary)">Timeline coming soon</p></div>'
}
```

**Step 3: Wire routing in `src/main.js`**

Add import (after line 24):
```js
import { renderClientTimeline } from './client-timeline.js'
```

Add route (after line 66):
```js
  '/client-timeline':   { view: 'client-timeline' },
```

Add VIEW_TO_PATH entry (in the object on line 74):
```js
  'client-timeline': '/client-timeline',
```

Add switch case (after the `client-timesheets` case around line 761):
```js
    case 'client-timeline':
      renderClientTimeline(mainContent, tasks, { ...ctx, userClientId, userClientName, userRole })
      break
```

**Step 4: Verify**

Run `npm run dev`, sign in as a client user, confirm three tabs appear: Board, Timeline, Timesheets. Clicking Timeline shows the placeholder text.

**Step 5: Commit**

```bash
git add index.html src/client-timeline.js src/main.js
git commit -m "feat: add client timeline route and nav tab (scaffold)"
```

---

### Task 2: Column generation logic

**Files:**
- Modify: `src/client-timeline.js`

**Step 1: Implement `generateColumns(selectedMonth, selectedYear)` helper**

This function returns an array of column descriptors. Each column has `{ id, label, type, date?, startDate?, endDate? }`.

```js
function generateColumns(month, year) {
  const today = new Date()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0) // last day of month

  const columns = []

  // Determine which dates get individual day columns:
  // Current week + next week (if viewing the current month)
  // Otherwise, first 2 weeks of the selected month
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month

  let dayStart, dayEnd
  if (isCurrentMonth) {
    // Start of current week (Monday)
    dayStart = new Date(today)
    const dow = dayStart.getDay()
    dayStart.setDate(dayStart.getDate() - ((dow + 6) % 7)) // back to Monday
    dayStart.setHours(0, 0, 0, 0)

    // End of next week (Sunday)
    dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 13)
  } else {
    dayStart = new Date(monthStart)
    dayEnd = new Date(monthStart)
    dayEnd.setDate(dayEnd.getDate() + 13)
  }

  // Clamp to month boundaries
  if (dayStart < monthStart) dayStart = new Date(monthStart)
  if (dayEnd > monthEnd) dayEnd = new Date(monthEnd)

  // Generate individual day columns
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const cursor = new Date(dayStart)
  const lastDayWithDayCol = new Date(dayEnd)

  while (cursor <= dayEnd && cursor <= monthEnd) {
    const d = new Date(cursor)
    columns.push({
      id: `day-${d.toISOString().slice(0, 10)}`,
      label: `${dayNames[d.getDay()]} ${d.getDate()}`,
      type: 'day',
      date: new Date(d),
      isToday: d.toDateString() === today.toDateString(),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  // Generate week columns for remaining weeks in the month
  // Start from the Monday after the last day column
  let weekStart = new Date(lastDayWithDayCol)
  weekStart.setDate(weekStart.getDate() + 1)
  // Advance to next Monday if not already Monday
  while (weekStart.getDay() !== 1 && weekStart <= monthEnd) {
    weekStart.setDate(weekStart.getDate() + 1)
  }

  while (weekStart <= monthEnd) {
    const wEnd = new Date(weekStart)
    wEnd.setDate(wEnd.getDate() + 6)
    const clampedEnd = wEnd > monthEnd ? new Date(monthEnd) : new Date(wEnd)

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    columns.push({
      id: `week-${weekStart.toISOString().slice(0, 10)}`,
      label: `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()}–${clampedEnd.getDate()}`,
      type: 'week',
      startDate: new Date(weekStart),
      endDate: new Date(clampedEnd),
      isToday: today >= weekStart && today <= clampedEnd,
    })

    weekStart.setDate(weekStart.getDate() + 7)
  }

  return columns
}
```

**Step 2: Implement `assignTaskToColumn(task, columns)` helper**

Returns the column ID the task belongs to, or `'unscheduled'`.

```js
function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function assignTaskToColumn(task, columns) {
  const isDone = task.status === 'done'
  const dateVal = isDone ? toDate(task.closedAt) : toDate(task.deadline)
  if (!dateVal) return 'unscheduled'

  const dateStr = dateVal.toISOString().slice(0, 10)

  // Check day columns first (exact date match)
  for (const col of columns) {
    if (col.type === 'day' && col.date.toISOString().slice(0, 10) === dateStr) {
      return col.id
    }
  }

  // Check week columns (date falls within range)
  for (const col of columns) {
    if (col.type === 'week') {
      const start = col.startDate
      const end = new Date(col.endDate)
      end.setHours(23, 59, 59, 999)
      if (dateVal >= start && dateVal <= end) {
        return col.id
      }
    }
  }

  return null // outside selected month — don't show
}
```

**Step 3: Verify**

No visual change yet — these are internal helpers. Verify no syntax errors by confirming the dev server still loads the timeline route without console errors.

**Step 4: Commit**

```bash
git add src/client-timeline.js
git commit -m "feat: add column generation and task placement logic for timeline"
```

---

### Task 3: Render the timeline view

**Files:**
- Modify: `src/client-timeline.js`

**Step 1: Implement the full `renderClientTimeline` function**

Replace the scaffold with the real implementation. Reuse the `taskCard`, `statusIcon`, `avatarStack`, `formatDeadline`, `esc` helpers — extract them from `client-board.js` or duplicate (they're small, pure functions).

```js
export function renderClientTimeline(container, tasks, ctx) {
  const clientId = ctx.userClientId
  const clientTasks = tasks.filter((t) => t.clientId === clientId)
  const clientProjects = ctx.projects.filter((p) => p.clientId === clientId)

  const today = new Date()
  let selectedMonth = today.getMonth()
  let selectedYear = today.getFullYear()
  let selectedProjectId = ''

  function render() {
    const filtered = selectedProjectId
      ? clientTasks.filter((t) => t.projectId === selectedProjectId)
      : clientTasks

    const columns = generateColumns(selectedMonth, selectedYear)
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']

    // Group tasks by column
    const groups = { unscheduled: [] }
    columns.forEach((col) => { groups[col.id] = [] })

    filtered.forEach((task) => {
      const colId = assignTaskToColumn(task, columns)
      if (colId === 'unscheduled') {
        groups.unscheduled.push(task)
      } else if (colId && groups[colId]) {
        groups[colId].push(task)
      }
      // colId === null means outside month — skip
    })

    container.innerHTML = `
      <div class="timeline-view">
        <div class="timeline-header">
          <div class="month-picker">
            <button class="month-picker-btn" id="month-prev"><i class="ph ph-caret-left"></i></button>
            <button class="month-picker-label" id="month-label">${monthNames[selectedMonth]} ${selectedYear}</button>
            <button class="month-picker-btn" id="month-next"><i class="ph ph-caret-right"></i></button>
          </div>
          ${clientProjects.length > 1 ? `
            <div class="segmented-control" id="timeline-project-filter">
              <button class="segment${!selectedProjectId ? ' active' : ''}" data-project="">All Projects</button>
              ${clientProjects.map((p) => `<button class="segment${p.id === selectedProjectId ? ' active' : ''}" data-project="${p.id}">${esc(p.name)}</button>`).join('')}
            </div>
          ` : ''}
        </div>
        <div class="timeline-board">
          <div class="column timeline-col-unscheduled" data-col="unscheduled">
            <div class="column-header">
              <span class="column-dot" style="background:var(--text-tertiary)"></span>
              <span class="column-label">Unscheduled</span>
              <span class="column-count">${groups.unscheduled.length}</span>
            </div>
            <div class="column-tasks" data-col="unscheduled">
              ${groups.unscheduled.map((t) => taskCard(t, ctx)).join('')}
            </div>
          </div>
          ${columns.map((col) => `
            <div class="column timeline-col${col.isToday ? ' timeline-col-today' : ''}" data-col="${col.id}" data-col-type="${col.type}"${col.type === 'day' ? ` data-date="${col.date.toISOString().slice(0, 10)}"` : ` data-date="${col.startDate.toISOString().slice(0, 10)}"`}>
              <div class="column-header">
                <span class="column-label">${col.label}</span>
                <span class="column-count">${(groups[col.id] || []).length || ''}</span>
              </div>
              <div class="column-tasks" data-col="${col.id}" data-col-type="${col.type}"${col.type === 'day' ? ` data-date="${col.date.toISOString().slice(0, 10)}"` : ` data-date="${col.startDate.toISOString().slice(0, 10)}"`}>
                ${(groups[col.id] || []).map((t) => taskCard(t, ctx)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    // --- Event listeners ---

    // Month picker
    document.getElementById('month-prev')?.addEventListener('click', () => {
      selectedMonth--
      if (selectedMonth < 0) { selectedMonth = 11; selectedYear-- }
      render()
    })
    document.getElementById('month-next')?.addEventListener('click', () => {
      selectedMonth++
      if (selectedMonth > 11) { selectedMonth = 0; selectedYear++ }
      render()
    })
    document.getElementById('month-label')?.addEventListener('click', () => {
      selectedMonth = today.getMonth()
      selectedYear = today.getFullYear()
      render()
    })

    // Project filter
    container.querySelectorAll('#timeline-project-filter .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedProjectId = btn.dataset.project
        render()
      })
    })

    // Task card clicks
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = clientTasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    // Auto-scroll to today column
    const todayCol = container.querySelector('.timeline-col-today')
    if (todayCol) {
      todayCol.scrollIntoView({ inline: 'center', behavior: 'instant' })
    }
  }

  render()
}
```

**Step 2: Add shared helpers at top of file**

Copy `taskCard`, `statusIcon`, `avatarStack`, `formatDeadline`, `esc` from `client-board.js` into `client-timeline.js`. These are small pure functions (no shared state) — duplicating is simpler than extracting to a shared module right now.

**Step 3: Verify**

Run `npm run dev`, navigate to Timeline tab. Confirm:
- Month picker shows current month and navigates
- Unscheduled column shows tasks without deadlines
- Day and week columns show tasks in correct buckets
- Today column is highlighted
- Task cards are clickable (open modal)

**Step 4: Commit**

```bash
git add src/client-timeline.js
git commit -m "feat: render timeline view with date columns and task grouping"
```

---

### Task 4: Drag-and-drop scheduling

**Files:**
- Modify: `src/client-timeline.js` (add drag handlers inside `render()`)

**Step 1: Add drag-and-drop event listeners**

Add these after the task card click listeners inside `render()`:

```js
    // Drag and drop — scheduling
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id)
        e.dataTransfer.effectAllowed = 'move'
        card.classList.add('dragging')
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging')
        container.querySelectorAll('.column-tasks').forEach((col) => col.classList.remove('drag-over'))
      })
    })

    container.querySelectorAll('.column-tasks').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        col.classList.add('drag-over')
      })
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
      col.addEventListener('drop', async (e) => {
        e.preventDefault()
        col.classList.remove('drag-over')
        const taskId = e.dataTransfer.getData('text/plain')
        if (!taskId) return

        const colId = col.dataset.col
        if (colId === 'unscheduled') {
          // Drag back to unscheduled — clear deadline
          await updateTask(ctx.db, taskId, { deadline: null })
        } else {
          // Set deadline based on column type
          const colType = col.dataset.colType
          const dateStr = col.dataset.date
          if (dateStr) {
            const newDeadline = new Date(dateStr + 'T23:59:59')
            if (colType === 'week') {
              // Week columns: set to Monday (startDate is already Monday)
              newDeadline.setHours(23, 59, 59)
            }
            await updateTask(ctx.db, taskId, { deadline: newDeadline.toISOString().slice(0, 10) })
          }
        }
      })
    })
```

**Step 2: Verify**

- Drag a task from Unscheduled to a day column — deadline updates to that day
- Drag between day columns — deadline changes
- Drag to a week column — deadline set to Monday of that week
- Drag back to Unscheduled — deadline clears
- Modal shows updated deadline after drag

**Step 3: Commit**

```bash
git add src/client-timeline.js
git commit -m "feat: add drag-to-schedule on timeline view"
```

---

### Task 5: CSS for timeline view

**Files:**
- Modify: `src/style.css` (append new styles)

**Step 1: Add timeline-specific CSS**

Append to `src/style.css`:

```css
/* ===== Client Timeline View ===== */

.timeline-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.month-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}

.month-picker-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
}

.month-picker-btn:hover {
  background: var(--bg);
  color: var(--text);
}

.month-picker-label {
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  padding: 4px 12px;
  border-radius: var(--radius);
}

.month-picker-label:hover {
  background: var(--bg);
}

.timeline-board {
  display: flex;
  gap: 12px;
  padding: 20px;
  height: 100%;
  overflow-x: auto;
}

/* Sticky unscheduled column */
.timeline-col-unscheduled {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--bg);
  border-right: 1px solid var(--border);
  padding-right: 12px;
}

/* Today highlight */
.timeline-col-today {
  background: var(--primary-light);
  border-radius: var(--radius-lg);
  padding: 0 6px;
}

/* Narrower columns for day view */
.timeline-col {
  min-width: 200px;
  width: 200px;
}
```

**Step 2: Verify**

- Unscheduled column stays pinned when scrolling right
- Today's column has a subtle indigo highlight
- Month picker looks clean
- Columns are appropriately sized
- Responsive: no layout breaks on smaller viewports

**Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: add timeline view styles with sticky unscheduled and today highlight"
```

---

### Task 6: Final integration and deploy

**Files:**
- All files from previous tasks

**Step 1: Smoke test the full flow**

1. Sign in as client user → Board, Timeline, Timesheets tabs visible
2. Timeline shows current month with correct columns
3. Tasks grouped correctly (unscheduled, by day, by week)
4. Done tasks appear at their closedAt date, dimmed
5. Overdue tasks show red deadline chip
6. Drag task from Unscheduled → day column (sets deadline)
7. Drag task to week column (sets deadline to Monday)
8. Drag task back to Unscheduled (clears deadline)
9. Month picker navigates, clicking label resets to today
10. Project filter works
11. Card click opens modal

**Step 2: Build and deploy**

```bash
npm run deploy
```

**Step 3: Commit (if any final fixes)**

```bash
git add -A
git commit -m "feat: client timeline view — date-based kanban with drag scheduling"
git push
```
