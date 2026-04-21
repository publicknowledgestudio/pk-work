# My Day Redesign — Two-Column Layout with Calendar Improvements

**Date:** 2026-03-11
**Approach:** CSS layout split (Approach A) — minimal JS restructuring

## 1. Layout Structure

Split `.my-day` into a two-column flex container:

```
┌─────────────────────────────────┬──────────────────┐
│  LEFT (2/3)                     │  RIGHT (1/3)     │
│                                 │ ← Today, Mar 11 →│
│  Header (greeting, stats)       │                  │
│                                 │  9 AM ─────────  │
│  Up Next                        │  9:30 ─────────  │
│    [task card] [task card]      │  10 AM ─────────  │
│    [task card]                  │  [Task Block]    │
│                                 │  [Cal Event]     │
│  Tomorrow                       │  ...             │
│    [task card]                  │  10 PM ────────  │
│                                 │                  │
│  Completed Today                │                  │
│    [task card]                  │                  │
└─────────────────────────────────┴──────────────────┘
```

- Left panel scrolls vertically if content overflows
- Right panel (calendar) scrolls independently
- Header stays in left panel
- Floating add-task bar at bottom spans full width

**Files:** `src/my-day.js` (template restructure), `src/style.css` (flex layout)

## 2. Calendar Time Range

Change from 9AM–7PM to 9AM–10PM.

- `DAY_END = 22` (was `19`)
- `TOTAL_SLOTS` recalculates to 52 (was 40)
- `GRID_H` recalculates to 728px (was 560px)

**Files:** `src/time-grid.js` (constants)

## 3. Calendar Task Block Redesign

Make scheduled task blocks look more like the `.my-day-card` list items:

- White background with subtle border (matching `.my-day-card`)
- Status icon on the left (same circle icons as list cards)
- Client logo + project tag + title in a row
- Deadline badge if applicable
- Keep amber left-border accent for visual distinction from calendar events
- For short blocks (<30min): compact single-line layout
- For taller blocks: full card-like layout with meta row
- Done state: strikethrough + green left-border

**Files:** `src/time-grid.js` (renderTaskBlock), `src/style.css` (task-block styles)

## 4. Drag from Up Next → Calendar (No Removal)

When dropping an Up Next card onto the calendar:

1. Task gets added to `focusTaskIds` and `timeBlocks` (scheduled on grid)
2. Task is **not** removed from Up Next — stays in the list
3. A small clock icon appears on the Up Next card indicating it's scheduled
4. Time grid shows the task block at the dropped slot

**Change:** `upNext` filtering in `my-day.js` currently excludes tasks in `focusTaskIds`. Remove that exclusion. Add scheduled badge rendering.

**Files:** `src/my-day.js` (upNext filter, upNextCard template), `src/style.css` (badge)

## 5. Half-Hour Hover Highlight

When hovering over the calendar grid (not over existing blocks):

- The 30-minute slot (2 × 15-min slots) under cursor highlights with subtle primary tint
- Highlight shows time label (e.g., "10:30 AM")
- Clicking triggers the enhanced slot picker
- Highlight disappears when cursor leaves or enters a task/calendar block

**Implementation:** CSS `:hover` on `.tg-slot` elements won't work for 2-slot highlight. Use `mousemove` on `.tg-slots` to toggle a `.hover` class on the target slot and the next one. Show a floating time label.

**Files:** `src/time-grid.js` (bindTimeGridActions), `src/style.css` (hover styles)

## 6. Enhanced Slot Picker

When clicking an empty slot, the picker popover now includes:

- **Top item:** "New task at 10:30 AM" with inline input — creates a new task scheduled at that slot
- **Below:** List of available tasks (existing behavior)

**Files:** `src/time-grid.js` (showSlotPicker)

## 7. Day Navigation

Calendar right panel gets a day nav header:

```
← Today, Mar 11 →
```

- Left/right arrows go back/forward one day
- Center shows "Today" if current day, otherwise "Mon, Mar 10" format
- Clicking date label resets to today
- When viewing a different day, time blocks and calendar events update for that date
- "Now" indicator line only shows on today's view
- Left panel stays fixed to today — only calendar navigates

**Implementation:** Add `calendarDate` state to `my-day.js`. Pass to `renderTimeGrid()`. Day navigation triggers re-render of just the right panel. Need to load `dailyFocus` for the selected date and fetch calendar events for that date.

**Files:** `src/my-day.js` (state, nav handlers), `src/time-grid.js` (accept date param)

## Summary of Changes

| File | Changes |
|------|---------|
| `src/my-day.js` | Two-column template, calendarDate state, day nav, upNext filter change, scheduled badge |
| `src/time-grid.js` | DAY_END=22, renderTaskBlock card-style, hover highlight, enhanced picker, day nav header, accept date param |
| `src/style.css` | Two-column layout, task-block card styles, hover highlight, day nav, scheduled badge |
