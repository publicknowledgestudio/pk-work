import { STATUSES, TEAM } from './config.js'
import { updateTask } from './db.js'
import { openModal } from './modal.js'
import { toDate, formatDeadline, toLocalISODate } from './utils/dates.js'

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

function statusIcon(status) {
  switch (status) {
    case 'done':
      return '<button class="status-btn" data-action="cycle-status" title="Done"><i class="ph-fill ph-check-circle status-icon done"></i></button>'
    case 'todo':
      return '<button class="status-btn" data-action="cycle-status" title="To Do"><i class="ph ph-circle status-icon todo"></i></button>'
    case 'in_progress':
      return '<button class="status-btn" data-action="cycle-status" title="In Progress"><i class="ph-fill ph-circle-half status-icon in-progress"></i></button>'
    case 'review':
      return '<button class="status-btn" data-action="cycle-status" title="Review"><i class="ph-fill ph-caret-circle-double-right status-icon review"></i></button>'
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

export function taskCard(task, ctx) {
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

/* ── Column Generation ──────────────────────────────────────────── */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function dayId(d) {
  return `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDayLabel(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getDay()]} ${d.getDate()}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function getMondayOfWeek(d) {
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  return addDays(startOfDay(d), diff)
}

export function formatWeekRange(start, end) {
  const sMonth = MONTHS_SHORT[start.getMonth()]
  const eMonth = MONTHS_SHORT[end.getMonth()]
  if (start.getFullYear() !== end.getFullYear()) {
    return `${sMonth} ${start.getDate()}, ${start.getFullYear()} – ${eMonth} ${end.getDate()}, ${end.getFullYear()}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}, ${start.getFullYear()}`
  }
  return `${sMonth} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`
}

export function generateColumns(weekStart) {
  const today = startOfDay(new Date())
  const start = startOfDay(weekStart)
  const columns = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    columns.push({
      id: dayId(d),
      label: formatDayLabel(d),
      type: 'day',
      date: d,
      isToday: sameDay(d, today),
    })
  }
  return columns
}

/* ── Task → Column Assignment ───────────────────────────────────── */

export function assignTaskToColumn(task, columns) {
  const isDone = task.status === 'done'
  const rawDate = isDone ? (task.closedAt || task.deadline) : task.deadline
  if (!rawDate) return 'unscheduled'

  const d = startOfDay(toDate(rawDate))
  if (!d || isNaN(d.getTime())) return 'unscheduled'

  for (const col of columns) {
    if (sameDay(d, col.date)) return col.id
  }

  return null
}

/* ── Render ──────────────────────────────────────────────────────── */

export function renderClientTimeline(container, tasks, ctx) {
  const clientId = ctx.userClientId
  const clientTasks = tasks.filter((t) => t.clientId === clientId)
  const clientProjects = ctx.projects.filter((p) => p.clientId === clientId)

  let weekStart = getMondayOfWeek(new Date())
  let selectedProjectId = ''

  function render() {
    const filtered = selectedProjectId
      ? clientTasks.filter((t) => t.projectId === selectedProjectId)
      : clientTasks

    const columns = generateColumns(weekStart)
    const weekEnd = addDays(weekStart, 6)

    const buckets = { unscheduled: [] }
    for (const col of columns) buckets[col.id] = []

    for (const task of filtered) {
      const colId = assignTaskToColumn(task, columns)
      if (colId === null) continue
      if (!buckets[colId]) buckets[colId] = []
      buckets[colId].push(task)
    }

    container.innerHTML = `
      <div class="timeline-view">
        ${clientProjects.length > 1 ? `
          <div class="client-board-header">
            <div class="segmented-control" id="timeline-project-filter">
              <button class="segment${!selectedProjectId ? ' active' : ''}" data-project="">All Projects</button>
              ${clientProjects.map((p) => `<button class="segment${p.id === selectedProjectId ? ' active' : ''}" data-project="${p.id}">${esc(p.name)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="timeline-header">
          <div class="week-picker">
            <button class="week-picker-btn week-prev" title="Previous week"><i class="ph ph-caret-left"></i></button>
            <button class="week-picker-label week-label">${formatWeekRange(weekStart, weekEnd)}</button>
            <button class="week-picker-btn week-next" title="Next week"><i class="ph ph-caret-right"></i></button>
          </div>
        </div>
        <div class="timeline-board">
          <div class="timeline-col timeline-col-unscheduled">
            <div class="column-header">
              <span class="column-dot" style="background:var(--text-tertiary)"></span>
              <span class="column-label">Unscheduled</span>
              <span class="column-count">${buckets.unscheduled.length}</span>
            </div>
            <div class="column-tasks" data-col="unscheduled">
              ${buckets.unscheduled.map((t) => taskCard(t, ctx)).join('')}
            </div>
          </div>
          ${columns.map((col) => `
            <div class="timeline-col${col.isToday ? ' timeline-col-today' : ''}">
              <div class="column-header">
                <span class="column-label">${col.label}</span>
                <span class="column-count">${(buckets[col.id] || []).length}</span>
              </div>
              <div class="column-tasks" data-col="${col.id}" data-date="${toLocalISODate(col.date)}">
                ${(buckets[col.id] || []).map((t) => taskCard(t, ctx)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    // ── Event listeners ──

    container.querySelectorAll('#timeline-project-filter .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedProjectId = btn.dataset.project
        render()
      })
    })

    container.querySelector('.week-prev')?.addEventListener('click', () => {
      weekStart = addDays(weekStart, -7)
      render()
    })
    container.querySelector('.week-next')?.addEventListener('click', () => {
      weekStart = addDays(weekStart, 7)
      render()
    })
    container.querySelector('.week-label')?.addEventListener('click', () => {
      weekStart = getMondayOfWeek(new Date())
      render()
    })

    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = clientTasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    // Drag and drop — scheduling
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
        if (!taskId) return

        const colId = col.dataset.col
        if (colId === 'unscheduled') {
          await updateTask(ctx.db, taskId, { deadline: null })
        } else {
          const dateStr = col.dataset.date
          if (dateStr) {
            await updateTask(ctx.db, taskId, { deadline: dateStr })
          }
        }
      })
    })
  }

  render()
}
