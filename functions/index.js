/**
 * Cloud Functions API for Claude Slack Integration
 *
 * These endpoints allow Claude (acting as scrum master in Slack)
 * to read and write task data in Firestore.
 *
 * All endpoints require the x-api-key header matching the
 * CLAUDE_API_KEY environment variable set in Firebase.
 *
 * Set the key: firebase functions:config:set claude.apikey="your-secret-key"
 * Or for v2: firebase functions:secrets:set CLAUDE_API_KEY
 */

const { onRequest } = require('firebase-functions/v2/https')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()

// Team config for leave balance calculations. Engagement dates live in the
// `contracts` Firestore collection — see accrualForUser / earliestStart below.
const TEAM_MEMBERS = [
  { email: 'gyan@publicknowledge.co', name: 'Gyan', role: 'admin' },
  { email: 'charu@publicknowledge.co', name: 'Charu', role: 'admin' },
  { email: 'sharang@publicknowledge.co', name: 'Sharang', role: 'member' },
  { email: 'anandu@publicknowledge.co', name: 'Anandu', role: 'member' },
  { email: 'mohit@publicknowledge.co', name: 'Mohit', role: 'member' },
  { email: 'rakesh@publicknowledge.co', name: 'Rakesh', role: 'member' },
  { email: 'saurabh@publicknowledge.co', name: 'Saurabh', role: 'member' },
]

const CLAUDE_API_KEY = defineSecret('CLAUDE_API_KEY')
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN')
const OPENCLAW_WEBHOOK_URL = defineSecret('OPENCLAW_WEBHOOK_URL')
const OPENCLAW_WEBHOOK_SECRET = defineSecret('OPENCLAW_WEBHOOK_SECRET')

const LEAVES_CHANNEL_ID = 'C09U7GVJ31R'
const LEAVE_NOTIFY_TYPES = new Set(['personal', 'medical', 'overtime'])

// Auth middleware
function authenticate(req, res) {
  const key = req.headers['x-api-key']
  if (!key || key !== process.env.CLAUDE_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// CORS headers
function cors(res) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
}

// Helper to get assignees array from task (backward compat with single assignee)
function getAssignees(t) {
  if (t.assignees) return t.assignees
  return t.assignee ? [t.assignee] : []
}

/**
 * GET  /api/tasks          - List all tasks (optional filters: ?assignee=email&status=todo&clientId=x&projectId=x)
 * POST /api/tasks          - Create a task
 * PATCH /api/tasks/:id     - Update a task
 * DELETE /api/tasks/:id    - Delete a task
 * GET  /api/clients        - List all clients
 * GET  /api/projects       - List projects (optional filter: ?clientId=x)
 */
exports.api = onRequest(
  { secrets: [CLAUDE_API_KEY, OPENCLAW_WEBHOOK_URL, OPENCLAW_WEBHOOK_SECRET] },
  async (req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (!authenticate(req, res)) return

  const path = req.path.replace(/^\//, '').replace(/\/$/, '')
  const segments = path.split('/')

  try {
    // --- TASKS ---
    if (segments[0] === 'tasks') {
      if (req.method === 'GET' && segments.length === 1) {
        return await listTasks(req, res)
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createTask(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        return await updateTask(req, res, segments[1])
      }
      if (req.method === 'DELETE' && segments.length === 2) {
        return await deleteTask(req, res, segments[1])
      }
    }

    // --- ASTY: SEARCH + STATUS ---
    if (segments[0] === 'search' && req.method === 'GET') {
      return await astySearch(req, res)
    }
    if (segments[0] === 'status' && req.method === 'GET') {
      return await astyStatus(req, res)
    }

    // --- SCRUM (daily summary) ---
    if (segments[0] === 'scrum' && req.method === 'GET') {
      return await scrumSummary(req, res)
    }

    // --- STANDUPS ---
    if (segments[0] === 'standups') {
      if (req.method === 'POST' && segments.length === 1) {
        return await createStandup(req, res)
      }
      if (req.method === 'GET' && segments.length === 1) {
        return await listStandups(req, res)
      }
    }

    // --- PEOPLE ---
    if (segments[0] === 'people') {
      if (req.method === 'GET' && segments.length === 1) {
        return await listPeople(req, res)
      }
      if (req.method === 'GET' && segments.length === 2) {
        return await getPerson(req, res, segments[1])
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createPersonHandler(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        return await updatePersonHandler(req, res, segments[1])
      }
      if (req.method === 'DELETE' && segments.length === 2) {
        return await deletePersonHandler(req, res, segments[1])
      }
      // Page content: /people/:id/content
      if (segments.length === 3 && segments[2] === 'content') {
        if (req.method === 'GET') return await getPageContent(req, res, 'people', segments[1])
        if (req.method === 'PATCH') return await updatePageContent(req, res, 'people', segments[1])
      }
    }

    // --- CLIENTS ---
    if (segments[0] === 'clients' && req.method === 'GET') {
      return await listClients(req, res)
    }

    // --- PROJECTS ---
    if (segments[0] === 'projects') {
      if (req.method === 'GET' && segments.length === 1) {
        return await listProjects(req, res)
      }
      // Page content: /projects/:id/content
      if (segments.length === 3 && segments[2] === 'content') {
        if (req.method === 'GET') return await getPageContent(req, res, 'projects', segments[1])
        if (req.method === 'PATCH') return await updatePageContent(req, res, 'projects', segments[1])
      }
    }

    // --- PARSE NOTES ---
    if (segments[0] === 'notes' && req.method === 'POST') {
      return await addNote(req, res)
    }

    // --- PROCESSES ---
    if (segments[0] === 'processes') {
      if (req.method === 'GET' && segments.length === 1) {
        return await listProcesses(req, res)
      }
      if (req.method === 'GET' && segments.length === 2) {
        return await getProcess(req, res, segments[1])
      }
    }

    // --- REFERENCES ---
    if (segments[0] === 'references') {
      if (segments.length === 2 && segments[1] === 'preview' && req.method === 'GET') {
        return await previewReference(req, res)
      }
      if (segments.length === 2 && segments[1] === 'search' && req.method === 'GET') {
        return await searchReferences(req, res)
      }
      if (req.method === 'GET' && segments.length === 1) {
        return await listReferences(req, res)
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createReference(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2 && !['preview', 'search'].includes(segments[1])) {
        return await updateReference(req, res, segments[1])
      }
      if (req.method === 'DELETE' && segments.length === 2 && !['preview', 'search'].includes(segments[1])) {
        return await deleteReference(req, res, segments[1])
      }
    }

    // --- MOODBOARDS ---
    if (segments[0] === 'moodboards') {
      if (req.method === 'GET' && segments.length === 1) {
        return await listMoodboards(req, res)
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createMoodboard(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        return await updateMoodboard(req, res, segments[1])
      }
      if (req.method === 'DELETE' && segments.length === 2) {
        return await deleteMoodboard(req, res, segments[1])
      }
    }

    // --- LEAVES ---
    if (segments[0] === 'leaves') {
      if (segments.length === 2 && segments[1] === 'balances' && req.method === 'GET') {
        return await getLeaveBalances(req, res)
      }
      if (req.method === 'GET' && segments.length === 1) {
        return await listLeaves(req, res)
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createLeave(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        return await cancelLeave(req, res, segments[1])
      }
    }

    res.status(404).json({ error: 'Not found' })
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// === Task Handlers ===

async function listTasks(req, res) {
  let q = db.collection('tasks')

  if (req.query.assignee) q = q.where('assignees', 'array-contains', req.query.assignee)
  if (req.query.status) q = q.where('status', '==', req.query.status)
  if (req.query.clientId) q = q.where('clientId', '==', req.query.clientId)
  if (req.query.projectId) q = q.where('projectId', '==', req.query.projectId)

  // Date range filters on closedAt (ISO date strings, e.g. "2026-02-24")
  const hasClosedAtFilter = req.query.closedAfter || req.query.closedBefore
  if (req.query.closedAfter) {
    q = q.where('closedAt', '>=', admin.firestore.Timestamp.fromDate(new Date(req.query.closedAfter)))
  }
  if (req.query.closedBefore) {
    q = q.where('closedAt', '<', admin.firestore.Timestamp.fromDate(new Date(req.query.closedBefore)))
  }

  // Firestore requires orderBy on the range-filtered field first
  if (hasClosedAtFilter) {
    q = q.orderBy('closedAt', 'desc')
  } else {
    q = q.orderBy('updatedAt', 'desc')
  }

  const snap = await q.get()
  const tasks = snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      closedAt: data.closedAt?.toDate?.()?.toISOString() || null,
      deadline: data.deadline?.toDate?.()?.toISOString()?.split('T')[0] || null,
    }
  })
  res.json({ tasks })
}

async function createTask(req, res) {
  const data = req.body
  if (!data.title) return res.status(400).json({ error: 'title is required' })

  // Resolve human-readable names to ids/emails where provided.
  // An unresolvable name is a 400 (with valid names listed) rather than a
  // silently unfiled task — callers like Asty need actionable feedback.
  let clientId = data.clientId || ''
  if (!clientId && data.clientName) {
    clientId = (await resolveClientId(data.clientName)) || ''
    if (!clientId) {
      const snap = await db.collection('clients').get()
      const clients = snap.docs.map((d) => d.data().name).filter(Boolean).sort()
      return res.status(400).json({ error: `Unknown client: ${data.clientName}`, clients })
    }
  }
  let projectId = data.projectId || ''
  if (!projectId && data.projectName) {
    projectId = (await resolveProjectId(data.projectName, clientId)) || ''
    if (!projectId) {
      let q = db.collection('projects')
      if (clientId) q = q.where('clientId', '==', clientId)
      const snap = await q.get()
      const projects = snap.docs.map((d) => d.data().name).filter(Boolean).sort()
      return res.status(400).json({ error: `Unknown project: ${data.projectName}`, projects })
    }
  }
  const assigneesRaw = data.assignees || (data.assignee ? [data.assignee] : [])
  const assignees = await resolveAssignees(assigneesRaw)

  const task = {
    title: data.title,
    description: data.description || '',
    clientId,
    projectId,
    assignees,
    status: data.status || 'todo',
    priority: data.priority || 'medium',
    deadline: data.deadline ? admin.firestore.Timestamp.fromDate(new Date(data.deadline)) : null,
    notes: data.notes || [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    closedAt: null,
    createdBy: data.createdBy || 'claude',
  }

  const ref = await db.collection('tasks').add(task)
  res.status(201).json({ id: ref.id, ...task })
}

async function updateTask(req, res, taskId) {
  const data = req.body
  const update = { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }

  // Resolve name fields if provided. Unresolvable names are a 400, not a
  // silently dropped field — callers like Asty need actionable feedback.
  if (data.clientName && !data.clientId) {
    const cid = await resolveClientId(data.clientName)
    if (!cid) {
      const snap = await db.collection('clients').get()
      const clients = snap.docs.map((d) => d.data().name).filter(Boolean).sort()
      return res.status(400).json({ error: `Unknown client: ${data.clientName}`, clients })
    }
    update.clientId = cid
    delete update.clientName
  }
  if (data.projectName && !data.projectId) {
    const pid = await resolveProjectId(data.projectName, update.clientId || data.clientId)
    if (!pid) {
      let q = db.collection('projects')
      const cid = update.clientId || data.clientId
      if (cid) q = q.where('clientId', '==', cid)
      const snap = await q.get()
      const projects = snap.docs.map((d) => d.data().name).filter(Boolean).sort()
      return res.status(400).json({ error: `Unknown project: ${data.projectName}`, projects })
    }
    update.projectId = pid
    delete update.projectName
  }
  if (data.assignee && !data.assignees) {
    update.assignees = await resolveAssignees([data.assignee])
    delete update.assignee
  } else if (data.assignees) {
    update.assignees = await resolveAssignees(data.assignees)
  }

  if (data.status === 'done') {
    update.closedAt = admin.firestore.FieldValue.serverTimestamp()
  } else if (data.status) {
    update.closedAt = null
  }

  if (data.deadline) {
    update.deadline = admin.firestore.Timestamp.fromDate(new Date(data.deadline))
  }

  await db.collection('tasks').doc(taskId).update(update)
  res.json({ id: taskId, updated: true })
}

async function deleteTask(req, res, taskId) {
  await db.collection('tasks').doc(taskId).delete()
  res.json({ id: taskId, deleted: true })
}

// === Asty / OpenClaw: name resolvers + search + status digest ===

async function resolveClientId(clientName) {
  if (!clientName) return null
  const term = String(clientName).toLowerCase().trim()
  const snap = await db.collection('clients').get()
  const match = snap.docs.find((d) => (d.data().name || '').toLowerCase() === term)
  if (match) return match.id
  // substring fallback (single hit only, otherwise ambiguous)
  const subs = snap.docs.filter((d) => (d.data().name || '').toLowerCase().includes(term))
  return subs.length === 1 ? subs[0].id : null
}

async function resolveProjectId(projectName, clientId) {
  if (!projectName) return null
  const term = String(projectName).toLowerCase().trim()
  let q = db.collection('projects')
  if (clientId) q = q.where('clientId', '==', clientId)
  const snap = await q.get()
  const match = snap.docs.find((d) => (d.data().name || '').toLowerCase() === term)
  if (match) return match.id
  const subs = snap.docs.filter((d) => (d.data().name || '').toLowerCase().includes(term))
  return subs.length === 1 ? subs[0].id : null
}

async function resolveAssigneeEmail(nameOrEmail) {
  if (!nameOrEmail) return null
  const val = String(nameOrEmail).trim()
  if (val.includes('@')) return val
  const term = val.toLowerCase()
  const snap = await db.collection('people').get()
  const match = snap.docs.find((d) => {
    const data = d.data()
    const name = (data.name || '').toLowerCase()
    return name === term || name.split(' ')[0] === term
  })
  return match ? match.data().email || val : val
}

async function resolveAssignees(input) {
  if (!input) return []
  const arr = Array.isArray(input) ? input : [input]
  const out = []
  for (const v of arr) out.push(await resolveAssigneeEmail(v))
  return out.filter(Boolean)
}

async function astySearch(req, res) {
  const q = String(req.query.q || '').toLowerCase().trim()
  if (!q) return res.status(400).json({ error: 'q is required' })
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '12', 10), 25))

  const [clientsSnap, projectsSnap, peopleSnap, tasksSnap] = await Promise.all([
    db.collection('clients').get(),
    db.collection('projects').get(),
    db.collection('people').get(),
    db.collection('tasks').orderBy('updatedAt', 'desc').limit(100).get(),
  ])

  const results = []

  for (const d of clientsSnap.docs) {
    const data = d.data()
    if ((data.name || '').toLowerCase().includes(q)) {
      results.push({
        type: 'client',
        id: d.id,
        name: data.name,
        slackChannelId: data.slackChannelId || null,
      })
    }
  }

  for (const d of projectsSnap.docs) {
    const data = d.data()
    if ((data.name || '').toLowerCase().includes(q)) {
      results.push({
        type: 'project',
        id: d.id,
        name: data.name,
        clientId: data.clientId || null,
      })
    }
  }

  for (const d of peopleSnap.docs) {
    const data = d.data()
    const name = (data.name || '').toLowerCase()
    const email = (data.email || '').toLowerCase()
    if (name.includes(q) || email.includes(q)) {
      results.push({
        type: 'person',
        id: d.id,
        name: data.name,
        email: data.email || null,
        role: data.role || null,
      })
    }
  }

  for (const d of tasksSnap.docs) {
    const data = d.data()
    if ((data.title || '').toLowerCase().includes(q)) {
      results.push({
        type: 'task',
        id: d.id,
        title: data.title,
        status: data.status,
        assignees: data.assignees || [],
        clientId: data.clientId || null,
        projectId: data.projectId || null,
      })
    }
  }

  res.json({ q, results: results.slice(0, limit) })
}

async function astyStatus(req, res) {
  const rawScope = String(req.query.scope || '').toLowerCase().trim()

  let kind = 'all'
  let assigneeFilter = null
  let clientFilter = null
  let label = 'studio'

  if (rawScope === 'today') {
    kind = 'today'
    label = 'today'
  } else if (rawScope) {
    // try person (name first-word or full name, or email)
    const peopleSnap = await db.collection('people').get()
    const personMatch = peopleSnap.docs.find((d) => {
      const data = d.data()
      const name = (data.name || '').toLowerCase()
      const email = (data.email || '').toLowerCase()
      return name === rawScope || name.split(' ')[0] === rawScope || email === rawScope
    })
    if (personMatch) {
      assigneeFilter = personMatch.data().email
      kind = 'person'
      label = personMatch.data().name || assigneeFilter
    } else {
      const clientsSnap = await db.collection('clients').get()
      const clientMatch = clientsSnap.docs.find((d) => {
        const name = (d.data().name || '').toLowerCase()
        return name === rawScope || name.includes(rawScope)
      })
      if (clientMatch) {
        clientFilter = clientMatch.id
        kind = 'client'
        label = clientMatch.data().name
      } else {
        return res.status(400).json({
          error: 'scope did not match a known person or client',
          scope: rawScope,
          hint: 'try a first name (e.g. charu), a client name (e.g. brunk), or "today"',
        })
      }
    }
  }

  let q = db.collection('tasks')
  if (assigneeFilter) q = q.where('assignees', 'array-contains', assigneeFilter)
  if (clientFilter) q = q.where('clientId', '==', clientFilter)
  const snap = await q.get()
  let all = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  if (kind === 'today') {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(startOfDay)
    endOfDay.setDate(endOfDay.getDate() + 1)
    all = all.filter((t) => {
      const dl = t.deadline?.toDate?.()
      return dl && dl >= startOfDay && dl < endOfDay
    })
  }

  // Always build a clients map with slack channels — Asty needs this to route per-client messages
  const cs = await db.collection('clients').get()
  const clients = {}
  cs.docs.forEach((d) => {
    const data = d.data()
    clients[d.id] = {
      name: data.name || '',
      slackChannelId: data.slackChannelId || null,
    }
  })

  const slim = (t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignees: t.assignees || [],
    clientId: t.clientId || null,
    client: clients[t.clientId]?.name || null,
    slackChannelId: clients[t.clientId]?.slackChannelId || null,
    deadline: t.deadline?.toDate?.()?.toISOString()?.split('T')[0] || null,
    priority: t.priority || null,
  })

  const byStatus = { backlog: [], todo: [], in_progress: [], review: [], done: [] }
  for (const t of all) {
    const s = t.status || 'todo'
    if (byStatus[s]) byStatus[s].push(slim(t))
  }

  const activeCount =
    byStatus.todo.length + byStatus.in_progress.length + byStatus.review.length

  // For client scope, surface the channel id at the top level.
  const slackChannelId =
    kind === 'client' && clientFilter
      ? clients[clientFilter]?.slackChannelId || null
      : null

  // For studio-wide, build a per-client breakdown so Asty can route per channel.
  let activeClients = null
  if (kind === 'all') {
    const acc = {}
    const allActive = [...byStatus.todo, ...byStatus.in_progress, ...byStatus.review]
    for (const t of allActive) {
      if (!t.clientId) continue
      const key = t.clientId
      if (!acc[key]) {
        acc[key] = {
          clientId: key,
          name: clients[key]?.name || null,
          slackChannelId: clients[key]?.slackChannelId || null,
          in_progress: 0,
          review: 0,
          todo: 0,
        }
      }
      acc[key][t.status] = (acc[key][t.status] || 0) + 1
    }
    activeClients = Object.values(acc).sort(
      (a, b) =>
        b.in_progress + b.review + b.todo - (a.in_progress + a.review + a.todo),
    )
  }

  res.json({
    scope: rawScope || 'all',
    kind,
    label,
    slackChannelId,
    activeClients,
    counts: {
      active: activeCount,
      in_progress: byStatus.in_progress.length,
      review: byStatus.review.length,
      todo: byStatus.todo.length,
      backlog: byStatus.backlog.length,
      done: byStatus.done.length,
    },
    in_progress: byStatus.in_progress,
    review: byStatus.review,
    todo: byStatus.todo,
  })
}

// === Processes ===

async function listProcesses(req, res) {
  const snap = await db.collection('processes').orderBy('name').get()
  res.json({ processes: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })
}

async function getProcess(req, res, processId) {
  const docRef = await db.collection('processes').doc(processId).get()
  if (!docRef.exists) return res.status(404).json({ error: 'Process not found' })
  res.json({ id: docRef.id, ...docRef.data() })
}

// === OpenClaw Webhook ===

const ASTY_EMAIL = 'asty@publicknowledge.co'

async function lookupProject(projectId) {
  if (!projectId) return null
  const doc = await db.collection('projects').doc(projectId).get()
  return doc.exists ? doc.data() : null
}

async function lookupProjectName(projectId) {
  const project = await lookupProject(projectId)
  return project?.name || ''
}

function notifyOpenClaw(taskId, task, action) {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL
  const webhookSecret = process.env.OPENCLAW_WEBHOOK_SECRET
  if (!webhookUrl) return // not configured yet — skip silently

  // Sanitize Firestore-specific objects before JSON serialization
  const serializableTask = {
    ...task,
    deadline: task.deadline?.toDate ? task.deadline.toDate().toISOString() : (task.deadline || null),
    createdAt: task.createdAt?.toDate ? task.createdAt.toDate().toISOString() : null,
    updatedAt: task.updatedAt?.toDate ? task.updatedAt.toDate().toISOString() : null,
    closedAt: task.closedAt?.toDate ? task.closedAt.toDate().toISOString() : null,
  }

  const payload = {
    event: task.event || 'task_assigned',
    action,
    task: { id: taskId, ...serializableTask },
  }

  // Fire and forget — do not await, do not block the response
  fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': webhookSecret || '',
    },
    body: JSON.stringify(payload),
  }).catch((err) => console.error('OpenClaw webhook error:', err))
}

// === Firestore Trigger — Notify OpenClaw on key task events ===

exports.onTaskWritten = onDocumentWritten(
  { document: 'tasks/{taskId}', secrets: [OPENCLAW_WEBHOOK_URL, OPENCLAW_WEBHOOK_SECRET, SLACK_BOT_TOKEN] },
  async (event) => {
    const after = event.data?.after
    if (!after?.exists) return // task deleted — ignore

    const task = after.data()
    const before = event.data?.before?.data()
    const afterAssignees = task.assignees || []
    const beforeAssignees = before?.assignees || []

    // Slack retry: frontend flipped slackNotification.status from 'failed'
    // to 'retrying' after a user clicked Retry in the toast. Re-post with
    // the stored channel/text/actedBy and return early so we don't also
    // re-run the original notify paths below (which are keyed on other
    // fields and wouldn't fire anyway, but being explicit is safer).
    const beforeNotif = before?.slackNotification
    const afterNotif = task.slackNotification
    if (beforeNotif?.status === 'failed' && afterNotif?.status === 'retrying' && afterNotif.channel && afterNotif.text) {
      await postToSlackChannel(event.params.taskId, afterNotif.channel, afterNotif.text, afterNotif.actedBy || '')
      return
    }

    // Notify when Asty is newly assigned
    const newlyAssigned = afterAssignees.includes(ASTY_EMAIL) && !beforeAssignees.includes(ASTY_EMAIL)
    if (newlyAssigned) {
      const action = event.data?.before?.exists ? 'updated' : 'created'
      const projectName = await lookupProjectName(task.projectId)
      notifyOpenClaw(event.params.taskId, { ...task, projectName }, action)
    }

    // Notify when an external (client) user creates a task — post to client Slack channel
    const isNewTask = !event.data?.before?.exists
    const createdBy = task.createdBy || ''
    const isExternalUser = isNewTask && createdBy && !createdBy.endsWith('@publicknowledge.co')
    if (isExternalUser && task.clientId) {
      const [clientUserDoc, clientDoc, project] = await Promise.all([
        db.collection('clientUsers').doc(createdBy).get(),
        db.collection('clients').doc(task.clientId).get(),
        lookupProject(task.projectId),
      ])
      const client = clientDoc.exists ? clientDoc.data() : null
      const channelId = project?.slackChannelId || client?.slackChannelId
      if (channelId) {
        const projectName = project?.name || ''
        const userName = clientUserDoc.exists ? (clientUserDoc.data().name || createdBy.split('@')[0]) : createdBy.split('@')[0]
        const contextLine = [projectName, client.name].filter(Boolean).join(' · ')
        const message = `📋 New task created by external user "${userName}" — ${task.title}\n${contextLine}`
        await postToSlackChannel(event.params.taskId, channelId, message, createdBy)
      }
    }

    // Notify when a task is marked as done — post to client Slack channel
    const justCompleted = task.status === 'done' && before?.status && before.status !== 'done'
    if (justCompleted) {
      const project = await lookupProject(task.projectId)
      const projectName = project?.name || ''
      notifyOpenClaw(event.params.taskId, { ...task, projectName, event: 'task_completed' }, 'completed')

      // Post to client's Slack channel via Asty bot token (project channel overrides client channel)
      if (task.clientId) {
        const clientDoc = await db.collection('clients').doc(task.clientId).get()
        const client = clientDoc.exists ? clientDoc.data() : null
        const channelId = project?.slackChannelId || client?.slackChannelId
        if (channelId) {
          const actedByEmail = task.updatedBy || ''
          const completedBy = lookupTeamName(actedByEmail || afterAssignees[0] || '')
          const projectLine = projectName || client.name || ''
          const message = `✅ ${task.title}\n${projectLine} · Marked done by ${completedBy}`
          await postToSlackChannel(event.params.taskId, channelId, message, actedByEmail)
        }
      }
    }
  }
)

function lookupTeamName(email) {
  if (!email) return 'someone'
  const member = TEAM_MEMBERS.find((m) => m.email === email)
  return member ? member.name : email.split('@')[0]
}

// Post to Slack and record the outcome on the task so the frontend can
// surface a success/failure toast to the user who acted. Slack returns
// HTTP 200 even for API-level failures (ok: false with an error code
// like 'not_in_channel'), so we must parse the body to detect them.
async function postToSlackChannel(taskId, channelId, text, actedBy) {
  const writeOutcome = (status, error) => db.collection('tasks').doc(taskId).update({
    slackNotification: {
      status,
      error: error || '',
      channel: channelId || '',
      text: text || '',
      actedBy: actedBy || '',
      at: admin.firestore.FieldValue.serverTimestamp(),
    },
  }).catch((err) => console.error('Failed writing slackNotification:', err))

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    console.error('Slack post skipped: SLACK_BOT_TOKEN not configured')
    return writeOutcome('failed', 'missing_bot_token')
  }

  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: channelId, text }),
    })
    const data = await resp.json()
    if (data.ok) return writeOutcome('ok', '')
    console.error('Slack postMessage failed:', data.error, 'channel:', channelId)
    return writeOutcome('failed', data.error || 'unknown_error')
  } catch (err) {
    console.error('Slack postMessage network error:', err)
    return writeOutcome('failed', 'network_error')
  }
}

// === Leaves → #leaves notifier ===
// Posts to #leaves on create / cancel / edit for personal, medical, overtime.
// wfh is intentionally excluded — it's a daily status, not time off.

exports.onLeaveWritten = onDocumentWritten(
  { document: 'leaves/{leaveId}', secrets: [SLACK_BOT_TOKEN] },
  async (event) => {
    const after = event.data?.after
    const before = event.data?.before
    if (!after?.exists) return // hard delete — ignore (cancellation is a soft delete via status)

    const leave = after.data()
    const prev = before?.exists ? before.data() : null

    if (!LEAVE_NOTIFY_TYPES.has(leave.type)) return

    const isNew = !prev
    const justCancelled = !!prev && prev.status !== 'cancelled' && leave.status === 'cancelled'
    const isEdit = !!prev && prev.status !== 'cancelled' && leave.status !== 'cancelled' && hasLeaveFieldChange(prev, leave)

    let message = ''
    let actor = ''
    if (isNew) {
      message = formatLeaveCreate(leave)
      actor = leave.createdBy || ''
    } else if (justCancelled) {
      message = formatLeaveCancel(leave)
      actor = leave.cancelledBy || ''
    } else if (isEdit) {
      message = formatLeaveEdit(prev, leave)
      actor = leave.updatedBy || leave.createdBy || ''
    } else {
      return
    }

    const subjectEmail = leave.userEmail || ''
    if (actor && actor !== subjectEmail) {
      const verb = isNew ? 'Marked' : justCancelled ? 'Cancelled' : 'Edited'
      message += ` (${verb} by ${lookupTeamName(actor)})`
    }

    await postToLeavesChannel(event.params.leaveId, LEAVES_CHANNEL_ID, message, actor)
  }
)

function hasLeaveFieldChange(a, b) {
  return a.type !== b.type ||
    a.startDate !== b.startDate ||
    a.endDate !== b.endDate ||
    !!a.halfDay !== !!b.halfDay ||
    (a.note || '') !== (b.note || '')
}

function formatLeaveCreate(leave) {
  const name = lookupTeamName(leave.userEmail)
  const dates = formatLeaveDateRange(leave.startDate, leave.endDate, leave.halfDay)
  if (leave.type === 'overtime') {
    return `${name} logged overtime on ${dates}.`
  }
  const halfPrefix = leave.halfDay ? 'half-day ' : ''
  return `${name} is on ${halfPrefix}leave (${leave.type}) on ${dates}.`
}

function formatLeaveCancel(leave) {
  const name = lookupTeamName(leave.userEmail)
  const dates = formatLeaveDateRange(leave.startDate, leave.endDate, leave.halfDay)
  if (leave.type === 'overtime') {
    return `${name}'s overtime on ${dates} was cancelled.`
  }
  return `${name}'s leave (${leave.type}) on ${dates} was cancelled.`
}

function formatLeaveEdit(prev, leave) {
  const name = lookupTeamName(leave.userEmail)
  const subject = leave.type === 'overtime'
    ? `${name}'s overtime`
    : `${name}'s leave (${leave.type})`
  const diffs = []
  if (prev.type !== leave.type) {
    diffs.push(`type ${prev.type} → ${leave.type}`)
  }
  if (prev.startDate !== leave.startDate || prev.endDate !== leave.endDate) {
    const oldDates = formatLeaveDateRange(prev.startDate, prev.endDate, prev.halfDay)
    const newDates = formatLeaveDateRange(leave.startDate, leave.endDate, leave.halfDay)
    diffs.push(`${oldDates} → ${newDates}`)
  } else if (!!prev.halfDay !== !!leave.halfDay) {
    diffs.push(leave.halfDay ? 'now half-day' : 'now full day')
  }
  if ((prev.note || '') !== (leave.note || '')) {
    diffs.push('note updated')
  }
  return `${subject} was updated: ${diffs.join(', ')}.`
}

// "Wednesday, 12 June" / "Wednesday, 12 June – Friday, 14 June".
// startDate / endDate are YYYY-MM-DD strings authored in the user's local
// (IST) calendar. Parse them as plain date components — do NOT use new
// Date(string) which would interpret as UTC and shift in display.
function formatLeaveDateRange(startDate, endDate, halfDay) {
  const start = parseISODateLocal(startDate)
  if (!start) return startDate || ''
  const startStr = formatLeaveDate(start)
  if (!endDate || endDate === startDate || halfDay) return startStr
  const end = parseISODateLocal(endDate)
  if (!end) return startStr
  return `${startStr} – ${formatLeaveDate(end)}`
}

function parseISODateLocal(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function formatLeaveDate(d) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
}

// Mirrors postToSlackChannel but writes outcome onto the leaves doc.
async function postToLeavesChannel(leaveId, channelId, text, actedBy) {
  const writeOutcome = (status, error) => db.collection('leaves').doc(leaveId).update({
    slackNotification: {
      status,
      error: error || '',
      channel: channelId || '',
      text: text || '',
      actedBy: actedBy || '',
      at: admin.firestore.FieldValue.serverTimestamp(),
    },
  }).catch((err) => console.error('Failed writing leaves slackNotification:', err))

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    console.error('Leaves Slack post skipped: SLACK_BOT_TOKEN not configured')
    return writeOutcome('failed', 'missing_bot_token')
  }

  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: channelId, text }),
    })
    const data = await resp.json()
    if (data.ok) return writeOutcome('ok', '')
    console.error('Leaves Slack postMessage failed:', data.error, 'channel:', channelId)
    return writeOutcome('failed', data.error || 'unknown_error')
  } catch (err) {
    console.error('Leaves Slack postMessage network error:', err)
    return writeOutcome('failed', 'network_error')
  }
}

// === Scrum Summary ===
// Returns: items closed yesterday + currently open items per team member

async function scrumSummary(req, res) {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  // Items closed yesterday
  const closedSnap = await db
    .collection('tasks')
    .where('closedAt', '>=', admin.firestore.Timestamp.fromDate(yesterday))
    .where('closedAt', '<', admin.firestore.Timestamp.fromDate(today))
    .get()
  const closedYesterday = closedSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  // All open items (not done, not backlog)
  const openSnap = await db
    .collection('tasks')
    .where('status', 'in', ['todo', 'in_progress', 'review'])
    .get()
  const openTasks = openSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  // Helper to get assignees array from task (backward compat)
  function getAssignees(t) {
    if (t.assignees) return t.assignees
    return t.assignee ? [t.assignee] : []
  }

  // Group by assignee
  const team = ['gyan', 'charu', 'sharang', 'anandu']
  const summary = {}
  for (const name of team) {
    const email = `${name}@publicknowledge.co`
    summary[name] = {
      closedYesterday: closedYesterday.filter((t) => getAssignees(t).includes(email)),
      open: openTasks.filter((t) => getAssignees(t).includes(email)),
    }
  }

  // Unassigned
  summary['unassigned'] = {
    closedYesterday: closedYesterday.filter((t) => getAssignees(t).length === 0),
    open: openTasks.filter((t) => getAssignees(t).length === 0),
  }

  res.json({ date: now.toISOString().split('T')[0], summary })
}

// === Standup Handlers ===

async function createStandup(req, res) {
  const data = req.body
  const standup = {
    userEmail: data.userEmail,
    userName: data.userName || '',
    yesterday: data.yesterday || '',
    today: data.today || '',
    blockers: data.blockers || '',
    date: admin.firestore.FieldValue.serverTimestamp(),
  }

  const ref = await db.collection('standups').add(standup)
  res.status(201).json({ id: ref.id })
}

async function listStandups(req, res) {
  let q = db.collection('standups').orderBy('date', 'desc').limit(20)
  if (req.query.userEmail) q = q.where('userEmail', '==', req.query.userEmail)

  const snap = await q.get()
  const standups = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  res.json({ standups })
}

// === Reference Data ===

async function listClients(req, res) {
  const snap = await db.collection('clients').orderBy('name').get()
  res.json({ clients: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })
}

async function listProjects(req, res) {
  let q = db.collection('projects')
  if (req.query.clientId) q = q.where('clientId', '==', req.query.clientId)
  q = q.orderBy('name')
  const snap = await q.get()
  res.json({ projects: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })
}

// === People Handlers ===

async function listPeople(req, res) {
  let q = db.collection('people')
  if (req.query.type) q = q.where('type', '==', req.query.type)
  if (req.query.clientId) q = q.where('clientIds', 'array-contains', req.query.clientId)
  q = q.orderBy('name')

  const snap = await q.get()
  const people = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  res.json({ people })
}

async function getPerson(req, res, personId) {
  const doc = await db.collection('people').doc(personId).get()
  if (!doc.exists) return res.status(404).json({ error: 'Person not found' })
  res.json({ id: doc.id, ...doc.data() })
}

async function createPersonHandler(req, res) {
  const data = req.body
  if (!data.name) return res.status(400).json({ error: 'name is required' })

  const person = {
    name: data.name,
    email: data.email || '',
    type: data.type || 'external',
    role: data.role || '',
    organization: data.organization || '',
    clientIds: data.clientIds || [],
    tags: data.tags || [],
    content: data.content || '',
    contentUpdatedAt: null,
    contentUpdatedBy: '',
    photoURL: data.photoURL || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  const ref = await db.collection('people').add(person)
  res.status(201).json({ id: ref.id, ...person })
}

async function updatePersonHandler(req, res, personId) {
  const data = req.body
  const update = { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  await db.collection('people').doc(personId).update(update)
  res.json({ id: personId, updated: true })
}

async function deletePersonHandler(req, res, personId) {
  await db.collection('people').doc(personId).delete()
  res.json({ id: personId, deleted: true })
}

// === Page Content Handlers (generic for people + projects) ===

async function getPageContent(req, res, collectionName, docId) {
  const doc = await db.collection(collectionName).doc(docId).get()
  if (!doc.exists) return res.status(404).json({ error: 'Not found' })
  const data = doc.data()
  res.json({
    id: doc.id,
    content: data.content || '',
    contentUpdatedAt: data.contentUpdatedAt || null,
    contentUpdatedBy: data.contentUpdatedBy || '',
  })
}

async function updatePageContent(req, res, collectionName, docId) {
  const { content, updatedBy } = req.body
  if (content === undefined) return res.status(400).json({ error: 'content is required' })

  await db.collection(collectionName).doc(docId).update({
    content,
    contentUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    contentUpdatedBy: updatedBy || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  res.json({ id: docId, updated: true })
}

// === Notes (Granola / meeting notes) ===

async function addNote(req, res) {
  const data = req.body
  const note = {
    content: data.content || '',
    source: data.source || 'slack',
    taskIds: data.taskIds || [],
    createdBy: data.createdBy || 'claude',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  const ref = await db.collection('notes').add(note)
  res.status(201).json({ id: ref.id })
}

// === Slack Bot (Events API — interactive @mentions) ===
// Disabled: Asty (OpenClaw, socket mode) now handles all Slack interaction.
// The old Events API bot required SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET
// secrets which are no longer provisioned, blocking all function deployments.
// exports.slack = require('./slack').slack

// Old slackWebhook (Scrumpy) removed — replaced by Asty bot token posting in onTaskWritten

// === Reference Handlers ===

async function listReferences(req, res) {
  let q = db.collection('references')

  if (req.query.clientId) q = q.where('clientId', '==', req.query.clientId)
  if (req.query.projectId) q = q.where('projectId', '==', req.query.projectId)
  if (req.query.tag) q = q.where('tags', 'array-contains', req.query.tag)
  if (req.query.sharedBy) q = q.where('sharedBy', '==', req.query.sharedBy)

  q = q.orderBy('createdAt', 'desc')

  const limit = parseInt(req.query.limit) || 50
  const offset = parseInt(req.query.offset) || 0
  q = q.limit(limit + offset)

  const snap = await q.get()
  const references = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .slice(offset, offset + limit)
  res.json({ references })
}

async function createReference(req, res) {
  const data = req.body
  if (!data.url) return res.status(400).json({ error: 'url is required' })

  const reference = {
    url: data.url,
    title: data.title || '',
    description: data.description || '',
    imageUrl: data.imageUrl || '',
    tags: data.tags || [],
    clientId: data.clientId || '',
    projectId: data.projectId || '',
    sharedBy: data.sharedBy || '',
    slackMessageTs: data.slackMessageTs || '',
    slackChannel: data.slackChannel || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  const ref = await db.collection('references').add(reference)
  res.status(201).json({ id: ref.id, ...reference })
}

async function updateReference(req, res, refId) {
  const data = req.body
  const ALLOWED = ['url', 'title', 'description', 'imageUrl', 'tags', 'clientId', 'projectId', 'sharedBy']
  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  for (const key of ALLOWED) {
    if (data[key] !== undefined) update[key] = data[key]
  }
  await db.collection('references').doc(refId).update(update)
  res.json({ id: refId, updated: true })
}

async function deleteReference(req, res, refId) {
  await db.collection('references').doc(refId).delete()
  res.json({ id: refId, deleted: true })
}

async function searchReferences(req, res) {
  const query = req.query.q
  if (!query) return res.status(400).json({ error: 'q query parameter is required' })

  const searchTerms = query.toLowerCase().split(/\s+/)

  const snap = await db.collection('references')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get()

  const references = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((ref) => {
      const searchable = [
        ref.title || '',
        ref.description || '',
        ref.url || '',
        ...(ref.tags || []),
      ].join(' ').toLowerCase()
      return searchTerms.every((term) => searchable.includes(term))
    })

  res.json({ references })
}

async function previewReference(req, res) {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'url query parameter is required' })

  // Validate URL protocol to prevent SSRF
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http/https URLs are supported' })
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') || hostname === '::1' ||
        hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80') ||
        hostname.endsWith('.local') || hostname.endsWith('.internal') ||
        hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
      return res.status(400).json({ error: 'Internal URLs are not allowed' })
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PKWork/1.0; +https://work.publicknowledge.co)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    })

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    if (contentLength > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Response too large' })
    }
    const html = await response.text()
    if (html.length > 2 * 1024 * 1024) {
      return res.json({ title: '', description: '', imageUrl: '', error: 'Response too large' })
    }

    // Extract OG / meta tags using regex
    // Check both property="og:X" content="Y" and content="Y" property="og:X" orderings
    // Also check name="X" variants
    function extractMeta(propName) {
      const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${propName}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${propName}["']`, 'i'),
      ]
      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match && match[1]) return match[1]
      }
      return ''
    }

    const title = extractMeta('og:title') || extractMeta('twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ''
    const description = extractMeta('og:description') || extractMeta('twitter:description') || extractMeta('description') || ''
    const imageUrl = extractMeta('og:image') || extractMeta('twitter:image') || ''

    res.json({ title: title.trim(), description: description.trim(), imageUrl })
  } catch (err) {
    console.error('Preview fetch error:', err.message)
    res.json({ title: '', description: '', imageUrl: '', error: err.message })
  }
}

// === Moodboard Handlers ===

async function listMoodboards(req, res) {
  let q = db.collection('moodboards')

  if (req.query.clientId) q = q.where('clientId', '==', req.query.clientId)
  if (req.query.projectId) q = q.where('projectId', '==', req.query.projectId)

  q = q.orderBy('updatedAt', 'desc')

  const snap = await q.get()
  const moodboards = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  res.json({ moodboards })
}

async function createMoodboard(req, res) {
  const data = req.body
  if (!data.name) return res.status(400).json({ error: 'name is required' })

  const moodboard = {
    name: data.name,
    description: data.description || '',
    referenceIds: data.referenceIds || [],
    clientId: data.clientId || '',
    projectId: data.projectId || '',
    createdBy: data.createdBy || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  const ref = await db.collection('moodboards').add(moodboard)
  res.status(201).json({ id: ref.id, ...moodboard })
}

async function updateMoodboard(req, res, boardId) {
  const data = req.body
  const ALLOWED = ['name', 'description', 'referenceIds', 'clientId', 'projectId']
  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  for (const key of ALLOWED) {
    if (data[key] !== undefined) update[key] = data[key]
  }
  await db.collection('moodboards').doc(boardId).update(update)
  res.json({ id: boardId, updated: true })
}

async function deleteMoodboard(req, res, boardId) {
  await db.collection('moodboards').doc(boardId).delete()
  res.json({ id: boardId, deleted: true })
}

// === Leave Helpers ===

function countWeekdays(startDate, endDate) {
  let count = 0
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const current = new Date(start)
  while (current <= end) {
    const day = current.getDay()
    if (day !== 0 && day !== 6) count++
    current.setDate(current.getDate() + 1)
  }
  return count
}

// Months a single contract has accrued by `asOf`. Mirrors src/utils/contracts.js.
function contractMonths(contract, asOf) {
  if (!contract || !contract.startDate) return 0
  const start = new Date(contract.startDate + 'T00:00:00')
  if (start > asOf) return 0
  const end = contract.endDate ? new Date(contract.endDate + 'T00:00:00') : asOf
  const cap = end < asOf ? end : asOf
  return Math.max(0, (cap.getFullYear() - start.getFullYear()) * 12 + (cap.getMonth() - start.getMonth()) + 1)
}

// Sums accrued months across a person's contracts. Returns 0 for anyone with
// no contracts in Firestore (admin must create one for new team members).
async function accrualForUser(member, contractsByEmail = null) {
  const userContracts = contractsByEmail
    ? (contractsByEmail.get(member.email) || [])
    : (await db.collection('contracts').where('userEmail', '==', member.email).get())
        .docs.map((d) => d.data())
  if (userContracts.length === 0) return 0
  const now = new Date()
  return userContracts.reduce((sum, c) => sum + contractMonths(c, now), 0)
}

// Earliest contract start date string (YYYY-MM-DD) or null.
function earliestStart(_member, userContracts) {
  const dates = (userContracts || []).map((c) => c.startDate).filter(Boolean).sort()
  return dates[0] || null
}

// Loads all contracts once and indexes them by userEmail. Used by handlers
// that need accrual for many people in one request.
async function loadContractsByEmail() {
  const snap = await db.collection('contracts').get()
  const map = new Map()
  snap.docs.forEach((d) => {
    const c = d.data()
    if (!map.has(c.userEmail)) map.set(c.userEmail, [])
    map.get(c.userEmail).push(c)
  })
  return map
}

// === Leave Handlers ===

async function listLeaves(req, res) {
  let q = db.collection('leaves')

  if (req.query.userEmail) q = q.where('userEmail', '==', req.query.userEmail)
  if (req.query.status) q = q.where('status', '==', req.query.status)

  q = q.orderBy('startDate', 'desc')

  const snap = await q.get()
  let leaves = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  if (req.query.startDate) {
    leaves = leaves.filter((l) => l.startDate >= req.query.startDate)
  }
  if (req.query.endDate) {
    leaves = leaves.filter((l) => l.startDate <= req.query.endDate)
  }

  res.json({ leaves })
}

async function createLeave(req, res) {
  const data = req.body
  if (!data.userEmail) return res.status(400).json({ error: 'userEmail is required' })
  if (!data.type || !['personal', 'medical', 'overtime'].includes(data.type)) {
    return res.status(400).json({ error: 'type must be "personal", "medical" or "overtime"' })
  }
  if (!data.startDate) return res.status(400).json({ error: 'startDate is required' })

  const endDate = data.endDate || data.startDate
  const halfDay = !!data.halfDay
  // Overtime falls on off-days, so countWeekdays would yield 0 — it's a
  // single-day credit (matches the attendance UI), not paid leave.
  const isOvertime = data.type === 'overtime'
  const days = halfDay ? 0.5 : isOvertime ? 1 : countWeekdays(data.startDate, endDate)

  let paidDays = isOvertime ? 0 : days
  let unpaidDays = 0

  if (data.type === 'personal') {
    const member = TEAM_MEMBERS.find((m) => m.email === data.userEmail)
    if (member) {
      const accrued = await accrualForUser(member)
      const existingSnap = await db.collection('leaves')
        .where('userEmail', '==', data.userEmail)
        .where('type', '==', 'personal')
        .where('status', '==', 'approved')
        .get()
      let usedDays = 0
      existingSnap.docs.forEach((d) => {
        const l = d.data()
        usedDays += l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)
      })
      const available = Math.max(0, accrued - usedDays)
      paidDays = Math.min(days, available)
      unpaidDays = days - paidDays
    }
  }

  const leave = {
    userEmail: data.userEmail,
    userName: data.userName || '',
    type: data.type,
    startDate: data.startDate,
    endDate: endDate,
    halfDay,
    days,
    paidDays,
    unpaidDays,
    status: 'approved',
    note: data.note || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: data.createdBy || '',
    cancelledBy: null,
    cancelledAt: null,
  }

  const ref = await db.collection('leaves').add(leave)
  res.status(201).json({ id: ref.id, ...leave })
}

async function cancelLeave(req, res, leaveId) {
  const data = req.body
  const docRef = db.collection('leaves').doc(leaveId)
  const doc = await docRef.get()

  if (!doc.exists) return res.status(404).json({ error: 'Leave not found' })

  await docRef.update({
    status: 'cancelled',
    cancelledBy: data.cancelledBy || '',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  res.json({ id: leaveId, cancelled: true })
}

async function getLeaveBalances(req, res) {
  const members = req.query.userEmail
    ? TEAM_MEMBERS.filter((m) => m.email === req.query.userEmail)
    : TEAM_MEMBERS

  const snap = await db.collection('leaves').where('status', '==', 'approved').get()
  const allLeaves = snap.docs.map((d) => d.data())
  const contractsByEmail = await loadContractsByEmail()

  // Current month string for medical (non-rolling) calculation
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const balances = await Promise.all(members.map(async (member) => {
    const accrued = await accrualForUser(member, contractsByEmail)
    const memberLeaves = allLeaves.filter((l) => l.userEmail === member.email)

    const personalLeaves = memberLeaves.filter((l) => l.type === 'personal')
    const medicalLeaves = memberLeaves.filter((l) => l.type === 'medical')

    const personalUsed = personalLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)

    // Medical: 1 per month, does NOT roll over — only count current month usage
    const medicalUsedThisMonth = medicalLeaves
      .filter((l) => l.startDate.startsWith(currentMonthStr))
      .reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
    const medicalTotalUsed = medicalLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)

    return {
      userEmail: member.email,
      userName: member.name,
      joinDate: earliestStart(member, contractsByEmail.get(member.email)),
      personal: {
        accrued,
        used: personalUsed,
        available: accrued - personalUsed,
      },
      medical: {
        accrued: 1,
        used: medicalUsedThisMonth,
        totalUsed: medicalTotalUsed,
        available: 1 - medicalUsedThisMonth,
      },
    }
  }))

  res.json({ balances })
}
