// Normalize anything date-like (Firestore Timestamp, { seconds }, Date, ISO string)
// into a JS Date, or null if absent.
export function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

// Render a deadline relative to today: Today / Tomorrow / Yesterday /
// Nd ago / Nd / "Mon 5". Returns '' when there is no deadline.
export function formatDeadline(deadline) {
  if (!deadline) return ''
  const d = toDate(deadline)
  const now = new Date()
  const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < -1) return `${Math.abs(diff)}d ago`
  if (diff <= 7) return `${diff}d`

  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

// "Mar 5" style short date — takes a Date, not a Timestamp.
export function formatShortDate(d) {
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

// YYYY-MM-DD string for <input type="date"> values and API payloads.
// Accepts anything toDate accepts. Returns '' for null/undefined.
export function toISODate(ts) {
  const d = toDate(ts)
  if (!d || isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

// YYYY-MM-DD using LOCAL calendar components — no UTC conversion.
// Use when the input is a local-midnight Date and the output should preserve
// that calendar day regardless of the user's timezone (toISOString rolls
// local-midnight back by one day for any timezone east of UTC).
export function toLocalISODate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Convert any date-like value (Firestore Timestamp, { seconds }, Date, ISO
// string) to an ISO-8601 UTC string. Returns null for absent values so
// consumers can keep distinguishing "no date" from "epoch". Used at the
// Firestore read boundary (see db.js normalizeTask) so the rest of the
// app never has to shape-sniff timestamps.
export function toISOString(ts) {
  const d = toDate(ts)
  if (!d || isNaN(d.getTime())) return null
  return d.toISOString()
}
