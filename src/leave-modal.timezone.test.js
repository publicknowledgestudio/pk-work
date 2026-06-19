// Regression test for the early-morning day-boundary bug in the leave modal.
//
// The leave date inputs default to "tomorrow". That default was built with
// `tomorrow.toISOString().split('T')[0]` (the UTC date), so between 00:00–05:29
// IST it resolved to *today* instead of tomorrow. TZ is pinned to IST and the
// clock to 03:34 IST so the bug reproduces regardless of the machine/CI
// timezone. leave-modal.js grabs its elements at import time, so the DOM
// scaffold is injected and the module dynamically imported afterwards.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  isAdmin: () => false,
  getAttendanceTeam: () => [],
}))
vi.mock('./db.js', () => ({ createLeave: vi.fn(), updateLeave: vi.fn() }))
vi.mock('./utils/contracts.js', () => ({
  accrualMonthsFromContracts: () => 0,
  contractsForUser: () => [],
}))

const SCAFFOLD = `
  <div id="leave-modal" class="hidden">
    <button id="leave-modal-close"></button>
    <button id="leave-cancel-btn"></button>
    <button id="leave-save-btn"></button>
    <h2 id="leave-modal-title"></h2>
    <div id="leave-type-pills"></div>
    <input id="leave-start" type="date">
    <input id="leave-end" type="date">
    <input id="leave-half-day" type="checkbox">
    <textarea id="leave-note"></textarea>
    <div id="leave-summary"></div>
    <div id="leave-person-row"><select id="leave-person"></select></div>
  </div>
`

let openLeaveModal

describe('Leave modal — default "tomorrow" across the UTC day boundary (IST)', () => {
  beforeAll(async () => {
    document.body.innerHTML = SCAFFOLD
    ;({ openLeaveModal } = await import('./leave-modal.js'))
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

  it('defaults the start/end dates to tomorrow (local), not today, at 03:34 IST', () => {
    // Guard: confirm IST took effect (in UTC, tomorrow would stringify to 06-19).
    expect(new Date().getDate()).toBe(19)

    openLeaveModal({ db: {}, currentUser: { email: 'alice@example.com' }, allLeaves: [], allContracts: [] }, {})

    expect(document.getElementById('leave-start').value).toBe('2026-06-20')
    expect(document.getElementById('leave-end').value).toBe('2026-06-20')
  })
})
