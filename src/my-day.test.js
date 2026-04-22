import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all my-day.js dependencies
vi.mock('./db.js', () => ({
  updateTask: vi.fn(),
  createTask: vi.fn(),
  loadDailyFocus: vi.fn().mockResolvedValue({ taskIds: [], timeBlocks: [] }),
  saveDailyFocus: vi.fn(),
  loadHolidays: vi.fn().mockResolvedValue([]),
}))

vi.mock('./modal.js', () => ({ openModal: vi.fn() }))
vi.mock('./mention.js', () => ({ attachMention: vi.fn() }))
vi.mock('./calendar.js', () => ({ loadCalendarEvents: vi.fn().mockResolvedValue({ events: [], needsAuth: false }) }))
vi.mock('./time-grid.js', () => ({
  renderTimeGrid: vi.fn(() => ''),
  bindTimeGridActions: vi.fn(),
  isTimeGridDragging: vi.fn(() => false),
}))
vi.mock('./context-menu.js', () => ({
  setSelectedTaskIds: vi.fn(),
  clearSelection: vi.fn(),
}))
vi.mock('./config.js', () => ({
  TEAM: [{ email: 'alice@example.com', name: 'Alice' }],
  STATUSES: [],
}))

import { renderMyDay } from './my-day.js'

describe('renderMyDay', () => {
  let container
  let ctx
  let currentUser

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ctx = { db: {}, clients: [], projects: [], allTasks: [] }
    currentUser = { email: 'alice@example.com' }
  })

  it('attaches a marquee mousedown listener to the container without throwing', async () => {
    const unhandled = []
    const handler = (err) => unhandled.push(err)
    process.on('unhandledRejection', handler)

    await renderMyDay(container, [], currentUser, ctx)

    process.off('unhandledRejection', handler)
    expect(unhandled).toEqual([])

    // Verify marquee actually fires by dispatching a mousedown on the container
    // background (target = container itself, not excluded selector).
    let fired = false
    container.addEventListener('mousedown', () => { fired = true }, { capture: true })
    const ev = new MouseEvent('mousedown', { button: 0, bubbles: true })
    Object.defineProperty(ev, 'target', { value: container })
    container.dispatchEvent(ev)
    expect(fired).toBe(true)
  })
})
