import { STATUSES, PRIORITIES, TEAM } from './config.js'
import { createTask, updateTask, deleteTask, loadDailyFocus, saveDailyFocus } from './db.js'

let menuEl = null
let activeTaskId = null
let openSubmenu = null

// The task card selectors used across views
const TASK_SELECTORS = '.task-card, .my-task-row, .my-day-card, .scrum-card'

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
    activeTaskId = card.dataset.id
    showMenu(e.clientX, e.clientY, getCtx())
  })

  // Close on click outside or Escape
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      closeMenu()
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu()
  })
  document.addEventListener('scroll', () => closeMenu(), true)
}

function showMenu(x, y, ctx) {
  const task = ctx.allTasks.find((t) => t.id === activeTaskId)
  if (!task) return

  openSubmenu = null

  const todayStr = new Date().toISOString().split('T')[0]
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0]

  menuEl.innerHTML = `
    <div class="ctx-item" data-action="add-to-my-day">
      <i class="ph-fill ph-sun"></i> Add to My Day
    </div>
    <div class="ctx-item" data-action="add-to-tomorrow">
      <i class="ph ph-calendar-plus"></i> Add to Tomorrow
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item" data-action="duplicate">
      <i class="ph ph-copy"></i> Duplicate
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item has-sub" data-sub="status">
      <i class="ph ph-circle-half"></i> Status
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="status">
        ${STATUSES.map((s) => `
          <div class="ctx-item${task.status === s.id ? ' active' : ''}" data-action="status" data-value="${s.id}">
            <span class="ctx-dot" style="background:${s.color}"></span> ${s.label}
            ${task.status === s.id ? '<i class="ph ph-check ctx-check"></i>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="ctx-item has-sub" data-sub="assign">
      <i class="ph ph-user"></i> Assign To
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="assign">
        ${TEAM.map((m) => {
          const isAssigned = (task.assignees || []).includes(m.email)
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
        <div class="ctx-item${(!task.assignees || task.assignees.length === 0) ? ' active' : ''}" data-action="unassign">
          <i class="ph ph-user-minus" style="font-size:13px"></i> Unassign All
        </div>
      </div>
    </div>
    <div class="ctx-item has-sub" data-sub="priority">
      <i class="ph ph-flag"></i> Priority
      <i class="ph ph-caret-right ctx-arrow"></i>
      <div class="ctx-submenu" data-sub-id="priority">
        ${PRIORITIES.map((p) => `
          <div class="ctx-item${task.priority === p.id ? ' active' : ''}" data-action="priority" data-value="${p.id}">
            <span class="ctx-dot" style="background:${p.color}"></span> ${p.label}
            ${task.priority === p.id ? '<i class="ph ph-check ctx-check"></i>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item danger" data-action="delete">
      <i class="ph ph-trash"></i> Delete
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
  bindMenuActions(ctx, task)
}

function bindMenuActions(ctx, task) {
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

  // Add to My Day
  menuEl.querySelector('[data-action="add-to-my-day"]')?.addEventListener('click', async () => {
    closeMenu()
    const email = ctx.currentUser?.email
    if (!email) return
    const todayStr = new Date().toISOString().split('T')[0]
    const current = await loadDailyFocus(ctx.db, email, todayStr)
    if (!current.includes(task.id)) {
      current.push(task.id)
      await saveDailyFocus(ctx.db, email, todayStr, current)
    }
    ctx.onSave?.()
  })

  // Add to Tomorrow
  menuEl.querySelector('[data-action="add-to-tomorrow"]')?.addEventListener('click', async () => {
    closeMenu()
    const email = ctx.currentUser?.email
    if (!email) return
    const tom = new Date()
    tom.setDate(tom.getDate() + 1)
    const tomorrowStr = tom.toISOString().split('T')[0]
    const current = await loadDailyFocus(ctx.db, email, tomorrowStr)
    if (!current.includes(task.id)) {
      current.push(task.id)
      await saveDailyFocus(ctx.db, email, tomorrowStr, current)
    }
    ctx.onSave?.()
  })

  // Duplicate
  menuEl.querySelector('[data-action="duplicate"]')?.addEventListener('click', async () => {
    closeMenu()
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

  // Status changes
  menuEl.querySelectorAll('[data-action="status"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      await updateTask(ctx.db, task.id, { status: item.dataset.value })
    })
  })

  // Assign to (toggle)
  menuEl.querySelectorAll('[data-action="assign"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      const email = item.dataset.value
      const current = task.assignees || []
      let newAssignees
      if (current.includes(email)) {
        newAssignees = current.filter((e) => e !== email)
      } else {
        newAssignees = [...current, email]
      }
      await updateTask(ctx.db, task.id, { assignees: newAssignees })
    })
  })

  // Unassign all
  menuEl.querySelector('[data-action="unassign"]')?.addEventListener('click', async () => {
    closeMenu()
    await updateTask(ctx.db, task.id, { assignees: [] })
  })

  // Priority changes
  menuEl.querySelectorAll('[data-action="priority"]').forEach((item) => {
    item.addEventListener('click', async () => {
      closeMenu()
      await updateTask(ctx.db, task.id, { priority: item.dataset.value })
    })
  })

  // Delete
  menuEl.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    closeMenu()
    if (confirm('Delete this task?')) {
      await deleteTask(ctx.db, task.id)
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
  activeTaskId = null
  openSubmenu = null
}

function formatDateForCreate(deadline) {
  if (!deadline) return null
  const d = deadline.toDate ? deadline.toDate() : deadline.seconds ? new Date(deadline.seconds * 1000) : new Date(deadline)
  return d.toISOString().split('T')[0]
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
