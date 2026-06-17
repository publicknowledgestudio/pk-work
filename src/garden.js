// ───────────────────────────────────────────────────────────────────────────
// Cursor Garden — a live, multiplayer, garden-themed strip across the top of
// My Week. Team members who mouse into the band show up as Figma-style cursors;
// typing plants a message that blooms as a flower and wilts after a minute
// (or can be X'd to remove instantly).
//
// Transport: Firebase Realtime Database (ephemeral presence, auto-cleared on
// disconnect). When no RTDB is configured (or in demo mode) the garden runs
// LOCAL-ONLY — you still see your own planting + a synthetic "ghost gardener"
// so the UI is fully exercisable without a backend.
//
// The controller is a module-level singleton with its own persistent DOM root
// and animation loop, so it survives My Week's frequent innerHTML re-renders:
// renderMyDay just re-hosts the same root via mountGarden().
// ───────────────────────────────────────────────────────────────────────────

import { TEAM } from './config.js'

const GARDEN_ID = 'my-week'
const LIFETIME = 60_000 // a message lives for one minute
const WILT_LEAD = 9_000 // start wilting in the last ~9s
const PRUNE_GRACE = 15_000 // any client deletes RTDB nodes older than LIFETIME + this
const WRITE_MS = 45 // cursor write throttle (~22/sec)
const MAX_LEN = 240
const PLANT_Y_MIN = 0.52 // keep planted flowers in the lower garden zone…
const PLANT_Y_MAX = 0.9 // …above the grass line, clear of the header controls

// Figma/Liveblocks-style cursor arrow.
const CURSOR_SVG = '<svg width="22" height="30" viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.65 12.37H5.46l-.14.13L.5 16.88V1.2l11.28 11.17H5.65Z" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>'

const PLANTS = ['🌷', '🌹', '🌻', '🌼', '🌸', '🪴', '🌱', '💐']

let cfg = { rtdb: null, user: null, isDemo: false }
let root = null
let host = null
let started = false
let rafId = null
let pointerInside = false
let lastWrite = 0
let hintDismissed = false

const me = { x: 0.5, y: 0.5 }
const remote = new Map() // uid -> { name, color, x, y, tx, ty, el }
const messages = new Map() // id -> { uid, name, color, text, x, y, plantedAt, plant, el }
let typing = null // { x, y, wrap, input }

// RTDB handles (lazily required so the bundle works without firebase/database)
let rdb = null // { ref, onValue, set, remove, push, onDisconnect, serverTimestamp }
let cursorsRef = null
let messagesRef = null
let myCursorRef = null
let unsubCursors = null
let unsubMessages = null

// Demo "ghost gardener" state
const ghosts = []
let nextGhostPlant = 0

// ── Public API ──

export function configureGarden({ rtdb, user, isDemo }) {
  cfg.rtdb = rtdb || null
  cfg.user = resolveIdentity(user)
  cfg.isDemo = !!isDemo
}

export function mountGarden(hostEl) {
  if (!cfg.user || !hostEl) return
  if (!root) buildRoot()
  if (host !== hostEl) {
    detachHostListeners()
    host = hostEl
    host.classList.add('garden-band')
    host.appendChild(root) // moves the persistent root into the new header
    attachHostListeners()
  }
  if (!started) start()
}

export function unmountGarden() {
  if (!started) return
  started = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  detachHostListeners()
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('visibilitychange', onVisible)
  removeMyCursor()
  if (unsubCursors) { unsubCursors(); unsubCursors = null }
  if (unsubMessages) { unsubMessages(); unsubMessages = null }
  closeTyping()
  // Clear transient remote state (messages already in RTDB will reload on return)
  remote.forEach((c) => c.el?.remove())
  remote.clear()
  messages.forEach((m) => m.el?.remove())
  messages.clear()
  ghosts.length = 0
  if (host) { host.classList.remove('garden-band'); }
  if (root && root.parentElement) root.parentElement.removeChild(root)
}

// ── Identity ──

function resolveIdentity(user) {
  if (!user || !user.email) return null
  const member = TEAM.find((m) => m.email === user.email)
  const name = member?.name || (user.displayName || user.email).split(/[ @]/)[0]
  const color = member?.color || hashColor(user.email)
  return { uid: user.uid || user.email, email: user.email, name, color }
}

function hashColor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue} 70% 45%)`
}

// ── DOM scaffold ──

function buildRoot() {
  root = document.createElement('div')
  root.className = 'garden-root'
  root.innerHTML = `
    <div class="garden-sky"></div>
    <div class="garden-grass">${grassMarkup()}</div>
    <div class="garden-messages"></div>
    <div class="garden-cursors"></div>
    <div class="garden-hint"><i class="ph ph-flower-tulip"></i> click or type to plant a note</div>
  `
}

function grassMarkup() {
  // A row of swaying blades + the odd flower. Pure decoration.
  let out = ''
  for (let i = 0; i < 28; i++) {
    const flower = i % 5 === 2
    const delay = (i * 0.17).toFixed(2)
    const h = 14 + ((i * 7) % 16)
    out += `<span class="garden-blade${flower ? ' has-flower' : ''}" style="--d:${delay}s;--h:${h}px;left:${(i / 28 * 100).toFixed(1)}%">${flower ? `<i>${PLANTS[i % PLANTS.length]}</i>` : ''}</span>`
  }
  return out
}

function layer(sel) { return root.querySelector(sel) }

// ── Lifecycle ──

function start() {
  started = true
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('visibilitychange', onVisible)

  if (cfg.rtdb) {
    connectRtdb()
  } else if (cfg.isDemo) {
    // Local-only demo: no backend, so conjure a synthetic gardener for company.
    seedGhosts()
  }
  // (Real user, RTDB not yet configured: garden still works for your own
  //  planting; you just won't see anyone else until Realtime Database is on.)
  rafId = requestAnimationFrame(loop)
}

async function connectRtdb() {
  try {
    rdb = await import('firebase/database')
    cursorsRef = rdb.ref(cfg.rtdb, `gardens/${GARDEN_ID}/cursors`)
    messagesRef = rdb.ref(cfg.rtdb, `gardens/${GARDEN_ID}/messages`)
    myCursorRef = rdb.ref(cfg.rtdb, `gardens/${GARDEN_ID}/cursors/${cfg.user.uid}`)
    rdb.onDisconnect(myCursorRef).remove()

    unsubCursors = rdb.onValue(cursorsRef, (snap) => reconcileCursors(snap.val() || {}))
    unsubMessages = rdb.onValue(messagesRef, (snap) => reconcileMessages(snap.val() || {}))
  } catch (err) {
    console.warn('[garden] RTDB unavailable, running local-only:', err)
    rdb = null
    if (cfg.isDemo) seedGhosts()
  }
}

function onVisible() {
  if (document.hidden) removeMyCursor()
}

// ── Pointer + keyboard ──

function attachHostListeners() {
  if (!host) return
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerenter', onPointerEnter)
  host.addEventListener('pointerleave', onPointerLeave)
  host.addEventListener('click', onClick)
}
function detachHostListeners() {
  if (!host) return
  host.removeEventListener('pointermove', onPointerMove)
  host.removeEventListener('pointerenter', onPointerEnter)
  host.removeEventListener('pointerleave', onPointerLeave)
  host.removeEventListener('click', onClick)
}

// A click on open garden ground also starts a planting (ignore the real header
// controls, existing flowers, and the open input itself).
function onClick(e) {
  if (e.target.closest('button, a, input, textarea, .garden-flower, .garden-typing')) return
  const r = host.getBoundingClientRect()
  me.x = clamp((e.clientX - r.left) / r.width, 0, 1)
  me.y = clamp((e.clientY - r.top) / r.height, 0, 1)
  pointerInside = true
  if (!hintDismissed) { hintDismissed = true; root.classList.add('garden-hint-gone') }
  openTyping(me.x, me.y, '')
}

function bandSize() {
  return { w: root.clientWidth || 1, h: root.clientHeight || 1 }
}

function onPointerEnter() {
  pointerInside = true
  if (!hintDismissed) { hintDismissed = true; root.classList.add('garden-hint-gone') }
}
function onPointerLeave() {
  pointerInside = false
  removeMyCursor()
}
function onPointerMove(e) {
  const r = host.getBoundingClientRect()
  me.x = clamp((e.clientX - r.left) / r.width, 0, 1)
  me.y = clamp((e.clientY - r.top) / r.height, 0, 1)
  writeMyCursor()
}

function onKeyDown(e) {
  if (typing) return // the input handles its own keys
  if (!pointerInside) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const ae = document.activeElement
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
  // A single printable, non-space character starts a planting
  if (e.key.length === 1 && !/\s/.test(e.key)) {
    openTyping(me.x, me.y, e.key)
    e.preventDefault()
  }
}

// ── Own cursor presence ──

function writeMyCursor() {
  if (!started) return
  const now = Date.now()
  if (now - lastWrite < WRITE_MS) return
  lastWrite = now
  if (rdb && myCursorRef) {
    rdb.set(myCursorRef, {
      name: cfg.user.name, color: cfg.user.color,
      x: me.x, y: me.y, t: rdb.serverTimestamp(),
    }).catch(() => {})
  }
}

function removeMyCursor() {
  if (rdb && myCursorRef) rdb.remove(myCursorRef).catch(() => {})
}

// ── Typing → planting ──

function openTyping(x, y, initial) {
  closeTyping()
  // Anchor plantings into the lower "garden" zone: flowers grow up from the
  // grass, and bubbles stay clear of the greeting/Calendar controls up top.
  x = clamp(x, 0.08, 0.92)
  y = clamp(y, PLANT_Y_MIN, PLANT_Y_MAX)
  const wrap = document.createElement('div')
  wrap.className = 'garden-typing'
  wrap.style.setProperty('--c', cfg.user.color)
  const { w, h } = bandSize()
  place(wrap, x, y, w, h)
  wrap.innerHTML = `
    <span class="garden-typing-tag" style="background:${cfg.user.color}">${esc(cfg.user.name)}</span>
    <input class="garden-typing-input" maxlength="${MAX_LEN}" placeholder="plant a note…" />
  `
  layer('.garden-messages').appendChild(wrap)
  const input = wrap.querySelector('input')
  input.value = initial || ''
  typing = { x, y, wrap, input }
  input.focus()
  // move caret to end
  const v = input.value; input.value = ''; input.value = v

  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      const text = input.value.trim()
      closeTyping()
      if (text) plantMessage(text, x, y)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeTyping()
    }
  })
  input.addEventListener('blur', () => { if (typing && typing.input === input) closeTyping() })
}

function closeTyping() {
  if (!typing) return
  // Null `typing` BEFORE removing the input. Removing the focused input fires a
  // synchronous blur, whose handler also calls closeTyping(); clearing the ref
  // first makes that re-entrant call a no-op instead of double-removing the node
  // (which threw NotFoundError and aborted the Enter handler before planting).
  const wrap = typing.wrap
  typing = null
  try { wrap.remove() } catch (_) {}
}

function plantMessage(text, x, y) {
  const plant = PLANTS[Math.floor((x * 7 + y * 13 + text.length) % PLANTS.length)]
  const payload = {
    uid: cfg.user.uid, name: cfg.user.name, color: cfg.user.color,
    text: text.slice(0, MAX_LEN), x, y, plant,
  }
  console.log('[garden] plantMessage', { hasRdb: !!rdb, hasRef: !!messagesRef, payload })
  if (rdb && messagesRef) {
    try {
      const r = rdb.push(messagesRef)
      rdb.set(r, { ...payload, plantedAt: rdb.serverTimestamp() })
        .then(() => console.log('[garden] plant write OK →', r.key))
        .catch((e) => console.error('[garden] plant write REJECTED:', e?.code || e?.message, e))
    } catch (e) {
      console.error('[garden] plant write THREW synchronously:', e)
    }
  } else {
    addLocalMessage('local_' + Math.floor(performance.now()) + '_' + messages.size, { ...payload, plantedAt: Date.now() })
  }
}

function deleteMessage(id) {
  const m = messages.get(id)
  if (rdb && messagesRef && !id.startsWith('local_') && !id.startsWith('ghost_')) {
    rdb.remove(rdb.ref(cfg.rtdb, `gardens/${GARDEN_ID}/messages/${id}`)).catch(() => {})
  }
  if (m) { m.el?.remove(); messages.delete(id) }
}

// ── Reconcile remote state from RTDB ──

function reconcileCursors(data) {
  const seen = new Set()
  for (const uid in data) {
    if (uid === cfg.user.uid) continue
    seen.add(uid)
    const d = data[uid]
    let c = remote.get(uid)
    if (!c) {
      c = { name: d.name, color: d.color, x: d.x, y: d.y, tx: d.x, ty: d.y, el: null }
      remote.set(uid, c)
      ensureCursorEl(uid, c)
    }
    c.name = d.name; c.color = d.color; c.tx = d.x; c.ty = d.y
  }
  for (const [uid, c] of remote) {
    if (uid.startsWith('ghost_')) continue
    if (!seen.has(uid)) { c.el?.remove(); remote.delete(uid) }
  }
}

function reconcileMessages(data) {
  console.log('[garden] messages onValue:', Object.keys(data || {}).length, 'in db')
  const seen = new Set()
  for (const id in data) {
    seen.add(id)
    if (!messages.has(id)) addLocalMessage(id, data[id])
  }
  for (const [id, m] of messages) {
    if (id.startsWith('ghost_') || id.startsWith('local_')) continue
    if (!seen.has(id)) { m.el?.remove(); messages.delete(id) }
  }
}

function addLocalMessage(id, d) {
  if (messages.has(id)) return
  // Lifetime is measured from when THIS client first renders the message, using
  // our own clock — never the server's plantedAt against our clock. That cross-
  // clock comparison made messages vanish on any client whose clock led the
  // server (a skewed wall clock = the message looked "born expired").
  const m = { ...d, el: null, shownAt: Date.now() }
  messages.set(id, m)
  ensureFlowerEl(id, m)
}

// ── Element builders ──

function ensureCursorEl(uid, c) {
  const el = document.createElement('div')
  el.className = 'garden-cursor'
  el.style.color = c.color
  el.innerHTML = `${CURSOR_SVG}<span class="garden-cursor-name" style="background:${c.color}">${esc(c.name)}</span>`
  layer('.garden-cursors').appendChild(el)
  c.el = el
  // Position immediately so it appears in the right spot before the first frame
  const { w, h } = bandSize()
  el.style.transform = `translate(${(c.x * w).toFixed(1)}px, ${(c.y * h).toFixed(1)}px)`
}

function ensureFlowerEl(id, m) {
  const el = document.createElement('div')
  el.className = 'garden-flower'
  el.style.setProperty('--c', m.color)
  el.innerHTML = `
    <button class="garden-flower-x" title="Remove">${'×'}</button>
    <div class="garden-flower-bubble">
      <span class="garden-flower-name" style="color:${m.color}">${esc(m.name)}</span>
      <span class="garden-flower-text">${esc(m.text)}</span>
    </div>
    <div class="garden-flower-stem"></div>
    <div class="garden-flower-bloom">${m.plant || '🌷'}</div>
  `
  el.querySelector('.garden-flower-x').addEventListener('click', (e) => {
    e.stopPropagation()
    deleteMessage(id)
  })
  layer('.garden-messages').appendChild(el)
  m.el = el
  const { w, h } = bandSize()
  place(el, m.x, m.y, w, h)
}

// ── Render loop ──

function loop() {
  if (!started) return
  const { w, h } = bandSize()

  if (cfg.isDemo || !rdb) updateGhosts(w, h)

  // Glide remote cursors toward their targets
  for (const c of remote.values()) {
    c.x += (c.tx - c.x) * 0.22
    c.y += (c.ty - c.y) * 0.22
    if (c.el) c.el.style.transform = `translate(${(c.x * w).toFixed(1)}px, ${(c.y * h).toFixed(1)}px)`
  }

  // Position flowers + handle wilting / expiry
  const now = Date.now()
  for (const [id, m] of messages) {
    const age = now - (m.shownAt || now)
    if (age > LIFETIME + PRUNE_GRACE) { deleteMessage(id); continue }
    if (age > LIFETIME) { if (m.el) m.el.style.opacity = '0'; if (id.startsWith('ghost_') || id.startsWith('local_')) { m.el?.remove(); messages.delete(id) } continue }
    if (m.el) {
      place(m.el, m.x, m.y, w, h)
      m.el.classList.toggle('wilting', age > LIFETIME - WILT_LEAD)
    }
  }

  rafId = requestAnimationFrame(loop)
}

// Position an element so its anchor sits at fraction (x,y) of the band.
function place(el, x, y, w, h) {
  el.style.left = (x * w).toFixed(1) + 'px'
  el.style.top = (y * h).toFixed(1) + 'px'
}

// ── Demo ghost gardener ──

function seedGhosts() {
  if (ghosts.length) return
  // Pick a teammate that isn't the demo user for a believable second cursor.
  const other = TEAM.find((m) => m.email !== cfg.user.email) || { name: 'Sprout', color: '#16a34a' }
  const uid = 'ghost_1'
  const c = { name: other.name, color: other.color, x: 0.3, y: 0.5, tx: 0.3, ty: 0.5, el: null, phase: 0 }
  remote.set(uid, c)
  ensureCursorEl(uid, c)
  ghosts.push({ uid, c, seed: 0.7 })
  nextGhostPlant = Date.now() + 4000
}

function updateGhosts(w, h) {
  const t = performance.now()
  for (const g of ghosts) {
    g.c.tx = clamp(0.5 + 0.34 * Math.sin(t * 0.00033 + g.seed * 6), 0.05, 0.95)
    g.c.ty = clamp(0.5 + 0.26 * Math.cos(t * 0.00051 + g.seed * 6), 0.1, 0.9)
  }
  if (Date.now() > nextGhostPlant && ghosts[0]) {
    const g = ghosts[0]
    const lines = ['watered the roadmap 🌱', 'nice work today!', 'coffee? ☕', 'shipping season 🌻', 'look at this bloom']
    const text = lines[Math.floor(t / 1000) % lines.length]
    addLocalMessage('ghost_' + Math.floor(t), {
      uid: g.uid, name: g.c.name, color: g.c.color, text,
      x: clamp(g.c.x, 0.08, 0.92), y: clamp(g.c.y, PLANT_Y_MIN, PLANT_Y_MAX),
      plant: PLANTS[Math.floor(t / 700) % PLANTS.length], plantedAt: Date.now(),
    })
    nextGhostPlant = Date.now() + 14000
  }
}

// ── utils ──

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
