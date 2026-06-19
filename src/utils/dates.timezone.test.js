// Regression test for the local-day helper at the heart of the early-morning
// day-boundary bug. `toLocalISODate` builds YYYY-MM-DD from LOCAL calendar
// components; the buggy pattern it replaces — `date.toISOString().split('T')[0]`
// — returns the UTC date, which rolls back one calendar day for any timezone
// east of UTC (IST = UTC+5:30) between local midnight and the offset
// (00:00–05:29 IST). TZ is pinned to IST so the contrast is reproducible
// regardless of the machine/CI timezone (in UTC the bug can't manifest).

import { describe, it, expect, afterAll } from 'vitest'

const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'Asia/Kolkata'

import { toLocalISODate } from './dates.js'

describe('toLocalISODate — local calendar day across the UTC boundary (IST)', () => {
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('reports the local calendar day, not the UTC day', () => {
    // Fri 2026-06-19 01:30 IST = Thu 2026-06-18T20:00:00Z. The UTC date is the
    // *previous* day — the exact window where the old code rolled back.
    const earlyMorningIST = new Date('2026-06-18T20:00:00Z')
    // Guard: confirm IST actually took effect for this worker, else the
    // assertion below would be meaningless.
    expect(earlyMorningIST.getDate()).toBe(19)
    expect(earlyMorningIST.toISOString().split('T')[0]).toBe('2026-06-18') // the bug
    expect(toLocalISODate(earlyMorningIST)).toBe('2026-06-19') // the fix
  })

  it('keeps a UTC-midnight date-only value on the same day in IST', () => {
    // Deadlines are stored as UTC midnight; +5:30 lands at 05:30 IST, same day.
    expect(toLocalISODate(new Date('2026-06-20T00:00:00.000Z'))).toBe('2026-06-20')
  })

  it('returns "" for null, invalid dates, and non-Date inputs', () => {
    expect(toLocalISODate(null)).toBe('')
    expect(toLocalISODate(undefined)).toBe('')
    expect(toLocalISODate(new Date('not a date'))).toBe('')
    // Strict by design: callers with a Timestamp/ISO string must toDate() first.
    expect(toLocalISODate('2026-06-19')).toBe('')
  })
})
