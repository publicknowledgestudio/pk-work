// Regression test for the early-morning day-boundary bug in the task modal.
//
// Two date inputs key off the local calendar day:
//   1. Marking a task "done" auto-fills the closed-at date with *today*.
//   2. Opening a closed task shows its closedAt instant as a date.
// Both used `…toISOString().split('T')[0]` (the UTC date), so between
// 00:00–05:29 IST they rolled back to the previous day. TZ is pinned to IST and
// the clock to 03:34 IST. modal.js grabs its elements at import time, so the DOM
// scaffold is injected and the module dynamically imported afterwards.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  PRIORITIES: [],
  STATUSES: [],
}))
vi.mock('./db.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createProject: vi.fn(),
}))
vi.mock('./utils/client-visibility.js', () => ({ selectableClients: (c) => c || [] }))

const SCAFFOLD = `
  <div id="task-modal" class="hidden">
    <h2 id="modal-title"></h2>
    <button id="modal-close"></button>
    <button id="task-cancel"></button>
    <button id="task-save"></button>
    <button id="task-delete"></button>
    <input id="task-title">
    <textarea id="task-description"></textarea>
    <input id="task-status" type="hidden">
    <div id="task-status-pills">
      <button class="status-pill" data-status="todo"></button>
      <button class="status-pill" data-status="done"></button>
    </div>
    <select id="task-priority"><option value="medium">medium</option></select>
    <input id="task-deadline" type="date">
    <div id="task-closed-at-row" class="hidden"><input id="task-closed-at" type="date"></div>
    <textarea id="task-notes"></textarea>
    <div id="task-notes-list"></div>
    <div id="task-assignees-inline"></div>
    <input id="task-client" type="hidden">
    <input id="task-project" type="hidden">
    <div id="project-picker">
      <div id="project-picker-display">
        <span id="project-picker-text"></span>
        <button id="project-picker-clear"></button>
      </div>
      <div id="project-picker-dropdown" class="hidden">
        <input id="project-picker-search">
        <div id="project-picker-list"></div>
        <div id="project-picker-create"></div>
      </div>
    </div>
  </div>
`

let openModal
const ctx = { db: {}, currentUser: { email: 'alice@example.com' }, clients: [], projects: [] }

describe('Task modal — closed-at date across the UTC day boundary (IST)', () => {
  beforeAll(async () => {
    document.body.innerHTML = SCAFFOLD
    ;({ openModal } = await import('./modal.js'))
  })
  beforeEach(() => {
    // Fri 2026-06-19 03:34 IST (= Thu 2026-06-18T22:04:00Z).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-18T22:04:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  afterAll(() => {
    document.body.innerHTML = ''
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('displays a task closed in the early-morning window under its local day', () => {
    // Guard: confirm IST took effect (in UTC, both values would read 06-18).
    expect(new Date().getDate()).toBe(19)

    // Closed Fri 2026-06-19 01:30 IST (= Thu 2026-06-18T20:00:00Z): the UTC date
    // is the 18th, the local date is the 19th.
    openModal(
      { id: 't1', title: 'X', status: 'done', closedAt: '2026-06-18T20:00:00Z', assignees: [], notes: [] },
      ctx
    )

    expect(document.getElementById('task-closed-at').value).toBe('2026-06-19')
  })

  it('auto-fills the closed-at date with the local today when marking done', () => {
    openModal({ id: 't2', title: 'Y', status: 'todo', assignees: [], notes: [] }, ctx)
    expect(document.getElementById('task-closed-at').value).toBe('') // hidden + empty for non-done

    document.querySelector('#task-status-pills .status-pill[data-status="done"]').click()

    expect(document.getElementById('task-closed-at').value).toBe('2026-06-19')
  })
})
