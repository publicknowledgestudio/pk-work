/**
 * PK Work MCP bridge — exposes the PK Work REST API as an MCP server so
 * clients like Poke (poke.com) can use it as a custom integration.
 *
 * Transport: streamable HTTP, stateless (new server per request — required
 * for Cloud Functions, where instances come and go).
 * Auth: callers send `Authorization: Bearer <POKE_MCP_KEY>`; the bridge talks
 * to the REST API internally with CLAUDE_API_KEY. The Firebase secret never
 * leaves the backend.
 *
 * The five tools mirror Asty's openclaw-pkwork plugin (search / status /
 * task_add / task_set / raw), including output formatting, so both assistants
 * behave the same.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { z } = require('zod')

const INSTRUCTIONS = `PK Work is the task management system for Public Knowledge Studio: clients, projects, tasks, standups, and leaves.

Tool choice: use pkwork_status for any "what's pending / what's going on" question (scope = client name, person first-name, or "today"; omit for studio-wide) and show actual task lists, not just counts. Use pkwork_search first whenever something is referenced by name and you need its id. Use pkwork_task_add / pkwork_task_set for changes. pkwork_raw is the escape hatch for anything else, including leaves.

Team emails (for assignee and leaves fields): gyan@, charu@, anandu@, mohit@, rakesh@, ananya@, vyshnav@ — all @publicknowledge.co. Sharang (sharang@) is on leave ~June–July 2026.

Conventions:
- Statuses: backlog, todo, in_progress, review, done. Priorities: low, medium, high, urgent. Deadlines are ISO dates (2026-06-20).
- Names auto-resolve server-side: pass clientName "Brunk" and assignee "charu", not raw ids.
- Only create tasks on explicit action language; multi-item requests = one pkwork_task_add call per item, then report each result.
- Report only what tools actually returned; if a call fails, say which item failed. Never claim success you did not observe.
- Leaves and overtime via pkwork_raw: POST /leaves with { userEmail, type ("personal" | "medical" | "overtime"), startDate, endDate?, halfDay?, note?, createdBy }. "Worked Saturday" or "+0.5 working day" = overtime, usually halfDay: true. Balances: GET /leaves/balances. List: GET /leaves?userEmail=.
- If nothing fits an ask, say so plainly rather than improvising.`

const STATUS_EMOJI = {
  backlog: '⚪️',
  todo: '⭕️',
  in_progress: '🟡',
  review: '🟣',
  done: '✅',
}

function text(s) {
  return { content: [{ type: 'text', text: s }] }
}

function errorText(s) {
  return { content: [{ type: 'text', text: s }], isError: true }
}

// === Rendering (ported from Asty's plugin so output matches) ===

function renderStatus(data) {
  const c = data.counts
  const channelSuffix = data.slackChannelId ? ` (slack: ${data.slackChannelId})` : ''
  const head = `${data.label}${channelSuffix} — ${c.active} active (🟡 ${c.in_progress} · 🟣 ${c.review} · ⭕️ ${c.todo})`

  const sections = []

  if (data.activeClients && data.activeClients.length) {
    const lines = data.activeClients.map((ac) => {
      const counts = []
      if (ac.in_progress) counts.push(`🟡 ${ac.in_progress}`)
      if (ac.review) counts.push(`🟣 ${ac.review}`)
      if (ac.todo) counts.push(`⭕️ ${ac.todo}`)
      const ch = ac.slackChannelId ? ` [${ac.slackChannelId}]` : ' [no channel]'
      return `- ${ac.name || ac.clientId}${ch} — ${counts.join(' · ')}`
    })
    sections.push(`Active clients (${data.activeClients.length}):\n${lines.join('\n')}`)
  }

  const renderRow = (t) => {
    const who = (t.assignees || []).map((a) => a.split('@')[0]).join(',')
    const dl = t.deadline ? ` ⌛${t.deadline}` : ''
    const cl = t.client && data.kind !== 'client' ? ` [${t.client}]` : ''
    return `${STATUS_EMOJI[t.status] || ''} ${t.title}${cl} — ${who}${dl}`
  }

  if (data.in_progress.length) sections.push('In progress:\n' + data.in_progress.map(renderRow).join('\n'))
  if (data.review.length) sections.push('Review:\n' + data.review.map(renderRow).join('\n'))
  if (data.todo.length && data.todo.length <= 15) sections.push('Todo:\n' + data.todo.map(renderRow).join('\n'))
  else if (data.todo.length)
    sections.push(
      `Todo: ${data.todo.length} items total — per-client counts are listed above. Re-run pkwork_status scoped to a client or person to get their full todo list.`
    )

  return sections.length ? `${head}\n\n${sections.join('\n\n')}` : head
}

function renderSearchHit(h) {
  if (h.type === 'client') {
    const ch = h.slackChannelId ? ` (slack: ${h.slackChannelId})` : ''
    return `- client: ${h.name}${ch} [id: ${h.id}]`
  }
  if (h.type === 'project') {
    return `- project: ${h.name} (client: ${h.clientId}) [id: ${h.id}]`
  }
  if (h.type === 'person') {
    const role = h.role ? `, ${h.role}` : ''
    return `- person: ${h.name}${role} <${h.email}> [id: ${h.id}]`
  }
  const a = (h.assignees || []).join(', ')
  return `- task: ${h.title} (${h.status}${a ? `, ${a}` : ''}) [id: ${h.id}]`
}

// === Server ===

function buildServer({ apiBase, internalApiKey }) {
  async function api(method, path, body) {
    const resp = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'x-api-key': internalApiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const raw = await resp.text()
    let parsed = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      /* non-JSON body — surface raw text below */
    }
    if (!resp.ok) {
      throw new Error(`PK Work API ${method} ${path} failed (${resp.status}): ${raw}`)
    }
    return parsed
  }

  const server = new McpServer(
    { name: 'pk-work', title: 'PK Work', version: '1.0.0' },
    { instructions: INSTRUCTIONS }
  )

  server.registerTool(
    'pkwork_search',
    {
      title: 'PK Work: Search',
      description:
        'Free-text search across clients, projects, people, and tasks. Use this first whenever the user mentions something by name and you need its id. Substring match, case-insensitive.',
      inputSchema: {
        q: z.string().describe('Search query, for example: brunk, charu, radial flowers.'),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ q, limit }) => {
      try {
        const params = new URLSearchParams({ q })
        if (limit) params.set('limit', String(limit))
        const result = await api('GET', `/search?${params.toString()}`)
        if (!result.results.length) return text(`No results for "${q}".`)
        return text(`${result.results.length} result(s) for "${q}":\n${result.results.map(renderSearchHit).join('\n')}`)
      } catch (err) {
        return errorText(err.message)
      }
    }
  )

  server.registerTool(
    'pkwork_status',
    {
      title: 'PK Work: Status digest',
      description:
        'Digest of active work for a scope, including the actual task lists. Pass a person first-name (e.g. charu), a client name (e.g. brunk), today, or omit for studio-wide. The default for any "what is going on / what is pending" question.',
      inputSchema: {
        scope: z.string().optional().describe('Person first-name, client name, or today. Omit for studio-wide.'),
      },
    },
    async ({ scope }) => {
      try {
        const qs = scope ? `?scope=${encodeURIComponent(scope)}` : ''
        const data = await api('GET', `/status${qs}`)
        return text(renderStatus(data))
      } catch (err) {
        return errorText(err.message)
      }
    }
  )

  server.registerTool(
    'pkwork_task_add',
    {
      title: 'PK Work: Add task',
      description:
        'Create a task. Pass title plus optional names (clientName, projectName, assignee) — names are auto-resolved server-side, so prefer them over raw ids. Only call when the user has clearly committed to action.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        clientName: z.string().optional().describe('Client name, e.g. Brunk.'),
        projectName: z.string().optional().describe('Project name within the client.'),
        assignee: z.string().optional().describe('Assignee name or email. charu resolves to charu@publicknowledge.co.'),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        deadline: z.string().optional().describe('ISO date like 2026-05-20.'),
      },
    },
    async (args) => {
      try {
        const result = await api('POST', '/tasks', { ...args, createdBy: 'poke' })
        const who = (result.assignees || []).map((a) => a.split('@')[0]).join(',') || 'unassigned'
        return text(`✅ Created "${result.title}" — ${who}, ${result.status}, ${result.priority} [id: ${result.id}]`)
      } catch (err) {
        return errorText(err.message)
      }
    }
  )

  server.registerTool(
    'pkwork_task_set',
    {
      title: 'PK Work: Update or delete a task',
      description:
        'Modify one task by id. Use for status changes, reassignment, deadline shifts, title or description edits, or deletion. Set change.delete=true to delete. Need a taskId — use pkwork_search to find it if the user referenced the task by name.',
      inputSchema: {
        taskId: z.string(),
        change: z.object({
          status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          assignee: z.string().optional().describe('Name or email; name is auto-resolved.'),
          priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
          deadline: z.string().optional().describe('ISO date, or empty string to clear.'),
          clientName: z.string().optional(),
          projectName: z.string().optional(),
          delete: z.boolean().optional().describe('Set true to delete this task.'),
        }),
      },
    },
    async ({ taskId, change }) => {
      try {
        if (change.delete) {
          await api('DELETE', `/tasks/${taskId}`)
          return text(`🗑️ Deleted task ${taskId}`)
        }
        const patch = { ...change }
        delete patch.delete
        await api('PATCH', `/tasks/${taskId}`, patch)
        const fields = Object.keys(patch).join(', ')
        return text(`✏️ Updated ${taskId} (${fields || 'no fields'})`)
      } catch (err) {
        return errorText(err.message)
      }
    }
  )

  server.registerTool(
    'pkwork_raw',
    {
      title: 'PK Work: Raw API call',
      description:
        'Escape hatch for direct PK Work REST API calls (e.g. /leaves, /leaves/balances, /standups, /clients, /projects, /references). Prefer search, status, task_add, task_set first. Path is relative to the API root and starts with /.',
      inputSchema: {
        method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']),
        path: z.string().describe('Path starting with /, e.g. /leaves/balances.'),
        body: z.record(z.string(), z.any()).optional(),
      },
    },
    async ({ method, path, body }) => {
      try {
        const result = await api(method, path, body)
        return text(`${method} ${path}\n${JSON.stringify(result, null, 2)}`)
      } catch (err) {
        return errorText(err.message)
      }
    }
  )

  return server
}

/**
 * Returns an onRequest-compatible handler. Secrets are read lazily (inside
 * the request) because defineSecret values only resolve at runtime.
 */
function createMcpHandler({ getInternalApiKey, getPokeKey, apiBase }) {
  return async (req, res) => {
    // Bearer auth — constant-shape comparison, reject before any MCP work.
    const auth = req.headers.authorization || ''
    const expected = `Bearer ${getPokeKey()}`
    if (!getPokeKey() || auth !== expected) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token' },
        id: null,
      })
      return
    }

    // Stateless streamable HTTP: only POST carries JSON-RPC in this mode.
    if (req.method !== 'POST') {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This MCP server is stateless — use POST.' },
        id: null,
      })
      return
    }

    const server = buildServer({ apiBase, internalApiKey: getInternalApiKey() })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }
}

module.exports = { createMcpHandler }
