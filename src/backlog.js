import { TEAM } from './config.js'
import { createTask, updateTask } from './db.js'
import { openModal } from './modal.js'
import { attachMention } from './mention.js'
import { setSelectedTaskIds, clearSelection } from './context-menu.js'
import { toDate, formatDeadline } from './utils/dates.js'

// null = unset (default to logged-in user on first render); 'all' = everyone; else email
let viewingEmail = null
let selectedClientId = '' // '' = all clients

// Listeners attached to the container are aborted at the start of each render
// so they don't accumulate.
let renderAC = null

export function renderBacklog(container, tasks, currentUser, ctx) {
  renderAC?.abort()
  renderAC = new AbortController()
  const renderSignal = renderAC.signal

  const myEmail = currentUser?.email
  if (viewingEmail === null) viewingEmail = myEmail

  // Filter to backlog
  let items = tasks.filter((t) => t.status === 'backlog')

  // Person scope
  if (viewingEmail !== 'all') {
    items = items.filter((t) => (t.assignees || []).includes(viewingEmail))
  }

  // Counts per client (within current person scope, before client filter)
  const clientCounts = new Map()
  items.forEach((t) => {
    if (t.clientId) clientCounts.set(t.clientId, (clientCounts.get(t.clientId) || 0) + 1)
  })
  const totalCount = items.length
  const activeClients = (ctx.clients || []).filter((c) => clientCounts.has(c.id))

  // Reset client tab if it no longer has items
  if (selectedClientId && !clientCounts.has(selectedClientId)) selectedClientId = ''

  if (selectedClientId) items = items.filter((t) => t.clientId === selectedClientId)
  items = sortUrgentFirst(items)

  // Heading
  const isMe = viewingEmail === myEmail
  const isAll = viewingEmail === 'all'
  const target = isAll ? null : TEAM.find((m) => m.email === viewingEmail)
  const headingText = isAll ? "Everyone's backlog"
    : `${target?.name || 'Backlog'}'s backlog`

  container.innerHTML = `
    <div class="backlog-view">
      <div class="my-day-header">
        <div>
          <div class="my-day-greeting-row">
            <h2 class="my-day-greeting">${esc(headingText)}</h2>
            <button class="myday-person-toggle" id="backlog-person-toggle" title="View someone else's backlog">
              <i class="ph-fill ph-caret-down"></i>
            </button>
          </div>
          <div class="my-day-stats" style="margin-top:6px">
            <span class="my-day-stat"><i class="ph-fill ph-stack"></i> ${totalCount} item${totalCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      ${activeClients.length > 0 ? `
      <div class="my-week-client-tabs" id="backlog-client-tabs">
        <button class="client-tab${selectedClientId === '' ? ' active' : ''}" data-client-id="">
          <span class="client-tab-logos">${activeClients.slice(0, 3).map((c) =>
            c.logoUrl
              ? `<img class="client-tab-logo" src="${c.logoUrl}" alt="${esc(c.name)}">`
              : `<span class="client-tab-logo client-tab-logo-placeholder">${c.name[0]}</span>`
          ).join('')}</span>
          <span class="client-tab-label">All Clients</span>
          <span class="client-tab-count">${totalCount}</span>
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
      </div>` : ''}

      <div class="backlog-list">
        ${items.length
          ? items.map((t) => taskRow(t, ctx, isAll)).join('')
          : `<div class="backlog-empty">
              <i class="ph ph-stack"></i>
              <p>Nothing in the backlog${selectedClientId ? ' for this client' : isAll ? '' : ` for ${esc(target?.name || '')}`}.</p>
            </div>`
        }
        <div class="column-add-wrap">
          <input class="column-add-input" id="backlog-add-input" placeholder="+ Add task (@ to tag)" type="text">
        </div>
      </div>
    </div>`

  // Row click → modal (ignore promote button)
  container.querySelectorAll('.my-task-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.backlog-promote-btn')) return
      const task = items.find((t) => t.id === row.dataset.id)
      if (task) openModal(task, ctx)
    })
  })

  // Promote → Todo
  container.querySelectorAll('.backlog-promote-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const row = btn.closest('.my-task-row')
      const taskId = row.dataset.id
      btn.disabled = true
      row.classList.add('promoting')
      await updateTask(ctx.db, taskId, { status: 'todo' })
    })
  })

  // Client tabs
  container.querySelectorAll('.client-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      selectedClientId = tab.dataset.clientId
      renderBacklog(container, tasks, currentUser, ctx)
    })
  })

  // Person toggle
  container.querySelector('#backlog-person-toggle')?.addEventListener('click', () => {
    openPersonPicker(container, tasks, currentUser, ctx)
  })

  // Inline add-task input with @ mention
  const addInput = container.querySelector('#backlog-add-input')
  if (addInput) {
    const mention = attachMention(addInput, { projects: ctx.projects, clients: ctx.clients })
    addInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !mention.isOpen()) {
        const title = addInput.value.trim()
        if (!title) return
        const mentionTags = mention.getTags()
        const baseAssignees = (!isAll && viewingEmail) ? [viewingEmail] : []
        const allAssignees = [...new Set([...baseAssignees, ...mentionTags.assignees])]
        addInput.disabled = true
        await createTask(ctx.db, {
          title,
          status: 'backlog',
          assignees: allAssignees,
          clientId: selectedClientId || ctx.filterClientId || '',
          projectId: mentionTags.projectId || ctx.filterProjectId || '',
          createdBy: currentUser?.email || '',
        })
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

  setupMarquee(container, renderSignal)
}

function sortUrgentFirst(tasks) {
  return [...tasks].sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1))
}

function taskRow(task, ctx, showAssignees) {
  const client = ctx.clients.find((c) => c.id === task.clientId)
  const project = ctx.projects.find((p) => p.id === task.projectId)
  const deadlineStr = formatDeadline(task.deadline)
  const isOverdue = task.deadline && toDate(task.deadline) < new Date()

  const clientLogo = client?.logoUrl
    ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="${esc(client.name)}" title="${esc(client.name)}">`
    : ''

  let assigneesHtml = ''
  if (showAssignees) {
    const assignees = (task.assignees || []).map((email) => TEAM.find((m) => m.email === email)).filter(Boolean)
    assigneesHtml = assignees.slice(0, 3).map((m) => m.photoURL
      ? `<img class="backlog-assignee" src="${m.photoURL}" alt="${esc(m.name)}" title="${esc(m.name)}">`
      : `<span class="backlog-assignee backlog-assignee-initial" style="background:${m.color}" title="${esc(m.name)}">${m.name[0]}</span>`
    ).join('')
  }

  return `
    <div class="my-task-row" data-id="${task.id}">
      <i class="ph-fill ph-prohibit status-icon backlog"></i>
      ${task.priority === 'urgent' ? '<i class="ph-fill ph-warning urgent-icon"></i>' : ''}
      ${clientLogo}
      ${project ? `<span class="my-task-project">${esc(project.name)}</span>` : ''}
      <span class="my-task-title">${esc(task.title)}</span>
      <div class="my-task-meta">
        ${assigneesHtml ? `<span class="backlog-assignees">${assigneesHtml}</span>` : ''}
        ${deadlineStr ? `<span class="my-task-deadline${isOverdue ? ' overdue' : ''}">${deadlineStr}</span>` : ''}
      </div>
      <button class="backlog-promote-btn" title="Move to To Do">
        <i class="ph ph-arrow-right"></i>Todo
      </button>
    </div>`
}

// ── Person picker (with "Everyone" option) ──
function openPersonPicker(container, tasks, currentUser, ctx) {
  const existing = document.querySelector('.person-picker-overlay')
  if (existing) { existing.remove(); return }

  const myEmail = currentUser?.email
  const overlay = document.createElement('div')
  overlay.className = 'person-picker-overlay'

  const everyoneOpt = `
    <div class="person-picker-option${viewingEmail === 'all' ? ' active' : ''}" data-email="all">
      <span class="avatar-sm" style="background:var(--text-tertiary);color:white"><i class="ph-fill ph-users-three"></i></span>
      <div class="person-picker-option-info">
        <span class="person-picker-option-name">Everyone</span>
      </div>
      ${viewingEmail === 'all' ? '<i class="ph-fill ph-check-circle" style="color:var(--primary);font-size:18px"></i>' : ''}
    </div>
  `

  const teamOpts = TEAM.map((m) => {
    const avatarHtml = m.photoURL
      ? `<img class="avatar-photo-sm" src="${m.photoURL}" alt="${esc(m.name)}">`
      : `<span class="avatar-sm" style="background:${m.color}">${m.name[0]}</span>`
    const isCurrent = m.email === viewingEmail
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
        <span class="person-picker-sheet-title">View whose backlog</span>
        <button class="modal-close person-picker-close">&times;</button>
      </div>
      <div class="person-picker-sheet-list">
        ${everyoneOpt}
        ${teamOpts}
      </div>
    </div>`

  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('.person-picker-close').addEventListener('click', () => overlay.remove())
  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey) }
  }
  document.addEventListener('keydown', onKey)

  overlay.querySelectorAll('.person-picker-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      viewingEmail = opt.dataset.email
      // reset client filter on person change so counts stay meaningful
      selectedClientId = ''
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      renderBacklog(container, tasks, currentUser, ctx)
    })
  })
}

// ── Marquee (lasso) selection — same pattern as my-day, targets .my-task-row ──
function setupMarquee(container, renderSignal) {
  let marqueeEl = null
  let startX = 0, startY = 0
  let isDragging = false

  const onMarqueeDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.my-task-row, button, input, a, .ctx-menu, .my-week-client-tabs, .my-day-header')) return

    clearSelection()

    startX = e.clientX
    startY = e.clientY
    isDragging = false

    const onMove = (me) => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      if (!isDragging && Math.abs(dx) < 5 && Math.abs(dy) < 5) return

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

      const marqueeRect = { left: x, top: y, right: x + w, bottom: y + h }
      const selected = new Set()
      container.querySelectorAll('.my-task-row').forEach((row) => {
        const cr = row.getBoundingClientRect()
        const intersects =
          cr.left < marqueeRect.right &&
          cr.right > marqueeRect.left &&
          cr.top < marqueeRect.bottom &&
          cr.bottom > marqueeRect.top
        if (intersects) {
          row.classList.add('selected')
          selected.add(row.dataset.id)
        } else {
          row.classList.remove('selected')
        }
      })
      setSelectedTaskIds(selected, () => {
        container.querySelectorAll('.my-task-row.selected').forEach((r) => r.classList.remove('selected'))
      })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (marqueeEl) { marqueeEl.remove(); marqueeEl = null }
      if (!isDragging) clearSelection()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  container.addEventListener('mousedown', onMarqueeDown, { signal: renderSignal })
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
