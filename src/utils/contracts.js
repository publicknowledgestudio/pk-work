// Helpers for deriving leave-accrual data from a person's contracts.
// A "contract" is { userEmail, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD or null), ... }.
// Months are counted inclusively from the start month: a contract that begins
// March 1 contributes 1 month in March, 2 by April, etc. — matching the legacy
// monthsSinceJoin semantics so the migration is a no-op for current data.
//
// Leave balances are scoped to the CURRENT contract term (see currentContract):
// each contract is self-contained, so a fresh contract starts with a fresh
// balance and leaves taken under a prior contract (or during a gap between
// contracts) don't count against it.

import { toLocalISODate } from './dates.js'

// Default medical-leave pool for a contract when `medicalLeaveTotal` is unset.
// Matches the written leave policy ("up to 3 days total during your contract").
export const DEFAULT_MEDICAL_TOTAL = 3

function parseDate(s) {
  return new Date(s + 'T00:00:00')
}

function monthsBetweenInclusive(startDate, endDate) {
  const start = parseDate(startDate)
  const end = endDate instanceof Date ? endDate : parseDate(endDate)
  if (end < start) return 0
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
}

// Months a single contract has accrued by `asOf`. Caps at the contract's
// endDate if it has one; returns 0 if the contract hasn't started yet.
export function contractMonths(contract, asOf = new Date()) {
  if (!contract?.startDate) return 0
  const start = parseDate(contract.startDate)
  if (start > asOf) return 0
  const end = contract.endDate ? parseDate(contract.endDate) : asOf
  const cap = end < asOf ? end : asOf
  return Math.max(0, monthsBetweenInclusive(contract.startDate, cap))
}

// Earliest contract start for a person, used as the "joined" anchor in the UI.
// Returns YYYY-MM-DD or null.
export function earliestContractStart(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) return null
  return contracts.reduce((earliest, c) => {
    if (!c.startDate) return earliest
    if (!earliest || c.startDate < earliest) return c.startDate
    return earliest
  }, null)
}

// Filter contracts to one person's set.
export function contractsForUser(contracts, userEmail) {
  if (!Array.isArray(contracts)) return []
  return contracts.filter((c) => c.userEmail === userEmail)
}

// The contract a person's balance should be computed against as of `asOf`:
// the active contract (started, not yet ended) with the latest start; or, if
// none is active (e.g. between contracts), the most recent started contract.
// Returns null when the person has no started contract on file.
export function currentContract(contracts, asOf = new Date()) {
  if (!Array.isArray(contracts) || contracts.length === 0) return null
  const asOfISO = toLocalISODate(asOf)
  const started = contracts.filter((c) => c.startDate && c.startDate <= asOfISO)
  if (started.length === 0) return null
  const active = started.filter((c) => !c.endDate || c.endDate >= asOfISO)
  const candidates = active.length > 0 ? active : started
  return candidates.reduce((best, c) => (!best || c.startDate > best.startDate ? c : best), null)
}

// Medical-leave pool for a single contract (its `medicalLeaveTotal`, or the
// default). Returns 0 for a null contract.
export function medicalPoolForContract(contract) {
  if (!contract) return 0
  return typeof contract.medicalLeaveTotal === 'number' ? contract.medicalLeaveTotal : DEFAULT_MEDICAL_TOTAL
}

// Whether a leave (keyed by its YYYY-MM-DD start date) falls within a
// contract's term. A null contract contains nothing.
export function isWithinContractTerm(dateStr, contract) {
  if (!contract || !dateStr) return false
  if (dateStr < contract.startDate) return false
  if (contract.endDate && dateStr > contract.endDate) return false
  return true
}
