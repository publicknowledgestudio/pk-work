# Leave and monthly payout policy

Policy engine: `functions/leave-policy.mjs`. The website, API, previews and closed statements all use this module. Stored leave `paidDays` / `unpaidDays` are creation-time snapshots; use calculated API responses or statements for payroll.

## Eligibility and agreements

Only Sharang, Mohit and Rakesh are eligible (`full_time` engagement role, separate from application permissions). Gyan, Charu and Devika retain application access but have no leave balances. Historical leave documents are retained, not deleted.

Each contract is independent. Personal leave does not transfer at renewal and is not encashable. Medical leave is three days at the start of each six-month service period, without rollover; explicit historical contract allowances are retained. No contract means the leave cannot be closed for deduction until the dates are reconciled.

Sharang and Mohit have new terms from 2026-10-01 through 2027-03-31. The idempotent migration `apply-leave-renewals.cjs` creates or updates those terms and ends overlapping older terms on 2026-09-30. It preserves historical leave. The admin-only October setup action runs this transaction after deployment. Do not infer or overwrite monthly fees; the administrator supplies the agreed fee when reviewing each payout statement.

## Personal accrual and counting

One day is earned after each completed service month, usable from the next service month. October 1 start: zero during October, one day on November 1. October 20 start: first credit on November 20. Anniversaries on a missing calendar date use the month's last day. Accrual stops at contract end. A credit earned after an absence never retrospectively pays for that absence.

Unused earned credit carries only within the same term. Approved compensatory overtime is credited on its recorded date, one day or half-day, and expires with the term. Legacy overtime entries without explicit approval do not count automatically.

Count Monday–Friday, excluding January 26, August 15, October 2, plus holiday documents with `studioApproved: true`. Existing holiday documents without that flag do not automatically exempt religious holidays. Administrators must explicitly approve any additional studio holiday. Weekend/holiday half-days are zero. Multi-day requests are split into daily entries and evaluated using the applicable contract and balance on each day. Overlapping notices must be reconciled before closing. Cancelled records do not count.

## Monthly close

Admin: Leaves → select month → Monthly leave close → person and agreed monthly fee → Review statement → Close month and lock statement.

Daily rate = full monthly fee / scheduled working days in the calendar month.
Deduction = daily rate × unpaid day equivalents, rounded to paise after multiplying.

The denominator excludes the same weekends and holidays used for absence counting. This is a full-month fee divisor; review unusual partial-month or changed-rate agreements separately rather than entering a prorated fee as if it were the full-month fee.

The statement contains opening and closing balances, effective-date credits, daily paid/unpaid allocations, the monthly fee, divisor, current deduction and prior-period corrections. Download produces a printable standalone HTML statement.

Only completed calendar months can be closed. Closing requires a preview revision matching the transaction's current source data. Snapshots cannot be overwritten; retries return the existing statement. After the first close, subsequent closes must follow consecutive months. No automatic transfer to PK Money or bank transaction is performed. Apply the confirmed statement amount to that month's payout.

Late entries/cancellations/contract or holiday corrections are recalculated against the original month's fee and divisor. The next close contains only the difference from the original deduction and adjustments already settled. Negative adjustments are payout credits. The original statement stays immutable. Do not close pre-launch historical months without reconciling prior payments, deductions, waivers and make-up agreements first.

## API

Existing API-key authentication applies to:

- `GET /leaves`: derived daily allocations and paid/unpaid totals.
- `GET /leaves/balances`: shared-policy balances, eligible people only.
- `GET /leaves/closes?userEmail=...&month=YYYY-MM&monthlyFee=...`: preview (or existing locked statement).
- `POST /leaves/closes`: `{userEmail, month, monthlyFee, previewRevision}` closes a reviewed statement.
- `GET /leaves/closes`: saved statements.

The `leaveClose` HTTPS function exposes the same close handler to the website with a Firebase ID token and verifies Charu/Gyan admin identity server-side. `POST {action: "applyOctoberRenewals"}` performs the agreed renewal migration. Closed statements are backend-write-only under Firestore rules. No close or contract migration posts Slack messages.

## Deployment and verification

Run `npm test`, `npm run build`, then deploy hosting, Firestore rules, `api` and `leaveClose` together. A signed-in Firebase account with project access is required. Apply and read back the October renewal migration before using new statements. Review October 2026 first; do not automatically finalize historical deductions.
