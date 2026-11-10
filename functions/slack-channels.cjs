// GET /slackChannels — the Slack channels the bot can see, for the Manage page's
// channel picker. Authenticated with a Firebase ID token (team members only),
// so the browser never holds SLACK_BOT_TOKEN.
//
// Response: { channels: [{ id, name, isPrivate, isMember }] }
//   isMember — whether the bot is in the channel. It can only post task
//   updates to channels it has been invited to.
//
// Needs the bot scopes `channels:read` (public) and `groups:read` (private
// channels it is in). If Slack rejects the call the endpoint returns 502 with
// Slack's error code, and the picker falls back to pasting a channel link/ID.

const CACHE_MS = 5 * 60 * 1000
const MAX_PAGES = 10

module.exports = function install({ admin, onRequest, slackBotToken }) {
  let cache = null // { at, channels }

  async function fetchChannels(token) {
    const channels = []
    let cursor = ''
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '1000',
      })
      if (cursor) params.set('cursor', cursor)
      const resp = await fetch('https://slack.com/api/conversations.list?' + params, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await resp.json()
      if (!body.ok) {
        const err = new Error(body.error || 'slack_error')
        err.slack = true
        throw err
      }
      for (const c of body.channels || []) {
        channels.push({ id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member })
      }
      cursor = body.response_metadata?.next_cursor || ''
      if (!cursor) break
    }
    return channels.sort((a, b) => a.name.localeCompare(b.name))
  }

  const endpoint = onRequest({ secrets: [slackBotToken] }, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

    let claims
    try {
      claims = await admin.auth().verifyIdToken((req.headers.authorization || '').replace(/^Bearer /, ''))
    } catch {
      return res.status(401).json({ error: 'Sign in to list Slack channels' })
    }
    // Same team test as firestore.rules isTeamMember().
    if (!claims.email_verified || !/@publicknowledge\.co$/.test(claims.email || '')) {
      return res.status(403).json({ error: 'Team members only' })
    }

    const token = process.env.SLACK_BOT_TOKEN
    if (!token) return res.status(503).json({ error: 'SLACK_BOT_TOKEN not configured' })

    try {
      if (!cache || Date.now() - cache.at > CACHE_MS || req.query.refresh === '1') {
        cache = { at: Date.now(), channels: await fetchChannels(token) }
      }
      return res.json({ channels: cache.channels })
    } catch (err) {
      console.error('slackChannels failed:', err.message)
      return res.status(502).json({ error: err.slack ? `Slack: ${err.message}` : 'Could not reach Slack' })
    }
  })

  return { endpoint, fetchChannels }
}
