// Time-block day calendar grid for My Day view
// Renders a vertical timeline (9am–7pm, 15-min slots) with task blocks and calendar events

const DAY_START = 9 // 9 AM
const DAY_END = 19 // 7 PM
const SLOT_MIN = 15 // minutes per slot
const TOTAL_SLOTS = ((DAY_END - DAY_START) * 60) / SLOT_MIN // 40
const SLOT_H = 14 // px per slot
const GRID_H = TOTAL_SLOTS * SLOT_H // 560px
const GUTTER_W = 52 // px for time labels

let nowInterval = null
let isDragging = false // guard against re-render during drag

export function isTimeGridDragging() {
  return isDragging
}

// ── Rendering ──

export function renderTimeGrid({
  timeBlocks,
  focusTasks,
  calendarEvents,
  allDayEvents,
  calendarNeedsAuth,
  isOwnDay,
  ctx,
  now,
}) {
  const timedEvents = (calendarEvents || []).filter((e) => !e.allDay)
  const allDay = allDayEvents || []

  // All-day events row
  const allDayHtml =
    allDay.length > 0
      ? `<div class="tg-allday">${allDay.map((e) => `<a href="${esc(e.htmlLink || '#')}" target="_blank" rel="noopener" class="tg-allday-chip" title="${esc(e.summary)}"><i class="ph-fill ph-calendar-dots"></i> ${esc(e.summary)}</a>`).join('')}</div>`
      : ''

  // Calendar connect prompt (inside grid area)
  const connectHtml =
    calendarNeedsAuth && isOwnDay
      ? `<div class="tg-connect">
        <i class="ph ph-google-logo" style="font-size:18px;opacity:0.35"></i>
        <span>Connect calendar</span>
        <button class="btn-ghost tg-connect-btn" id="cal-connect-btn">Connect</button>
      </div>`
      : ''

  // Hour labels
  let labelsHtml = ''
  for (let h = DAY_START; h < DAY_END; h++) {
    const top = (h - DAY_START) * 4 * SLOT_H
    const label = h <= 12 ? `${h} AM` : `${h - 12} PM`
    labelsHtml += `<div class="tg-label" style="top:${top}px">${h === 12 ? '12 PM' : label}</div>`
  }

  // Grid lines (hourly + half-hour)
  let linesHtml = ''
  for (let h = DAY_START; h <= DAY_END; h++) {
    const top = (h - DAY_START) * 4 * SLOT_H
    linesHtml += `<div class="tg-line" style="top:${top}px"></div>`
    if (h < DAY_END) {
      linesHtml += `<div class="tg-line half" style="top:${top + 2 * SLOT_H}px"></div>`
    }
  }

  // Current time indicator
  const nowY = timeToY(now)
  const showNow = nowY >= 0 && nowY <= GRID_H
  const nowHtml = showNow
    ? `<div class="tg-now" id="tg-now" style="top:${nowY}px"><div class="tg-now-dot"></div><div class="tg-now-line"></div></div>`
    : ''

  // Task blocks
  const taskBlocksHtml = timeBlocks
    .map((block) => {
      const task = focusTasks.find((t) => t.id === block.taskId)
      if (!task) return ''
      return renderTaskBlock(block, task, ctx, isOwnDay)
    })
    .join('')

  // Calendar event blocks
  const calBlocksHtml = timedEvents
    .map((event) => renderCalBlock(event))
    .join('')

  // Invisible slot targets
  let slotsHtml = ''
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    slotsHtml += `<div class="tg-slot" data-slot="${i}" style="top:${i * SLOT_H}px;height:${SLOT_H}px"></div>`
  }

  // Unscheduled focus tasks (in taskIds but not in timeBlocks, excluding done tasks)
  const scheduledIds = new Set(timeBlocks.map((b) => b.taskId))
  const unscheduled = focusTasks.filter((t) => !scheduledIds.has(t.id) && t.status !== 'done')
  const unschedHtml =
    unscheduled.length > 0
      ? `<div class="tg-unscheduled">
        <span class="tg-unscheduled-label">Unscheduled</span>
        ${unscheduled.map((t) => `<div class="tg-unsched-chip my-day-card" draggable="${isOwnDay}" data-id="${t.id}"><span class="tg-unsched-title">${esc(t.title)}</span>${isOwnDay ? `<button class="btn-icon-xs" data-action="unfocus" data-id="${t.id}" title="Remove from My Day"><i class="ph ph-x"></i></button>` : ''}</div>`).join('')}
      </div>`
      : ''

  return `
    <div class="tg-wrap" id="tg-wrap">
      ${connectHtml}
      ${allDayHtml}
      ${unschedHtml}
      <div class="tg-scroll" id="tg-scroll">
        <div class="tg" id="tg" style="height:${GRID_H}px">
          <div class="tg-gutter" style="width:${GUTTER_W}px">${labelsHtml}</div>
          <div class="tg-body" style="left:${GUTTER_W}px">
            ${linesHtml}
            ${nowHtml}
            <div class="tg-blocks" id="tg-blocks">${taskBlocksHtml}${calBlocksHtml}</div>
            <div class="tg-slots" id="tg-slots">${slotsHtml}</div>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderTaskBlock(block, task, ctx, isOwnDay) {
  const top = timeStrToY(block.start)
  const bottom = timeStrToY(block.end)
  const height = Math.max(bottom - top, SLOT_H)
  const compact = height <= SLOT_H

  const client = ctx.clients.find((c) => c.id === task.clientId)
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
    : ''

  // Duration label (e.g. "15m", "1h", "1h 30m")
  const durMin = durationMinutes(block.start, block.end)
  const durLabel = durMin >= 60
    ? (durMin % 60 === 0 ? `${durMin / 60}h` : `${Math.floor(durMin / 60)}h ${durMin % 60}m`)
    : `${durMin}m`

  // Status icon (matches up-next card style)
  const statusHtml = statusIconHtml(task.status)
  const urgentIcon = task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''
  const highIcon = task.priority === 'high' ? '<i class="ph-fill ph-arrow-fat-up" style="color:#f59e0b;font-size:13px"></i>' : ''

  const doneClass = task.status === 'done' ? ' done' : ''

  return `
    <div class="time-block task-block${compact ? ' compact' : ''}${doneClass}" data-task-id="${task.id}"
         style="top:${top}px;height:${height}px" title="${esc(task.title)}">
      <div class="tb-main" data-task-id="${task.id}">
        ${statusHtml}
        ${urgentIcon}${highIcon}
        ${clientLogo}
        ${project ? `<span class="tb-project">${esc(project.name)}</span>` : ''}
        <span class="tb-title">${esc(task.title)}</span>
        <span class="tb-duration">${durLabel}</span>
      </div>
      ${isOwnDay ? `<div class="tb-actions">
        <button class="btn-icon-xs" data-action="unschedule" data-task-id="${task.id}" title="Remove from timeline"><i class="ph ph-x"></i></button>
      </div>
      <div class="tb-resize" data-task-id="${task.id}"></div>` : ''}
    </div>
  `
}

function renderCalBlock(event) {
  const startY = isoToY(event.start)
  const endY = isoToY(event.end)
  const top = Math.max(startY, 0)
  const height = Math.max(Math.min(endY, GRID_H) - top, SLOT_H)
  const compact = height <= SLOT_H

  const meetIcon = event.hangoutLink
    ? `<a href="${esc(event.hangoutLink)}" target="_blank" rel="noopener" class="tb-meet" title="Join meeting" onclick="event.stopPropagation()"><i class="ph-fill ph-video-camera"></i></a>`
    : ''

  return `
    <a href="${esc(event.htmlLink || '#')}" target="_blank" rel="noopener"
       class="time-block cal-block${compact ? ' compact' : ''}"
       style="top:${top}px;height:${height}px" title="${esc(event.summary)}">
      <div class="tb-main">
        <span class="tb-title">${esc(event.summary)}</span>
        ${!compact ? `<span class="tb-time">${fmtTime(isoToTimeStr(event.start))} – ${fmtTime(isoToTimeStr(event.end))}</span>` : ''}
      </div>
      ${meetIcon}
    </a>
  `
}

// ── Interactions ──

export function bindTimeGridActions(container, { tasks, focusTasks, isOwnDay, ctx, onSave, onTaskClick }) {
  if (!isOwnDay) return

  const grid = container.querySelector('#tg')
  const body = grid?.querySelector('.tg-body')
  const scroll = container.querySelector('#tg-scroll')
  if (!grid || !body) return

  // Scroll the page so the current-time indicator is visible
  const nowEl = container.querySelector('#tg-now')
  if (nowEl && nowEl.style.display !== 'none') {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    nowEl.scrollIntoView({ behavior: motion, block: 'center' })
  }

  // Update current-time indicator every 60s
  clearInterval(nowInterval)
  nowInterval = setInterval(() => {
    const el = container.querySelector('#tg-now')
    if (!el) return clearInterval(nowInterval)
    const y = timeToY(new Date())
    if (y >= 0 && y <= GRID_H) {
      el.style.top = y + 'px'
      el.style.display = ''
    } else {
      el.style.display = 'none'
    }
  }, 60000)

  // Click task block → open modal (status cycling is handled by global handler in main.js)
  body.querySelectorAll('.task-block .tb-main').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (isDragging) return
      if (e.target.closest('.status-btn')) return
      const id = el.dataset.taskId
      const task = tasks.find((t) => t.id === id)
      if (task && onTaskClick) onTaskClick(task)
    })
  })

  // Unschedule button (remove from timeline, keep in focus)
  body.querySelectorAll('[data-action="unschedule"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const taskId = btn.dataset.taskId
      onSave('unschedule', taskId)
    })
  })

  // ── Drag to move task blocks ──
  const DRAG_THRESHOLD = 4 // px — must move this far before drag starts
  body.querySelectorAll('.task-block').forEach((block) => {
    const resize = block.querySelector('.tb-resize')
    let mode = null // 'move' | 'resize' | null
    let pending = false // waiting to exceed threshold
    let startY = 0
    let startTop = 0
    let startHeight = 0

    const onPointerDown = (e) => {
      // Skip interactive elements — let click handlers handle them
      if (e.target.closest('.status-btn') || e.target.closest('.tb-actions') || e.target.closest('.tb-meet')) return
      e.preventDefault()
      pending = true
      mode = e.target === resize ? 'resize' : 'move'
      startY = e.clientY
      startTop = parseInt(block.style.top, 10) || 0
      startHeight = parseInt(block.style.height, 10) || SLOT_H
      block.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      if (!mode) return
      const dy = e.clientY - startY
      // Don't start drag until threshold exceeded
      if (pending) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return
        pending = false
        isDragging = true
        block.classList.add('dragging')
      }
      if (!isDragging) return
      if (mode === 'move') {
        const raw = startTop + dy
        const snapped = snapToSlot(raw)
        const clamped = Math.max(0, Math.min(GRID_H - SLOT_H, snapped))
        block.style.top = clamped + 'px'
      } else {
        const raw = startHeight + dy
        const snapped = Math.max(SLOT_H, snapToSlot(raw))
        const top = parseInt(block.style.top, 10) || 0
        const clamped = Math.min(GRID_H - top, snapped)
        block.style.height = clamped + 'px'
      }
    }

    const onPointerUp = () => {
      const wasDragging = isDragging
      if (pending) {
        // Threshold was never exceeded — this was a click, not a drag
        pending = false
        mode = null
        return
      }
      if (!mode) return
      block.classList.remove('dragging')
      const taskId = block.dataset.taskId
      const newTop = parseInt(block.style.top, 10) || 0
      const newHeight = parseInt(block.style.height, 10) || SLOT_H
      const newStart = yToTimeStr(newTop)
      const newEnd = yToTimeStr(newTop + newHeight)
      // Update duration label in-place (no re-render)
      const durEl = block.querySelector('.tb-duration')
      if (durEl) {
        const mins = durationMinutes(newStart, newEnd)
        durEl.textContent = mins >= 60
          ? (mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
          : `${mins}m`
      }
      mode = null
      isDragging = false
      if (wasDragging) {
        onSave('move', taskId, newStart, newEnd)
      }
    }

    block.addEventListener('pointerdown', onPointerDown)
    block.addEventListener('pointermove', onPointerMove)
    block.addEventListener('pointerup', onPointerUp)
    block.addEventListener('pointercancel', onPointerUp)
  })

  // ── HTML5 Drag: drop from Up Next / unscheduled chips onto grid ──
  const slotsEl = container.querySelector('#tg-slots')
  if (slotsEl) {
    slotsEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // Highlight 2 slots (30min default)
      const rect = slotsEl.getBoundingClientRect()
      const y = e.clientY - rect.top + (scroll?.scrollTop || 0)
      const slotIdx = Math.floor(y / SLOT_H)
      slotsEl.querySelectorAll('.tg-slot').forEach((s, i) => {
        s.classList.toggle('drop-hover', i >= slotIdx && i < slotIdx + 2)
      })
    })

    slotsEl.addEventListener('dragleave', (e) => {
      if (!slotsEl.contains(e.relatedTarget)) {
        slotsEl.querySelectorAll('.tg-slot').forEach((s) => s.classList.remove('drop-hover'))
      }
    })

    slotsEl.addEventListener('drop', (e) => {
      e.preventDefault()
      slotsEl.querySelectorAll('.tg-slot').forEach((s) => s.classList.remove('drop-hover'))
      const taskId = e.dataTransfer.getData('text/plain')
      if (!taskId) return
      const rect = slotsEl.getBoundingClientRect()
      const y = e.clientY - rect.top + (scroll?.scrollTop || 0)
      const slotIdx = Math.max(0, Math.min(TOTAL_SLOTS - 2, Math.floor(y / SLOT_H)))
      const start = slotToTimeStr(slotIdx)
      const end = slotToTimeStr(slotIdx + 2)
      onSave('drop', taskId, start, end)
    })
  }

  // ── Click empty slot to assign ──
  slotsEl?.addEventListener('click', (e) => {
    if (isDragging) return
    const slot = e.target.closest('.tg-slot')
    if (!slot) return
    // Check if there's already a block at this position (don't show picker on occupied slots)
    const slotIdx = parseInt(slot.dataset.slot, 10)
    showSlotPicker(container, slotIdx, tasks, focusTasks, ctx, onSave, scroll)
  })
}

// ── Slot picker popover ──

function showSlotPicker(container, slotIdx, tasks, focusTasks, ctx, onSave, scroll) {
  // Remove existing picker
  container.querySelector('.tg-picker')?.remove()

  const targetEmail = ctx.currentUser?.email || ''

  // Available tasks: unscheduled focus tasks + Up Next tasks
  const scheduledIds = new Set((focusTasks || []).filter((t) => {
    // Check if it already has a time block — we'll pass from module state
    return false // We'll populate via the caller
  }).map((t) => t.id))

  // Get all active tasks assigned to user that are not done/backlog
  const available = tasks
    .filter((t) =>
      (t.assignees || []).includes(targetEmail) &&
      t.status !== 'done' &&
      t.status !== 'backlog'
    )
    .slice(0, 15) // cap for popover size

  if (available.length === 0) return

  const time = slotToTimeStr(slotIdx)
  const endTime = slotToTimeStr(Math.min(slotIdx + 2, TOTAL_SLOTS))

  const pickerHtml = `
    <div class="tg-picker" id="tg-picker" style="top:${slotIdx * SLOT_H}px">
      <div class="tg-picker-header">${fmtTime(time)}</div>
      <div class="tg-picker-list">
        ${available.map((t) => {
          const project = ctx.projects.find((p) => p.id === t.projectId)
          const label = project ? project.name : ''
          return `<button class="tg-picker-item" data-task-id="${t.id}">
            <span class="tg-picker-title">${esc(t.title)}</span>
            ${label ? `<span class="tg-picker-meta">${esc(label)}</span>` : ''}
          </button>`
        }).join('')}
      </div>
    </div>
  `

  const body = container.querySelector('.tg-body')
  if (!body) return
  body.insertAdjacentHTML('beforeend', pickerHtml)

  const picker = body.querySelector('#tg-picker')
  if (!picker) return

  // Handle pick
  picker.addEventListener('click', (e) => {
    const item = e.target.closest('.tg-picker-item')
    if (!item) return
    const taskId = item.dataset.taskId
    picker.remove()
    onSave('pick', taskId, time, endTime)
  })

  // Close on outside click
  const close = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove()
      document.removeEventListener('pointerdown', close)
    }
  }
  // Defer to avoid immediate close
  requestAnimationFrame(() => {
    document.addEventListener('pointerdown', close)
  })
}

// ── Time conversion helpers ──

function timeToY(dateObj) {
  const h = dateObj.getHours()
  const m = dateObj.getMinutes()
  const mins = (h - DAY_START) * 60 + m
  return (mins / SLOT_MIN) * SLOT_H
}

function timeStrToY(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const mins = (h - DAY_START) * 60 + m
  return (mins / SLOT_MIN) * SLOT_H
}

function yToTimeStr(y) {
  const slotIdx = Math.round(y / SLOT_H)
  const mins = slotIdx * SLOT_MIN
  const h = DAY_START + Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function slotToTimeStr(slotIdx) {
  const mins = slotIdx * SLOT_MIN
  const h = DAY_START + Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function snapToSlot(y) {
  return Math.round(y / SLOT_H) * SLOT_H
}

function isoToY(isoStr) {
  const d = new Date(isoStr)
  return timeToY(d)
}

function isoToTimeStr(isoStr) {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function durationMinutes(startStr, endStr) {
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

function statusIconHtml(status) {
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

function esc(str) {
  if (!str) return ''
  const d = document.createElement('span')
  d.textContent = str
  return d.innerHTML
}
