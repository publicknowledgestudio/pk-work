import { describe, it, expect } from 'vitest'
import {
  buildDigest,
  renderProjectMessage,
  renderOrphanNote,
  assigneeLabel,
  isoDateInTz,
} from './digest.js'

const TZ = 'Asia/Kolkata'
// 2026-09-12 11:00 UTC = 2026-09-12 16:30 IST
const NOW = new Date('2026-09-12T11:00:00Z')

const clients = [
  { id: 'c1', name: 'Brunk', slackChannelId: 'C0A3XG7F55J' },
  { id: 'c2', name: 'Alpha', slackChannelId: 'CALPHA' },
  { id: 'c3', name: 'Neels AI', slackChannelId: '' },
]
const projects = [
  { id: 'p1', name: 'Website', clientId: 'c1' },
  { id: 'p2', name: 'Brand', clientId: 'c1' },
  { id: 'p3', name: 'App', clientId: 'c2' },
]

const task = (over) => ({
  id: 'x',
  title: 'T',
  status: 'todo',
  clientId: 'c1',
  projectId: 'p1',
  assignees: [],
  ...over,
})

describe('buildDigest', () => {
  it('includes only open statuses, never backlog or done', () => {
    const tasks = [
      task({ id: 'a', status: 'todo' }),
      task({ id: 'b', status: 'in_progress' }),
      task({ id: 'c', status: 'review' }),
      task({ id: 'd', status: 'backlog' }),
      task({ id: 'e', status: 'done' }),
    ]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    const ids = messages.flatMap((m) => m.tasks.map((t) => t.id))
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('sends one message per project, never combining two', () => {
    const tasks = [
      task({ id: 'a', projectId: 'p1' }),
      task({ id: 'b', projectId: 'p2' }),
    ]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.projectName).sort()).toEqual(['Brand', 'Website'])
    // Both go to the same client channel.
    expect(new Set(messages.map((m) => m.channelId))).toEqual(new Set(['C0A3XG7F55J']))
  })

  it('groups project-less tasks under "No project", sorted last', () => {
    const tasks = [
      task({ id: 'a', projectId: null }),
      task({ id: 'b', projectId: 'p1' }),
    ]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages.map((m) => m.projectName)).toEqual(['Website', 'No project'])
  })

  it('routes by the client slackChannelId, not by any hardcoded map', () => {
    const tasks = [task({ id: 'a', clientId: 'c2', projectId: 'p3' })]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages[0].channelId).toBe('CALPHA')
  })

  it('falls back to the project’s client when the task has no clientId', () => {
    const tasks = [task({ id: 'a', clientId: null, projectId: 'p3' })]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages[0].channelId).toBe('CALPHA')
  })

  it('reports clients with open tasks but no channel as orphans, never guessing', () => {
    const tasks = [task({ id: 'a', clientId: 'c3', projectId: null, title: 'neels ai invoice' })]
    const { messages, orphans } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages).toHaveLength(0)
    expect(orphans).toEqual([
      { clientName: 'Neels AI', tasks: [expect.objectContaining({ title: 'neels ai invoice' })] },
    ])
  })

  it('skips clients with no open tasks silently', () => {
    const tasks = [task({ id: 'a', status: 'done' })]
    const { messages, orphans } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages).toEqual([])
    expect(orphans).toEqual([])
  })

  it('splits a project over 20 tasks, keeping the project total in each header', () => {
    const tasks = Array.from({ length: 23 }, (_, i) =>
      task({ id: `t${String(i).padStart(2, '0')}`, title: `Task ${String(i).padStart(2, '0')}` })
    )
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages).toHaveLength(2)
    expect(messages[0].tasks).toHaveLength(20)
    expect(messages[1].tasks).toHaveLength(3)
    expect(messages.map((m) => m.totalOpen)).toEqual([23, 23])
    // Every chunk stays under Slack's 50-block cap.
    for (const m of messages) {
      expect(renderProjectMessage(m).blocks.length).toBeLessThanOrEqual(50)
    }
  })

  it('is stable: the same input twice produces identical output', () => {
    const tasks = [
      task({ id: 'b', title: 'Beta', projectId: 'p2' }),
      task({ id: 'a', title: 'Alpha', projectId: 'p1' }),
      task({ id: 'c', title: 'Gamma', clientId: 'c2', projectId: 'p3' }),
    ]
    const one = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    const two = buildDigest({ clients, projects, tasks: [...tasks].reverse(), now: NOW, tz: TZ })
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('orders clients by name, then projects by name', () => {
    const tasks = [
      task({ id: 'a', clientId: 'c2', projectId: 'p3' }),
      task({ id: 'b', clientId: 'c1', projectId: 'p1' }),
      task({ id: 'c', clientId: 'c1', projectId: 'p2' }),
    ]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages.map((m) => `${m.clientName}/${m.projectName}`)).toEqual([
      'Alpha/App',
      'Brunk/Brand',
      'Brunk/Website',
    ])
  })

  it('orders tasks in_progress, then review, then todo', () => {
    const tasks = [
      task({ id: 'a', status: 'todo', title: 'A' }),
      task({ id: 'b', status: 'review', title: 'B' }),
      task({ id: 'c', status: 'in_progress', title: 'C' }),
    ]
    const { messages } = buildDigest({ clients, projects, tasks, now: NOW, tz: TZ })
    expect(messages[0].tasks.map((t) => t.status)).toEqual(['in_progress', 'review', 'todo'])
  })
})

describe('overdue', () => {
  const run = (deadline) =>
    buildDigest({
      clients,
      projects,
      tasks: [task({ id: 'a', deadline })],
      now: NOW,
      tz: TZ,
    }).messages[0].tasks[0].overdue

  it('flags a deadline before today', () => {
    expect(run('2026-09-11T00:00:00Z')).toBe(true)
  })

  it('does not flag a deadline of today', () => {
    expect(run('2026-09-12T05:00:00Z')).toBe(false)
  })

  it('does not flag a future deadline', () => {
    expect(run('2026-09-20T00:00:00Z')).toBe(false)
  })

  it('does not flag a missing deadline', () => {
    expect(run(null)).toBe(false)
  })

  it('judges "today" in Asia/Kolkata, not UTC', () => {
    // 2026-09-12T19:00Z is already 2026-09-13 in IST, so a deadline dated
    // 2026-09-12 is overdue there while still being "today" in UTC.
    const late = new Date('2026-09-12T19:00:00Z')
    const { messages } = buildDigest({
      clients,
      projects,
      tasks: [task({ id: 'a', deadline: '2026-09-12T05:00:00Z' })],
      now: late,
      tz: TZ,
    })
    expect(messages[0].tasks[0].overdue).toBe(true)
    expect(isoDateInTz(late, TZ)).toBe('2026-09-13')
  })

  it('accepts a Firestore Timestamp', () => {
    expect(run({ toDate: () => new Date('2026-09-01T00:00:00Z') })).toBe(true)
  })
})

describe('assigneeLabel', () => {
  it('capitalizes the email local part', () => {
    expect(assigneeLabel(['sharang@publicknowledge.co'], {})).toBe('Sharang')
  })

  it('joins two names with "and"', () => {
    expect(assigneeLabel(['charu@publicknowledge.co', 'anandu@publicknowledge.co'], {})).toBe(
      'Charu and Anandu'
    )
  })

  it('joins three with commas and a final "and"', () => {
    expect(assigneeLabel(['a@x.co', 'b@x.co', 'c@x.co'], {})).toBe('A, B and C')
  })

  it('says unassigned for none', () => {
    expect(assigneeLabel([], {})).toBe('unassigned')
  })

  it('prefers a people record over the email local part', () => {
    expect(
      assigneeLabel(['rk@publicknowledge.co'], { 'rk@publicknowledge.co': { name: 'Rakesh Kumar' } })
    ).toBe('Rakesh')
  })
})

describe('renderProjectMessage', () => {
  const message = {
    projectName: 'Website',
    totalOpen: 1,
    part: 1,
    partCount: 1,
    tasks: [{ id: 'T1', title: 'Fix nav', status: 'todo', emoji: '⭕️', assignee: 'Rakesh', overdue: false }],
  }

  it('uses single-asterisk bold for the project name', () => {
    const { blocks } = renderProjectMessage(message)
    expect(blocks[0].text.text).toBe('*Website*  1 open')
    expect(blocks[0].text.text).not.toContain('**')
  })

  it('emits two blocks per task: the line and its buttons', () => {
    const { blocks } = renderProjectMessage(message)
    expect(blocks).toHaveLength(3)
    expect(blocks[1].block_id).toBe('task_T1')
    expect(blocks[2].block_id).toBe('actions_T1')
  })

  it('carries the action and the task id in separate fields', () => {
    const { blocks } = renderProjectMessage(message)
    expect(blocks[2].elements.map((e) => [e.action_id, e.value])).toEqual([
      ['done', 'T1'],
      ['today', 'T1'],
      ['backlog', 'T1'],
    ])
  })

  it('survives a task id containing an underscore', () => {
    const { blocks } = renderProjectMessage({
      ...message,
      tasks: [{ ...message.tasks[0], id: 'a_b_c' }],
    })
    expect(blocks[2].elements[0].value).toBe('a_b_c')
  })

  it('marks overdue tasks', () => {
    const { blocks } = renderProjectMessage({
      ...message,
      tasks: [{ ...message.tasks[0], overdue: true }],
    })
    expect(blocks[1].text.text).toContain('⚠️ overdue')
  })

  it('escapes mrkdwn-structural characters in titles', () => {
    const { blocks } = renderProjectMessage({
      ...message,
      tasks: [{ ...message.tasks[0], title: '<script> & "co"' }],
    })
    expect(blocks[1].text.text).toContain('&lt;script&gt; &amp; "co"')
  })

  it('shows a part counter only when split', () => {
    expect(renderProjectMessage(message).blocks[0].text.text).not.toContain('/')
    expect(
      renderProjectMessage({ ...message, part: 2, partCount: 3 }).blocks[0].text.text
    ).toContain('(2/3)')
  })
})

describe('renderOrphanNote', () => {
  it('names the client, the count and the titles', () => {
    const note = renderOrphanNote([
      { clientName: 'Neels AI', tasks: [{ title: 'neels ai invoice' }] },
    ])
    expect(note).toContain('Neels AI')
    expect(note).toContain('1 open task,')
    expect(note).toContain('neels ai invoice')
  })

  it('pluralizes correctly', () => {
    const note = renderOrphanNote([{ clientName: 'X', tasks: [{ title: 'a' }, { title: 'b' }] }])
    expect(note).toContain('2 open tasks')
  })
})
