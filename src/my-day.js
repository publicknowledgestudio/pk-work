import { TEAM, STATUSES } from './config.js'
import { updateTask, createTask, loadDailyFocus, saveDailyFocus } from './db.js'
import { openModal } from './modal.js'
import { attachMention } from './mention.js'
import { loadCalendarEvents } from './calendar.js'
import { renderTimeGrid, bindTimeGridActions, isTimeGridDragging } from './time-grid.js'

let focusTaskIds = []
let timeBlocks = []
let tomorrowTaskIds = []
let todayStr = ''
let tomorrowStr = ''
let viewingEmail = '' // email of the person whose day we're viewing

export async function renderMyDay(container, tasks, currentUser, ctx) {
  const myEmail = currentUser?.email
  if (!viewingEmail) viewingEmail = myEmail
  const isOwnDay = viewingEmail === myEmail
  const targetEmail = viewingEmail

  const now = new Date()
  todayStr = now.toISOString().split('T')[0]
  const tomorrowDate = new Date(now)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  tomorrowStr = tomorrowDate.toISOString().split('T')[0]
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Load daily focus for today and tomorrow
  const focusData = await loadDailyFocus(ctx.db, targetEmail, todayStr)
  focusTaskIds = focusData.taskIds
  timeBlocks = focusData.timeBlocks
  const tomorrowData = await loadDailyFocus(ctx.db, targetEmail, tomorrowStr)
  tomorrowTaskIds = tomorrowData.taskIds

  // Filter out stale IDs (tasks that no longer exist) — keep done tasks so they persist on the calendar
  const validFocusIds = focusTaskIds.filter((id) => {
    const t = tasks.find((task) => task.id === id)
    return !!t
  })
  if (validFocusIds.length !== focusTaskIds.length && isOwnDay) {
    focusTaskIds = validFocusIds
    // Also clean time blocks for removed tasks
    const focusSet = new Set(focusTaskIds)
    timeBlocks = timeBlocks.filter((b) => focusSet.has(b.taskId))
    saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
  }

  const focusTasks = (isOwnDay ? validFocusIds : focusTaskIds)
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean)

  // Filter stale tomorrow IDs — remove done tasks from tomorrow (already completed)
  const validTomorrowIds = tomorrowTaskIds.filter((id) => {
    const t = tasks.find((task) => task.id === id)
    return t && t.status !== 'done'
  })
  if (validTomorrowIds.length !== tomorrowTaskIds.length && isOwnDay) {
    tomorrowTaskIds = validTomorrowIds
    saveDailyFocus(ctx.db, targetEmail, tomorrowStr, tomorrowTaskIds)
  }
  const tomorrowTasks = (isOwnDay ? validTomorrowIds : tomorrowTaskIds)
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean)

  // Up Next: active tasks not in focus or tomorrow for viewed user
  const focusSet = new Set(focusTaskIds)
  const tomorrowSet = new Set(tomorrowTaskIds)
  const upNext = tasks
    .filter((t) =>
      (t.assignees || []).includes(targetEmail) &&
      t.status !== 'done' &&
      t.status !== 'backlog' &&
      !focusSet.has(t.id) &&
      !tomorrowSet.has(t.id)
    )
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))

  // Completed today for viewed user
  const completedToday = tasks.filter((t) => {
    if (t.status !== 'done' || !t.closedAt) return false
    if (!(t.assignees || []).includes(targetEmail)) return false
    const closed = toDate(t.closedAt)
    return closed >= todayStart
  })

  // Load calendar events (only for own day)
  let calendarEvents = []
  let calendarNeedsAuth = false
  if (isOwnDay) {
    const cal = await loadCalendarEvents(todayStr)
    calendarEvents = cal.events
    calendarNeedsAuth = cal.needsAuth
  }

  const viewingMember = TEAM.find((m) => m.email === targetEmail)
  const viewingName = viewingMember?.name || currentUser?.displayName || ''

  const greetingText = isOwnDay
    ? `${greeting()}, ${esc(viewingName.split(' ')[0])}`
    : `${esc(viewingName.split(' ')[0])}'s Day`

  // Split events
  const allDayEvents = calendarEvents.filter((e) => e.allDay)
  const timedEvents = calendarEvents.filter((e) => !e.allDay)
  const scheduledCount = timeBlocks.length

  container.innerHTML = `
    <div class="my-day">
      <div class="my-day-header">
        <div>
          <div class="my-day-greeting-row">
            <h2 class="my-day-greeting">${greetingText}</h2>
            <button class="myday-person-toggle" id="myday-person-toggle" title="View another person's day">
              <i class="ph-fill ph-caret-down"></i>
            </button>
          </div>
          <p class="my-day-date">${formatDate(now)}</p>
        </div>
        <div class="my-day-stats">
          <span class="my-day-stat"><i class="ph-fill ph-target"></i> ${focusTasks.length} planned</span>
          <span class="my-day-stat"><i class="ph-fill ph-check-circle"></i> ${completedToday.length} done today</span>
        </div>
      </div>

      <!-- Time-Block Calendar -->
      <div class="my-day-section">
        <div class="my-day-section-header">
          <i class="ph-fill ph-sun" style="color:#f59e0b"></i>
          <span>My Day</span>
          ${scheduledCount > 0 ? `<span class="my-day-count">${scheduledCount} scheduled</span>` : ''}
        </div>
        ${renderTimeGrid({
          timeBlocks,
          focusTasks,
          calendarEvents: timedEvents,
          allDayEvents,
          calendarNeedsAuth,
          isOwnDay,
          ctx,
          now,
        })}
      </div>

      <!-- Up Next Section -->
      <div class="my-day-section">
        <div class="my-day-section-header">
          <i class="ph-fill ph-queue" style="color:#3b82f6"></i>
          <span>Up Next</span>
          <span class="my-day-count">${upNext.length}</span>
        </div>
        <div class="my-day-upnext-list" data-drop="upnext">
          ${upNext.length > 0 ? upNext.map((t) => upNextCard(t, ctx, now, isOwnDay)).join('') : `
            <div class="my-day-empty">
              <i class="ph ph-check" style="font-size:24px;opacity:0.3"></i>
              <span>${isOwnDay ? "No active tasks — you're all caught up" : 'No active tasks'}</span>
            </div>
          `}
        </div>
      </div>

      <!-- Tomorrow Section -->
      <div class="my-day-section">
        <div class="my-day-section-header">
          <i class="ph-fill ph-calendar-plus" style="color:#6366f1"></i>
          <span>Tomorrow</span>
          <span class="my-day-count">${tomorrowTasks.length}</span>
        </div>
        <div class="my-day-tomorrow-list" data-drop="tomorrow">
          ${tomorrowTasks.length > 0 ? tomorrowTasks.map((t) => tomorrowCard(t, ctx, now, isOwnDay)).join('') : `
            <div class="my-day-empty">
              <i class="ph ph-calendar-blank" style="font-size:24px;opacity:0.3"></i>
              <span>${isOwnDay ? 'Plan ahead — drag or add tasks for tomorrow' : 'Nothing planned for tomorrow'}</span>
            </div>
          `}
        </div>
      </div>

      <!-- Completed Today -->
      ${completedToday.length > 0 ? `
        <div class="my-day-section">
          <div class="my-day-section-header">
            <i class="ph-fill ph-check-circle" style="color:#22c55e"></i>
            <span>Completed Today</span>
            <span class="my-day-count">${completedToday.length}</span>
          </div>
          <div class="my-day-completed-list">
            ${completedToday.map((t) => completedCard(t, ctx, now)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="myday-add-spacer"></div>
    </div>

    <div class="myday-add-bar">
      <div class="myday-add-wrap">
        <input class="myday-add-input" id="myday-add-input" placeholder="+ Add task (@ to tag)" type="text">
      </div>
    </div>
  `

  bindMyDayActions(container, tasks, currentUser, ctx, now, isOwnDay)
}

// ── Card renderers ──

function upNextCard(task, ctx, now, isOwnDay) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''
  const deadlineHtml = deadlineTag(task, now)

  return `
    <div class="my-day-card upnext" data-id="${task.id}" draggable="${isOwnDay}">
      <div class="my-day-card-main">
        ${statusIcon(task.status)}
        ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
        ${clientLogo}
        ${project ? `<span class="my-day-project">${esc(project.name)}</span>` : ''}
        <span class="my-day-card-title">${esc(task.title)}</span>
        <div class="my-day-card-meta">
          ${deadlineHtml}
        </div>
      </div>
      ${isOwnDay ? `
      <div class="my-day-card-actions">
        <button class="my-day-action-btn add-focus" data-action="focus" data-id="${task.id}" title="Add to today's focus">
          <i class="ph ph-plus-circle"></i>
        </button>
      </div>
      ` : ''}
    </div>
  `
}

function tomorrowCard(task, ctx, now, isOwnDay) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''
  const status = STATUSES.find((s) => s.id === task.status)
  const deadlineHtml = deadlineTag(task, now)

  return `
    <div class="my-day-card tomorrow" data-id="${task.id}" draggable="${isOwnDay}">
      <div class="my-day-card-main">
        ${statusIcon(task.status)}
        ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
        ${clientLogo}
        ${project ? `<span class="my-day-project">${esc(project.name)}</span>` : ''}
        <span class="my-day-card-title">${esc(task.title)}</span>
        <div class="my-day-card-meta">
          ${status ? `<span class="task-tag" style="color:${status.color}">${status.label}</span>` : ''}
          ${deadlineHtml}
        </div>
      </div>
      ${isOwnDay ? `
      <div class="my-day-card-actions">
        <button class="my-day-action-btn" data-action="move-to-today" data-id="${task.id}" title="Move to today">
          <i class="ph ph-arrow-fat-up"></i>
        </button>
        <button class="my-day-action-btn" data-action="remove-tomorrow" data-id="${task.id}" title="Remove from tomorrow">
          <i class="ph ph-x"></i>
        </button>
      </div>
      ` : ''}
    </div>
  `
}

function completedCard(task, ctx, now) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''
  const closedDate = toDate(task.closedAt)
  const timeAgo = closedDate ? relativeTime(closedDate, now) : ''

  return `
    <div class="my-day-card completed" data-id="${task.id}">
      <div class="my-day-card-main">
        <button class="status-btn" data-action="cycle-status" title="Done — click to reopen"><i class="ph-fill ph-check-circle status-icon done"></i></button>
        ${clientLogo}
        ${project ? `<span class="my-day-project">${esc(project.name)}</span>` : ''}
        <span class="my-day-card-title">${esc(task.title)}</span>
        <div class="my-day-card-meta">
          ${timeAgo ? `<span class="my-day-time-ago">${timeAgo}</span>` : ''}
        </div>
      </div>
    </div>
  `
}

// ── Actions ──

function bindMyDayActions(container, tasks, currentUser, ctx, now, isOwnDay) {
  const myEmail = currentUser?.email
  const targetEmail = viewingEmail || myEmail

  // Person picker popover
  const toggleBtn = container.querySelector('#myday-person-toggle')
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      openPersonPicker(container, tasks, currentUser, ctx, targetEmail, myEmail)
    })
  }

  // Connect Calendar button
  const calConnectBtn = container.querySelector('#cal-connect-btn')
  if (calConnectBtn) {
    calConnectBtn.addEventListener('click', async () => {
      calConnectBtn.disabled = true
      calConnectBtn.textContent = 'Connecting...'
      const ok = await ctx.reconnectCalendar()
      if (ok) renderMyDay(container, tasks, currentUser, ctx)
    })
  }

  // Time grid interactions
  bindTimeGridActions(container, {
    tasks,
    focusTasks: focusTaskIds.map((id) => tasks.find((t) => t.id === id)).filter(Boolean),
    isOwnDay,
    ctx: { ...ctx, currentUser },
    onTaskClick: (task) => openModal(task, ctx),
    onSave: async (action, taskId, start, end) => {
      if (action === 'unschedule') {
        timeBlocks = timeBlocks.filter((b) => b.taskId !== taskId)
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
        renderMyDay(container, tasks, currentUser, ctx)
      } else if (action === 'move') {
        // Update data + save without re-rendering (DOM is already correct from pointer events)
        timeBlocks = timeBlocks.map((b) =>
          b.taskId === taskId ? { ...b, start, end } : b
        )
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
      } else if (action === 'drop' || action === 'pick') {
        // Add to focus if not already there
        if (!focusTaskIds.includes(taskId)) {
          focusTaskIds.push(taskId)
        }
        // Remove existing time block for this task if any
        timeBlocks = timeBlocks.filter((b) => b.taskId !== taskId)
        timeBlocks.push({ taskId, start, end })
        // Sort by start time
        timeBlocks.sort((a, b) => a.start.localeCompare(b.start))
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
        renderMyDay(container, tasks, currentUser, ctx)
      }
    },
  })

  // Open modal on card main click (skip if status-btn was clicked)
  container.querySelectorAll('.my-day-card-main').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.status-btn')) return
      const id = el.closest('.my-day-card').dataset.id
      const task = tasks.find((t) => t.id === id)
      if (task) openModal(task, ctx)
    })
  })

  // Add to focus
  container.querySelectorAll('[data-action="focus"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      if (!focusTaskIds.includes(id)) {
        focusTaskIds.push(id)
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
        renderMyDay(container, tasks, currentUser, ctx)
      }
    })
  })

  // Remove from focus
  container.querySelectorAll('[data-action="unfocus"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      focusTaskIds = focusTaskIds.filter((fid) => fid !== id)
      timeBlocks = timeBlocks.filter((b) => b.taskId !== id)
      await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // Move from tomorrow to today
  container.querySelectorAll('[data-action="move-to-today"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      // Remove from tomorrow
      tomorrowTaskIds = tomorrowTaskIds.filter((fid) => fid !== id)
      await saveDailyFocus(ctx.db, myEmail, tomorrowStr, tomorrowTaskIds)
      // Add to today
      if (!focusTaskIds.includes(id)) {
        focusTaskIds.push(id)
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
      }
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // Remove from tomorrow
  container.querySelectorAll('[data-action="remove-tomorrow"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      tomorrowTaskIds = tomorrowTaskIds.filter((fid) => fid !== id)
      await saveDailyFocus(ctx.db, myEmail, tomorrowStr, tomorrowTaskIds)
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // Advance status
  container.querySelectorAll('[data-action="advance"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      const next = btn.dataset.next
      btn.disabled = true
      await updateTask(ctx.db, id, { status: next })
    })
  })

  // Drag and drop (only on own day)
  container.querySelectorAll('.my-day-card[draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id)
      e.dataTransfer.effectAllowed = 'move'
      card.classList.add('dragging')
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
      container.querySelectorAll('[data-drop]').forEach((z) => z.classList.remove('drag-over'))
    })
  })

  // Floating add-task input with @ mention
  const addInput = container.querySelector('#myday-add-input')
  if (addInput) {
    const mention = attachMention(addInput, { projects: ctx.projects, clients: ctx.clients })
    addInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !mention.isOpen()) {
        const title = addInput.value.trim()
        if (!title) return
        const mentionTags = mention.getTags()
        addInput.disabled = true
        // Merge targetEmail with any @-mentioned people
        const assignees = [targetEmail, ...mentionTags.assignees.filter((a) => a !== targetEmail)]
        const projectId = mentionTags.projectId || ''
        // Auto-resolve client from project (every project belongs to exactly one client)
        const clientId = projectId
          ? (ctx.projects.find((p) => p.id === projectId)?.clientId || '')
          : ''
        const ref = await createTask(ctx.db, {
          title,
          status: 'todo',
          assignees,
          clientId,
          projectId,
          createdBy: myEmail || '',
        })
        // Add new task to today's focus (unscheduled — no time block)
        if (ref && ref.id) {
          focusTaskIds.push(ref.id)
          await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
        }
        addInput.value = ''
        addInput.disabled = false
        mention.reset()
        addInput.focus()
      }
      if (e.key === 'Escape' && !mention.isOpen()) {
        addInput.value = ''
        addInput.blur()
      }
    })
  }

  // Drop zones (upnext, tomorrow — focus is now handled by time grid)
  const upnextZone = container.querySelector('[data-drop="upnext"]')
  const tomorrowZone = container.querySelector('[data-drop="tomorrow"]')

  ;[upnextZone, tomorrowZone].filter(Boolean).forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      zone.classList.add('drag-over')
    })
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove('drag-over')
      }
    })
    zone.addEventListener('drop', async (e) => {
      e.preventDefault()
      zone.classList.remove('drag-over')
      const taskId = e.dataTransfer.getData('text/plain')
      const dropTarget = zone.dataset.drop
      let changed = false

      // Remove from wherever it currently is
      if (focusTaskIds.includes(taskId)) {
        focusTaskIds = focusTaskIds.filter((id) => id !== taskId)
        timeBlocks = timeBlocks.filter((b) => b.taskId !== taskId)
        await saveDailyFocus(ctx.db, myEmail, todayStr, focusTaskIds, timeBlocks)
        changed = true
      }
      if (tomorrowTaskIds.includes(taskId)) {
        tomorrowTaskIds = tomorrowTaskIds.filter((id) => id !== taskId)
        await saveDailyFocus(ctx.db, myEmail, tomorrowStr, tomorrowTaskIds)
        changed = true
      }

      // Add to the target zone
      if (dropTarget === 'tomorrow' && !tomorrowTaskIds.includes(taskId)) {
        tomorrowTaskIds.push(taskId)
        await saveDailyFocus(ctx.db, myEmail, tomorrowStr, tomorrowTaskIds)
        changed = true
      }
      // dropTarget === 'upnext' just removes from focus/tomorrow (already done above)

      if (changed) renderMyDay(container, tasks, currentUser, ctx)
    })
  })

}

// ── Person Picker Popover ──

function openPersonPicker(container, tasks, currentUser, ctx, targetEmail, myEmail) {
  // Remove existing popover if open
  const existing = document.querySelector('.person-picker-overlay')
  if (existing) { existing.remove(); return }

  const overlay = document.createElement('div')
  overlay.className = 'person-picker-overlay'

  const optionsHtml = TEAM.map((m) => {
    const avatarHtml = m.photoURL
      ? `<img class="avatar-photo-sm" src="${m.photoURL}" alt="${esc(m.name)}">`
      : `<span class="avatar-sm" style="background:${m.color}">${m.name[0]}</span>`
    const isCurrent = m.email === targetEmail
    return `<div class="person-picker-option${isCurrent ? ' active' : ''}" data-email="${m.email}">
      ${avatarHtml}
      <div class="person-picker-option-info">
        <span class="person-picker-option-name">${esc(m.name)}</span>
        ${m.email === myEmail ? '<span class="person-picker-option-you">you</span>' : ''}
      </div>
      ${isCurrent ? '<i class="ph-fill ph-check-circle" style="color:var(--primary);font-size:18px"></i>' : ''}
    </div>`
  }).join('')

  overlay.innerHTML = `
    <div class="person-picker-sheet">
      <div class="person-picker-sheet-header">
        <span class="person-picker-sheet-title">View someone's day</span>
        <button class="modal-close person-picker-close">&times;</button>
      </div>
      <div class="person-picker-sheet-list">
        ${optionsHtml}
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })

  // Close button
  overlay.querySelector('.person-picker-close').addEventListener('click', () => overlay.remove())

  // Escape key
  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey) }
  }
  document.addEventListener('keydown', onKey)

  // Option clicks
  overlay.querySelectorAll('.person-picker-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      viewingEmail = opt.dataset.email
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })
}

// ── Helpers ──

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

function getNextStatus(currentStatus) {
  const order = ['backlog', 'todo', 'in_progress', 'review', 'done']
  const idx = order.indexOf(currentStatus)
  if (idx < 0 || idx >= order.length - 1) return null
  const nextId = order[idx + 1]
  return STATUSES.find((s) => s.id === nextId) || null
}

function deadlineTag(task, now) {
  if (!task.deadline) return ''
  const d = toDate(task.deadline)
  if (!d) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24))
  let cls = ''
  let label = ''
  if (diff < 0) { cls = 'overdue'; label = `${Math.abs(diff)}d overdue` }
  else if (diff === 0) { cls = 'due-today'; label = 'Due today' }
  else if (diff <= 2) { cls = 'due-soon'; label = `Due in ${diff}d` }
  else { label = formatShortDate(d) }
  return `<span class="my-day-deadline ${cls}">${label}</span>`
}

function priorityWeight(p) {
  const w = { urgent: 4, high: 3, medium: 2, low: 1 }
  return w[p] || 0
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function relativeTime(date, now) {
  const diffMs = now - date
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShortDate(d) {
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
