// Helpers for deriving leave-accrual data from a person's contracts.
// A "contract" is { userEmail, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD or null), ... }.
// Months are counted inclusively from the start month: a contract that begins
// March 1 contributes 1 month in March, 2 by April, etc. — matching the legacy
// monthsSinceJoin semantics so the migration is a no-op for current data.

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

// Total accrued months across all of a person's contracts. Gaps between
// contracts don't accrue (correct for contractor model).
export function accrualMonthsFromContracts(contracts, asOf = new Date()) {
  if (!Array.isArray(contracts) || contracts.length === 0) return 0
  return contracts.reduce((sum, c) => sum + contractMonths(c, asOf), 0)
}

// Total medical-leave pool across a person's contracts. Unlike personal leave
// (which accrues 1/month), medical leave is a fixed pool for the contract term:
// each started contract contributes its `medicalLeaveTotal` (default 3). Pools
// sum across contracts; contracts that haven't started yet contribute 0.
export function medicalTotalFromContracts(contracts, asOf = new Date()) {
  if (!Array.isArray(contracts) || contracts.length === 0) return 0
  return contracts.reduce((sum, c) => {
    if (!c.startDate) return sum
    if (parseDate(c.startDate) > asOf) return sum
    const total = typeof c.medicalLeaveTotal === 'number' ? c.medicalLeaveTotal : DEFAULT_MEDICAL_TOTAL
    return sum + total
  }, 0)
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
