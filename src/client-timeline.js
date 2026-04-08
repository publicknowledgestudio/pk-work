import { STATUSES, TEAM } from './config.js'
import { updateTask } from './db.js'
import { openModal } from './modal.js'

/* ── Helpers (shared with client-board) ─────────────────────────── */

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

/* ── Column Generation ──────────────────────────────────────────── */

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function dayId(d) {
  return `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekId(start) {
  return `week-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
}

function formatDayLabel(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getDay()]} ${d.getDate()}`
}

function formatWeekLabel(start, end) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const sMonth = monthNames[start.getMonth()]
  if (start.getMonth() === end.getMonth()) {
    return `${sMonth} ${start.getDate()}\u2013${end.getDate()}`
  }
  const eMonth = monthNames[end.getMonth()]
  return `${sMonth} ${start.getDate()}\u2013${eMonth} ${end.getDate()}`
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function getMondayOfWeek(d) {
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  return addDays(startOfDay(d), diff)
}

function daysInMonth(month, year) {
  return new Date(year, month + 1, 0).getDate()
}

export function generateColumns(month, year) {
  const today = startOfDay(new Date())
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month
  const totalDays = daysInMonth(month, year)
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month, totalDays)

  const columns = []
  let dayColumnsEnd // date after last day column

  if (isCurrentMonth) {
    // Day columns: Monday of current week through end of next week, clamped to month
    const monday = getMondayOfWeek(today)
    const nextWeekEnd = addDays(monday, 13) // 14 days total (0-indexed: day 0 to day 13)
    const start = monday < monthStart ? monthStart : monday
    const end = nextWeekEnd > monthEnd ? monthEnd : nextWeekEnd

    let cur = startOfDay(start)
    while (cur <= end) {
      columns.push({
        id: dayId(cur),
        label: formatDayLabel(cur),
        type: 'day',
        date: new Date(cur),
        isToday: sameDay(cur, today),
      })
      cur = addDays(cur, 1)
    }
    dayColumnsEnd = addDays(end, 1)
  } else {
    // Day columns for first 2 weeks of that month
    const end = Math.min(14, totalDays)
    for (let i = 1; i <= end; i++) {
      const d = new Date(year, month, i)
      columns.push({
        id: dayId(d),
        label: formatDayLabel(d),
        type: 'day',
        date: new Date(d),
        isToday: sameDay(d, today),
      })
    }
    dayColumnsEnd = new Date(year, month, end + 1)
  }

  // Week columns for remaining days in month after day columns
  if (dayColumnsEnd <= monthEnd) {
    // Start from the Monday on or after dayColumnsEnd
    let weekStart = startOfDay(dayColumnsEnd)
    // Align to Monday if not already
    const dow = weekStart.getDay()
    if (dow !== 1) {
      // Go back to this week's Monday (the days before dayColumnsEnd are covered by day cols)
      // Actually, we want to start the first week column from dayColumnsEnd itself
      // and go until the following Sunday, then continue in full weeks
    }

    // Simpler approach: iterate from dayColumnsEnd to monthEnd in week chunks
    let cur = startOfDay(dayColumnsEnd)
    while (cur <= monthEnd) {
      const wStart = new Date(cur)
      const wEnd = new Date(Math.min(addDays(cur, 6).getTime(), monthEnd.getTime()))
      columns.push({
        id: weekId(wStart),
        label: formatWeekLabel(wStart, wEnd),
        type: 'week',
        startDate: new Date(wStart),
        endDate: new Date(wEnd),
        isToday: today >= wStart && today <= wEnd,
      })
      cur = addDays(cur, 7)
    }
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

  // Check day columns first
  for (const col of columns) {
    if (col.type === 'day' && sameDay(d, col.date)) return col.id
    if (col.type === 'week' && d >= col.startDate && d <= col.endDate) return col.id
  }

  // Outside all columns
  return null
}

/* ── Render ──────────────────────────────────────────────────────── */

export function renderClientTimeline(container, tasks, ctx) {
  const clientId = ctx.userClientId
  const clientTasks = tasks.filter((t) => t.clientId === clientId)
  const clientProjects = ctx.projects.filter((p) => p.clientId === clientId)

  const today = new Date()
  let selectedMonth = today.getMonth()
  let selectedYear = today.getFullYear()
  let selectedProjectId = ''

  function render() {
    const filtered = selectedProjectId
      ? clientTasks.filter((t) => t.projectId === selectedProjectId)
      : clientTasks

    const columns = generateColumns(selectedMonth, selectedYear)

    // Bucket tasks into columns
    const buckets = { unscheduled: [] }
    for (const col of columns) buckets[col.id] = []

    for (const task of filtered) {
      const colId = assignTaskToColumn(task, columns)
      if (colId === null) continue // outside month
      if (!buckets[colId]) buckets[colId] = []
      buckets[colId].push(task)
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']

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
          <div class="month-picker">
            <button class="month-picker-btn month-prev" title="Previous month"><i class="ph ph-caret-left"></i></button>
            <button class="month-picker-label month-label">${monthNames[selectedMonth]} ${selectedYear}</button>
            <button class="month-picker-btn month-next" title="Next month"><i class="ph ph-caret-right"></i></button>
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
              <div class="column-tasks" data-col="${col.id}" data-col-type="${col.type}" data-date="${col.type === 'day' ? col.date.toISOString().slice(0, 10) : col.startDate.toISOString().slice(0, 10)}">
                ${(buckets[col.id] || []).map((t) => taskCard(t, ctx)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    // ── Event listeners ──

    // Project filter
    container.querySelectorAll('#timeline-project-filter .segment').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedProjectId = btn.dataset.project
        render()
      })
    })

    // Month navigation
    container.querySelector('.month-prev')?.addEventListener('click', () => {
      selectedMonth--
      if (selectedMonth < 0) { selectedMonth = 11; selectedYear-- }
      render()
    })
    container.querySelector('.month-next')?.addEventListener('click', () => {
      selectedMonth++
      if (selectedMonth > 11) { selectedMonth = 0; selectedYear++ }
      render()
    })
    container.querySelector('.month-label')?.addEventListener('click', () => {
      const now = new Date()
      selectedMonth = now.getMonth()
      selectedYear = now.getFullYear()
      render()
    })

    // Task card clicks
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = clientTasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    // Auto-scroll to today's column
    const todayCol = container.querySelector('.timeline-col-today')
    if (todayCol) {
      todayCol.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }

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
