// Regression test for the early-morning day-boundary bug in the contracts view.
//
// A contract is "Ended" when `endDate < today`. `today` was computed with
// `new Date().toISOString().split('T')[0]` (the UTC date), so between
// 00:00–05:29 IST it was *yesterday* — a contract that ended yesterday still
// showed as "Active" until 05:30. TZ is pinned to IST and the clock to 03:34 IST
// so the bug reproduces regardless of the machine/CI timezone.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

const member = { email: 'alice@example.com', name: 'Alice' }

// vi.mock factories are hoisted — inline literals, don't reference `member`.
vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  isAdmin: () => false,
  getAttendanceTeam: () => [{ email: 'alice@example.com', name: 'Alice' }],
}))
vi.mock('./db.js', () => ({
  subscribeToContracts: (_, cb) => {
    cb([{ id: 'k1', userEmail: 'alice@example.com', startDate: '2026-01-01', endDate: '2026-06-18' }])
    return () => {}
  },
  subscribeToLeaves: (_, cb) => { cb([]); return () => {} },
  createContract: vi.fn(),
  updateContract: vi.fn(),
  deleteContract: vi.fn(),
}))
vi.mock('./utils/contracts.js', () => ({
  accrualMonthsFromContracts: () => 0,
  contractsForUser: (all) => all,
  earliestContractStart: () => null,
}))

import { renderContracts, cleanupContracts } from './contracts.js'

describe('Contracts view — "Ended" badge across the UTC day boundary (IST)', () => {
  let container
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    // Fri 2026-06-19 03:34 IST (= Thu 2026-06-18T22:04:00Z).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-18T22:04:00Z'))
  })
  afterEach(() => {
    cleanupContracts()
    vi.useRealTimers()
    container.remove()
  })
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('marks a contract that ended yesterday (local) as Ended at 03:34 IST', () => {
    // Guard: confirm IST took effect (in UTC, "today" is still 06-18).
    expect(new Date().getDate()).toBe(19)

    renderContracts(container, { db: {}, currentUser: { email: member.email } })

    const ended = container.querySelector('.contract-status-ended')
    expect(ended).toBeTruthy()
    expect(ended.textContent).toBe('Ended')
  })
})
