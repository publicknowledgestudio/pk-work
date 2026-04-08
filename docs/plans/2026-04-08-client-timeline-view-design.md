# Client Timeline View — Design

**Date:** 2026-04-08
**Status:** Approved

## Goal

Give external clients a date-based view of their tasks so they can see when work is scheduled, what's been completed, and what's unscheduled. Accessible as a new "Timeline" tab in the client nav.

## Approach

Horizontal scrolling columns (same visual language as the existing kanban board) keyed to dates instead of statuses. Fixed "Unscheduled" column on the left, adaptive day/week columns to the right.

## Layout & Navigation

- New **Timeline** nav tab alongside Board and Timesheets. Route: `#/client-timeline`.
- **Month picker** at top: `<- Apr 2026 ->`. Arrows shift by one month. Clicking month name resets to today's month.
- **Project filter:** Same segmented control as existing client board (reused).
- **Fixed left column:** "Unscheduled" — pinned via `position: sticky`, doesn't scroll. Contains all tasks with no deadline.
- **Scrollable columns:** Days for current + next week (up to 14 day columns), then week columns for remaining weeks in the selected month. Auto-scrolls to today on load.
- **Column headers:** Day columns show `Mon 7`, `Tue 8`. Week columns show `Apr 13-19`. Today's column gets a highlighted header.

## Task Cards & Placement

- Reuse the same `taskCard()` component from `client-board.js` (title, status icon, project tag, deadline chip, assignee avatars, priority icon).
- **No deadline** -> Unscheduled column.
- **Has deadline, not done** -> day/week column matching deadline date.
- **Done** -> day/week column matching `closedAt` date, with `.done` dimmed style.
- **Deadline outside selected month** -> not shown (visible when user navigates to that month). Unscheduled always shows.
- **Overdue** tasks get existing `.overdue` red deadline chip.
- **Today's column** gets a subtle highlighted background.

## Drag & Drop Scheduling

Same drag-and-drop pattern as existing client board, but changes `deadline` instead of `status`.

- **Unscheduled -> day column:** sets `deadline` to that day.
- **Unscheduled -> week column:** sets `deadline` to Monday of that week.
- **Between columns:** updates `deadline` accordingly.
- **Back to Unscheduled:** clears `deadline` (sets to `null`).
- Only `deadline` is updated via existing `updateTask()`. Status is unchanged.
- Both team and client users can drag to reschedule.

## Data & Architecture

- **New file:** `src/client-timeline.js` — exports `renderClientTimeline(container, tasks, ctx)`.
- **No new Firestore queries.** Reuses the same `tasks` array from `subscribeToTasksByClient`. Groups/filters client-side by deadline date.
- **Column generation** (pure JS): Take selected month, generate day columns for current + next week (capped at month boundary), then week columns for remaining weeks.

## Files Changed

- `src/client-timeline.js` — new file, main view logic
- `src/main.js` — add route, import, switch case, pass ctx
- `index.html` — add Timeline nav tab (`<button class="nav-tab client-nav hidden" data-view="client-timeline">`)
- `src/style.css` — minimal additions: sticky Unscheduled column, today highlight, month picker

## No new Firestore queries, indexes, secrets, or dependencies.
