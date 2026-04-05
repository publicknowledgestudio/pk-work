// Time-block day calendar grid for My Day view
// Renders a vertical timeline (9am–7pm, 15-min slots) with task blocks and calendar events

const DAY_START = 9 // 9 AM
const DAY_END = 22 // 10 PM
const SLOT_MIN = 15 // minutes per slot
const TOTAL_SLOTS = ((DAY_END - DAY_START) * 60) / SLOT_MIN // 52
const SLOT_H = 14 // px per slot
const GRID_H = TOTAL_SLOTS * SLOT_H // 728px
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
  calendarDate,
  isToday,
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

  // Current time indicator (only on today's view)
  const nowY = timeToY(now)
  const showNow = isToday !== false && nowY >= 0 && nowY <= GRID_H
  const nowHtml = showNow
    ? `<div class="tg-now" id="tg-now" style="top:${nowY}px"><div class="tg-now-dot"></div><div class="tg-now-line"></div></div>`
    : ''

  // Day navigation header
  const calDate = calendarDate || now
  const dayLabel = isToday !== false
    ? 'Today'
    : calDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })
  const dayNavHtml = `
    <div class="tg-day-nav" id="tg-day-nav">
      <button class="tg-day-nav-btn" id="tg-day-prev" title="Previous day"><i class="ph ph-caret-left"></i></button>
      <button class="tg-day-nav-label" id="tg-day-label" title="Go to today">${dayLabel}</button>
      <button class="tg-day-nav-btn" id="tg-day-next" title="Next day"><i class="ph ph-caret-right"></i></button>
    </div>
  `

  // ── Overlap layout: collect all blocks, compute columns ──
  const allItems = []

  timeBlocks.forEach((block) => {
    const task = focusTasks.find((t) => t.id === block.taskId)
    if (!task) return
    const top = timeStrToY(block.start)
    const bottom = timeStrToY(block.end)
    const height = Math.max(bottom - top, SLOT_H)
    allItems.push({ type: 'task', block, task, top, height })
  })

  timedEvents.forEach((event) => {
    const startY = isoToY(event.start)
    const endY = isoToY(event.end)
    const top = Math.max(startY, 0)
    const height = Math.max(Math.min(endY, GRID_H) - top, SLOT_H)
    allItems.push({ type: 'cal', event, top, height })
  })

  const layout = layoutOverlaps(allItems)

  // Task blocks
  const taskBlocksHtml = timeBlocks
    .map((block) => {
      const task = focusTasks.find((t) => t.id === block.taskId)
      if (!task) return ''
      const key = 'task:' + block.taskId
      const pos = layout.get(key) || { col: 0, totalCols: 1 }
      return renderTaskBlock(block, task, ctx, isOwnDay, pos)
    })
    .join('')

  // Calendar event blocks
  const calBlocksHtml = timedEvents
    .map((event) => {
      const key = 'cal:' + (event.id || event.summary)
      const pos = layout.get(key) || { col: 0, totalCols: 1 }
      return renderCalBlock(event, pos)
    })
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
        ${unscheduled.map((t) => {
          const project = ctx.projects.find((p) => p.id === t.projectId)
          const client = ctx.clients.find((c) => c.id === t.clientId)
          const clientLogo = client?.logoUrl
            ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}">`
            : ''
          const deadline = deadlineTagHtml(t, now)
          return `<div class="my-day-card upnext" data-id="${t.id}" draggable="${isOwnDay}">
            <div class="my-day-card-main">
              ${statusIconHtml(t.status)}
              ${t.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
              ${clientLogo}
              ${project ? `<span class="my-day-project">${esc(project.name)}</span>` : ''}
              <span class="my-day-card-title">${esc(t.title)}</span>
              <div class="my-day-card-meta">
                ${deadline}
              </div>
            </div>
            ${isOwnDay ? `<div class="my-day-card-actions">
              <button class="btn-icon-xs" data-action="unfocus" data-id="${t.id}" title="Remove from My Day"><i class="ph ph-x"></i></button>
            </div>` : ''}
          </div>`
        }).join('')}
      </div>`
      : ''

  return `
    <div class="tg-wrap" id="tg-wrap">
      ${dayNavHtml}
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

// ── Overlap layout algorithm ──
// Groups overlapping blocks and assigns each a column so they split the width
function layoutOverlaps(items) {
  const result = new Map() // key → { col, totalCols }
  if (items.length === 0) return result

  // Sort by top position, then by height descending (taller items first)
  const sorted = [...items].sort((a, b) => a.top - b.top || b.height - a.height)

  // Assign keys
  sorted.forEach((item) => {
    item.key = item.type === 'task' ? 'task:' + item.block.taskId : 'cal:' + (item.event.id || item.event.summary)
    item.bottom = item.top + item.height
  })

  // Find connected groups of overlapping items
  const visited = new Set()
  const groups = []

  for (let i = 0; i < sorted.length; i++) {
    if (visited.has(i)) continue
    // BFS/DFS to find all items that transitively overlap
    const group = []
    const stack = [i]
    while (stack.length > 0) {
      const idx = stack.pop()
      if (visited.has(idx)) continue
      visited.add(idx)
      group.push(sorted[idx])
      // Find all items overlapping with this one
      for (let j = 0; j < sorted.length; j++) {
        if (visited.has(j)) continue
        if (sorted[j].top < sorted[idx].bottom && sorted[j].bottom > sorted[idx].top) {
          stack.push(j)
        }
      }
    }
    groups.push(group)
  }

  // For each group, greedily assign columns
  for (const group of groups) {
    // Sort group by top, then height descending
    group.sort((a, b) => a.top - b.top || b.height - a.height)
    const columns = [] // columns[col] = end of last item in that column

    for (const item of group) {
      // Find first column where this item fits (no overlap)
      let placed = false
      for (let c = 0; c < columns.length; c++) {
        if (item.top >= columns[c]) {
          columns[c] = item.bottom
          item.col = c
          placed = true
          break
        }
      }
      if (!placed) {
        item.col = columns.length
        columns.push(item.bottom)
      }
    }

    const totalCols = columns.length
    for (const item of group) {
      result.set(item.key, { col: item.col, totalCols })
    }
  }

  return result
}

function renderTaskBlock(block, task, ctx, isOwnDay, pos) {
  const top = timeStrToY(block.start)
  const bottom = timeStrToY(block.end)
  const height = Math.max(bottom - top, SLOT_H)
  const compact = height <= SLOT_H * 2 // compact for < 30min

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

  // Time range label
  const timeLabel = `${fmtTime(block.start)} – ${fmtTime(block.end)}`

  // Status icon (matches up-next card style)
  const statusHtml = statusIconHtml(task.status)
  const urgentIcon = task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''
  const highIcon = task.priority === 'high' ? '<i class="ph-fill ph-arrow-fat-up" style="color:#f59e0b;font-size:13px"></i>' : ''

  // Deadline badge
  const deadlineStr = task.deadline ? formatBlockDeadline(task.deadline) : ''
  const isOverdue = task.deadline && task.status !== 'done' && toDateHelper(task.deadline) < new Date()

  const doneClass = task.status === 'done' ? ' done' : ''

  // Column layout for overlapping blocks
  const { col, totalCols } = pos || { col: 0, totalCols: 1 }
  const PAD = 4 // px padding on each side
  const colWidth = `calc((100% - ${PAD * 2}px) / ${totalCols})`
  const colLeft = `calc(${PAD}px + (100% - ${PAD * 2}px) * ${col} / ${totalCols})`

  if (compact) {
    // Single-line compact layout for short blocks
    return `
      <div class="time-block task-block compact${doneClass}" data-task-id="${task.id}"
           style="top:${top}px;height:${height}px;left:${colLeft};width:${colWidth}" title="${esc(task.title)}">
        <div class="tb-main" data-task-id="${task.id}">
          ${statusHtml}
          ${urgentIcon}${highIcon}
          ${clientLogo}
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

  // Full card-like layout for taller blocks
  return `
    <div class="time-block task-block${doneClass}" data-task-id="${task.id}"
         style="top:${top}px;height:${height}px;left:${colLeft};width:${colWidth}" title="${esc(task.title)}">
      <div class="tb-main tb-main-card" data-task-id="${task.id}">
        <div class="tb-card-header">
          ${statusHtml}
          ${urgentIcon}${highIcon}
          <span class="tb-title">${esc(task.title)}</span>
        </div>
        <div class="tb-card-meta">
          ${clientLogo}
          ${project ? `<span class="tb-project">${esc(project.name)}</span>` : ''}
          ${deadlineStr ? `<span class="tb-deadline${isOverdue ? ' overdue' : ''}">${deadlineStr}</span>` : ''}
          <span class="tb-duration">${durLabel}</span>
        </div>
      </div>
      ${isOwnDay ? `<div class="tb-actions">
        <button class="btn-icon-xs" data-action="unschedule" data-task-id="${task.id}" title="Remove from timeline"><i class="ph ph-x"></i></button>
      </div>
      <div class="tb-resize" data-task-id="${task.id}"></div>` : ''}
    </div>
  `
}

function formatBlockDeadline(deadline) {
  const d = toDateHelper(deadline)
  if (!d) return ''
  const now = new Date()
  const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff <= 7) return `${diff}d`
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

function toDateHelper(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function renderCalBlock(event, pos) {
  const startY = isoToY(event.start)
  const endY = isoToY(event.end)
  const top = Math.max(startY, 0)
  const height = Math.max(Math.min(endY, GRID_H) - top, SLOT_H)
  const compact = height <= SLOT_H

  // Only render meet icon for blocks tall enough to display it (3+ slots / 45min)
  const meetIcon = height >= SLOT_H * 3 && event.hangoutLink
    ? `<a href="${esc(event.hangoutLink)}" target="_blank" rel="noopener" class="tb-meet" title="Join meeting" onclick="event.stopPropagation()"><i class="ph-fill ph-video-camera"></i></a>`
    : ''

  // Column layout for overlapping blocks
  const { col, totalCols } = pos || { col: 0, totalCols: 1 }
  const PAD = 4
  const colWidth = `calc((100% - ${PAD * 2}px) / ${totalCols})`
  const colLeft = `calc(${PAD}px + (100% - ${PAD * 2}px) * ${col} / ${totalCols})`

  return `
    <a href="${esc(event.htmlLink || '#')}" target="_blank" rel="noopener"
       class="time-block cal-block${compact ? ' compact' : ''}"
       style="top:${top}px;height:${height}px;left:${colLeft};width:${colWidth}" title="${esc(event.summary)}">
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

  // ── Half-hour hover highlight ──
  let hoverLabel = null
  if (slotsEl) {
    slotsEl.addEventListener('mousemove', (e) => {
      if (isDragging) return
      // Don't highlight if hovering over an existing block
      const blockUnder = document.elementFromPoint(e.clientX, e.clientY)
      if (blockUnder && blockUnder.closest('.time-block')) {
        clearHover(slotsEl)
        if (hoverLabel) { hoverLabel.remove(); hoverLabel = null }
        return
      }
      const rect = slotsEl.getBoundingClientRect()
      const y = e.clientY - rect.top + (scroll?.scrollTop || 0)
      const slotIdx = Math.floor(y / SLOT_H)
      // Snap to even slot (30-min boundary)
      const baseSlot = slotIdx - (slotIdx % 2)
      slotsEl.querySelectorAll('.tg-slot').forEach((s, i) => {
        s.classList.toggle('slot-hover', i >= baseSlot && i < baseSlot + 2)
      })
      // Floating time label
      if (!hoverLabel) {
        hoverLabel = document.createElement('div')
        hoverLabel.className = 'tg-hover-label'
        body.appendChild(hoverLabel)
      }
      const timeStr = slotToTimeStr(baseSlot)
      hoverLabel.textContent = fmtTime(timeStr)
      hoverLabel.style.top = (baseSlot * SLOT_H) + 'px'
    })

    slotsEl.addEventListener('mouseleave', () => {
      clearHover(slotsEl)
      if (hoverLabel) { hoverLabel.remove(); hoverLabel = null }
    })
  }

  function clearHover(el) {
    el.querySelectorAll('.tg-slot').forEach((s) => s.classList.remove('slot-hover'))
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

  // Get all active tasks assigned to user that are not done/backlog
  const available = tasks
    .filter((t) =>
      (t.assignees || []).includes(targetEmail) &&
      t.status !== 'done' &&
      t.status !== 'backlog'
    )
    .slice(0, 15) // cap for popover size

  const time = slotToTimeStr(slotIdx)
  const endTime = slotToTimeStr(Math.min(slotIdx + 2, TOTAL_SLOTS))

  const pickerHtml = `
    <div class="tg-picker" id="tg-picker" style="top:${slotIdx * SLOT_H}px">
      <div class="tg-picker-header">${fmtTime(time)}</div>
      <div class="tg-picker-new">
        <i class="ph ph-plus-circle" style="font-size:16px;color:var(--text-tertiary);flex-shrink:0"></i>
        <input class="tg-picker-new-input" id="tg-picker-new-input" placeholder="New task at ${fmtTime(time)}" type="text">
      </div>
      ${available.length > 0 ? `
        <div class="tg-picker-divider"></div>
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
      ` : ''}
    </div>
  `

  const body = container.querySelector('.tg-body')
  if (!body) return
  body.insertAdjacentHTML('beforeend', pickerHtml)

  const picker = body.querySelector('#tg-picker')
  if (!picker) return

  // Focus the new task input
  const newInput = picker.querySelector('#tg-picker-new-input')
  if (newInput) {
    requestAnimationFrame(() => newInput.focus())
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const title = newInput.value.trim()
        if (!title) return
        newInput.disabled = true
        picker.remove()
        onSave('new-task', null, time, endTime, title)
      }
      if (e.key === 'Escape') {
        picker.remove()
      }
    })
  }

  // Handle pick existing task
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

function deadlineTagHtml(task, now) {
  if (!task.deadline) return ''
  const d = toDateHelper(task.deadline)
  if (!d) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24))
  let cls = '', label = ''
  if (diff < 0) { cls = 'overdue'; label = `${Math.abs(diff)}d overdue` }
  else if (diff === 0) { cls = 'due-today'; label = 'Due today' }
  else if (diff <= 2) { cls = 'due-soon'; label = `Due in ${diff}d` }
  else { label = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) }
  return `<span class="my-day-deadline ${cls}">${label}</span>`
}

function esc(str) {
  if (!str) return ''
  const d = document.createElement('span')
  d.textContent = str
  return d.innerHTML
}
