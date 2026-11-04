import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { resolveBlocks, verifySignature, isFreshSlackWrite } from './pkwork-slack.js'
import { renderProjectMessage } from './digest.js'

const message = {
  projectName: 'Website',
  totalOpen: 2,
  part: 1,
  partCount: 1,
  tasks: [
    { id: 'T1', title: 'Fix nav', status: 'todo', emoji: '⭕️', assignee: 'Rakesh', overdue: false },
    { id: 'T2', title: 'Ship hero', status: 'review', emoji: '🟣', assignee: 'Charu', overdue: false },
  ],
}

describe('resolveBlocks', () => {
  const { blocks } = renderProjectMessage(message)

  it('removes only the clicked task’s buttons', () => {
    const out = resolveBlocks(blocks, 'T1', 'done')
    expect(out.find((b) => b.block_id === 'actions_T1')).toBeUndefined()
    // The other task stays clickable.
    expect(out.find((b) => b.block_id === 'actions_T2')).toBeDefined()
  })

  it('strikes the line and labels it done', () => {
    const out = resolveBlocks(blocks, 'T1', 'done')
    const line = out.find((b) => b.block_id === 'task_T1')
    expect(line.text.text).toMatch(/^~.*~  _done_$/)
    expect(line.text.text).toContain('Fix nav')
  })

  it('leaves the other task’s line untouched', () => {
    const out = resolveBlocks(blocks, 'T1', 'done')
    const other = out.find((b) => b.block_id === 'task_T2')
    expect(other.text.text).toBe('🟣 Ship hero — Charu')
  })

  it('leaves the project header untouched', () => {
    const out = resolveBlocks(blocks, 'T1', 'done')
    expect(out[0].text.text).toBe('*Website*  2 open')
  })

  it('does not strike a "today" click — the task is scheduled, not finished', () => {
    const out = resolveBlocks(blocks, 'T1', "on gyan's day today", { strike: false, emoji: '🟡' })
    const line = out.find((b) => b.block_id === 'task_T1')
    expect(line.text.text).toBe("🟡 Fix nav — Rakesh  _on gyan's day today_")
    expect(line.text.text).not.toContain('~')
  })

  it('keeps the buttons live after "today" so it can still be marked done', () => {
    const out = resolveBlocks(blocks, 'T1', 'later', { strike: false, emoji: '🟡' })
    expect(out.find((b) => b.block_id === 'actions_T1')).toBeDefined()
  })

  it('swaps only the leading status emoji, not one inside the title', () => {
    const { blocks: b2 } = renderProjectMessage({
      ...message,
      tasks: [{ ...message.tasks[0], title: 'Use ⭕️ in the icon set' }],
    })
    const out = resolveBlocks(b2, 'T1', 'x', { strike: false, emoji: '🟡' })
    expect(out.find((b) => b.block_id === 'task_T1').text.text).toBe(
      '🟡 Use ⭕️ in the icon set — Rakesh  _x_'
    )
  })

  it('a repeated "today" click does not stack annotations', () => {
    const opts = { strike: false, emoji: '🟡' }
    const once = resolveBlocks(blocks, 'T1', 'scheduled', opts)
    const twice = resolveBlocks(once, 'T1', 'scheduled', opts)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('is idempotent — a second click changes nothing more', () => {
    const once = resolveBlocks(blocks, 'T1', 'done')
    const twice = resolveBlocks(once, 'T1', 'done')
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('is a no-op for a task id not in the message', () => {
    expect(JSON.stringify(resolveBlocks(blocks, 'NOPE', 'x'))).toBe(JSON.stringify(blocks))
  })
})

describe('verifySignature', () => {
  const secret = 's3cr3t'
  const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D'
  const sign = (ts, sec = secret) =>
    'v0=' + crypto.createHmac('sha256', sec).update(`v0:${ts}:${body}`, 'utf8').digest('hex')
  const now = () => Math.floor(Date.now() / 1000)

  it('accepts a correctly signed, fresh request', () => {
    const ts = String(now())
    expect(verifySignature(body, ts, sign(ts), secret)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const ts = String(now())
    expect(verifySignature(body, ts, sign(ts, 'wrong'), secret)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const ts = String(now())
    expect(verifySignature(body + 'x', ts, sign(ts), secret)).toBe(false)
  })

  it('rejects a replay older than five minutes', () => {
    const ts = String(now() - 301)
    expect(verifySignature(body, ts, sign(ts), secret)).toBe(false)
  })

  it('rejects a missing signature, timestamp or secret', () => {
    const ts = String(now())
    expect(verifySignature(body, ts, null, secret)).toBe(false)
    expect(verifySignature(body, null, sign(ts), secret)).toBe(false)
    expect(verifySignature(body, ts, sign(ts), '')).toBe(false)
  })

  it('rejects a malformed signature without throwing', () => {
    const ts = String(now())
    expect(verifySignature(body, ts, 'v0=zz', secret)).toBe(false)
  })
})

describe('isFreshSlackWrite', () => {
  it('suppresses a click-driven write from moments ago', () => {
    expect(isFreshSlackWrite({ updatedVia: { source: 'pkwork-slack', at: Date.now() } })).toBe(true)
  })

  it('does not suppress a stale marker — a task reopened and re-completed later still notifies', () => {
    expect(
      isFreshSlackWrite({ updatedVia: { source: 'pkwork-slack', at: Date.now() - 120_000 } })
    ).toBe(false)
  })

  it('does not suppress writes from anywhere else', () => {
    expect(isFreshSlackWrite({})).toBe(false)
    expect(isFreshSlackWrite({ updatedVia: { source: 'web', at: Date.now() } })).toBe(false)
    expect(isFreshSlackWrite({ updatedVia: 'pkwork-slack' })).toBe(false)
  })
})
