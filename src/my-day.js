import { TEAM, STATUSES } from './config.js'
import { updateTask, createTask, loadDailyFocus, saveDailyFocus, loadHolidays } from './db.js'
import { openModal } from './modal.js'
import { attachMention } from './mention.js'
import { loadCalendarEvents } from './calendar.js'
import { renderTimeGrid, bindTimeGridActions, isTimeGridDragging } from './time-grid.js'
import { setSelectedTaskIds, clearSelection } from './context-menu.js'

let focusTaskIds = []
let timeBlocks = []
let weekData = {} // { 'YYYY-MM-DD': { taskIds: [], label: 'Monday', isToday: bool } }
let todayStr = ''
let viewingEmail = '' // email of the person whose day we're viewing
let calendarDate = null // null = today, or a Date object for a different day
let selectedClientId = '' // '' = all clients
let weekOffset = 0 // 0 = current week, -1 = prev, +1 = next

export function resetWeekOffset() { weekOffset = 0 }

export async function renderMyDay(container, tasks, currentUser, ctx) {
  const myEmail = currentUser?.email
  if (!viewingEmail) viewingEmail = myEmail
  const isOwnDay = viewingEmail === myEmail
  const targetEmail = viewingEmail

  const now = new Date()
  todayStr = now.toISOString().split('T')[0]
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Compute current week (Mon-Sun)
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setDate(monday.getDate() + (weekOffset * 7))
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const weekDates = [] // [{dateStr, label, isToday, isPast, isWeekend}]
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    weekDates.push({
      dateStr,
      label: dayNames[i],
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      isWeekend: i >= 5,
      date: d,
    })
  }

  const weekStartDate = weekDates[0].date
  const weekEndDate = weekDates[6].date
  const weekRangeStr = weekOffset === 0
    ? formatDate(now)
    : `${weekStartDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })} – ${weekEndDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`

  // Load daily focus for today + holidays in parallel
  const [focusData, allHolidays] = await Promise.all([
    loadDailyFocus(ctx.db, targetEmail, todayStr),
    loadHolidays(ctx.db),
  ])
  focusTaskIds = focusData.taskIds
  timeBlocks = focusData.timeBlocks

  // Build holiday lookup for this week
  const weekDateSet = new Set(weekDates.map((wd) => wd.dateStr))
  const holidayMap = new Map() // dateStr → holiday name
  for (const h of allHolidays) {
    if (weekDateSet.has(h.date)) {
      holidayMap.set(h.date, h.name)
    }
  }

  // Compute next week dates (for excluding scheduled-next-week tasks from Unscheduled)
  const nextMonday = new Date(monday)
  nextMonday.setDate(monday.getDate() + 7)
  const nextWeekDates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(nextMonday)
    d.setDate(nextMonday.getDate() + i)
    nextWeekDates.push(d.toISOString().split('T')[0])
  }

  // Load daily focus for all weekdays + next week in parallel
  const allFocusPromises = [
    ...weekDates.map((wd) => wd.isToday
      ? Promise.resolve(focusData)
      : loadDailyFocus(ctx.db, targetEmail, wd.dateStr)
    ),
    ...nextWeekDates.map((ds) => loadDailyFocus(ctx.db, targetEmail, ds)),
  ]
  const allFocusResults = await Promise.all(allFocusPromises)
  const weekFocusResults = allFocusResults.slice(0, 7)
  const nextWeekFocusResults = allFocusResults.slice(7)

  // Build weekData
  weekData = {}
  for (let i = 0; i < weekDates.length; i++) {
    const wd = weekDates[i]
    let taskIds = weekFocusResults[i].taskIds
    // Clean stale IDs for non-today days (remove done/reassigned tasks from future)
    if (tasks.length > 0 && !wd.isToday && !wd.isPast && isOwnDay) {
      const cleaned = taskIds.filter((id) => {
        const t = tasks.find((task) => task.id === id)
        return t && t.status !== 'done' && (t.assignees || []).includes(targetEmail)
      })
      if (cleaned.length !== taskIds.length) {
        taskIds = cleaned
        saveDailyFocus(ctx.db, targetEmail, wd.dateStr, taskIds)
      }
    }
    weekData[wd.dateStr] = { taskIds: [...new Set(taskIds)], label: wd.label, isToday: wd.isToday, isPast: wd.isPast, date: wd.date }
  }

  // Filter stale IDs for today's focus
  const validFocusIds = tasks.length > 0
    ? focusTaskIds.filter((id) => tasks.find((task) => task.id === id))
    : focusTaskIds
  if (tasks.length > 0 && validFocusIds.length !== focusTaskIds.length && isOwnDay) {
    focusTaskIds = validFocusIds
    const focusSet = new Set(focusTaskIds)
    timeBlocks = timeBlocks.filter((b) => focusSet.has(b.taskId))
    saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
    weekData[todayStr].taskIds = focusTaskIds
  }

  const focusTasks = (isOwnDay ? validFocusIds : focusTaskIds)
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean)

  // Build set of all tasks assigned to a weekday (current + next week)
  const weekTaskIdSet = new Set()
  for (const wd of Object.values(weekData)) {
    for (const id of wd.taskIds) weekTaskIdSet.add(id)
  }
  // Also exclude tasks scheduled for next week from Unscheduled
  for (const focus of nextWeekFocusResults) {
    for (const id of focus.taskIds) weekTaskIdSet.add(id)
  }

  // Resolve week day tasks — only from dailyFocus, filtered by assignee
  const weekDayTasks = {} // dateStr → task[]
  for (const [dateStr, wd] of Object.entries(weekData)) {
    weekDayTasks[dateStr] = wd.taskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t) => t && (t.assignees || []).includes(targetEmail))
  }

  // Up Next (Unscheduled): active tasks not assigned to any weekday
  const upNext = tasks
    .filter((t) =>
      (t.assignees || []).includes(targetEmail) &&
      t.status !== 'done' &&
      t.status !== 'backlog' &&
      !weekTaskIdSet.has(t.id)
    )
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))

  // Completed today for viewed user (still used for stats)
  const completedToday = tasks.filter((t) => {
    if (t.status !== 'done' || !t.closedAt) return false
    if (!(t.assignees || []).includes(targetEmail)) return false
    const closed = toDate(t.closedAt)
    return closed >= todayStart
  })

  // Determine the calendar date (default: today)
  const calDate = calendarDate || now
  const calDateStr = calDate.toISOString().split('T')[0]
  const isCalToday = calDateStr === todayStr

  // Load focus data for the calendar date (if different from today)
  let calFocusTaskIds = focusTaskIds
  let calTimeBlocks = timeBlocks
  if (!isCalToday) {
    const calFocusData = await loadDailyFocus(ctx.db, targetEmail, calDateStr)
    calFocusTaskIds = calFocusData.taskIds
    calTimeBlocks = calFocusData.timeBlocks
  }
  const calFocusTasks = calFocusTaskIds
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean)

  // Load calendar events (only for own day)
  let calendarEvents = []
  let calendarNeedsAuth = false
  if (isOwnDay) {
    const cal = await loadCalendarEvents(calDateStr)
    calendarEvents = cal.events
    calendarNeedsAuth = cal.needsAuth
  }

  const viewingMember = TEAM.find((m) => m.email === targetEmail)
  const viewingName = viewingMember?.name || currentUser?.displayName || ''

  const greetingText = isOwnDay
    ? (weekOffset === 0
      ? `${greeting()}, ${esc(viewingName.split(' ')[0])}`
      : `${esc(viewingName.split(' ')[0])}'s Week`)
    : `${esc(viewingName.split(' ')[0])}'s Week`

  // Build client filter data — count only tasks visible in sections
  const allWeekTasks = Object.values(weekDayTasks).flat()
  const visibleTasks = [...upNext, ...allWeekTasks]
  const clientCounts = new Map() // clientId → count
  for (const t of visibleTasks) {
    const cid = t.clientId || ''
    clientCounts.set(cid, (clientCounts.get(cid) || 0) + 1)
  }
  const totalActiveCount = visibleTasks.length
  // Only show clients that have tasks
  const activeClients = ctx.clients
    .filter((c) => clientCounts.has(c.id))
    .sort((a, b) => (clientCounts.get(b.id) || 0) - (clientCounts.get(a.id) || 0))

  // If selected client no longer has tasks, reset to all
  if (selectedClientId && !clientCounts.has(selectedClientId)) {
    selectedClientId = ''
  }

  // Filter task lists by selected client
  const clientFilter = (t) => !selectedClientId || t.clientId === selectedClientId
  const filteredUpNext = upNext.filter(clientFilter)
  const filteredWeekDayTasks = {}
  for (const [dateStr, dayTasks] of Object.entries(weekDayTasks)) {
    filteredWeekDayTasks[dateStr] = dayTasks.filter(clientFilter)
  }

  // Split events
  const allDayEvents = calendarEvents.filter((e) => e.allDay)
  const timedEvents = calendarEvents.filter((e) => !e.allDay)
  const scheduledCount = timeBlocks.length

  // Build scheduled set for badges
  const scheduledSet = new Set(timeBlocks.map((b) => b.taskId))

  container.innerHTML = `
    <div class="my-day">
      <div class="my-day-left">
        <div class="my-day-header">
          <div>
            <div class="my-day-greeting-row">
              <h2 class="my-day-greeting">${greetingText}</h2>
              <button class="myday-person-toggle" id="myday-person-toggle" title="View another person's day">
                <i class="ph-fill ph-caret-down"></i>
              </button>
            </div>
            <div class="my-day-date week-nav">
              <button class="week-nav-btn" id="week-prev" title="Previous week"><i class="ph ph-caret-left"></i></button>
              <span class="week-nav-label" id="week-label">${weekRangeStr}</span>
              <button class="week-nav-btn" id="week-next" title="Next week"><i class="ph ph-caret-right"></i></button>
            </div>
          </div>
          <div class="my-day-stats">
            <span class="my-day-stat"><i class="ph-fill ph-target"></i> ${focusTasks.length} planned</span>
            <span class="my-day-stat"><i class="ph-fill ph-check-circle"></i> ${completedToday.length} done today</span>
          </div>
        </div>

        ${activeClients.length > 0 ? `
        <div class="my-week-client-tabs" id="my-week-client-tabs">
          <button class="client-tab${selectedClientId === '' ? ' active' : ''}" data-client-id="">
            <span class="client-tab-logos">${activeClients.slice(0, 3).map((c) =>
              c.logoUrl
                ? `<img class="client-tab-logo" src="${c.logoUrl}" alt="${esc(c.name)}">`
                : `<span class="client-tab-logo client-tab-logo-placeholder">${c.name[0]}</span>`
            ).join('')}</span>
            <span class="client-tab-label">All Clients</span>
            <span class="client-tab-count">${totalActiveCount}</span>
          </button>
          ${activeClients.map((c) => `
            <button class="client-tab${selectedClientId === c.id ? ' active' : ''}" data-client-id="${c.id}">
              ${c.logoUrl
                ? `<img class="client-tab-logo" src="${c.logoUrl}" alt="${esc(c.name)}">`
                : `<span class="client-tab-logo client-tab-logo-placeholder">${c.name[0]}</span>`
              }
              <span class="client-tab-label">${esc(c.name)}</span>
              <span class="client-tab-count">${clientCounts.get(c.id) || 0}</span>
            </button>
          `).join('')}
        </div>
        ` : ''}

        <!-- Unscheduled Section -->
        <div class="my-day-section">
          <div class="my-day-section-header">
            <i class="ph-fill ph-queue" style="color:#3b82f6"></i>
            <span>Unscheduled</span>
            <span class="my-day-count">${filteredUpNext.length}</span>
          </div>
          <div class="my-day-upnext-list" data-drop="upnext">
            ${filteredUpNext.length > 0 ? filteredUpNext.map((t) => upNextCard(t, ctx, now, isOwnDay, scheduledSet.has(t.id))).join('') : `
              <div class="my-day-empty">
                <i class="ph ph-check" style="font-size:24px;opacity:0.3"></i>
                <span>${isOwnDay ? "No active tasks — you're all caught up" : 'No active tasks'}</span>
              </div>
            `}
          </div>
        </div>

        <!-- Weekday Sections (Mon-Sun) -->
        ${weekDates.map((wd) => {
          const dayTasks = filteredWeekDayTasks[wd.dateStr] || []
          const holiday = holidayMap.get(wd.dateStr)
          const dayIcon = wd.isToday ? 'ph-fill ph-star' : wd.isPast ? 'ph ph-calendar-check' : 'ph-fill ph-calendar-plus'
          const dayColor = wd.isToday ? '#f59e0b' : wd.isPast ? '#94a3b8' : '#6366f1'
          const shortDate = wd.date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
          const dayLabel = wd.isToday ? `Today · ${wd.label}` : `${wd.label} · ${shortDate}`
          return `
          <div class="my-day-section${wd.isPast && !wd.isToday ? ' day-past' : ''}${wd.isToday ? ' day-today' : ''}${wd.isWeekend ? ' day-weekend' : ''}">
            <div class="my-day-section-header">
              <i class="${dayIcon}" style="color:${dayColor}"></i>
              <span>${dayLabel}</span>
              ${holiday ? `<span class="my-week-holiday-badge"><i class="ph-fill ph-flag-pennant"></i> ${esc(holiday)}</span>` : ''}
              <span class="my-day-count">${dayTasks.length}</span>
            </div>
            <div class="my-day-weekday-list" data-drop="weekday" data-date="${wd.dateStr}">
              ${dayTasks.length > 0 ? dayTasks.map((t) => weekdayCard(t, ctx, now, isOwnDay, wd.dateStr, wd.isPast)).join('') : `
                <div class="my-day-empty my-day-empty-sm">
                  <span>${isOwnDay ? 'Drag tasks here' : 'Nothing planned'}</span>
                </div>
              `}
            </div>
          </div>
          `
        }).join('')}

        <div class="myday-add-spacer"></div>
      </div>

      <div class="my-day-right">
        ${renderTimeGrid({
          timeBlocks: calTimeBlocks,
          focusTasks: calFocusTasks,
          calendarEvents: timedEvents,
          allDayEvents,
          calendarNeedsAuth,
          isOwnDay,
          ctx,
          now,
          calendarDate: calDate,
          isToday: isCalToday,
        })}
      </div>
    </div>

    <div class="myday-add-bar">
      <div class="myday-add-wrap">
        <input class="myday-add-input" id="myday-add-input" placeholder="+ Add task (@ to tag)" type="text">
      </div>
    </div>
  `

  bindMyDayActions(container, tasks, currentUser, ctx, now, isOwnDay, { calDateStr, isCalToday, calFocusTaskIds, calTimeBlocks })
}

// ── Card renderers ──

function upNextCard(task, ctx, now, isOwnDay, isScheduled) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''
  const deadlineHtml = deadlineTag(task, now)
  const scheduledBadge = isScheduled
    ? '<span class="my-day-scheduled-badge" title="Scheduled on calendar"><i class="ph-fill ph-clock"></i></span>'
    : ''

  return `
    <div class="my-day-card upnext${isScheduled ? ' scheduled' : ''}" data-id="${task.id}" draggable="${isOwnDay}">
      <div class="my-day-card-main">
        ${statusIcon(task.status)}
        ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
        ${clientLogo}
        ${project ? `<span class="my-day-project">${esc(project.name)}</span>` : ''}
        <span class="my-day-card-title">${esc(task.title)}</span>
        <div class="my-day-card-meta">
          ${scheduledBadge}
          ${deadlineHtml}
        </div>
      </div>
      ${isOwnDay && !isScheduled ? `
      <div class="my-day-card-actions">
        <button class="my-day-action-btn add-focus" data-action="focus" data-id="${task.id}" title="Add to today's focus">
          <i class="ph ph-plus-circle"></i>
        </button>
      </div>
      ` : ''}
    </div>
  `
}

function weekdayCard(task, ctx, now, isOwnDay, dateStr, isPast) {
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''
  const status = STATUSES.find((s) => s.id === task.status)
  const deadlineHtml = deadlineTag(task, now)

  return `
    <div class="my-day-card weekday${isPast ? ' past' : ''}${task.status === 'done' ? ' completed' : ''}" data-id="${task.id}" data-date="${dateStr}" draggable="${isOwnDay}">
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
        <button class="my-day-action-btn" data-action="remove-weekday" data-id="${task.id}" data-date="${dateStr}" title="Remove from this day">
          <i class="ph ph-x"></i>
        </button>
      </div>
      ` : ''}
    </div>
  `
}

// ── Actions ──

function bindMyDayActions(container, tasks, currentUser, ctx, now, isOwnDay, { calDateStr, isCalToday, calFocusTaskIds, calTimeBlocks } = {}) {
  const myEmail = currentUser?.email
  const targetEmail = viewingEmail || myEmail

  // Client filter tabs
  container.querySelectorAll('.client-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      selectedClientId = tab.dataset.clientId
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // Person picker popover
  const toggleBtn = container.querySelector('#myday-person-toggle')
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      openPersonPicker(container, tasks, currentUser, ctx, targetEmail, myEmail)
    })
  }

  // Day navigation buttons
  const dayPrev = container.querySelector('#tg-day-prev')
  const dayNext = container.querySelector('#tg-day-next')
  const dayLabel = container.querySelector('#tg-day-label')
  if (dayPrev) {
    dayPrev.addEventListener('click', () => {
      const base = calendarDate || new Date()
      const prev = new Date(base)
      prev.setDate(prev.getDate() - 1)
      calendarDate = prev
      renderMyDay(container, tasks, currentUser, ctx)
    })
  }
  if (dayNext) {
    dayNext.addEventListener('click', () => {
      const base = calendarDate || new Date()
      const next = new Date(base)
      next.setDate(next.getDate() + 1)
      calendarDate = next
      renderMyDay(container, tasks, currentUser, ctx)
    })
  }
  if (dayLabel) {
    dayLabel.addEventListener('click', () => {
      calendarDate = null // reset to today
      renderMyDay(container, tasks, currentUser, ctx)
    })
  }

  document.getElementById('week-prev')?.addEventListener('click', () => {
    weekOffset--
    renderMyDay(container, tasks, currentUser, ctx)
  })
  document.getElementById('week-next')?.addEventListener('click', () => {
    weekOffset++
    renderMyDay(container, tasks, currentUser, ctx)
  })
  document.getElementById('week-label')?.addEventListener('click', () => {
    weekOffset = 0
    renderMyDay(container, tasks, currentUser, ctx)
  })

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

  // Time grid interactions — use calendarDate-aware focus/blocks
  const tgDateStr = calDateStr
  const tgIsCalToday = isCalToday
  let tgFocusIds = tgIsCalToday ? focusTaskIds : [...calFocusTaskIds]
  let tgBlocks = tgIsCalToday ? timeBlocks : [...calTimeBlocks]

  bindTimeGridActions(container, {
    tasks,
    focusTasks: tgFocusIds.map((id) => tasks.find((t) => t.id === id)).filter(Boolean),
    isOwnDay,
    ctx: { ...ctx, currentUser },
    onTaskClick: (task) => openModal(task, ctx),
    onSave: async (action, taskId, start, end, newTitle) => {
      if (action === 'unschedule') {
        tgBlocks = tgBlocks.filter((b) => b.taskId !== taskId)
        if (tgIsCalToday) { timeBlocks = tgBlocks; focusTaskIds = tgFocusIds }
        await saveDailyFocus(ctx.db, targetEmail, tgDateStr, tgFocusIds, tgBlocks)
        renderMyDay(container, tasks, currentUser, ctx)
      } else if (action === 'move') {
        tgBlocks = tgBlocks.map((b) =>
          b.taskId === taskId ? { ...b, start, end } : b
        )
        if (tgIsCalToday) { timeBlocks = tgBlocks }
        await saveDailyFocus(ctx.db, targetEmail, tgDateStr, tgFocusIds, tgBlocks)
      } else if (action === 'drop' || action === 'pick') {
        if (!tgFocusIds.includes(taskId)) {
          tgFocusIds.push(taskId)
        }
        tgBlocks = tgBlocks.filter((b) => b.taskId !== taskId)
        tgBlocks.push({ taskId, start, end })
        tgBlocks.sort((a, b) => a.start.localeCompare(b.start))
        if (tgIsCalToday) { timeBlocks = tgBlocks; focusTaskIds = tgFocusIds }
        await saveDailyFocus(ctx.db, targetEmail, tgDateStr, tgFocusIds, tgBlocks)
        renderMyDay(container, tasks, currentUser, ctx)
      } else if (action === 'new-task' && newTitle) {
        const ref = await createTask(ctx.db, {
          title: newTitle,
          status: 'todo',
          assignees: [targetEmail],
          createdBy: myEmail || '',
        })
        if (ref && ref.id) {
          tgFocusIds.push(ref.id)
          tgBlocks.push({ taskId: ref.id, start, end })
          tgBlocks.sort((a, b) => a.start.localeCompare(b.start))
          if (tgIsCalToday) { timeBlocks = tgBlocks; focusTaskIds = tgFocusIds }
          await saveDailyFocus(ctx.db, targetEmail, tgDateStr, tgFocusIds, tgBlocks)
        }
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
        await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
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
      await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
      renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // Remove from weekday
  container.querySelectorAll('[data-action="remove-weekday"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      const dateStr = btn.dataset.date
      const wd = weekData[dateStr]
      if (!wd) return
      wd.taskIds = wd.taskIds.filter((fid) => fid !== id)
      // If removing from today, also clean focusTaskIds/timeBlocks
      if (dateStr === todayStr) {
        focusTaskIds = focusTaskIds.filter((fid) => fid !== id)
        timeBlocks = timeBlocks.filter((b) => b.taskId !== id)
        await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
      } else {
        await saveDailyFocus(ctx.db, targetEmail, dateStr, wd.taskIds)
      }
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

  // Drop zones (upnext + weekday sections)
  container.querySelectorAll('[data-drop]').forEach((zone) => {
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
      const dropType = zone.dataset.drop
      const dropDate = zone.dataset.date
      let changed = false

      // Remove from wherever it currently is (any weekday or today's focus)
      for (const [dateStr, wd] of Object.entries(weekData)) {
        if (wd.taskIds.includes(taskId)) {
          wd.taskIds = wd.taskIds.filter((id) => id !== taskId)
          if (dateStr === todayStr) {
            focusTaskIds = focusTaskIds.filter((id) => id !== taskId)
            timeBlocks = timeBlocks.filter((b) => b.taskId !== taskId)
            await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
          } else {
            await saveDailyFocus(ctx.db, targetEmail, dateStr, wd.taskIds)
          }
          changed = true
        }
      }

      // Add to the target zone
      if (dropType === 'weekday' && dropDate) {
        const wd = weekData[dropDate]
        if (wd && !wd.taskIds.includes(taskId)) {
          wd.taskIds.push(taskId)
          if (dropDate === todayStr) {
            focusTaskIds.push(taskId)
            await saveDailyFocus(ctx.db, targetEmail, todayStr, focusTaskIds, timeBlocks)
          } else {
            await saveDailyFocus(ctx.db, targetEmail, dropDate, wd.taskIds)
          }
          changed = true
        }
      }
      // dropType === 'upnext' just removes (already done above)

      if (changed) renderMyDay(container, tasks, currentUser, ctx)
    })
  })

  // ── Marquee (lasso) selection ──
  let marqueeEl = null
  let startX = 0, startY = 0
  let isDragging = false

  const onMarqueeDown = (e) => {
    // Only start marquee on background — not on cards, buttons, inputs, scrollbars, menus
    if (e.button !== 0) return
    if (e.target.closest('.my-day-card, .task-card, button, input, a, .ctx-menu, .my-week-client-tabs, .my-day-header, .tg-slot, .tg-block')) return

    // Clear previous selection
    clearSelection()

    startX = e.clientX
    startY = e.clientY
    isDragging = false

    const onMove = (me) => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      // Only start drawing after a small threshold to avoid accidental drags
      if (!isDragging && (Math.abs(dx) < 5 && Math.abs(dy) < 5)) return

      if (!isDragging) {
        isDragging = true
        marqueeEl = document.createElement('div')
        marqueeEl.className = 'marquee-rect'
        document.body.appendChild(marqueeEl)
      }

      const x = Math.min(startX, me.clientX)
      const y = Math.min(startY, me.clientY)
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      marqueeEl.style.left = `${x}px`
      marqueeEl.style.top = `${y}px`
      marqueeEl.style.width = `${w}px`
      marqueeEl.style.height = `${h}px`

      // Check which cards intersect with the marquee rectangle
      const marqueeRect = { left: x, top: y, right: x + w, bottom: y + h }
      const selected = new Set()
      container.querySelectorAll('.my-day-card').forEach((card) => {
        const cr = card.getBoundingClientRect()
        const intersects =
          cr.left < marqueeRect.right &&
          cr.right > marqueeRect.left &&
          cr.top < marqueeRect.bottom &&
          cr.bottom > marqueeRect.top
        if (intersects) {
          card.classList.add('selected')
          selected.add(card.dataset.id)
        } else {
          card.classList.remove('selected')
        }
      })
      setSelectedTaskIds(selected, () => {
        container.querySelectorAll('.my-day-card.selected').forEach((c) => c.classList.remove('selected'))
      })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (marqueeEl) {
        marqueeEl.remove()
        marqueeEl = null
      }
      // If we didn't actually drag (just a click), clear selection
      if (!isDragging) {
        clearSelection()
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  container.addEventListener('mousedown', onMarqueeDown)

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
        <span class="person-picker-sheet-title">View someone's week</span>
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
