import { describe, it, expect } from 'vitest'
import { asteriskTaskMessage, asteriskTaskBlocks, normalizeSource, normalizeCapture, normalizeCaptureLog, normalizeComment, MAX_COMMENT_LENGTH } from './task-extras.js'

describe('normalizeSource', () => {
  it('returns null when absent', () => {
    expect(normalizeSource(undefined)).toBeNull()
    expect(normalizeSource(null)).toBeNull()
  })
  it('keeps known fields only', () => {
    expect(normalizeSource({ type: 'slack', url: ' u ', channelId: 'C1', messageTs: '1.2', x: 1 }))
      .toEqual({ type: 'slack', url: 'u', channelId: 'C1', messageTs: '1.2' })
  })
  it('rejects bad input', () => {
    expect(() => normalizeSource('slack')).toThrow('object')
    expect(() => normalizeSource([])).toThrow('object')
    expect(() => normalizeSource({})).toThrow('source.type')
  })
})

describe('normalizeCapture', () => {
  it('returns null when absent', () => expect(normalizeCapture(undefined)).toBeNull())
  it('requires a capture id', () => expect(() => normalizeCapture({})).toThrow('captureId'))
  it('keeps id and reasoning', () => {
    expect(normalizeCapture({ captureId: 'a', reasoning: 'b', y: 1 })).toEqual({ captureId: 'a', reasoning: 'b' })
  })
})

describe('asteriskTaskMessage', () => {
  it('names the person, client, project and task', () => {
    expect(asteriskTaskMessage({ title: 'Absentia Labs: Audit API', assignees: ['gyan@publicknowledge.co'], clientName: 'Absentia Labs', projectName: 'Product' }))
      .toBe('New task (for Gyan) added to PK Work by Asterisk\n⭕️ Absentia Labs · Product · Audit API')
  })
  it('leaves out what it does not have', () => {
    expect(asteriskTaskMessage({ title: 'Audit', clientName: 'Brunk' })).toBe('New task added to PK Work by Asterisk\n⭕️ Brunk · Audit')
  })
})

describe('asteriskTaskBlocks', () => {
  it('offers "Not a task" on every post', () => {
    const blocks = asteriskTaskBlocks({ taskId: 'T1', text: 'New task\n⭕️ Brunk · A <b> & c' })
    expect(blocks.map((b) => b.block_id)).toEqual(['task_T1', 'actions_T1'])
    expect(blocks[0].text.text).toBe('New task\n⭕️ Brunk · A &lt;b&gt; &amp; c')
    expect(blocks[1].elements.map((e) => [e.action_id, e.value])).toEqual([['not_a_task', 'T1']])
  })
  it('asks for the project when it is not known', () => {
    const blocks = asteriskTaskBlocks({ taskId: 'T1', text: 't', projects: [{ id: 'p1', name: 'Brand' }, { id: 'p2', name: 'Website' }] })
    expect(blocks.map((b) => b.block_id)).toEqual(['task_T1', 'ask_T1', 'actions_T1'])
    expect(blocks[2].elements.map((e) => e.action_id)).toEqual(['project:p1', 'project:p2', 'not_a_task'])
    expect(blocks[2].elements[0].text.text).toBe('📁 Brand')
  })
})

describe('normalizeCaptureLog', () => {
  const row = { channelId: 'C1', messageTs: '1.2', kind: 'request', status: 'dry', extra: 1 }
  it('keeps known fields', () => {
    const out = normalizeCaptureLog(row)
    expect(out.kind).toBe('request')
    expect('extra' in out).toBe(false)
  })
  it('rejects bad rows', () => {
    expect(() => normalizeCaptureLog({ ...row, kind: 'x' })).toThrow('kind')
    expect(() => normalizeCaptureLog({ ...row, status: 'x' })).toThrow('status')
    expect(() => normalizeCaptureLog({ ...row, channelId: '' })).toThrow('channelId')
  })
})

describe('normalizeComment', () => {
  it('requires text and author', () => {
    expect(() => normalizeComment({ author: 'a' })).toThrow('text')
    expect(() => normalizeComment({ text: 't' })).toThrow('author')
    expect(() => normalizeComment(undefined)).toThrow('text')
  })
  it('limits length', () => {
    expect(() => normalizeComment({ text: 'x'.repeat(MAX_COMMENT_LENGTH + 1), author: 'a' })).toThrow('characters')
  })
  it('normalizes a comment with a source', () => {
    expect(normalizeComment({ text: ' hi ', author: 'asterisk', source: { type: 'slack' } })).toEqual({
      text: 'hi', author: 'asterisk', source: { type: 'slack', url: '', channelId: '', messageTs: '' },
    })
  })
})
