/**
 * Pure validation for task comments and capture metadata. Asterisk's intake
 * service writes both through the REST API, so bad input must be a 400 here.
 */

const MAX_COMMENT_LENGTH = 10000

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Where a task came from. Returns null when no source was given.
function normalizeSource(source) {
  if (source === undefined || source === null) return null
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('source must be an object')
  }
  const type = cleanString(source.type)
  if (!type) throw new Error('source.type is required')
  return {
    type,
    url: cleanString(source.url),
    channelId: cleanString(source.channelId),
    messageTs: cleanString(source.messageTs),
  }
}

// How Asterisk captured a task. Returns null when not captured.
function normalizeCapture(capture) {
  if (capture === undefined || capture === null) return null
  if (typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('capture must be an object')
  }
  const captureId = cleanString(capture.captureId)
  if (!captureId) throw new Error('capture.captureId is required')
  return { captureId, reasoning: cleanString(capture.reasoning) }
}

const CAPTURE_KINDS = ['request', 'followup', 'chatter', 'unclear']
const CAPTURE_STATUSES = ['dry', 'skipped', 'filing', 'filed', 'failed', 'undone']

// One row of Asterisk's capture feed, mirrored from the intake service.
function normalizeCaptureLog(data) {
  const body = data || {}
  const kind = cleanString(body.kind)
  const status = cleanString(body.status)
  if (!CAPTURE_KINDS.includes(kind)) throw new Error('kind is invalid')
  if (!CAPTURE_STATUSES.includes(status)) throw new Error('status is invalid')
  const channelId = cleanString(body.channelId)
  const messageTs = cleanString(body.messageTs)
  if (!channelId || !messageTs) throw new Error('channelId and messageTs are required')
  return {
    channelId,
    messageTs,
    clientId: cleanString(body.clientId),
    clientName: cleanString(body.clientName),
    text: cleanString(body.text).slice(0, MAX_COMMENT_LENGTH),
    kind,
    status,
    title: cleanString(body.title),
    reasoning: cleanString(body.reasoning),
    taskId: cleanString(body.taskId),
    url: cleanString(body.url),
  }
}

function normalizeComment(data) {
  const body = data || {}
  const text = cleanString(body.text)
  if (!text) throw new Error('text is required')
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new Error(`text must be ${MAX_COMMENT_LENGTH} characters or fewer`)
  }
  const author = cleanString(body.author)
  if (!author) throw new Error('author is required')
  return { text, author, source: normalizeSource(body.source) }
}

// The Slack post for a task Asterisk created.
function asteriskTaskMessage({ title, assignees = [], clientName = '', projectName = '' }) {
  const names = assignees.map((email) => {
    const name = String(email).split('@')[0]
    return name.charAt(0).toUpperCase() + name.slice(1)
  })
  const who = names.length ? ` (for ${names.join(', ')})` : ''
  const prefix = `${clientName}: `
  const task = clientName && title.startsWith(prefix) ? title.slice(prefix.length) : title
  const line = [clientName, projectName, task].filter(Boolean).join(' · ')
  return `New task${who} added to PK Work by Asterisk\n⭕️ ${line}`
}

// The same post with buttons. "Not a task" removes the task, and when Asterisk
// could not tell the project, one button per project asks the team.
function asteriskTaskBlocks({ taskId, text, projects = [] }) {
  const button = (label, actionId) => ({
    type: 'button',
    action_id: actionId,
    value: taskId,
    text: { type: 'plain_text', text: label.slice(0, 75), emoji: true },
  })
  // Titles are user input and land inside mrkdwn.
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = [{ type: 'section', block_id: `task_${taskId}`, text: { type: 'mrkdwn', text: safe } }]
  if (projects.length) {
    blocks.push({ type: 'context', block_id: `ask_${taskId}`, elements: [{ type: 'mrkdwn', text: 'Which project is this for?' }] })
  }
  blocks.push({
    type: 'actions',
    // chat.update finds this row by id to change it after a click.
    block_id: `actions_${taskId}`,
    elements: [
      ...projects.slice(0, 20).map((p) => button(`📁 ${p.name}`, `${PROJECT_ACTION}${p.id}`)),
      button('🚫 Not a task', 'not_a_task'),
    ],
  })
  return blocks
}

// Project buttons carry the project in the action id and the task in the value.
const PROJECT_ACTION = 'project:'

module.exports = { asteriskTaskMessage, asteriskTaskBlocks, PROJECT_ACTION, normalizeSource, normalizeCapture, normalizeCaptureLog, normalizeComment, MAX_COMMENT_LENGTH }
