import { describe, it, expect, vi } from 'vitest'
vi.mock('./db.js', () => ({ subscribeToCaptures: vi.fn(), undoCapture: vi.fn() }))
import { canUndo, splitCaptures } from './asterisk.js'

describe('asterisk captures', () => {
  it('allows undo only for filed tasks', () => {
    expect(canUndo({ status: 'filed', taskId: 't', kind: 'request' })).toBe(true)
    expect(canUndo({ status: 'dry', taskId: 't', kind: 'request' })).toBe(false)
    expect(canUndo({ status: 'filed', taskId: '', kind: 'request' })).toBe(false)
    expect(canUndo({ status: 'filed', taskId: 't', kind: 'followup' })).toBe(false)
  })
  it('separates skipped messages', () => {
    const out = splitCaptures([{ status: 'skipped' }, { status: 'filed' }])
    expect(out.skipped).toHaveLength(1)
    expect(out.captured).toHaveLength(1)
  })
})
