// Visibility rules for clients & projects across the app's working views.
//
// A client (or project) is shown on task-display surfaces — the by-client and
// by-project boards, and the backlog client tabs — only when it is BOTH:
//   • not archived (a manual flag toggled on the Manage page), and
//   • active, i.e. it has at least one open item (a task whose status !== 'done').
//
// Clients with no open items are "dormant": auto-hidden from those displays but
// still offered in the new-task project picker, so fresh work can revive them.
// Archived clients are hidden everywhere outside the Manage page, always.

export const isOpenItem = (task) => !!task && task.status !== 'done'

// Build sets of clientId / projectId that currently have ≥1 open item.
export function openItemIndex(tasks) {
  const clientIds = new Set()
  const projectIds = new Set()
  for (const t of tasks || []) {
    if (!isOpenItem(t)) continue
    if (t.clientId) clientIds.add(t.clientId)
    if (t.projectId) projectIds.add(t.projectId)
  }
  return { clientIds, projectIds }
}

// Set of ids for archived clients (manual flag).
export function archivedClientIds(clients) {
  return new Set((clients || []).filter((c) => c && c.archived).map((c) => c.id))
}

// Manage-page classification for one client: 'archived' | 'inactive' | 'active'.
// 'inactive' = dormant (no open items); 'archived' takes precedence.
export function clientState(client, openClientIds) {
  if (!client) return 'inactive'
  if (client.archived) return 'archived'
  return openClientIds.has(client.id) ? 'active' : 'inactive'
}

// Clients to show on task-display surfaces (board-by-client, backlog tabs):
// not archived AND has open items. Preserves input order.
export function visibleClients(clients, tasks) {
  const { clientIds } = openItemIndex(tasks)
  return (clients || []).filter((c) => c && !c.archived && clientIds.has(c.id))
}

// Projects to show on the by-project board: project has open items AND its
// client isn't archived. Preserves input order.
export function visibleProjects(projects, clients, tasks) {
  const { projectIds } = openItemIndex(tasks)
  const archived = archivedClientIds(clients)
  return (projects || []).filter((p) => p && projectIds.has(p.id) && !archived.has(p.clientId))
}

// Clients offered in pickers / non-task filters (new-task picker, references
// filter): archived removed, dormant kept. Preserves input order.
export function selectableClients(clients) {
  return (clients || []).filter((c) => c && !c.archived)
}
