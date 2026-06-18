// Regression test for the early-morning day-boundary bug.
//
// My Week buckets done tasks (and keys dailyFocus) by calendar day. The day
// keys were built with `date.toISOString().split('T')[0]`, which is the UTC
// date. For a timezone east of UTC (IST = UTC+5:30), opening the view between
// midnight and the offset (00:00–05:29 IST) rolls every key back one calendar
// day — so a task closed Thursday afternoon would surface under the column
// labelled "Friday". This test pins the timezone to IST and the clock to
// 03:34 IST so the bug is reproducible regardless of the machine/CI timezone
// (in UTC it never manifests).

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

vi.mock('./db.js', () => ({
  updateTask: vi.fn(),
  createTask: vi.fn(),
  loadDailyFocus: vi.fn().mockResolvedValue({ taskIds: [], timeBlocks: [] }),
  saveDailyFocus: vi.fn(),
  loadHolidays: vi.fn().mockResolvedValue([]),
}))
vi.mock('./modal.js', () => ({ openModal: vi.fn() }))
vi.mock('./mention.js', () => ({ attachMention: vi.fn() }))
vi.mock('./calendar.js', () => ({ loadCalendarEvents: vi.fn().mockResolvedValue({ events: [], needsAuth: false }) }))
vi.mock('./time-grid.js', () => ({
  renderTimeGrid: vi.fn(() => ''),
  bindTimeGridActions: vi.fn(),
  isTimeGridDragging: vi.fn(() => false),
}))
vi.mock('./context-menu.js', () => ({
  setSelectedTaskIds: vi.fn(),
  clearSelection: vi.fn(),
}))
vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  STATUSES: [],
}))

import { renderMyDay } from './my-day.js'

describe('My Week — done-task bucketing across the UTC day boundary (IST)', () => {
  let container
  let ctx
  const currentUser = { email: 'alice@example.com' }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ctx = { db: {}, clients: [], projects: [], allTasks: [] }
    // Fri 2026-06-19 03:34 IST (= Thu 2026-06-18 22:04 UTC). Only fake Date so
    // real timers keep working for the render's event wiring.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-18T22:04:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    container.remove()
  })

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('places a task closed Thursday afternoon (IST) under Thursday, not Friday', async () => {
    // Guard: confirm IST actually took effect for this worker, else the
    // assertion below would be meaningless (in UTC the bug can't reproduce).
    expect(new Date().getDate()).toBe(19) // local Friday
    expect(new Date().getHours()).toBe(3)

    const tasks = [{
      id: 'done-thu',
      title: 'Closed Thursday afternoon',
      assignees: ['alice@example.com'],
      status: 'done',
      closedAt: '2026-06-18T12:30:00.000Z', // Thu 18:00 IST
    }]

    await renderMyDay(container, tasks, currentUser, ctx)

    const card = container.querySelector('.my-day-card.weekday[data-id="done-thu"]')
    expect(card).toBeTruthy()
    const section = card.closest('.my-day-section')
    expect(section?.getAttribute('data-section')).toBe('Thursday')
  })
})
