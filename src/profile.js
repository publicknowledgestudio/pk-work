// ───────────────────────────────────────────────────────────────────────────
// Profile — a game-awards-style stats screen for each team member.
//
// Everything is computed client-side from the tasks the app already has in
// memory (createdBy / createdAt / closedAt / assignees), so this doubles as
// the team-visible face of usage telemetry: the same signals Gyan sees, shown
// to the person they belong to, framed as wins.
// Route: #/profile/<email> (defaults to the signed-in user).
// ───────────────────────────────────────────────────────────────────────────

import { TEAM } from './config.js'
import { toDate, toLocalISODate } from './utils/dates.js'

export function renderProfile(container, tasks, ctx, email) {
  const member = TEAM.find((m) => m.email === email) || TEAM.find((m) => m.email === ctx.currentUser?.email)
  if (!member) { container.innerHTML = '<div class="profile-empty">No profile found.</div>'; return }

  const s = computeStats(tasks, member.email, ctx)
  const awards = computeAwards(s)
  const unlockedCount = awards.filter((a) => a.unlocked).length

  container.innerHTML = `
    <div class="profile-screen">
      <div class="profile-hero" style="--pc:${member.color}">
        <div class="profile-hero-glow"></div>
        <div class="profile-avatar-ring">
          ${member.photoURL
            ? `<img class="profile-avatar" src="${member.photoURL}" alt="${esc(member.name)}">`
            : `<span class="profile-avatar profile-avatar-fallback" style="background:${member.color}">${esc(member.name[0])}</span>`}
        </div>
        <h1 class="profile-name">${esc(member.name)}</h1>
        <div class="profile-subtitle">${esc(title(s))}</div>
        <div class="profile-since">${s.firstSeen ? `In the studio since ${s.firstSeen.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : 'Just getting started'}</div>
      </div>

      <div class="profile-stats-grid">
        ${statTile('🌱', s.created, 'Tasks Planted', 'created by ' + member.name)}
        ${statTile('🌼', s.completed, 'Tasks Bloomed', 'completed all-time')}
        ${statTile('🔥', s.currentStreak, 'Day Streak', s.currentStreak > 0 ? 'consecutive workdays with a finish' : 'finish a task to start one')}
        ${statTile('🏆', s.longestStreak, 'Best Streak', 'personal record')}
        ${statTile('⚡', s.doneThisWeek, 'This Week', s.doneLastWeek ? `${s.doneLastWeek} last week` : 'closed since Monday')}
        ${statTile('🔨', s.inFlight, 'In Flight', 'in progress or review right now')}
        ${statTile('🗓️', s.busiestDay || '—', 'Power Day', 'most finishes land on this day')}
        ${statTile('🤝', s.topClient || '—', 'Most Tended', 'client with the most bloomed tasks')}
      </div>

      <div class="profile-section-title">Trophy Cabinet <span class="profile-award-count">${unlockedCount}/${awards.length}</span></div>
      <div class="profile-awards-grid">
        ${awards.map((a) => `
          <div class="profile-award${a.unlocked ? ' unlocked' : ' locked'}" title="${esc(a.hint)}">
            <span class="profile-award-medal">${a.emoji}</span>
            <span class="profile-award-name">${esc(a.name)}</span>
            <span class="profile-award-desc">${esc(a.unlocked ? a.desc : a.hint)}</span>
          </div>
        `).join('')}
      </div>

      <div class="profile-section-title">Last 12 Weeks</div>
      <div class="profile-weeks">
        ${s.weeklyCounts.map((w) => `
          <div class="profile-week-col" title="${w.label}: ${w.count} completed">
            <div class="profile-week-bar" style="height:${Math.min(100, w.count * 14)}%;--pc:${member.color}"></div>
            <span class="profile-week-count">${w.count || ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function statTile(emoji, value, label, hint) {
  return `
    <div class="profile-stat" title="${esc(hint)}">
      <span class="profile-stat-emoji">${emoji}</span>
      <span class="profile-stat-value">${esc(String(value))}</span>
      <span class="profile-stat-label">${esc(label)}</span>
    </div>
  `
}

// A playful rank name that grows with completions — the "level" of the screen.
function title(s) {
  if (s.completed >= 200) return 'Studio Legend'
  if (s.completed >= 100) return 'Master Gardener'
  if (s.completed >= 50) return 'Head Cultivator'
  if (s.completed >= 20) return 'Green Thumb'
  if (s.completed >= 5) return 'Sprouting'
  return 'Fresh Seedling'
}

function computeStats(tasks, email, ctx) {
  const created = tasks.filter((t) => t.createdBy === email)
  const mine = tasks.filter((t) => (t.assignees || []).includes(email))
  const done = mine.filter((t) => t.status === 'done' && t.closedAt)

  // First seen: earliest trace of this person in the data
  let firstSeen = null
  for (const t of [...created, ...mine]) {
    const d = toDate(t.createdAt)
    if (d && (!firstSeen || d < firstSeen)) firstSeen = d
  }

  // Completions per local day
  const byDay = new Map()
  for (const t of done) {
    const ds = toLocalISODate(toDate(t.closedAt))
    if (ds) byDay.set(ds, (byDay.get(ds) || 0) + 1)
  }

  // Streaks over workdays (weekends don't break a streak, they just don't count)
  const { current, longest } = streaks(byDay)

  // Day-of-week histogram
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const t of done) {
    const d = toDate(t.closedAt)
    if (d) dowCounts[d.getDay()]++
  }
  const maxDow = Math.max(...dowCounts)
  const busiestDay = maxDow > 0
    ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dowCounts.indexOf(maxDow)]
    : null

  // Top client by completed tasks
  const byClient = new Map()
  for (const t of done) {
    if (t.clientId) byClient.set(t.clientId, (byClient.get(t.clientId) || 0) + 1)
  }
  let topClient = null, topN = 0
  for (const [cid, n] of byClient) {
    if (n > topN) { topN = n; topClient = ctx.clients.find((c) => c.id === cid)?.name || null }
  }

  // This week vs last (weeks start Monday)
  const now = new Date()
  const monday = startOfWeek(now)
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7)
  let doneThisWeek = 0, doneLastWeek = 0
  for (const t of done) {
    const d = toDate(t.closedAt)
    if (!d) continue
    if (d >= monday) doneThisWeek++
    else if (d >= lastMonday) doneLastWeek++
  }

  // 12-week completion history
  const weeklyCounts = []
  for (let i = 11; i >= 0; i--) {
    const start = new Date(monday); start.setDate(monday.getDate() - i * 7)
    const end = new Date(start); end.setDate(start.getDate() + 7)
    const count = done.filter((t) => { const d = toDate(t.closedAt); return d && d >= start && d < end }).length
    weeklyCounts.push({ count, label: `Week of ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` })
  }

  // Special-moment detection for awards
  let earlyBird = false, nightOwl = false, hatTrickDay = 0, speedRun = false, marathon = false
  for (const t of done) {
    const d = toDate(t.closedAt)
    if (!d) continue
    const hr = d.getHours()
    // Backdated closes land at 23:59:59 exactly — don't count those as night owl
    const isBackdateStamp = hr === 23 && d.getMinutes() === 59
    if (hr < 9) earlyBird = true
    if (hr >= 22 && !isBackdateStamp) nightOwl = true
    const c = toDate(t.createdAt)
    if (c) {
      const ms = d - c
      if (ms > 0 && ms < 3600000) speedRun = true
      if (ms > 30 * 86400000) marathon = true
    }
  }
  for (const n of byDay.values()) hatTrickDay = Math.max(hatTrickDay, n)

  return {
    firstSeen,
    created: created.length,
    completed: done.length,
    inFlight: mine.filter((t) => ['in_progress', 'review'].includes(t.status)).length,
    currentStreak: current,
    longestStreak: longest,
    busiestDay,
    topClient,
    doneThisWeek,
    doneLastWeek,
    weeklyCounts,
    earlyBird, nightOwl, hatTrick: hatTrickDay >= 3, bigDay: hatTrickDay >= 5, speedRun, marathon,
  }
}

function computeAwards(s) {
  return [
    { emoji: '🌸', name: 'First Bloom', desc: 'Completed a task', hint: 'Complete your first task', unlocked: s.completed >= 1 },
    { emoji: '💐', name: 'Bouquet', desc: '10 tasks completed', hint: 'Complete 10 tasks', unlocked: s.completed >= 10 },
    { emoji: '🌻', name: 'Half Century', desc: '50 tasks completed', hint: 'Complete 50 tasks', unlocked: s.completed >= 50 },
    { emoji: '👑', name: 'Centurion', desc: '100 tasks completed', hint: 'Complete 100 tasks', unlocked: s.completed >= 100 },
    { emoji: '🎩', name: 'Hat Trick', desc: '3 finished in one day', hint: 'Finish 3 tasks in a single day', unlocked: s.hatTrick },
    { emoji: '🌋', name: 'Eruption', desc: '5 finished in one day', hint: 'Finish 5 tasks in a single day', unlocked: s.bigDay },
    { emoji: '🔥', name: 'On a Roll', desc: '5-workday finish streak', hint: 'Finish tasks 5 workdays in a row', unlocked: s.longestStreak >= 5 },
    { emoji: '🐦', name: 'Early Bird', desc: 'Finished before 9am', hint: 'Finish a task before 9am', unlocked: s.earlyBird },
    { emoji: '🦉', name: 'Night Owl', desc: 'Finished after 10pm', hint: 'Finish a task after 10pm', unlocked: s.nightOwl },
    { emoji: '⚡', name: 'Speed Run', desc: 'Created → done within an hour', hint: 'Finish a task within an hour of creating it', unlocked: s.speedRun },
    { emoji: '🐢', name: 'Marathon', desc: 'Closed a 30-day-old task', hint: 'Finally close a task older than 30 days', unlocked: s.marathon },
    { emoji: '🌱', name: 'Self Starter', desc: '20 tasks self-created', hint: 'Create 20 tasks yourself', unlocked: s.created >= 20 },
  ]
}

// Workday streaks: consecutive Mon–Fri days each having ≥1 completion,
// bridging weekends. Current streak tolerates "today has none yet".
function streaks(byDay) {
  let longest = 0
  const days = [...byDay.keys()].sort()
  if (days.length === 0) return { current: 0, longest: 0 }

  let run = 0
  let prev = null
  for (const ds of days) {
    if (prev && workdayGap(prev, ds) === 1) run++
    else run = 1
    longest = Math.max(longest, run)
    prev = ds
  }

  // Current streak: walk back from today (or the most recent workday)
  let current = 0
  const cursor = new Date()
  const todayStr = toLocalISODate(cursor)
  if (!byDay.has(todayStr)) {
    // today doesn't count against you until it's over
    cursor.setDate(cursor.getDate() - 1)
  }
  for (;;) {
    const dow = cursor.getDay()
    if (dow === 0 || dow === 6) { cursor.setDate(cursor.getDate() - 1); continue }
    if (byDay.has(toLocalISODate(cursor))) { current++; cursor.setDate(cursor.getDate() - 1) }
    else break
  }
  return { current, longest }
}

// Number of workdays between two ISO dates (1 = consecutive workdays)
function workdayGap(a, b) {
  const da = new Date(a + 'T12:00'), db = new Date(b + 'T12:00')
  let gap = 0
  const d = new Date(da)
  while (d < db) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) gap++
    if (gap > 2) break
  }
  return gap
}

function startOfWeek(d) {
  const out = new Date(d)
  const dow = out.getDay()
  out.setDate(out.getDate() + (dow === 0 ? -6 : 1 - dow))
  out.setHours(0, 0, 0, 0)
  return out
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
