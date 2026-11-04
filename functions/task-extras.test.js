import { describe, it, expect } from 'vitest'
import { normalizeSource, normalizeCapture, normalizeCaptureLog, normalizeComment, MAX_COMMENT_LENGTH } from './task-extras.js'

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
