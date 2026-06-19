// Regression test for the early-morning day-boundary bug in the attendance grid.
//
// Each calendar cell carries a LOCAL day key (built from currentMonth + day
// number). Whether a cell shows a "worked" dot is decided by `dateStr <= today`.
// `today` was computed with `new Date().toISOString().split('T')[0]` (the UTC
// date), so between 00:00–05:29 IST it was *yesterday* — and today's own cell
// stayed dot-less until 05:30. TZ is pinned to IST and the clock to 03:34 IST so
// the bug reproduces regardless of the machine/CI timezone.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

const member = { email: 'alice@example.com', name: 'Alice' }

// NOTE: vi.mock factories are hoisted above top-level consts, so the member
// literal is inlined here rather than referencing `member` (which would TDZ).
vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  ATTENDANCE_STATUSES: [],
  isAdmin: () => false,
  getAttendanceTeam: () => [{ email: 'alice@example.com', name: 'Alice' }],
}))
vi.mock('./db.js', () => ({
  subscribeToLeaves: (_, cb) => { cb([]); return () => {} },
  subscribeToHolidays: (_, cb) => { cb([]); return () => {} },
  subscribeToContracts: (_, cb) => { cb([]); return () => {} },
  createLeave: vi.fn(),
  cancelLeave: vi.fn(),
  createHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
}))
vi.mock('./leave-modal.js', () => ({ openLeaveModal: vi.fn() }))
vi.mock('./utils/contracts.js', () => ({
  accrualMonthsFromContracts: () => 0,
  contractsForUser: () => [],
  earliestContractStart: () => null,
}))

import { renderAttendance, cleanupAttendance } from './attendance.js'

describe('Attendance grid — today dot across the UTC day boundary (IST)', () => {
  let container
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    // Fri 2026-06-19 03:34 IST (= Thu 2026-06-18T22:04:00Z).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-18T22:04:00Z'))
  })
  afterEach(() => {
    cleanupAttendance()
    vi.useRealTimers()
    container.remove()
  })
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it("shows a worked dot on today's cell at 03:34 IST (local day, not UTC)", () => {
    // Guard: confirm IST took effect (in UTC this is still the 18th, no bug).
    expect(new Date().getDate()).toBe(19)
    expect(new Date().getHours()).toBe(3)

    renderAttendance(container, { db: {}, currentUser: { email: member.email } })

    const todayCell = container.querySelector('[data-date="2026-06-19"]')
    expect(todayCell).toBeTruthy()
    expect(todayCell.querySelector('.att-dot')).toBeTruthy()
  })
})
