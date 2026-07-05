// ───────────────────────────────────────────────────────────────────────────
// Scrum Room — a live, multiplayer standup view.
//
// The Garden header shows a "Join Scrum" pill with the avatars of whoever is
// currently in the room. Joining navigates to #/scrum: everyone's tasks in
// backlog-style rows grouped by person, with live cursors (Figma-style, like
// the garden) and a row UI built for standup speed:
//   · quick status buttons; "Done ▾" opens a past-facing two-week calendar
//     to backdate closedAt (work finished yesterday is the common case)
//   · a 💬 flag marks a task "needs discussion" — flags are shared live and
//     collect into a panel at the top, grouped by client, so after silent
//     triage the meeting walks exactly that list and nothing else
//
// Transport: Firebase Realtime Database (presence + cursors + flags, cleared
// on disconnect / next day), same as the cursor garden. Task changes ride the
// existing Firestore subscription, so every participant's view updates live.
// Demo mode (?demo=1) runs local-only with ghost participants.
// ───────────────────────────────────────────────────────────────────────────

import { TEAM, STATUSES } from './config.js'
import { updateTask } from './db.js'
import { toDate, toLocalISODate } from './utils/dates.js'

const ROOM_ID = 'daily'
const CURSOR_WRITE_MS = 45
const STALE_DAYS = 3 // in_progress untouched this long wilts 🥀

const CURSOR_SVG = '<svg width="22" height="30" viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.65 12.37H5.46l-.14.13L.5 16.88V1.2l11.28 11.17H5.65Z" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>'
const CONFETTI = ['🌸', '🌼', '🌻', '🌷', '✨', '🌿', '💮']

let cfg = { rtdb: null, user: null, isDemo: false }
let rdb = null // firebase/database module (lazy)
let joined = false
let joinedAt = 0

// Participants (uid -> { name, color, email, photoURL })
const participants = new Map()
let unsubParticipants = null
const widgetHosts = new Set() // header widgets to re-render on presence change

// Discussion flags (taskId -> { name, email, d }) — shared across the room
const flags = new Map()
let unsubFlags = null

// Cursors (uid -> { name, color, x, y, tx, ty, el })
const cursors = new Map()
let unsubCursors = null
let cursorLayer = null // persistent overlay, re-hosted across re-renders
let boardEl = null
let rafId = null
let lastCursorWrite = 0
let ghostSeed = 0

// Session tally: tasks marked done while in this scrum
let doneThisScrum = new Set()

// Latest render args so live flag changes can re-render the open view
let lastRender = null

// ── Public API ──

export function configureScrum({ rtdb, user, isDemo }) {
  cfg.rtdb = rtdb || null
  cfg.user = resolveIdentity(user)
  cfg.isDemo = !!isDemo
  if (cfg.rtdb) connectRoom()
  else if (cfg.isDemo) seedGhostParticipants()
}

export function isInScrum() { return joined }

export async function joinScrum() {
  if (!cfg.user) return
  joined = true
  joinedAt = Date.now()
  doneThisScrum = new Set()
  if (rdb && cfg.rtdb) {
    const myRef = rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/participants/${cfg.user.uid}`)
    rdb.onDisconnect(myRef).remove()
    rdb.set(myRef, {
      name: cfg.user.name, color: cfg.user.color,
      email: cfg.user.email, photoURL: cfg.user.photoURL || null,
      t: rdb.serverTimestamp(),
    }).catch(() => {})
  } else {
    participants.set(cfg.user.uid, { ...cfg.user })
    renderAllWidgets()
  }
  location.hash = '#/scrum'
}

export function leaveScrum({ navigate = true } = {}) {
  if (!joined) return
  joined = false
  if (rdb && cfg.rtdb) {
    rdb.remove(rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/participants/${cfg.user.uid}`)).catch(() => {})
    rdb.remove(rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/cursors/${cfg.user.uid}`)).catch(() => {})
  } else {
    participants.delete(cfg.user?.uid)
    renderAllWidgets()
  }
  stopCursorLoop()
  lastRender = null
  if (navigate) location.hash = '#/my-week'
}

// Called by main.js when the route moves off #/scrum without an explicit leave
// (closing the tab is handled by onDisconnect).
export function scrumViewHidden() {
  if (joined) leaveScrum({ navigate: false })
  else { stopCursorLoop(); lastRender = null }
}

// ── Garden header widget ──

// Renders the Join Scrum pill into hostEl and keeps it fresh on presence
// changes for as long as the element stays in the DOM.
export function renderScrumWidget(hostEl) {
  if (!hostEl) return
  widgetHosts.add(hostEl)
  paintWidget(hostEl)
}

function renderAllWidgets() {
  for (const el of [...widgetHosts]) {
    if (!el.isConnected) { widgetHosts.delete(el); continue }
    paintWidget(el)
  }
}

function paintWidget(el) {
  const others = [...participants.values()]
  const count = others.length
  const stack = others.slice(0, 4).map((p) => avatarHtml(p, 'scrum-widget-avatar')).join('')
  el.innerHTML = `
    <button class="scrum-join-btn${count > 0 ? ' live' : ''}" id="scrum-join-btn" title="${count > 0 ? 'A scrum is happening — jump in' : 'Start the daily scrum'}">
      ${count > 0 ? `<span class="scrum-widget-stack">${stack}</span>` : '<i class="ph-fill ph-users-three"></i>'}
      <span class="scrum-join-label">${count > 0 ? `${count} in Scrum` : 'Join Scrum'}</span>
      ${count > 0 ? '<span class="scrum-live-dot"></span>' : ''}
    </button>
  `
  el.querySelector('#scrum-join-btn').addEventListener('click', () => joinScrum())
}

// ── Presence + flags plumbing ──

async function connectRoom() {
  try {
    rdb = await import('firebase/database')
    const pRef = rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/participants`)
    if (unsubParticipants) unsubParticipants()
    unsubParticipants = rdb.onValue(pRef, (snap) => {
      const data = snap.val() || {}
      participants.clear()
      for (const uid in data) participants.set(uid, data[uid])
      renderAllWidgets()
      updateRoomHeader()
      reconcileCursorsVisibility()
    })

    const fRef = rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/flags`)
    if (unsubFlags) unsubFlags()
    unsubFlags = rdb.onValue(fRef, (snap) => {
      const data = snap.val() || {}
      const today = toLocalISODate(new Date())
      flags.clear()
      for (const taskId in data) {
        const f = data[taskId]
        if (f.d === today) flags.set(taskId, f)
        else rdb.remove(rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/flags/${taskId}`)).catch(() => {}) // prune yesterday's flags
      }
      rerenderIfOpen()
    })
  } catch (err) {
    console.warn('[scrum] RTDB unavailable, presence disabled:', err)
    rdb = null
    if (cfg.isDemo) seedGhostParticipants()
  }
}

function toggleFlag(task) {
  const today = toLocalISODate(new Date())
  const has = flags.has(task.id)
  if (rdb && cfg.rtdb) {
    const ref = rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/flags/${task.id}`)
    if (has) rdb.remove(ref).catch(() => {})
    else rdb.set(ref, { name: cfg.user.name, email: cfg.user.email, d: today }).catch(() => {})
  } else {
    if (has) flags.delete(task.id)
    else flags.set(task.id, { name: cfg.user.name, email: cfg.user.email, d: today })
    rerenderIfOpen()
  }
}

function rerenderIfOpen() {
  if (lastRender && lastRender.container.isConnected) {
    renderScrum(lastRender.container, lastRender.tasks, lastRender.ctx)
  }
}

function seedGhostParticipants() {
  if (participants.size) return
  const others = TEAM.filter((m) => m.email !== cfg.user?.email).slice(0, 2)
  others.forEach((m, i) => participants.set('ghost_' + i, {
    name: m.name, color: m.color, email: m.email, photoURL: m.photoURL || null,
  }))
  renderAllWidgets()
}

// ── The scrum room view ──

const RULES_COLLAPSE_KEY = 'pk-scrum-rules-collapsed'

export function renderScrum(container, tasks, ctx) {
  if (!cfg.user) return
  if (!joined) { joined = true; joinedAt = joinedAt || Date.now() } // deep-link into #/scrum counts as joining
  lastRender = { container, tasks, ctx }

  const todayStr = toLocalISODate(new Date())
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = toLocalISODate(yesterday)
  const now = Date.now()
  const rulesCollapsed = localStorage.getItem(RULES_COLLAPSE_KEY) === '1'

  const members = TEAM.filter((m) => !m.hidden)
  const flagged = [...flags.entries()]
    .map(([taskId, f]) => ({ task: tasks.find((t) => t.id === taskId), f }))
    .filter((x) => x.task)

  container.innerHTML = `
    <div class="scrum-room">
      <div class="scrum-header">
        <div class="scrum-header-left">
          <span class="scrum-title"><span class="scrum-live-dot"></span> Daily Scrum</span>
          <span class="scrum-timer" id="scrum-timer">0:00</span>
        </div>
        <div class="scrum-header-mid" id="scrum-participants"></div>
        <div class="scrum-header-right">
          <span class="scrum-tally" id="scrum-tally" title="Tasks completed during this scrum">🌼 <b>${doneThisScrum.size}</b> done this scrum</span>
          <button class="scrum-leave-btn" id="scrum-leave"><i class="ph ph-sign-out"></i> Leave</button>
        </div>
      </div>

      <div class="scrum-scroll" id="scrum-board">
        <div class="scrum-content">

          <div class="scrum-rules${rulesCollapsed ? ' collapsed' : ''}" id="scrum-rules">
            <button class="scrum-rules-header" id="scrum-rules-toggle">
              <span class="scrum-rules-title"><i class="ph-fill ph-list-checks"></i> Scrum Rules</span>
              <i class="ph ph-caret-${rulesCollapsed ? 'down' : 'up'}"></i>
            </button>
            <ol class="scrum-rules-list">
              <li><b>Triage silently first (3 min).</b> Walk your own list below: finished things → <b>Done ▾</b> (backdate to the real day) · needs the group → flag <i class="ph-fill ph-chat-circle-dots scrum-rules-flag-icon"></i> · everything else, leave alone.</li>
              <li><b>Discuss only flagged items,</b> grouped by client — blockers first, then decisions, then FYIs. Resolve → unflag.</li>
              <li><b>Don't read the board aloud.</b> It's on everyone's screen. Talking is for what the board can't say.</li>
            </ol>
          </div>

          ${flagged.length ? discussionPanel(flagged, ctx) : ''}

          ${members.map((m) => personSection(m, tasks, ctx, { todayStr, yesterdayStr, now })).join('')}
        </div>
      </div>
    </div>
  `

  updateRoomHeader()
  startTimer(container)

  container.querySelector('#scrum-leave').addEventListener('click', () => leaveScrum())

  container.querySelector('#scrum-rules-toggle').addEventListener('click', () => {
    const collapsed = container.querySelector('#scrum-rules').classList.toggle('collapsed')
    localStorage.setItem(RULES_COLLAPSE_KEY, collapsed ? '1' : '0')
    container.querySelector('#scrum-rules-toggle i:last-child').className = `ph ph-caret-${collapsed ? 'down' : 'up'}`
  })

  // Open the profile / awards screen from a person header
  container.querySelectorAll('.scrum-person-header').forEach((h) => {
    h.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      location.hash = '#/profile/' + encodeURIComponent(h.dataset.email)
    })
  })

  // Discussion panel: jump to a row / unflag
  container.querySelectorAll('[data-jump]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-unflag]')) return
      const row = container.querySelector(`.scrum-row[data-id="${el.dataset.jump}"]`)
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        row.classList.add('scrum-row-pulse')
        setTimeout(() => row.classList.remove('scrum-row-pulse'), 1600)
      }
    })
  })
  container.querySelectorAll('[data-unflag]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const task = tasks.find((t) => t.id === btn.dataset.unflag)
      if (task) toggleFlag(task)
    })
  })

  bindRowActions(container, tasks, ctx, todayStr)
  mountCursors(container.querySelector('#scrum-board'))
}

// "Needs Discussion" — flagged tasks grouped by client, the meeting's agenda
function discussionPanel(flagged, ctx) {
  const groups = new Map() // clientName -> items
  for (const item of flagged) {
    const client = ctx.clients.find((c) => c.id === item.task.clientId)
    const key = client?.name || 'No client'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return `
    <div class="scrum-discuss">
      <div class="scrum-discuss-header">
        <i class="ph-fill ph-chat-circle-dots"></i> Needs Discussion
        <span class="scrum-discuss-count">${flagged.length}</span>
      </div>
      ${sorted.map(([clientName, items]) => `
        <div class="scrum-discuss-group">
          <div class="scrum-discuss-client">${esc(clientName)}</div>
          ${items.map(({ task, f }) => {
            const owner = TEAM.find((m) => (task.assignees || []).includes(m.email))
            return `
            <div class="scrum-discuss-item" data-jump="${task.id}" title="Jump to task">
              <span class="scrum-discuss-title">${esc(task.title)}</span>
              <span class="scrum-discuss-by">${owner ? esc(owner.name) : ''} · flagged by ${esc(f.name)}</span>
              <button class="scrum-discuss-resolve" data-unflag="${task.id}" title="Resolved — remove from discussion"><i class="ph ph-check"></i></button>
            </div>
          `}).join('')}
        </div>
      `).join('')}
    </div>
  `
}

function personSection(member, tasks, ctx, { todayStr, yesterdayStr, now }) {
  const mine = tasks.filter((t) => (t.assignees || []).includes(member.email))
  const active = mine.filter((t) => ['in_progress', 'review', 'todo'].includes(t.status))
  const order = { in_progress: 0, review: 1, todo: 2 }
  active.sort((a, b) => (order[a.status] - order[b.status]) || (a.priority === 'urgent' ? -1 : 1))
  const recentDone = mine.filter((t) => {
    if (t.status !== 'done' || !t.closedAt) return false
    const d = toLocalISODate(toDate(t.closedAt))
    return d === todayStr || d === yesterdayStr
  })
  const doneToday = recentDone.filter((t) => toLocalISODate(toDate(t.closedAt)) === todayStr).length
  if (active.length === 0 && recentDone.length === 0) return ''

  const inScrum = [...participants.values()].some((p) => p.email === member.email)

  return `
    <div class="scrum-person" data-email="${member.email}">
      <div class="scrum-person-header" data-email="${member.email}" title="View ${esc(member.name)}'s stats">
        ${avatarHtml(member, 'scrum-person-avatar')}
        <span class="scrum-person-name">${esc(member.name)}</span>
        ${inScrum ? '<span class="scrum-person-here" title="In the room">●</span>' : ''}
        ${doneToday > 0 ? `<span class="scrum-col-blooms" title="Completed today">🌼 ${doneToday}</span>` : ''}
        <span class="scrum-person-count">${active.length}</span>
      </div>
      <div class="scrum-person-list">
        ${active.map((t) => scrumRow(t, ctx, now)).join('')}
        ${recentDone.length ? `
          <div class="scrum-done-divider">recently bloomed</div>
          ${recentDone.map((t) => scrumRow(t, ctx, now)).join('')}
        ` : ''}
      </div>
    </div>
  `
}

function scrumRow(task, ctx, now) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const isDone = task.status === 'done'
  const updatedMs = toDate(task.updatedAt)?.getTime?.() || now
  const isStale = task.status === 'in_progress' && (now - updatedMs) > STALE_DAYS * 86400000
  const flag = flags.get(task.id)

  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}" title="${esc(client.name)}">`
    : ''

  return `
    <div class="my-task-row scrum-row${isDone ? ' done' : ''}${flag ? ' flagged' : ''}" data-id="${task.id}">
      ${statusDot(task.status)}
      ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
      ${clientLogo}
      ${client && !client.logoUrl ? `<span class="my-task-project">${esc(client.name)}</span>` : ''}
      ${project ? `<span class="my-task-project">${esc(project.name)}</span>` : ''}
      <span class="my-task-title">${esc(task.title)}</span>
      ${isStale ? `<span class="scrum-stale" title="Untouched for ${STALE_DAYS}+ days — water me?">🥀</span>` : ''}
      <div class="scrum-row-actions">
        <button class="scrum-flag-btn${flag ? ' on' : ''}" data-flag title="${flag ? `Flagged by ${esc(flag.name)} — click to unflag` : 'Flag for discussion'}">
          <i class="ph${flag ? '-fill' : ''} ph-chat-circle-dots"></i>
        </button>
        <div class="scrum-quick-row">
          ${['todo', 'in_progress', 'review'].map((s) => {
            const st = STATUSES.find((x) => x.id === s)
            return `<button class="scrum-quick${task.status === s ? ' active' : ''}" data-set-status="${s}" style="--sc:${st.color}" title="${st.label}">${st.label}</button>`
          }).join('')}
          <button class="scrum-quick scrum-quick-done${isDone ? ' active' : ''}" data-done-menu style="--sc:var(--success)">
            Done${isDone && task.closedAt ? ` · ${shortDay(task.closedAt)}` : ''} <i class="ph ph-caret-down"></i>
          </button>
        </div>
      </div>
    </div>
  `
}

function statusDot(status) {
  const st = STATUSES.find((s) => s.id === status)
  const icon = { todo: 'ph ph-circle', in_progress: 'ph-fill ph-circle-half', review: 'ph-fill ph-caret-circle-double-right', done: 'ph-fill ph-check-circle', backlog: 'ph-fill ph-prohibit' }[status] || 'ph ph-circle'
  return `<i class="${icon} status-icon" style="color:${st?.color || 'var(--text-tertiary)'}"></i>`
}

function bindRowActions(container, tasks, ctx, todayStr) {
  // Direct status set
  container.querySelectorAll('[data-set-status]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.closest('[data-id]').dataset.id
      btn.disabled = true
      await updateTask(ctx.db, id, { status: btn.dataset.setStatus })
      await ctx.onSave?.()
    })
  })

  // Done ▾ — two-week mini calendar (past-facing) to pick the completion day
  container.querySelectorAll('[data-done-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      openDoneOnPopover(btn, async (dateStr) => {
        const id = btn.closest('[data-id]').dataset.id
        const payload = dateStr === todayStr
          ? { status: 'done' } // today → let the server stamp the exact time
          : { status: 'done', closedAt: dateStr }
        await updateTask(ctx.db, id, payload)
        doneThisScrum.add(id)
        if (flags.has(id)) { const t = tasks.find((x) => x.id === id); if (t) toggleFlag(t) } // done ⇒ discussion resolved
        const tally = document.getElementById('scrum-tally')
        if (tally) tally.innerHTML = `🌼 <b>${doneThisScrum.size}</b> done this scrum`
        burstConfetti(e.clientX, e.clientY)
        await ctx.onSave?.()
      })
    })
  })

  // Flag for discussion
  container.querySelectorAll('[data-flag]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = btn.closest('[data-id]').dataset.id
      const task = tasks.find((t) => t.id === id)
      if (task) toggleFlag(task)
    })
  })

  // Row click → task modal
  container.querySelectorAll('.scrum-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      const task = tasks.find((t) => t.id === row.dataset.id)
      if (task && ctx.onTaskClick) ctx.onTaskClick(task)
    })
  })
}

// The same two-week grid as the right-click Schedule menu, but pointed at the
// past: last week + this week, future days disabled ("done on" can't be ahead
// of today).
function openDoneOnPopover(anchor, onPick) {
  closeDoneOnPopover()
  const todayStr = toLocalISODate(new Date())
  const now = new Date()
  const dow = now.getDay()
  const mondayOffset = (dow === 0 ? -6 : 1 - dow) - 7 // Monday of LAST week
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  const days = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const ds = toLocalISODate(d)
    days.push({ dateStr: ds, day: d.getDate(), isToday: ds === todayStr, isFuture: ds > todayStr, isWeekend: d.getDay() === 0 || d.getDay() === 6 })
  }

  const pop = document.createElement('div')
  pop.className = 'ctx-schedule-sub scrum-doneon-pop'
  pop.innerHTML = `
    <div class="ctx-cal-header">Done On</div>
    <div class="ctx-cal-days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span class="ctx-cal-we">S</span><span class="ctx-cal-we">S</span></div>
    <div class="ctx-cal-grid">${days.slice(0, 7).map(dayBtn).join('')}</div>
    <div class="ctx-cal-grid">${days.slice(7).map(dayBtn).join('')}</div>
  `
  document.body.appendChild(pop)
  const r = anchor.getBoundingClientRect()
  const pr = pop.getBoundingClientRect()
  let left = Math.min(r.left, window.innerWidth - pr.width - 8)
  let top = r.bottom + 6
  if (top + pr.height > window.innerHeight) top = r.top - pr.height - 6
  pop.style.left = `${Math.max(8, left)}px`
  pop.style.top = `${Math.max(8, top)}px`

  pop.querySelectorAll('.ctx-cal-day:not([disabled])').forEach((b) => {
    b.addEventListener('click', () => { closeDoneOnPopover(); onPick(b.dataset.date) })
  })
  setTimeout(() => document.addEventListener('mousedown', dismissDoneOn, { once: true }), 0)

  function dayBtn(d) {
    return `<button class="ctx-cal-day${d.isToday ? ' today' : ''}${d.isWeekend ? ' weekend' : ''}" data-date="${d.dateStr}" ${d.isFuture ? 'disabled' : ''}>${d.day}</button>`
  }
}

function dismissDoneOn(e) {
  const pop = document.querySelector('.scrum-doneon-pop')
  if (pop && !pop.contains(e.target)) closeDoneOnPopover()
  else if (pop) setTimeout(() => document.addEventListener('mousedown', dismissDoneOn, { once: true }), 0)
}

function closeDoneOnPopover() {
  document.querySelectorAll('.scrum-doneon-pop').forEach((p) => p.remove())
}

// ── Room header (participants + timer) ──

function updateRoomHeader() {
  const el = document.getElementById('scrum-participants')
  if (!el) return
  const list = [...participants.values()]
  el.innerHTML = list.map((p) =>
    `<span class="scrum-participant" title="${esc(p.name)}" data-email="${esc(p.email || '')}">${avatarHtml(p, 'scrum-participant-avatar')}</span>`
  ).join('') || '<span class="scrum-participant-hint">flying solo — nudge the team in Slack</span>'
  el.querySelectorAll('.scrum-participant[data-email]').forEach((a) => {
    a.addEventListener('click', () => {
      if (a.dataset.email) location.hash = '#/profile/' + encodeURIComponent(a.dataset.email)
    })
  })
}

let timerInterval = null
function startTimer(container) {
  if (timerInterval) clearInterval(timerInterval)
  const el = container.querySelector('#scrum-timer')
  timerInterval = setInterval(() => {
    if (!el.isConnected) { clearInterval(timerInterval); timerInterval = null; return }
    const s = Math.floor((Date.now() - joinedAt) / 1000)
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    // Soft pacing: the timer blushes once the meeting runs long
    el.classList.toggle('overtime', s > 15 * 60)
  }, 1000)
}

// ── Live cursors over the board ──

function mountCursors(board) {
  boardEl = board
  if (!cursorLayer) {
    cursorLayer = document.createElement('div')
    cursorLayer.className = 'scrum-cursor-layer'
  }
  board.appendChild(cursorLayer) // re-host across re-renders (garden pattern)
  cursors.forEach((c) => { if (c.el) cursorLayer.appendChild(c.el) })

  board.addEventListener('pointermove', onBoardPointerMove)
  board.addEventListener('pointerleave', () => {
    if (rdb && cfg.rtdb && joined) rdb.remove(rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/cursors/${cfg.user.uid}`)).catch(() => {})
  })

  if (rdb && cfg.rtdb && !unsubCursors) {
    const cRef = rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/cursors`)
    unsubCursors = rdb.onValue(cRef, (snap) => reconcileCursors(snap.val() || {}))
  }
  if (cfg.isDemo && !cfg.rtdb) seedGhostCursors()
  if (!rafId) rafId = requestAnimationFrame(cursorLoop)
}

function contentEl() { return boardEl?.querySelector('.scrum-content') || boardEl }

function onBoardPointerMove(e) {
  if (!joined || !boardEl) return
  const now = Date.now()
  if (now - lastCursorWrite < CURSOR_WRITE_MS) return
  lastCursorWrite = now
  const el = contentEl()
  const r = el.getBoundingClientRect()
  // Normalize against the full content box, so cursors line up even when
  // participants have scrolled to different places.
  const x = (e.clientX - r.left) / (r.width || 1)
  const y = (e.clientY - r.top) / (r.height || 1)
  if (rdb && cfg.rtdb) {
    rdb.set(rdb.ref(cfg.rtdb, `scrum/${ROOM_ID}/cursors/${cfg.user.uid}`), {
      name: cfg.user.name, color: cfg.user.color, x, y, t: rdb.serverTimestamp(),
    }).catch(() => {})
  }
}

function reconcileCursors(data) {
  const seen = new Set()
  for (const uid in data) {
    if (uid === cfg.user?.uid) continue
    seen.add(uid)
    const d = data[uid]
    let c = cursors.get(uid)
    if (!c) {
      c = { name: d.name, color: d.color, x: d.x, y: d.y, tx: d.x, ty: d.y, el: null }
      cursors.set(uid, c)
      ensureCursorEl(c)
    }
    c.name = d.name; c.color = d.color; c.tx = d.x; c.ty = d.y
  }
  for (const [uid, c] of cursors) {
    if (uid.startsWith('ghost_')) continue
    if (!seen.has(uid)) { c.el?.remove(); cursors.delete(uid) }
  }
}

function reconcileCursorsVisibility() {
  // Drop cursors of users who left the room
  for (const [uid, c] of cursors) {
    if (!uid.startsWith('ghost_') && !participants.has(uid)) { c.el?.remove(); cursors.delete(uid) }
  }
}

function ensureCursorEl(c) {
  const el = document.createElement('div')
  el.className = 'scrum-cursor'
  el.style.color = c.color
  el.innerHTML = `${CURSOR_SVG}<span class="scrum-cursor-name" style="background:${c.color}">${esc(c.name)}</span>`
  if (cursorLayer) cursorLayer.appendChild(el)
  c.el = el
}

function cursorLoop() {
  rafId = null
  if (!boardEl || !boardEl.isConnected) { boardEl = null; return }
  const el = contentEl()
  const w = el.scrollWidth || 1
  const h = el.scrollHeight || 1
  if (cfg.isDemo && !cfg.rtdb) driftGhostCursors()
  for (const c of cursors.values()) {
    c.x += (c.tx - c.x) * 0.22
    c.y += (c.ty - c.y) * 0.22
    if (c.el) c.el.style.transform = `translate(${(c.x * w).toFixed(1)}px, ${(c.y * h).toFixed(1)}px)`
  }
  rafId = requestAnimationFrame(cursorLoop)
}

function stopCursorLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  if (unsubCursors) { unsubCursors(); unsubCursors = null }
  cursors.forEach((c) => c.el?.remove())
  cursors.clear()
  boardEl = null
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
}

function seedGhostCursors() {
  if ([...cursors.keys()].some((k) => k.startsWith('ghost_'))) return
  let i = 0
  for (const [uid, p] of participants) {
    if (!uid.startsWith('ghost_')) continue
    const c = { name: p.name, color: p.color, x: 0.2 + i * 0.3, y: 0.3, tx: 0.2, ty: 0.3, el: null, seed: ++ghostSeed * 2.7 }
    cursors.set(uid, c)
    ensureCursorEl(c)
    i++
  }
}

function driftGhostCursors() {
  const t = performance.now()
  for (const [uid, c] of cursors) {
    if (!uid.startsWith('ghost_')) continue
    c.tx = 0.5 + 0.35 * Math.sin(t * 0.00011 + c.seed)
    c.ty = 0.25 + 0.2 * Math.cos(t * 0.00017 + c.seed * 1.3)
  }
}

// ── Confetti (flower burst on Done) ──

export function burstConfetti(x, y) {
  let layer = document.getElementById('confetti-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'confetti-layer'
    document.body.appendChild(layer)
  }
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span')
    p.className = 'confetti-petal'
    p.textContent = CONFETTI[i % CONFETTI.length]
    const angle = (Math.PI * 2 * i) / 16 + (i % 3) * 0.4
    const dist = 60 + (i % 5) * 22
    p.style.left = `${x}px`
    p.style.top = `${y}px`
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`)
    p.style.setProperty('--rot', `${(i % 2 ? 1 : -1) * (180 + i * 30)}deg`)
    p.style.setProperty('--dur', `${0.8 + (i % 4) * 0.15}s`)
    layer.appendChild(p)
    p.addEventListener('animationend', () => p.remove())
  }
}

// ── utils ──

function resolveIdentity(user) {
  if (!user || !user.email) return null
  const member = TEAM.find((m) => m.email === user.email)
  return {
    uid: user.uid || user.email,
    email: user.email,
    name: member?.name || (user.displayName || user.email).split(/[ @]/)[0],
    color: member?.color || '#4f46e5',
    photoURL: user.photoURL || member?.photoURL || null,
  }
}

function shortDay(closedAt) {
  const d = toDate(closedAt)
  if (!d) return ''
  const today = toLocalISODate(new Date())
  const ds = toLocalISODate(d)
  if (ds === today) return 'today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (ds === toLocalISODate(y)) return 'yday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function avatarHtml(p, cls) {
  return p.photoURL
    ? `<img class="${cls}" src="${esc(p.photoURL)}" alt="${esc(p.name)}">`
    : `<span class="${cls} ${cls}-fallback" style="background:${p.color || '#6b7280'}">${esc((p.name || '?')[0])}</span>`
}
