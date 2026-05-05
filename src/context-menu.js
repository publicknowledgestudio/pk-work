import { STATUSES, PRIORITIES, TEAM } from './config.js'
import { createTask, updateTask, deleteTask, loadDailyFocus, saveDailyFocus, findDailyFocusContainingTask } from './db.js'
import { toISODate } from './utils/dates.js'

let menuEl = null
let activeTaskIds = [] // supports single or multi-select
let openSubmenu = null

// The task card selectors used across views
const TASK_SELECTORS = '.task-card, .my-task-row, .my-day-card'

// Multi-select state (shared with my-day.js via getter/setter)
let selectedIds = new Set()
let onSelectionCleared = null

export function getSelectedTaskIds() { return selectedIds }
export function setSelectedTaskIds(ids, onClear) {
  selectedIds = ids instanceof Set ? ids : new Set(ids)
  onSelectionCleared = onClear || null
}
export function clearSelection() {
  selectedIds.clear()
  document.querySelectorAll('.my-day-card.selected').forEach((c) => c.classList.remove('selected'))
  if (onSelectionCleared) onSelectionCleared()
}

export function initContextMenu(getCtx) {
  // Create the menu element once
  menuEl = document.createElement('div')
  menuEl.className = 'ctx-menu hidden'
  document.body.appendChild(menuEl)

  // Global contextmenu listener (delegated)
  document.addEventListener('contextmenu', (e) => {
    const card = e.target.closest(TASK_SELECTORS)
    if (!card || !card.dataset.id) return

    e.preventDefault()
    const clickedId = card.dataset.id

    // If right-clicking on a selected card, use the full selection
    if (selectedIds.size > 0 && selectedIds.has(clickedId)) {
      activeTaskIds = [...selectedIds]
    } else {
      // Single task right-click — clear any multi-selection
      clearSelection()
      activeTaskIds = [clickedId]
    }
    showMenu(e.clientX, e.clientY, getCtx())
  })

  // Close on click outside or Escape
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      closeMenu()
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu()
      clearSelection()
    }
  })
  document.addEventListener('scroll', () => closeMenu(), true)
}

function showMenu(x, y, ctx) {
  const tasks = activeTaskIds.map((id) => ctx.allTasks.find((t) => t.id === id)).filter(Boolean)
  if (tasks.length === 0) return

  const isMulti = tasks.length > 1
  const task = tasks[0] // first task (used for single-select active states)

  openSubmenu = null

  const todayStr = new Date().toISOString().split('T')[0]

  // Build 2-week mini calendar (current week Mon-Sun + next week Mon-Sun)
  const now = new Date()
  const dow = now.getDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  const calDays = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const ds = d.toISOString().split('T')[0]
    calDays.push({ date: d, dateStr: ds, day: d.getDate(), isToday: ds === todayStr, isPast: ds < todayStr, isWeekend: d.getDay() === 0 || d.getDay() === 6 })
  }
  const week1 = calDays.slice(0, 7)
  const week2 = calDays.slice(7, 14)

  const scheduleLabel = isMulti ? `Schedule ${tasks.length} Tasks` : 'Schedule Task'

  menuEl.innerHTML = `
    ${isMulti ? `<div class="ctx-multi-header"><i class="ph ph-selection-all"></i> ${tasks.length} tasks selected</div><div class="ctx-separator"></div>` : ''}
    <div class="ctx-item has-sub" data-sub="schedule">
      <i class="ph ph-calendar-plus"></i> ${scheduleLabel}
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu ctx-schedule-sub" data-sub-id="schedule">
        <div class="ctx-cal-header">${scheduleLabel}</div>
        <div class="ctx-cal-days">
          <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span class="ctx-cal-we">S</span><span class="ctx-cal-we">S</span>
        </div>
        <div class="ctx-cal-grid">
          ${week1.map((d) => `<button class="ctx-cal-day${d.isToday ? ' today' : ''}${d.isPast ? ' past' : ''}${d.isWeekend ? ' weekend' : ''}" data-action="schedule" data-date="${d.dateStr}">${d.day}</button>`).join('')}
        </div>
        <div class="ctx-cal-grid">
          ${week2.map((d) => `<button class="ctx-cal-day${d.isWeekend ? ' weekend' : ''}" data-action="schedule" data-date="${d.dateStr}">${d.day}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="ctx-separator"></div>
    ${!isMulti ? `
    <div class="ctx-item" data-action="duplicate">
      <i class="ph ph-copy"></i> Duplicate
    </div>
    <div class="ctx-separator"></div>
    ` : ''}
    <div class="ctx-item has-sub" data-sub="status">
      <i class="ph ph-circle-half"></i> Status
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="status">
        ${STATUSES.map((s) => `
          <div class="ctx-item${!isMulti && task.status === s.id ? ' active' : ''}" data-action="status" data-value="${s.id}">
            <span class="ctx-dot" style="background:${s.color}"></span> ${s.label}
            ${!isMulti && task.status === s.id ? '<i class="ph ph-check ctx-check"></i>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="ctx-item has-sub" data-sub="assign">
      <i class="ph ph-user"></i> Assign To
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="assign">
        ${TEAM.map((m) => {
          const isAssigned = !isMulti && (task.assignees || []).includes(m.email)
          const avatarHtml = m.photoURL
            ? `<img class="avatar-photo-xs" src="${m.photoURL}" alt="${m.name}">`
            : `<span class="ctx-dot" style="background:${m.color}"></span>`
          return `
            <div class="ctx-item${isAssigned ? ' active' : ''}" data-action="assign" data-value="${m.email}">
              ${avatarHtml} ${esc(m.name)}
              ${isAssigned ? '<i class="ph ph-check ctx-check"></i>' : ''}
            </div>
          `
        }).join('')}
        <div class="ctx-separator"></div>
        <div class="ctx-item${!isMulti && (!task.assignees || task.assignees.length === 0) ? ' active' : ''}" data-action="unassign">
          <i class="ph ph-user-minus" style="font-size:13px"></i> Unassign All
        </div>
      </div>
    </div>
    <div class="ctx-item has-sub" data-sub="priority">
      <i class="ph ph-flag"></i> Priority
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="priority">
        ${PRIORITIES.map((p) => `
          <div class="ctx-item${!isMulti && task.priority === p.id ? ' active' : ''}" data-action="priority" data-value="${p.id}">
            <span class="ctx-dot" style="background:${p.color}"></span> ${p.label}
            ${!isMulti && task.priority === p.id ? '<i class="ph ph-check ctx-check"></i>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item danger" data-action="delete">
      <i class="ph ph-trash"></i> Delete${isMulti ? ` ${tasks.length} Tasks` : ''}
    </div>
  `

  // Position: ensure it stays within viewport
  menuEl.classList.remove('hidden')
  const rect = menuEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = x
  let top = y
  if (x + rect.width > vw) left = vw - rect.width - 8
  if (y + rect.height > vh) top = vh - rect.height - 8
  if (left < 0) left = 8
  if (top < 0) top = 8

  menuEl.style.left = `${left}px`
  menuEl.style.top = `${top}px`

  // Bind actions
  bindMenuActions(ctx, tasks)
}

function bindMenuActions(ctx, tasks) {
  const isMulti = tasks.length > 1
  const task = tasks[0]

  // Submenu hover
  menuEl.querySelectorAll('.ctx-item.has-sub').forEach((item) => {
    item.addEventListener('mouseenter', () => {
      // Close any other open submenu
      menuEl.querySelectorAll('.ctx-submenu.open').forEach((s) => s.classList.remove('open'))
      const sub = item.querySelector('.ctx-submenu')
      if (sub) {
        sub.classList.add('open')
        openSubmenu = sub
        // Position submenu to avoid overflow
        positionSubmenu(item, sub)
      }
    })
  })

  // Close submenu when hovering non-sub items
  menuEl.querySelectorAll('.ctx-item:not(.has-sub)').forEach((item) => {
    // Only top-level items (direct children of ctx-menu)
    if (item.parentElement === menuEl) {
      item.addEventListener('mouseenter', () => {
        menuEl.querySelectorAll('.ctx-submenu.open').forEach((s) => s.classList.remove('open'))
        openSubmenu = null
      })
    }
  })

  // Schedule to a specific day (batch)
  menuEl.querySelectorAll('[data-action="schedule"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      closeMenu()
      const email = ctx.currentUser?.email
      if (!email) return
      const dateStr = btn.dataset.date

      // Remove each task from any previously scheduled day for this user
      // (otherwise scheduling to a new day leaves a stale copy on the old one)
      const cleanupByDate = new Map() // dateStr → { taskIds, timeBlocks }
      for (const t of tasks) {
        const existing = await findDailyFocusContainingTask(ctx.db, email, t.id)
        for (const doc of existing) {
          if (doc.date === dateStr) continue
          const entry = cleanupByDate.get(doc.date) || {
            taskIds: [...(doc.taskIds || [])],
            timeBlocks: [...(doc.timeBlocks || [])],
          }
          entry.taskIds = entry.taskIds.filter((id) => id !== t.id)
          entry.timeBlocks = entry.timeBlocks.filter((b) => b.taskId !== t.id)
          cleanupByDate.set(doc.date, entry)
        }
      }
      for (const [oldDate, entry] of cleanupByDate) {
        await saveDailyFocus(ctx.db, email, oldDate, entry.taskIds, entry.timeBlocks)
      }

      // Add tasks to the target day's focus
      const focus = await loadDailyFocus(ctx.db, email, dateStr)
      let changed = false
      for (const t of tasks) {
        if (!focus.taskIds.includes(t.id)) {
          focus.taskIds.push(t.id)
          changed = true
        }
      }
      if (changed) {
        await saveDailyFocus(ctx.db, email, dateStr, focus.taskIds, focus.timeBlocks)
      }
      clearSelection()
      await ctx.onSave?.()
    })
  })

  // Duplicate (single only)
  menuEl.querySelector('[data-action="duplicate"]')?.addEventListener('click', async () => {
    closeMenu()
    clearSelection()
    await createTask(ctx.db, {
      title: task.title + ' (copy)',
      description: task.description || '',
      clientId: task.clientId || '',
      projectId: task.projectId || '',
      assignees: [...(task.assignees || [])],
      status: task.status,
      priority: task.priority || 'medium',
      deadline: task.deadline ? formatDateForCreate(task.deadline) : null,
      createdBy: ctx.currentUser?.email || '',
    })
  })

  // Status changes (batch)
  menuEl.querySelectorAll('[data-action="status"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      clearSelection()
      const value = item.dataset.value
      await Promise.all(tasks.map((t) => updateTask(ctx.db, t.id, { status: value })))
    })
  })

  // Assign to (batch — always adds for multi, toggles for single)
  menuEl.querySelectorAll('[data-action="assign"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      clearSelection()
      const email = item.dataset.value
      if (isMulti) {
        // For multi-select, always add the person
        await Promise.all(tasks.map((t) => {
          const current = t.assignees || []
          if (!current.includes(email)) {
            return updateTask(ctx.db, t.id, { assignees: [...current, email] })
          }
          return Promise.resolve()
        }))
      } else {
        const current = task.assignees || []
        const newAssignees = current.includes(email)
          ? current.filter((e) => e !== email)
          : [...current, email]
        await updateTask(ctx.db, task.id, { assignees: newAssignees })
      }
    })
  })

  // Unassign all (batch)
  menuEl.querySelector('[data-action="unassign"]')?.addEventListener('click', async () => {
    closeMenu()
    clearSelection()
    await Promise.all(tasks.map((t) => updateTask(ctx.db, t.id, { assignees: [] })))
  })

  // Priority changes (batch)
  menuEl.querySelectorAll('[data-action="priority"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      clearSelection()
      const value = item.dataset.value
      await Promise.all(tasks.map((t) => updateTask(ctx.db, t.id, { priority: value })))
    })
  })

  // Delete (batch)
  menuEl.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    closeMenu()
    const msg = isMulti ? `Delete ${tasks.length} tasks?` : 'Delete this task?'
    if (confirm(msg)) {
      clearSelection()
      await Promise.all(tasks.map((t) => deleteTask(ctx.db, t.id)))
    }
  })
}

function positionSubmenu(parentItem, sub) {
  // Reset positioning
  sub.style.left = ''
  sub.style.right = ''
  sub.style.top = ''

  const parentRect = parentItem.getBoundingClientRect()
  const subRect = sub.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Default: open to the right
  if (parentRect.right + subRect.width > vw) {
    // Not enough space on right, open to the left
    sub.style.left = 'auto'
    sub.style.right = '100%'
  }

  // Vertical: make sure submenu stays in viewport
  if (parentRect.top + subRect.height > vh) {
    sub.style.top = `${vh - parentRect.top - subRect.height - 8}px`
  }
}

function closeMenu() {
  if (menuEl) {
    menuEl.classList.add('hidden')
    menuEl.querySelectorAll('.ctx-submenu.open').forEach((s) => s.classList.remove('open'))
  }
  activeTaskIds = []
  openSubmenu = null
}

// null when absent — createTask distinguishes null from '' for deadlines
function formatDateForCreate(deadline) {
  return toISODate(deadline) || null
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
