/**
 * Client to-do digest — the deterministic replacement for the OpenClaw
 * `client-todo-digest` agent cron.
 *
 * The old version handed an LLM a ~2,500-word prompt describing five GETs, a
 * group-by and a message format. Every step of it was a pure function of the
 * API response, so it is one here instead: `buildDigest` does the whole
 * transform with no I/O and no clock, `renderProjectMessage` turns one group
 * into Block Kit, and `runDigest` is the only part that talks to Firestore and
 * Slack.
 *
 * Message shape (unchanged from what the prompt asked for):
 *
 *   *Website*  3 open
 *   ⭕️ Make the 'We are hiring' ticker clickable on mobile — Rakesh
 *      [✅ Mark as done] [📅 On it today] [📜 Archive to backlog]
 */

// Open = todo + in_progress + review. Never backlog (that is what the Archive
// button writes to), never done.
const OPEN_STATUSES = ['todo', 'in_progress', 'review']

const STATUS_EMOJI = { todo: '⭕️', in_progress: '🟡', review: '🟣' }

// Slack allows 50 blocks per message. A task costs 2 (its line plus its button
// row) and the project header costs 1, so 20 tasks is 41 blocks — comfortably
// under the cap without needing to think about it at post time.
const MAX_TASKS_PER_MESSAGE = 20

const NO_PROJECT = 'No project'

const STATUS_ORDER = { in_progress: 0, review: 1, todo: 2 }

// ── Pure helpers ──────────────────────────────────────────────

// YYYY-MM-DD for an instant as seen in `tz`. en-CA formats as ISO, which makes
// date-only comparison a string compare with no date arithmetic.
function isoDateInTz(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

// Deadlines arrive as Firestore Timestamps from a trigger, ISO strings from the
// API, or Dates from tests.
function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word
}

// "sharang@publicknowledge.co" → "Sharang". A `people` entry wins when we have
// one, so someone whose display name is not their email local-part still reads
// correctly.
function firstName(email, peopleByEmail) {
  if (!email) return ''
  const person = peopleByEmail && peopleByEmail[email.toLowerCase()]
  if (person && person.name) return person.name.trim().split(/\s+/)[0]
  return capitalize(email.split('@')[0].split(/[._-]/)[0])
}

function assigneeLabel(emails, peopleByEmail) {
  const names = (emails || []).map((e) => firstName(e, peopleByEmail)).filter(Boolean)
  if (names.length === 0) return 'unassigned'
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

// Backward compat: tasks may carry `assignee` (string) or `assignees` (array).
function getAssignees(task) {
  if (task.assignees) return task.assignees
  return task.assignee ? [task.assignee] : []
}

function isOverdue(task, todayIso, tz) {
  const deadline = toDate(task.deadline)
  if (!deadline) return false
  return isoDateInTz(deadline, tz) < todayIso
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ── The transform ─────────────────────────────────────────────

/**
 * Group open tasks into one message per project, routed by the client's
 * `slackChannelId`.
 *
 * Pure: no Firestore, no Slack, no `Date.now()`. `now` and `tz` are arguments
 * precisely so "is this overdue" is testable and does not drift with the
 * machine the function happens to run on.
 *
 * Returns:
 *   messages — one per project chunk, in the order they should be posted
 *   orphans  — clients with open tasks but no channel to post them to
 */
function buildDigest({ clients, projects, tasks, peopleByEmail = {}, now, tz = 'Asia/Kolkata' }) {
  const todayIso = isoDateInTz(now, tz)

  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const clientsById = new Map(clients.map((c) => [c.id, c]))

  const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status))

  // clientId → projectKey → tasks. A task's client comes from its own
  // clientId, falling back to its project's — a task tagged only with a
  // project still reaches the right channel.
  const byClient = new Map()
  for (const task of open) {
    const project = task.projectId ? projectsById.get(task.projectId) : null
    const clientId = task.clientId || (project && project.clientId) || null
    if (!clientId) continue // unclaimed by any client — reported separately below

    if (!byClient.has(clientId)) byClient.set(clientId, new Map())
    const byProject = byClient.get(clientId)

    const key = project ? project.id : NO_PROJECT
    if (!byProject.has(key)) {
      byProject.set(key, { name: project ? project.name : NO_PROJECT, tasks: [] })
    }
    byProject.get(key).tasks.push(task)
  }

  const messages = []
  const orphans = []

  // Sort everything by name/title so two runs over the same data produce
  // byte-identical output. This is the property the old version could not hold.
  const clientIds = [...byClient.keys()].sort((a, b) => {
    const an = (clientsById.get(a) || {}).name || ''
    const bn = (clientsById.get(b) || {}).name || ''
    return an.localeCompare(bn)
  })

  for (const clientId of clientIds) {
    const client = clientsById.get(clientId)
    if (!client) continue

    const groups = [...byClient.get(clientId).values()].sort((a, b) => {
      // "No project" always sorts last; real projects sort by name.
      if (a.name === NO_PROJECT) return 1
      if (b.name === NO_PROJECT) return -1
      return a.name.localeCompare(b.name)
    })

    const decorated = groups.map((g) => ({
      projectName: g.name,
      tasks: g.tasks
        .map((t) => ({
          id: t.id,
          title: t.title || '(untitled)',
          status: t.status,
          emoji: STATUS_EMOJI[t.status] || '',
          assignee: assigneeLabel(getAssignees(t), peopleByEmail),
          overdue: isOverdue(t, todayIso, tz),
        }))
        .sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
            a.title.localeCompare(b.title)
        ),
    }))

    // Step 6 of the old prompt: open tasks but nowhere to send them. Never
    // guess a channel.
    if (!client.slackChannelId) {
      orphans.push({
        clientName: client.name,
        tasks: decorated.flatMap((g) => g.tasks),
      })
      continue
    }

    for (const group of decorated) {
      const parts = chunk(group.tasks, MAX_TASKS_PER_MESSAGE)
      parts.forEach((part, i) => {
        messages.push({
          channelId: client.slackChannelId,
          clientName: client.name,
          projectName: group.projectName,
          // The header count is the project total, not the chunk's, so a split
          // project still reports "23 open" on both messages.
          totalOpen: group.tasks.length,
          part: i + 1,
          partCount: parts.length,
          tasks: part,
        })
      })
    }
  }

  return { messages, orphans }
}

// ── Rendering ─────────────────────────────────────────────────

// Slack bold is a SINGLE asterisk. The old prompt had to spend a sentence
// warning the model that `**Website**` renders as literal asterisks; here it
// is just not possible to get wrong.
function renderProjectMessage(message) {
  const suffix = message.partCount > 1 ? ` (${message.part}/${message.partCount})` : ''
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(message.projectName)}*  ${message.totalOpen} open${suffix}`,
      },
    },
  ]

  for (const task of message.tasks) {
    const overdue = task.overdue ? ' ⚠️ overdue' : ''
    blocks.push({
      type: 'section',
      block_id: `task_${task.id}`,
      text: {
        type: 'mrkdwn',
        text: `${task.emoji} ${escapeMrkdwn(task.title)} — ${escapeMrkdwn(task.assignee)}${overdue}`,
      },
    })
    blocks.push({
      type: 'actions',
      // chat.update finds this row by id to strip it after a click.
      block_id: `actions_${task.id}`,
      elements: [
        button('✅ Mark as done', 'done', task.id),
        button('📅 On it today', 'today', task.id),
        button('📜 Archive to backlog', 'backlog', task.id),
      ],
    })
  }

  return {
    blocks,
    // Notification/fallback text for clients that cannot render blocks.
    text: `${message.projectName} — ${message.totalOpen} open`,
  }
}

// The action and the task id travel in separate fields. The old `done_<taskId>`
// convention had to be split back apart on arrival, which a task id containing
// an underscore would have corrupted.
function button(label, actionId, taskId) {
  return {
    type: 'button',
    action_id: actionId,
    value: taskId,
    text: { type: 'plain_text', text: label, emoji: true },
  }
}

// Task titles are user input and land inside mrkdwn. Only the three characters
// Slack treats structurally need escaping.
function escapeMrkdwn(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderOrphanNote(orphans) {
  const lines = orphans.map((o) => {
    const titles = o.tasks.map((t) => t.title).join(', ')
    const n = o.tasks.length
    return `• ${o.clientName} — ${n} open task${n === 1 ? '' : 's'}, no Slack channel: ${titles}`
  })
  return `Open tasks with nowhere to post:\n${lines.join('\n')}`
}

module.exports = {
  buildDigest,
  renderProjectMessage,
  renderOrphanNote,
  isoDateInTz,
  firstName,
  assigneeLabel,
  OPEN_STATUSES,
  STATUS_EMOJI,
  MAX_TASKS_PER_MESSAGE,
  NO_PROJECT,
}
