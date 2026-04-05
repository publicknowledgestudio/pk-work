import { STATUSES, TEAM } from './config.js'
import { createTask, updateTask } from './db.js'
import { openModal } from './modal.js'
import { attachMention } from './mention.js'

export function renderClientBoard(container, tasks, ctx) {
  const clientId = ctx.userClientId
  const clientTasks = tasks.filter((t) => t.clientId === clientId)

  // Project filter for client's projects only
  const clientProjects = ctx.projects.filter((p) => p.clientId === clientId)
  let selectedProjectId = ''

  function render() {
    const filtered = selectedProjectId
      ? clientTasks.filter((t) => t.projectId === selectedProjectId)
      : clientTasks

    container.innerHTML = `
      <div class="client-board-view">
        ${clientProjects.length > 1 ? `
          <div class="client-board-header">
            <div class="segmented-control" id="client-project-filter">
              <button class="segment${!selectedProjectId ? ' active' : ''}" data-project="">All Projects</button>
              ${clientProjects.map((p) => `<button class="segment${p.id === selectedProjectId ? ' active' : ''}" data-project="${p.id}">${esc(p.name)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="board">
          ${STATUSES.filter((s) => s.id !== 'backlog').map((s) => `
            <div class="column" data-status="${s.id}">
              <div class="column-header">
                <span class="column-dot" style="background:${s.color}"></span>
                <span class="column-label">${s.label}</span>
                <span class="column-count">${filtered.filter((t) => t.status === s.id).length}</span>
              </div>
              <div class="column-tasks" data-status="${s.id}">
                ${filtered.filter((t) => t.status === s.id)
                  .map((t) => taskCard(t, ctx))
                  .join('')}
              </div>
              <div class="column-add-wrap" data-status="${s.id}">
                <input class="column-add-input" data-status="${s.id}" placeholder="+ Add task (@ to tag)" type="text">
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    // Project filter (segmented control)
    container.querySelectorAll('#client-project-filter .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedProjectId = btn.dataset.project
        render()
      })
    })

    // Task card clicks
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = clientTasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    // Inline add-task with mention support
    container.querySelectorAll('.column-add-input').forEach((input) => {
      const mention = attachMention(input, { projects: clientProjects, clients: ctx.clients })
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !mention.isOpen()) {
          const title = input.value.trim()
          if (!title) return
          const mentionTags = mention.getTags()
          input.disabled = true
          await createTask(ctx.db, {
            title,
            status: input.dataset.status,
            assignees: mentionTags.assignees,
            clientId,
            projectId: mentionTags.projectId || selectedProjectId || '',
            createdBy: ctx.currentUser?.email || '',
          })
          input.value = ''
          input.disabled = false
          mention.reset()
          input.focus()
        }
        if (e.key === 'Escape' && !mention.isOpen()) {
          input.value = ''
          input.blur()
        }
      })
    })

    // Drag and drop
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id)
        e.dataTransfer.effectAllowed = 'move'
        card.classList.add('dragging')
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging')
        container.querySelectorAll('.column-tasks').forEach((col) => col.classList.remove('drag-over'))
      })
    })

    container.querySelectorAll('.column-tasks').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        col.classList.add('drag-over')
      })
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
      col.addEventListener('drop', async (e) => {
        e.preventDefault()
        col.classList.remove('drag-over')
        const taskId = e.dataTransfer.getData('text/plain')
        const newStatus = col.dataset.status
        if (taskId && newStatus) {
          await updateTask(ctx.db, taskId, { status: newStatus })
        }
      })
    })
  }

  render()
}

function taskCard(task, ctx) {
  const project = task.projectId ? ctx.projects.find((p) => p.id === task.projectId) : null
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const isDone = task.status === 'done'

  const deadlineStr = formatDeadline(task.deadline)
  const isOverdue = task.deadline && !isDone && toDate(task.deadline) < new Date()

  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}" title="${esc(client.name)}">`
    : ''

  return `
    <div class="task-card${isDone ? ' done' : ''}" data-id="${task.id}" draggable="true">
      <div class="task-card-header">
        ${statusIcon(task.status)}
        ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
        <span class="task-card-title">${esc(task.title)}</span>
      </div>
      <div class="task-card-meta">
        <div class="task-card-tags">
          ${clientLogo}
          ${client ? `<span class="task-tag">${esc(client.name)}</span>` : ''}
          ${project ? `<span class="task-tag">${esc(project.name)}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${deadlineStr ? `<span class="task-card-deadline${isOverdue ? ' overdue' : ''}">${deadlineStr}</span>` : ''}
          ${avatarStack(task.assignees)}
        </div>
      </div>
    </div>
  `
}

function statusIcon(status) {
  switch (status) {
    case 'done':
      return '<button class="status-btn" data-action="cycle-status" title="Done — click to cycle"><i class="ph-fill ph-check-circle status-icon done"></i></button>'
    case 'todo':
      return '<button class="status-btn" data-action="cycle-status" title="To Do — click to start"><i class="ph ph-circle status-icon todo"></i></button>'
    case 'in_progress':
      return '<button class="status-btn" data-action="cycle-status" title="In Progress — click to advance"><i class="ph-fill ph-circle-half status-icon in-progress"></i></button>'
    case 'review':
      return '<button class="status-btn" data-action="cycle-status" title="Review — click to complete"><i class="ph-fill ph-caret-circle-double-right status-icon review"></i></button>'
    default:
      return '<i class="ph-fill ph-prohibit status-icon backlog"></i>'
  }
}

function avatarStack(assignees) {
  if (!assignees || assignees.length === 0) return ''
  const members = assignees.map((email) => TEAM.find((m) => m.email === email)).filter(Boolean)
  if (members.length === 0) return ''
  return `<div class="avatar-stack">${members.map((m) =>
    m.photoURL
      ? `<img class="avatar-photo-xs" src="${m.photoURL}" alt="${m.name}" title="${m.name}">`
      : `<span class="avatar-xs" style="background:${m.color}" title="${m.name}">${m.name[0]}</span>`
  ).join('')}</div>`
}

function formatDeadline(deadline) {
  if (!deadline) return ''
  const d = toDate(deadline)
  const now = new Date()
  const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < -1) return `${Math.abs(diff)}d ago`
  if (diff <= 7) return `${diff}d`
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
