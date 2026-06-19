// ───────────────────────────────────────────────────────────────────────────
// Demo / fixture mode — DEV ONLY.
//
// Activated by visiting `?demo=1` while running the Vite dev server
// (`npm run dev`). It is gated on BOTH the query param AND import.meta.env.DEV,
// so in a production build (`npm run build`) isDemo() is always false and this
// whole layer is dead code. It exists purely so the UI can be driven in a
// browser/preview without Firebase auth or a live Firestore.
//
// When active, db.js and calendar.js short-circuit their Firestore/Google calls
// to the in-memory store below, and main.js skips the auth flow and boots
// straight into the app as a fake team user.
// ───────────────────────────────────────────────────────────────────────────

import { toLocalISODate } from './utils/dates.js'

export function isDemo() {
  try {
    return import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === '1'
  } catch (_) {
    return false
  }
}

// ── Date helpers (relative to "today" so the week view always has content) ──
const NOW = new Date()
const iso = (d) => d.toISOString()
// Local calendar day (not toISOString) — these feed dailyFocus keys + all-day
// event dates, which must match My Week's toLocalISODate keys in the IST window.
const dayStr = (d) => toLocalISODate(d)
function addDays(base, n) {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}
function atTime(base, h, m = 0) {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

const TODAY = dayStr(NOW)
const TOMORROW = dayStr(addDays(NOW, 1))
const DAY2 = dayStr(addDays(NOW, 2))

export const DEMO_USER = {
  email: 'gyan@publicknowledge.co',
  displayName: 'Gyan (Demo)',
  photoURL: '',
}

// ── Fixtures ──
const clients = [
  { id: 'c_brunk', name: 'Brunk', slackChannelId: 'C0BRUNKDEMO', logoUrl: '', defaultHourlyRate: 4000, currency: 'INR' },
  { id: 'c_hammock', name: 'Hammock', slackChannelId: '', logoUrl: '' },
  { id: 'c_scc', name: 'SCC Online', slackChannelId: '', logoUrl: '' },
  { id: 'c_pres', name: 'Presentations.ai', slackChannelId: '', logoUrl: '' },
  // Dormant — real client with history but no open items right now. Auto-hidden
  // from the board/backlog (visibleClients), shown "Inactive" on Manage, still
  // offered in the new-task picker (selectableClients).
  { id: 'c_mercury', name: 'Mercury', slackChannelId: '', logoUrl: '', defaultHourlyRate: 4500, currency: 'INR' },
  // Archived — manual flag toggled from the Manage page. Hidden from every
  // working view; shown dimmed + "Archived" on Manage only.
  { id: 'c_absentia', name: 'Absentia Labs', slackChannelId: '', logoUrl: '', archived: true },
]

const projects = [
  { id: 'p_brunk_brand', name: 'Brand identity', clientId: 'c_brunk' },
  { id: 'p_brunk_social', name: 'Social media', clientId: 'c_brunk' },
  { id: 'p_hammock_pack', name: 'Packaging', clientId: 'c_hammock' },
  { id: 'p_scc_redesign', name: 'Website redesign', clientId: 'c_scc' },
  { id: 'p_pres_blog', name: 'Blog content', clientId: 'c_pres' },
  { id: 'p_mercury_web', name: 'Website refresh', clientId: 'c_mercury' },
  { id: 'p_absentia_brand', name: 'Brand identity', clientId: 'c_absentia' },
]

const people = [
  { id: 'pe_gyan', name: 'Gyan', email: 'gyan@publicknowledge.co', type: 'team' },
  { id: 'pe_charu', name: 'Charu', email: 'charu@publicknowledge.co', type: 'team' },
  { id: 'pe_anandu', name: 'Anandu', email: 'anandu@publicknowledge.co', type: 'team' },
]

// Client users (external collaborators given scoped access). One on Brunk so the
// Manage sidebar shows a user count and the detail "Client Users" list renders.
const clientUsers = [
  { id: 'sam@brunk.example', email: 'sam@brunk.example', name: 'Sam Rivera', clientId: 'c_brunk', invitedBy: 'gyan@publicknowledge.co', createdAt: iso(addDays(NOW, -12)) },
]

const ME = DEMO_USER.email

// Tasks are stored already-normalized (timestamp fields are ISO strings, as
// they would be after normalizeTask runs on real Firestore data).
function makeTasks() {
  return [
    { id: 't1', title: 'Finalize Brunk logo lockup variations', description: 'Horizontal + stacked + icon-only', assignees: [ME], status: 'in_progress', priority: 'high', clientId: 'c_brunk', projectId: 'p_brunk_brand', deadline: iso(addDays(NOW, 1)), notes: [], createdAt: iso(addDays(NOW, -5)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't2', title: 'Hammock packaging dieline review', description: '', assignees: [ME], status: 'review', priority: 'urgent', clientId: 'c_hammock', projectId: 'p_hammock_pack', deadline: iso(NOW), notes: [], createdAt: iso(addDays(NOW, -6)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't3', title: 'SCC homepage hero — 3 directions', description: '', assignees: [ME], status: 'todo', priority: 'medium', clientId: 'c_scc', projectId: 'p_scc_redesign', deadline: iso(addDays(NOW, 3)), notes: [], createdAt: iso(addDays(NOW, -3)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't4', title: 'Draft Presentations.ai blog post on design systems', description: '', assignees: [ME], status: 'todo', priority: 'low', clientId: 'c_pres', projectId: 'p_pres_blog', deadline: null, notes: [], createdAt: iso(addDays(NOW, -2)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't5', title: 'Brunk social — June grid layout', description: '', assignees: [ME], status: 'todo', priority: 'medium', clientId: 'c_brunk', projectId: 'p_brunk_social', deadline: null, notes: [], createdAt: iso(addDays(NOW, -2)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't6', title: 'Collect SCC content inventory from client', description: '', assignees: [ME], status: 'in_progress', priority: 'high', clientId: 'c_scc', projectId: 'p_scc_redesign', deadline: iso(addDays(NOW, 5)), notes: [], createdAt: iso(addDays(NOW, -4)), updatedAt: iso(addDays(NOW, -2)), closedAt: null, createdBy: ME },
    { id: 't7', title: 'Pick typeface pairing for Hammock', description: '', assignees: [ME], status: 'todo', priority: 'low', clientId: 'c_hammock', projectId: 'p_hammock_pack', deadline: null, notes: [], createdAt: iso(addDays(NOW, -1)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't8', title: 'Export final Brunk brand guidelines PDF', description: '', assignees: [ME], status: 'todo', priority: 'medium', clientId: 'c_brunk', projectId: 'p_brunk_brand', deadline: iso(addDays(NOW, 4)), notes: [], createdAt: iso(addDays(NOW, -1)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't9', title: 'Weekly studio sync notes', description: '', assignees: [ME], status: 'done', priority: 'low', clientId: '', projectId: '', deadline: null, notes: [], createdAt: iso(addDays(NOW, -1)), updatedAt: iso(NOW), closedAt: iso(NOW), createdBy: ME },
    { id: 't10', title: 'SCC nav IA — first pass', description: '', assignees: [ME], status: 'done', priority: 'medium', clientId: 'c_scc', projectId: 'p_scc_redesign', deadline: null, notes: [], createdAt: iso(addDays(NOW, -3)), updatedAt: iso(NOW), closedAt: iso(NOW), createdBy: ME },
    { id: 't11', title: 'Review Charu’s Presentations.ai illustrations', description: '', assignees: [ME], status: 'todo', priority: 'high', clientId: 'c_pres', projectId: 'p_pres_blog', deadline: iso(addDays(NOW, 2)), notes: [], createdAt: iso(addDays(NOW, -1)), updatedAt: iso(addDays(NOW, -1)), closedAt: null, createdBy: ME },
    { id: 't12', title: 'Backlog: explore motion system for Brunk', description: '', assignees: [ME], status: 'backlog', priority: 'low', clientId: 'c_brunk', projectId: 'p_brunk_social', deadline: null, notes: [], createdAt: iso(addDays(NOW, -7)), updatedAt: iso(addDays(NOW, -7)), closedAt: null, createdBy: ME },
    // Mercury & Absentia carry only completed work → no open items. Mercury reads
    // as "dormant"; Absentia is archived. Both drop off the working boards.
    { id: 't13', title: 'Mercury site copy review', description: '', assignees: [ME], status: 'done', priority: 'medium', clientId: 'c_mercury', projectId: 'p_mercury_web', deadline: null, notes: [], createdAt: iso(addDays(NOW, -9)), updatedAt: iso(addDays(NOW, -5)), closedAt: iso(addDays(NOW, -5)), createdBy: ME },
    { id: 't14', title: 'Absentia brand guidelines v1', description: '', assignees: [ME], status: 'done', priority: 'low', clientId: 'c_absentia', projectId: 'p_absentia_brand', deadline: null, notes: [], createdAt: iso(addDays(NOW, -20)), updatedAt: iso(addDays(NOW, -12)), closedAt: iso(addDays(NOW, -12)), createdBy: ME },
  ]
}

// Calendar events for today (so the calendar panel has content when opened).
function makeCalendarEvents() {
  return [
    { id: 'e1', summary: 'Brunk weekly check-in', start: iso(atTime(NOW, 11, 0)), end: iso(atTime(NOW, 11, 30)), allDay: false, hangoutLink: 'https://meet.google.com/demo', htmlLink: '', location: '', attendees: 4 },
    { id: 'e2', summary: 'Design review — SCC', start: iso(atTime(NOW, 15, 0)), end: iso(atTime(NOW, 16, 0)), allDay: false, hangoutLink: '', htmlLink: '', location: 'Studio', attendees: 3 },
    { id: 'e3', summary: 'Anandu — Leave', start: TODAY, end: TODAY, allDay: true, hangoutLink: '', htmlLink: '', location: '', attendees: 4 },
  ]
}

// ── In-memory store (mutable, so drag/drop, scheduling, and add-task work) ──
const store = {
  tasks: makeTasks(),
  clients,
  projects,
  people,
  clientUsers,
  calendarEvents: makeCalendarEvents(),
  holidays: [],
  // dateStr → { taskIds, timeBlocks }
  focus: new Map([
    [TODAY, { taskIds: ['t1', 't2'], timeBlocks: [] }],
    [TOMORROW, { taskIds: ['t6'], timeBlocks: [] }],
    [DAY2, { taskIds: ['t8'], timeBlocks: [] }],
  ]),
}

export const demoStore = store

let seq = 100
const nowIso = () => iso(new Date())

// Pub/sub so the Manage page's real-time subscriptions (subscribeToClients /
// Projects / ClientUsers) re-fire after a mutation. The page re-renders off the
// subscription callback — its click handlers don't re-render directly — so a
// mutation has to notify subscribers, the way Firestore's onSnapshot would.
const collectionSubs = { clients: new Set(), projects: new Set(), clientUsers: new Set() }

function emitCollection(kind) {
  const snapshot = store[kind].map((x) => ({ ...x }))
  for (const cb of [...collectionSubs[kind]]) {
    try { cb(snapshot) } catch (err) { console.error(`[demo] ${kind} subscriber threw`, err) }
  }
}

function subscribeToCollection(kind, callback) {
  collectionSubs[kind].add(callback)
  callback(store[kind].map((x) => ({ ...x })))
  return () => { collectionSubs[kind].delete(callback) }
}

// ── Handlers mirroring db.js / calendar.js signatures ──
export const demo = {
  // Hand out the live store objects (a fresh array, same element refs) rather
  // than copies, so archive/edit mutations made on the Manage page propagate to
  // the board's `ctx.clients` (loaded once in main.js) without a reload.
  loadClients: async () => store.clients.slice(),
  loadProjects: async () => store.projects.map((p) => ({ ...p })),
  loadPeople: async () => store.people.map((p) => ({ ...p })),
  loadUserProfiles: async () => ({}),
  loadHolidays: async () => store.holidays.map((h) => ({ ...h })),

  subscribeToTasks: (callback) => {
    callback(store.tasks.map((t) => ({ ...t })))
    return () => {}
  },

  loadDailyFocus: async (_email, dateStr) => {
    const f = store.focus.get(dateStr)
    return f ? { taskIds: [...f.taskIds], timeBlocks: [...f.timeBlocks] } : { taskIds: [], timeBlocks: [] }
  },

  saveDailyFocus: async (_email, dateStr, taskIds, timeBlocks) => {
    const prev = store.focus.get(dateStr) || { taskIds: [], timeBlocks: [] }
    store.focus.set(dateStr, {
      taskIds: [...new Set(taskIds)],
      timeBlocks: timeBlocks !== undefined ? timeBlocks : prev.timeBlocks,
    })
  },

  findDailyFocusContainingTask: async (_email, taskId) => {
    const out = []
    for (const [dateStr, f] of store.focus) {
      if (f.taskIds.includes(taskId)) out.push(dateStr)
    }
    return out
  },

  createTask: async (data) => {
    const id = 'demo_' + seq++
    const assignees = data.assignees || (data.assignee ? [data.assignee] : [])
    store.tasks.unshift({
      id,
      title: data.title,
      description: data.description || '',
      clientId: data.clientId || '',
      projectId: data.projectId || '',
      assignees,
      status: data.status || 'todo',
      priority: data.priority || 'medium',
      deadline: data.deadline ? iso(new Date(data.deadline)) : null,
      notes: data.notes || [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      closedAt: null,
      createdBy: data.createdBy || '',
    })
    return { id }
  },

  updateTask: async (taskId, data) => {
    const t = store.tasks.find((x) => x.id === taskId)
    if (!t) return
    Object.assign(t, data, { updatedAt: nowIso() })
    if (data.status === 'done' && !data.closedAt) t.closedAt = nowIso()
    if (data.status && data.status !== 'done') t.closedAt = null
    if (data.deadline !== undefined) t.deadline = data.deadline ? iso(new Date(data.deadline)) : null
  },

  deleteTask: async (taskId) => {
    const i = store.tasks.findIndex((x) => x.id === taskId)
    if (i >= 0) store.tasks.splice(i, 1)
  },

  loadCalendarEvents: async (dateStr) => {
    const events = store.calendarEvents.filter((e) => (e.start || '').startsWith(dateStr))
    return { events, needsAuth: false }
  },

  // ── Manage page: clients, projects, client users ──
  subscribeToClients: (callback) => subscribeToCollection('clients', callback),
  subscribeToProjects: (callback) => subscribeToCollection('projects', callback),
  subscribeToClientUsers: (callback) => subscribeToCollection('clientUsers', callback),

  createClient: async (data) => {
    const id = 'demo_c_' + seq++
    store.clients.push({
      id,
      name: data.name,
      logoUrl: data.logoUrl || '',
      defaultHourlyRate: data.defaultHourlyRate || 0,
      currency: data.currency || 'INR',
      slackChannelId: data.slackChannelId || '',
      archived: false,
    })
    emitCollection('clients')
    return { id } // db.createClient resolves to a docRef; callers read .id
  },

  updateClient: async (clientId, data) => {
    const c = store.clients.find((x) => x.id === clientId)
    if (c) Object.assign(c, data)
    emitCollection('clients')
  },

  deleteClient: async (clientId) => {
    const i = store.clients.findIndex((x) => x.id === clientId)
    if (i >= 0) store.clients.splice(i, 1)
    emitCollection('clients')
  },

  // The real uploadClientLogo reads + resizes the file to a data URL. In demo we
  // just hand back an object URL for the picked file so the preview renders it.
  uploadClientLogo: async (file) => {
    try { return URL.createObjectURL(file) } catch (_) { return '' }
  },

  createProject: async (data) => {
    const id = 'demo_p_' + seq++
    store.projects.push({
      id,
      name: data.name,
      clientId: data.clientId || '',
      hourlyRate: data.hourlyRate || 0,
      currency: data.currency || 'INR',
      slackChannelId: data.slackChannelId || '',
    })
    emitCollection('projects')
    return { id }
  },

  updateProject: async (projectId, data) => {
    const p = store.projects.find((x) => x.id === projectId)
    if (p) Object.assign(p, data)
    emitCollection('projects')
  },

  deleteProject: async (projectId) => {
    const i = store.projects.findIndex((x) => x.id === projectId)
    if (i >= 0) store.projects.splice(i, 1)
    emitCollection('projects')
  },

  updateProjectContent: async (projectId, content, updatedBy) => {
    const p = store.projects.find((x) => x.id === projectId)
    if (p) {
      p.content = content
      p.contentUpdatedBy = updatedBy || ''
      p.contentUpdatedAt = nowIso()
    }
    emitCollection('projects')
  },

  createClientUser: async (email, data) => {
    const lower = (email || '').toLowerCase()
    const rec = {
      id: lower,
      email: lower,
      name: data.name || '',
      clientId: data.clientId,
      invitedBy: data.invitedBy || '',
      createdAt: nowIso(),
    }
    const existing = store.clientUsers.find((u) => u.email === lower)
    if (existing) Object.assign(existing, rec)
    else store.clientUsers.unshift(rec)
    emitCollection('clientUsers')
  },

  deleteClientUser: async (email) => {
    const i = store.clientUsers.findIndex((u) => u.email === email)
    if (i >= 0) store.clientUsers.splice(i, 1)
    emitCollection('clientUsers')
  },
}
