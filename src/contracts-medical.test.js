// Unit tests for the medical-leave pool model. Medical leave is a fixed pool
// per contract term (default 3), not a monthly accrual — this is what supports
// e.g. Anandu's "3 medical leaves over the 6-month contract" terms.

import { describe, it, expect } from 'vitest'
import { medicalTotalFromContracts, DEFAULT_MEDICAL_TOTAL } from './utils/contracts.js'

const asOf = new Date('2026-07-12T00:00:00')

describe('medicalTotalFromContracts', () => {
  it('defaults to 3 for a started contract with no explicit total', () => {
    const contracts = [{ userEmail: 'a@x.co', startDate: '2026-03-01', endDate: '2026-08-31' }]
    expect(medicalTotalFromContracts(contracts, asOf)).toBe(DEFAULT_MEDICAL_TOTAL)
    expect(DEFAULT_MEDICAL_TOTAL).toBe(3)
  })

  it('respects an explicit medicalLeaveTotal', () => {
    const contracts = [{ userEmail: 'a@x.co', startDate: '2026-03-01', endDate: '2026-08-31', medicalLeaveTotal: 3 }]
    expect(medicalTotalFromContracts(contracts, asOf)).toBe(3)
    expect(medicalTotalFromContracts([{ startDate: '2026-03-01', medicalLeaveTotal: 5 }], asOf)).toBe(5)
    expect(medicalTotalFromContracts([{ startDate: '2026-03-01', medicalLeaveTotal: 0 }], asOf)).toBe(0)
  })

  it('does not count contracts that have not started yet', () => {
    const contracts = [{ startDate: '2026-09-01', medicalLeaveTotal: 3 }]
    expect(medicalTotalFromContracts(contracts, asOf)).toBe(0)
  })

  it('sums pools across a person\'s contracts', () => {
    const contracts = [
      { startDate: '2025-01-01', endDate: '2025-06-30', medicalLeaveTotal: 3 },
      { startDate: '2026-03-01', endDate: '2026-08-31' }, // default 3
    ]
    expect(medicalTotalFromContracts(contracts, asOf)).toBe(6)
  })

  it('returns 0 when there are no contracts', () => {
    expect(medicalTotalFromContracts([], asOf)).toBe(0)
    expect(medicalTotalFromContracts(undefined, asOf)).toBe(0)
  })
})
