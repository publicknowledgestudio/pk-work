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

// Team config for leave balance calculations
const TEAM_MEMBERS = [
  { email: 'gyan@publicknowledge.co', name: 'Gyan', role: 'admin', joinDate: '2026-03-01' },
  { email: 'charu@publicknowledge.co', name: 'Charu', role: 'admin', joinDate: '2026-03-01' },
  { email: 'sharang@publicknowledge.co', name: 'Sharang', role: 'member', joinDate: '2026-03-01' },
  { email: 'anandu@publicknowledge.co', name: 'Anandu', role: 'member', joinDate: '2026-03-01' },
  { email: 'mohit@publicknowledge.co', name: 'Mohit', role: 'member', joinDate: '2026-03-16' },
  { email: 'rakesh@publicknowledge.co', name: 'Rakesh', role: 'member', joinDate: '2026-04-01' },
]

const CLAUDE_API_KEY = defineSecret('CLAUDE_API_KEY')
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN')
const OPENCLAW_WEBHOOK_URL = defineSecret('OPENCLAW_WEBHOOK_URL')
const OPENCLAW_WEBHOOK_SECRET = defineSecret('OPENCLAW_WEBHOOK_SECRET')

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

  const assignees = data.assignees || (data.assignee ? [data.assignee] : [])

  const task = {
    title: data.title,
    description: data.description || '',
    clientId: data.clientId || '',
    projectId: data.projectId || '',
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

async function lookupProjectName(projectId) {
  if (!projectId) return ''
  const doc = await db.collection('projects').doc(projectId).get()
  return doc.exists ? (doc.data().name || '') : ''
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
      const [clientUserDoc, clientDoc, projectName] = await Promise.all([
        db.collection('clientUsers').doc(createdBy).get(),
        db.collection('clients').doc(task.clientId).get(),
        lookupProjectName(task.projectId),
      ])
      const client = clientDoc.exists ? clientDoc.data() : null
      if (client?.slackChannelId) {
        const userName = clientUserDoc.exists ? (clientUserDoc.data().name || createdBy.split('@')[0]) : createdBy.split('@')[0]
        const contextLine = [projectName, client.name].filter(Boolean).join(' · ')
        const message = `📋 New task created by external user "${userName}" — ${task.title}\n${contextLine}`
        postToSlackChannel(client.slackChannelId, message)
      }
    }

    // Notify when a task is marked as done — post to client Slack channel
    const justCompleted = task.status === 'done' && before?.status && before.status !== 'done'
    if (justCompleted) {
      const projectName = await lookupProjectName(task.projectId)
      notifyOpenClaw(event.params.taskId, { ...task, projectName, event: 'task_completed' }, 'completed')

      // Post to client's Slack channel via Asty bot token
      if (task.clientId) {
        const clientDoc = await db.collection('clients').doc(task.clientId).get()
        const client = clientDoc.exists ? clientDoc.data() : null
        if (client?.slackChannelId) {
          const completedBy = lookupTeamName(task.updatedBy || afterAssignees[0] || '')
          const projectLine = projectName || client.name || ''
          const message = `✅ ${task.title}\n${projectLine} · Marked done by ${completedBy}`
          postToSlackChannel(client.slackChannelId, message)
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

function postToSlackChannel(channelId, text) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return

  fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: channelId, text }),
  }).catch((err) => console.error('Slack postMessage error:', err))
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
  const snap = await db.collection('projects').orderBy('name').get()
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

function monthsSinceJoin(joinDate) {
  const join = new Date(joinDate + 'T00:00:00')
  const now = new Date()
  // Include the current month (join March 1 → March counts as month 1)
  let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth()) + 1
  return Math.max(0, months)
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
  if (!data.type || !['personal', 'medical'].includes(data.type)) {
    return res.status(400).json({ error: 'type must be "personal" or "medical"' })
  }
  if (!data.startDate) return res.status(400).json({ error: 'startDate is required' })

  const endDate = data.endDate || data.startDate
  const halfDay = !!data.halfDay
  const days = halfDay ? 0.5 : countWeekdays(data.startDate, endDate)

  let paidDays = days
  let unpaidDays = 0

  if (data.type === 'personal') {
    const member = TEAM_MEMBERS.find((m) => m.email === data.userEmail)
    if (member) {
      const accrued = monthsSinceJoin(member.joinDate)
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

  // Current month string for medical (non-rolling) calculation
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const balances = members.map((member) => {
    const accrued = monthsSinceJoin(member.joinDate)
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
      joinDate: member.joinDate,
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
  })

  res.json({ balances })
}
