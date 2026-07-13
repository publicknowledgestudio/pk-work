// Unit tests for the per-contract-term leave model.
//
// Leave balances are scoped to a person's CURRENT contract term: each contract
// is self-contained. Medical is a fixed pool per term (default 3) that does not
// roll over — including across contracts — and personal accrues 1/month of the
// current contract only. Leaves taken under a prior contract, or during a gap
// between contracts, don't count against the current one.
//
// Regression scenario: Sharang finished a contract, took a month off, then
// started a fresh 3-month contract. His old-contract leaves must NOT debit the
// new contract's fresh balance.

import { describe, it, expect } from 'vitest'
import {
  currentContract,
  medicalPoolForContract,
  isWithinContractTerm,
  contractMonths,
  DEFAULT_MEDICAL_TOTAL,
} from './utils/contracts.js'

const asOf = new Date('2026-07-13T00:00:00')

describe('currentContract', () => {
  it('picks the active contract (started, not ended)', () => {
    const contracts = [
      { id: 'old', startDate: '2026-03-01', endDate: '2026-05-31' },
      { id: 'new', startDate: '2026-07-01', endDate: '2026-09-30' },
    ]
    expect(currentContract(contracts, asOf)?.id).toBe('new')
  })

  it('falls back to the most recent started contract when none is active (gap)', () => {
    const contracts = [
      { id: 'old', startDate: '2026-03-01', endDate: '2026-05-31' },
    ]
    // asOf is in June (the gap) — no active contract, so show the last one.
    expect(currentContract(contracts, new Date('2026-06-15T00:00:00'))?.id).toBe('old')
  })

  it('ignores contracts that have not started yet', () => {
    const contracts = [{ id: 'future', startDate: '2026-09-01', endDate: null }]
    expect(currentContract(contracts, asOf)).toBe(null)
  })

  it('returns null when there are no contracts', () => {
    expect(currentContract([], asOf)).toBe(null)
    expect(currentContract(undefined, asOf)).toBe(null)
  })
})

describe('medicalPoolForContract', () => {
  it('defaults to 3 when medicalLeaveTotal is unset', () => {
    expect(medicalPoolForContract({ startDate: '2026-07-01' })).toBe(DEFAULT_MEDICAL_TOTAL)
    expect(DEFAULT_MEDICAL_TOTAL).toBe(3)
  })
  it('respects an explicit total, including 0', () => {
    expect(medicalPoolForContract({ medicalLeaveTotal: 5 })).toBe(5)
    expect(medicalPoolForContract({ medicalLeaveTotal: 0 })).toBe(0)
  })
  it('is 0 for a null contract', () => {
    expect(medicalPoolForContract(null)).toBe(0)
  })
})

describe('isWithinContractTerm', () => {
  const contract = { startDate: '2026-07-01', endDate: '2026-09-30' }
  it('includes dates within the term (inclusive of both ends)', () => {
    expect(isWithinContractTerm('2026-07-01', contract)).toBe(true)
    expect(isWithinContractTerm('2026-08-15', contract)).toBe(true)
    expect(isWithinContractTerm('2026-09-30', contract)).toBe(true)
  })
  it('excludes dates before the start or after the end', () => {
    expect(isWithinContractTerm('2026-06-30', contract)).toBe(false)
    expect(isWithinContractTerm('2026-10-01', contract)).toBe(false)
  })
  it('treats an open-ended contract as extending indefinitely', () => {
    expect(isWithinContractTerm('2030-01-01', { startDate: '2026-07-01', endDate: null })).toBe(true)
  })
  it('contains nothing for a null contract', () => {
    expect(isWithinContractTerm('2026-08-01', null)).toBe(false)
  })
})

describe('Sharang scenario — fresh contract starts fresh', () => {
  // Only the fresh July contract is on file; old-contract leaves are Mar–May.
  const contracts = [{ id: 'new', startDate: '2026-07-01', endDate: '2026-09-30', medicalLeaveTotal: 3 }]
  const contract = currentContract(contracts, asOf)

  const oldLeaves = [
    { type: 'medical', startDate: '2026-03-09' },
    { type: 'medical', startDate: '2026-03-23', halfDay: true },
    { type: 'medical', startDate: '2026-05-06' },
    { type: 'personal', startDate: '2026-03-27' },
    { type: 'personal', startDate: '2026-05-20' },
    { type: 'personal', startDate: '2026-05-21' },
    { type: 'personal', startDate: '2026-05-22' },
  ]

  it('gives a fresh medical pool of 3 — old-contract medical days do not carry', () => {
    const pool = medicalPoolForContract(contract)
    const usedInTerm = oldLeaves.filter((l) => l.type === 'medical' && isWithinContractTerm(l.startDate, contract)).length
    expect(pool).toBe(3)
    expect(usedInTerm).toBe(0) // none of the March/May medical leaves count
  })

  it('does not show phantom unpaid personal days from the old contract', () => {
    const usedInTerm = oldLeaves.filter((l) => l.type === 'personal' && isWithinContractTerm(l.startDate, contract)).length
    expect(usedInTerm).toBe(0)
  })

  it('accrues personal from the fresh contract only (1 month by mid-July)', () => {
    expect(contractMonths(contract, asOf)).toBe(1)
  })
})
