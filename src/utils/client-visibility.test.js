import { describe, it, expect } from 'vitest'
import {
  isOpenItem,
  openItemIndex,
  archivedClientIds,
  clientState,
  visibleClients,
  visibleProjects,
  selectableClients,
} from './client-visibility.js'

const clients = [
  { id: 'active', name: 'Active Co' },
  { id: 'dormant', name: 'Dormant Co' },
  { id: 'archived', name: 'Archived Co', archived: true },
]

// 'archived' deliberately still has an open task — manual archive must win
// over the open-items rule.
const tasks = [
  { id: 't1', clientId: 'active', projectId: 'p1', status: 'in_progress' },
  { id: 't2', clientId: 'active', projectId: 'p1', status: 'done' },
  { id: 't3', clientId: 'dormant', projectId: 'p2', status: 'done' },
  { id: 't4', clientId: 'archived', projectId: 'p3', status: 'todo' },
  { id: 't5', clientId: '', projectId: '', status: 'todo' },
]

describe('isOpenItem', () => {
  it('treats every non-done status as open', () => {
    for (const s of ['backlog', 'todo', 'in_progress', 'review']) {
      expect(isOpenItem({ status: s })).toBe(true)
    }
    expect(isOpenItem({ status: 'done' })).toBe(false)
    expect(isOpenItem(null)).toBe(false)
  })
})

describe('openItemIndex', () => {
  it('indexes only clients/projects with an open task', () => {
    const { clientIds, projectIds } = openItemIndex(tasks)
    expect(clientIds.has('active')).toBe(true)
    expect(clientIds.has('archived')).toBe(true) // open task exists; archive handled elsewhere
    expect(clientIds.has('dormant')).toBe(false) // only a done task
    expect(projectIds.has('p1')).toBe(true)
    expect(projectIds.has('p2')).toBe(false)
  })

  it('ignores blank client/project ids', () => {
    const { clientIds, projectIds } = openItemIndex(tasks)
    expect(clientIds.has('')).toBe(false)
    expect(projectIds.has('')).toBe(false)
  })

  it('tolerates empty/undefined input', () => {
    expect(openItemIndex().clientIds.size).toBe(0)
    expect(openItemIndex([]).projectIds.size).toBe(0)
  })
})

describe('clientState', () => {
  const open = openItemIndex(tasks).clientIds
  it('marks archived clients archived even with open items', () => {
    expect(clientState(clients[2], open)).toBe('archived')
  })
  it('marks clients with open items active', () => {
    expect(clientState(clients[0], open)).toBe('active')
  })
  it('marks clients without open items inactive', () => {
    expect(clientState(clients[1], open)).toBe('inactive')
  })
})

describe('visibleClients', () => {
  it('keeps only non-archived clients that have open items', () => {
    const result = visibleClients(clients, tasks).map((c) => c.id)
    expect(result).toEqual(['active'])
  })
})

describe('visibleProjects', () => {
  it('keeps projects with open items whose client is not archived', () => {
    const projects = [
      { id: 'p1', clientId: 'active' },
      { id: 'p2', clientId: 'dormant' }, // only done tasks → hidden
      { id: 'p3', clientId: 'archived' }, // open task but archived client → hidden
    ]
    expect(visibleProjects(projects, clients, tasks).map((p) => p.id)).toEqual(['p1'])
  })
})

describe('selectableClients', () => {
  it('drops archived but keeps dormant clients', () => {
    expect(selectableClients(clients).map((c) => c.id)).toEqual(['active', 'dormant'])
  })
})

describe('archivedClientIds', () => {
  it('collects ids of archived clients', () => {
    expect([...archivedClientIds(clients)]).toEqual(['archived'])
  })
})
