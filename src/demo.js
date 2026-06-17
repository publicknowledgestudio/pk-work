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
const dayStr = (d) => d.toISOString().split('T')[0]
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
  { id: 'c_brunk', name: 'Brunk', slackChannelId: '', logoUrl: '' },
  { id: 'c_hammock', name: 'Hammock', slackChannelId: '', logoUrl: '' },
  { id: 'c_scc', name: 'SCC Online', slackChannelId: '', logoUrl: '' },
  { id: 'c_pres', name: 'Presentations.ai', slackChannelId: '', logoUrl: '' },
]

const projects = [
  { id: 'p_brunk_brand', name: 'Brand identity', clientId: 'c_brunk' },
  { id: 'p_brunk_social', name: 'Social media', clientId: 'c_brunk' },
  { id: 'p_hammock_pack', name: 'Packaging', clientId: 'c_hammock' },
  { id: 'p_scc_redesign', name: 'Website redesign', clientId: 'c_scc' },
  { id: 'p_pres_blog', name: 'Blog content', clientId: 'c_pres' },
]

const people = [
  { id: 'pe_gyan', name: 'Gyan', email: 'gyan@publicknowledge.co', type: 'team' },
  { id: 'pe_charu', name: 'Charu', email: 'charu@publicknowledge.co', type: 'team' },
  { id: 'pe_anandu', name: 'Anandu', email: 'anandu@publicknowledge.co', type: 'team' },
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

// ── Handlers mirroring db.js / calendar.js signatures ──
export const demo = {
  loadClients: async () => store.clients.map((c) => ({ ...c })),
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
}
