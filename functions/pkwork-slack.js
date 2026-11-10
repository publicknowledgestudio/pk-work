/**
 * PK Work Slack app — the scheduled client to-do digest and the button clicks
 * that come back from it.
 *
 * This replaces the OpenClaw `client-todo-digest` agent cron and the
 * `SOUL.md` button contract that resolved its clicks. Both halves are now
 * ordinary code: same data, same message, same semantics, no model in the loop.
 *
 * It is a separate Slack app from Asty on purpose. Slack routes interactivity
 * app-wide — with Socket Mode on, every payload for an app goes to the socket —
 * so deterministic button handling needs its own app with its own Request URL.
 * Asty keeps Socket Mode and keeps talking.
 */

const { onRequest } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const crypto = require('crypto')

const {
  buildDigest,
  renderProjectMessage,
  renderOrphanNote,
  isoDateInTz,
} = require('./digest')
const { applySchedule } = require('./schedule-core')
const { PROJECT_ACTION } = require('./task-extras')

const PKWORK_SLACK_BOT_TOKEN = defineSecret('PKWORK_SLACK_BOT_TOKEN')
const PKWORK_SLACK_SIGNING_SECRET = defineSecret('PKWORK_SLACK_SIGNING_SECRET')
// Reused from the existing API so the dry-run endpoint needs no new credential.
const CLAUDE_API_KEY = defineSecret('CLAUDE_API_KEY')

const TZ = 'Asia/Kolkata'
const TELL_ASTY_CHANNEL = 'C0AFL81644D'

// Marks writes that came from a digest button, so `onTaskWritten` can skip its
// own "✅ <title>" post — the click already updates the digest message in
// place, and two notifications for one click is noise.
//
// The marker carries a timestamp and is only honoured for a minute. Without
// that, a task later reopened and re-completed from the web app would still
// carry a stale marker and get silently swallowed.
const SLACK_SOURCE = 'pkwork-slack'
const SLACK_SOURCE_TTL_MS = 60_000

function slackSourceMark() {
  return { source: SLACK_SOURCE, at: Date.now() }
}

const db = () => admin.firestore()

// ── Slack ─────────────────────────────────────────────────────

// Slack returns HTTP 200 for API-level failures, so the body is the only real
// signal. Every caller here checks `ok`.
async function slackApi(method, params, token) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  })
  return res.json()
}

function verifySignature(rawBody, timestamp, signature, secret) {
  if (!timestamp || !signature || !secret) return false
  // Reject replays outside Slack's five-minute window.
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10)) > 300) return false

  const computed =
    'v0=' +
    crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`, 'utf8').digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

// ── The digest ────────────────────────────────────────────────

async function readAll() {
  const [clientsSnap, projectsSnap, tasksSnap, peopleSnap] = await Promise.all([
    db().collection('clients').get(),
    db().collection('projects').get(),
    // One read of the whole collection beats three status queries and keeps the
    // open-set definition in `buildDigest` where it is tested.
    db().collection('tasks').get(),
    db().collection('people').get(),
  ])

  const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  const peopleByEmail = {}
  for (const p of docs(peopleSnap)) {
    if (p.email) peopleByEmail[p.email.toLowerCase()] = p
  }

  return {
    clients: docs(clientsSnap),
    projects: docs(projectsSnap),
    tasks: docs(tasksSnap),
    peopleByEmail,
  }
}

/**
 * Delete the previous run's digest messages.
 *
 * We delete by recorded `ts` rather than by scanning channel history for
 * something that looks like a digest: recording what you posted is exact,
 * where pattern-matching it back out is a guess. It also drops the need for
 * `channels:history` / `groups:history` scopes entirely.
 */
async function prunePrevious(token) {
  const snap = await db().collection('digestMessages').get()
  let deleted = 0
  const failures = []

  for (const doc of snap.docs) {
    const { channel, ts } = doc.data()
    const res = await slackApi('chat.delete', { channel, ts }, token)
    // `message_not_found` means someone already removed it — the record is
    // stale either way, so drop it.
    if (res.ok || res.error === 'message_not_found') {
      deleted += 1
    } else {
      failures.push(`${channel}: ${res.error}`)
    }
    await doc.ref.delete()
  }

  return { deleted, failures }
}

async function runDigest({ token, now = new Date(), dryRunChannel = null }) {
  const { clients, projects, tasks, peopleByEmail } = await readAll()
  const { messages, orphans } = buildDigest({
    clients,
    projects,
    tasks,
    peopleByEmail,
    now,
    tz: TZ,
  })

  if (dryRunChannel) {
    const only = messages.filter((m) => m.channelId === dryRunChannel)
    return {
      dryRun: true,
      channel: dryRunChannel,
      date: isoDateInTz(now, TZ),
      messages: only.map((m) => ({ ...m, rendered: renderProjectMessage(m) })),
      orphans,
    }
  }

  const pruned = await prunePreviousSafe(token)

  const posted = []
  const failures = []

  for (const message of messages) {
    const { blocks, text } = renderProjectMessage(message)
    const res = await slackApi(
      'chat.postMessage', { channel: message.channelId, blocks, text }, token)

    if (res.ok) {
      posted.push({ channel: message.channelId, ts: res.ts })
      // Recorded so tomorrow's run can delete exactly this message.
      await db().collection('digestMessages').add({
        channel: message.channelId,
        ts: res.ts,
        clientName: message.clientName,
        projectName: message.projectName,
        postedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } else {
      failures.push(`${message.clientName} (${message.channelId}): ${res.error}`)
    }
  }

  // Step 6 of the old prompt: clients with open tasks but nowhere to post them.
  // One note, and only when there is something to say — never an all-clear.
  const notes = []
  if (orphans.length > 0) notes.push(renderOrphanNote(orphans))
  // A failure used to be invisible: cron delivery was `none`, and a depleted
  // model credit stopped the whole agent silently. Now it is reported.
  if (failures.length > 0) {
    notes.push(`Digest could not post to ${failures.length} channel(s):\n${failures.join('\n')}`)
  }
  if (pruned.failures.length > 0) {
    notes.push(`Could not delete ${pruned.failures.length} old digest message(s):\n${pruned.failures.join('\n')}`)
  }
  if (notes.length > 0) {
    // This is the channel that reports every other failure, so a failure HERE
    // must not be swallowed — that would put the reporting path in exactly the
    // silent state this whole change was meant to remove.
    const noteRes = await slackApi(
      'chat.postMessage', { channel: TELL_ASTY_CHANNEL, text: notes.join('\n\n') }, token)
    if (!noteRes.ok) {
      console.error('could not post digest notes to tell-asty:', noteRes.error, '\n', notes.join('\n\n'))
      failures.push(`tell-asty note: ${noteRes.error}`)
    }
  }

  return { posted: posted.length, failures, pruned: pruned.deleted, orphans: orphans.length }
}

// Pruning must never stop the digest from posting: an empty channel is worse
// than a duplicated one.
async function prunePreviousSafe(token) {
  try {
    return await prunePrevious(token)
  } catch (err) {
    console.error('prune failed, continuing to post:', err)
    return { deleted: 0, failures: [`prune threw: ${err.message}`] }
  }
}

// ── Button clicks ─────────────────────────────────────────────

async function resolveClicker(slackUserId, token) {
  const res = await slackApi('users.info', { user: slackUserId }, token)
  if (!res.ok) {
    console.error('users.info failed:', res.error, 'user:', slackUserId)
    return { email: null, name: 'someone' }
  }
  const profile = res.user.profile || {}
  return {
    email: (profile.email || '').toLowerCase() || null,
    name: (profile.display_name || res.user.real_name || res.user.name || 'someone').split(' ')[0],
  }
}

/**
 * Apply one button. Returns the past-tense phrase to show on the task line.
 *
 * Idempotent by construction: setting an already-done task to done, or
 * re-scheduling onto the same day, changes nothing. A double-click is a no-op
 * rather than two agent turns.
 */
async function applyAction({ actionId, taskId, clicker, resolveAssignees, now }) {
  const ref = db().collection('tasks').doc(taskId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, label: `could not find that task (${taskId})` }

  const stamp = admin.firestore.FieldValue.serverTimestamp()
  const actor = clicker.email || ''

  if (actionId === 'done') {
    await ref.update({
      status: 'done',
      closedAt: stamp,
      updatedAt: stamp,
      updatedBy: actor,
      updatedVia: slackSourceMark(),
    })
    return { ok: true, label: 'done', strike: true }
  }

  if (actionId === 'backlog') {
    await ref.update({
      status: 'backlog',
      closedAt: null,
      updatedAt: stamp,
      updatedBy: actor,
      updatedVia: slackSourceMark(),
    })
    return { ok: true, label: 'archived to backlog', strike: true }
  }

  if (actionId === 'today') {
    // "On it today" schedules; it does not set a deadline. It lands on the
    // assignee's day even when someone else clicked — the clicker is used only
    // when the task is unassigned, and then they claim it.
    const date = isoDateInTz(now, TZ)
    const result = await applySchedule({
      db: db(),
      admin,
      resolveAssignees,
      taskId,
      date,
      userEmail: clicker.email || undefined,
    })
    if (!result.ok) return { ok: false, label: `could not schedule: ${result.error}` }
    const owner = result.userEmail.split('@')[0]
    return {
      ok: true,
      label: result.claimed
        ? `on ${clicker.name}'s day today`
        : `on ${owner}'s day today`,
      // Still open — scheduled, not finished.
      strike: false,
      emoji: '🟡',
    }
  }

  // On the post for a task Asterisk added: it was not a task after all. The
  // task goes, and its capture is marked undone, as Undo does in the app.
  if (actionId === 'not_a_task') {
    const task = snap.data()
    if (task.createdBy !== 'asterisk') {
      return { ok: false, label: 'only tasks Asterisk added can be removed here' }
    }
    const batch = db().batch()
    batch.delete(ref)
    const captureId = task.capture && task.capture.captureId
    const captureRef = captureId && db().collection('captures').doc(captureId)
    if (captureRef && (await captureRef.get()).exists) {
      batch.update(captureRef, { status: 'undone', undoneBy: actor, updatedAt: stamp })
    }
    await batch.commit()
    return { ok: true, label: `not a task, removed by ${clicker.name}`, strike: true }
  }

  // On the same post, when Asterisk could not tell the project.
  if (actionId.startsWith(PROJECT_ACTION)) {
    const projectSnap = await db().collection('projects').doc(actionId.slice(PROJECT_ACTION.length)).get()
    if (!projectSnap.exists || projectSnap.data().clientId !== snap.data().clientId) {
      return { ok: false, label: 'that project does not belong to this client' }
    }
    await ref.update({
      projectId: projectSnap.id,
      updatedAt: stamp,
      updatedBy: actor,
      updatedVia: slackSourceMark(),
    })
    return {
      ok: true,
      label: `filed under ${projectSnap.data().name} by ${clicker.name}`,
      strike: false,
      // The question is answered; "Not a task" stays.
      dropActions: (id) => id.startsWith(PROJECT_ACTION),
    }
  }

  return { ok: false, label: `unknown action: ${actionId}` }
}

const STATUS_EMOJI_RE = /^(⭕️|🟡|🟣)/

/**
 * Rewrite the digest message in place and note who acted. Other tasks in the
 * same message keep working.
 *
 * How a task line changes depends on what the click did:
 *   done / backlog — the task leaves the open list, so strike it through and
 *     drop its buttons; there is nothing left to do to it here.
 *   today — the task is still open, just scheduled. Striking it through would
 *     read as finished, so instead swap its status emoji to 🟡 and keep the
 *     buttons live, so it can still be marked done from the same message.
 */
function resolveBlocks(blocks, taskId, label, { strike = true, emoji = null, dropActions = null } = {}) {
  return blocks
    .filter((b) => !(strike && b.block_id === `actions_${taskId}`))
    // A question about the task is settled by any click that ends or answers it.
    .filter((b) => !((strike || dropActions) && b.block_id === `ask_${taskId}`))
    .map((b) => {
      if (dropActions && b.block_id === `actions_${taskId}`) {
        return { ...b, elements: b.elements.filter((e) => !dropActions(e.action_id)) }
      }
      if (b.block_id !== `task_${taskId}`) return b

      let text = b.text.text
      // Already resolved — a retried chat.update must not stack annotations.
      if (text.startsWith('~') || text.endsWith(`_${label}_`)) return b

      if (emoji) text = text.replace(STATUS_EMOJI_RE, emoji)
      // Slack ends a strike at a line break, so each line gets its own.
      const struck = () => text.split('\n').map((line) => `~${line}~`).join('\n')
      text = strike ? `${struck()}  _${label}_` : `${text}  _${label}_`

      return { ...b, text: { type: 'mrkdwn', text } }
    })
}

function createInteractivityHandler({ resolveAssignees }) {
  return onRequest(
    { secrets: [PKWORK_SLACK_BOT_TOKEN, PKWORK_SLACK_SIGNING_SECRET] },
    async (req, res) => {
      if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

      const rawBody = req.rawBody ? req.rawBody.toString() : ''
      if (
        !verifySignature(
          rawBody,
          req.headers['x-slack-request-timestamp'],
          req.headers['x-slack-signature'],
          process.env.PKWORK_SLACK_SIGNING_SECRET
        )
      ) {
        return res.status(401).send('Invalid signature')
      }

      let payload
      try {
        payload = JSON.parse(req.body.payload)
      } catch (err) {
        console.error('Unparseable interactivity payload:', err)
        return res.status(200).send('')
      }
      if (payload.type !== 'block_actions' || !payload.actions?.length) {
        return res.status(200).send('')
      }

      const token = process.env.PKWORK_SLACK_BOT_TOKEN
      const action = payload.actions[0]
      const taskId = action.value

      // Slack asks for an ack within 3s and this work takes well under that
      // warm. It must NOT be moved after the response: on Cloud Functions gen 2
      // the instance is frozen once the response is sent, which silently killed
      // the chat.update half of this handler.
      try {
        const clicker = await resolveClicker(payload.user.id, token)
        console.log('click', {
          action: action.action_id,
          taskId,
          user: payload.user.id,
          email: clicker.email,
        })
        const result = await applyAction({
          actionId: action.action_id,
          taskId,
          clicker,
          resolveAssignees,
          now: new Date(),
        })

        // Even a failure updates the message — silence after a click reads as
        // a broken button.
        await slackApi(
          'chat.update',
          {
            channel: payload.channel.id,
            ts: payload.message.ts,
            blocks: result.ok
              ? resolveBlocks(payload.message.blocks, taskId, result.label, {
                  strike: result.strike,
                  emoji: result.emoji,
                  dropActions: result.dropActions,
                })
              : payload.message.blocks,
            text: payload.message.text || 'PK Work',
          },
          token
        )

        console.log('click applied', { taskId, ok: result.ok, label: result.label })

        if (!result.ok && payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response_type: 'ephemeral', text: `⚠️ ${result.label}` }),
          })
        }
      } catch (err) {
        console.error('Interactivity handler failed:', err)
        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'ephemeral',
              text: `⚠️ That didn't go through: ${err.message}`,
            }),
          })
        }
      }

      // Always 200, even on failure — a non-2xx makes Slack retry the click,
      // and a retried write is worse than a reported one.
      return res.status(200).send('')
    }
  )
}

function createDigestSchedule() {
  return onSchedule(
    {
      schedule: '10 10 * * 1-5',
      timeZone: TZ,
      secrets: [PKWORK_SLACK_BOT_TOKEN],
      // The old agent run took 7 minutes; this is five reads and a few posts.
      timeoutSeconds: 300,
      memory: '256MiB',
    },
    async () => {
      const result = await runDigest({ token: process.env.PKWORK_SLACK_BOT_TOKEN })
      console.log('client-todo-digest:', JSON.stringify(result))
    }
  )
}

// Renders (and optionally posts) a single channel's digest on demand, so the
// output can be checked against one client before the schedule is enabled.
function createDigestDryRun() {
  return onRequest(
    { secrets: [PKWORK_SLACK_BOT_TOKEN, CLAUDE_API_KEY] },
    async (req, res) => {
      if (req.headers['x-api-key'] !== process.env.CLAUDE_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      const channel = req.query.channel
      if (!channel) return res.status(400).json({ error: 'channel query param required' })

      const result = await runDigest({
        token: process.env.PKWORK_SLACK_BOT_TOKEN,
        dryRunChannel: channel,
      })
      return res.json(result)
    }
  )
}

// True when this write came from a digest button moments ago.
function isFreshSlackWrite(task) {
  const mark = task && task.updatedVia
  if (!mark || mark.source !== SLACK_SOURCE || typeof mark.at !== 'number') return false
  return Date.now() - mark.at < SLACK_SOURCE_TTL_MS
}

module.exports = {
  isFreshSlackWrite,
  createInteractivityHandler,
  createDigestSchedule,
  createDigestDryRun,
  runDigest,
  resolveBlocks,
  verifySignature,
  SLACK_SOURCE,
}
