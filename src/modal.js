import { TEAM, PRIORITIES, STATUSES } from './config.js'
import { createTask, updateTask, deleteTask, createProject } from './db.js'

const overlay = document.getElementById('task-modal')
const closeBtn = document.getElementById('modal-close')
const cancelBtn = document.getElementById('task-cancel')
const saveBtn = document.getElementById('task-save')
const deleteBtn = document.getElementById('task-delete')
const titleEl = document.getElementById('modal-title')

let currentTask = null
let currentCtx = null
let selectedAssignees = []
let selectedProjectId = ''
let selectedClientId = ''

// Project picker DOM refs
const pickerEl = document.getElementById('project-picker')
const pickerDisplay = document.getElementById('project-picker-display')
const pickerText = document.getElementById('project-picker-text')
const pickerClear = document.getElementById('project-picker-clear')
const pickerDropdown = document.getElementById('project-picker-dropdown')
const pickerSearch = document.getElementById('project-picker-search')
const pickerList = document.getElementById('project-picker-list')
const pickerCreate = document.getElementById('project-picker-create')

// Close handlers
closeBtn.addEventListener('click', close)
cancelBtn.addEventListener('click', close)
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) close()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!pickerDropdown.classList.contains('hidden')) {
      closeProjectPicker()
      e.stopPropagation()
    } else {
      close()
    }
  }
})

// Save handler
saveBtn.addEventListener('click', async () => {
  const title = document.getElementById('task-title').value.trim()
  if (!title) {
    document.getElementById('task-title').focus()
    return
  }

  const status = document.getElementById('task-status').value
  const data = {
    title,
    description: document.getElementById('task-description').value.trim(),
    clientId: selectedClientId,
    projectId: selectedProjectId,
    assignees: [...selectedAssignees],
    status,
    priority: document.getElementById('task-priority').value,
    deadline: document.getElementById('task-deadline').value || null,
  }

  // Include user-provided closedAt when status is done
  if (status === 'done') {
    const closedAtVal = document.getElementById('task-closed-at').value
    if (closedAtVal) {
      data.closedAt = closedAtVal
    }
  }

  // Handle new note
  const noteText = document.getElementById('task-notes').value.trim()
  if (noteText) {
    const userName =
      TEAM.find((m) => m.email === currentCtx.currentUser?.email)?.name ||
      currentCtx.currentUser?.displayName ||
      ''
    const newNote = {
      text: noteText,
      author: userName,
      timestamp: new Date().toISOString(),
    }
    if (currentTask) {
      data.notes = [...(currentTask.notes || []), newNote]
    } else {
      data.notes = [newNote]
    }
  }

  if (currentTask) {
    await updateTask(currentCtx.db, currentTask.id, data)
  } else {
    data.createdBy = currentCtx.currentUser?.email || ''
    await createTask(currentCtx.db, data)
  }

  close()
})

// Delete handler
deleteBtn.addEventListener('click', async () => {
  if (currentCtx.userRole === 'client') {
    alert('You do not have permissions to Delete tasks.')
    return
  }
  if (currentTask && confirm('Delete this task?')) {
    await deleteTask(currentCtx.db, currentTask.id)
    close()
  }
})

// ===== Status Pills =====
const statusPillsEl = document.getElementById('task-status-pills')
const statusHiddenEl = document.getElementById('task-status')

statusPillsEl.addEventListener('click', (e) => {
  const pill = e.target.closest('.status-pill')
  if (!pill) return
  const status = pill.dataset.status
  statusHiddenEl.value = status
  statusPillsEl.querySelectorAll('.status-pill').forEach((p) => p.classList.remove('active'))
  pill.classList.add('active')
  updateClosedAtVisibility(status)
})

function setStatusPill(status) {
  statusHiddenEl.value = status
  statusPillsEl.querySelectorAll('.status-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.status === status)
  })
  updateClosedAtVisibility(status)
}

function updateClosedAtVisibility(status) {
  const row = document.getElementById('task-closed-at-row')
  const input = document.getElementById('task-closed-at')
  if (status === 'done') {
    row.classList.remove('hidden')
    // Auto-fill with today if empty (user just marked as done)
    if (!input.value) {
      input.value = new Date().toISOString().split('T')[0]
    }
  } else {
    row.classList.add('hidden')
  }
}

// ===== Project Picker =====

pickerDisplay.addEventListener('click', () => {
  if (pickerDropdown.classList.contains('hidden')) {
    openProjectPicker()
  } else {
    closeProjectPicker()
  }
})

pickerClear.addEventListener('click', (e) => {
  e.stopPropagation()
  selectProject('', '')
})

pickerSearch.addEventListener('input', () => {
  renderProjectList(pickerSearch.value.trim())
})

// Close picker when clicking outside
document.addEventListener('mousedown', (e) => {
  if (!pickerEl.contains(e.target) && !pickerDropdown.classList.contains('hidden')) {
    closeProjectPicker()
  }
})

function openProjectPicker() {
  pickerDropdown.classList.remove('hidden')
  pickerEl.classList.add('open')
  pickerSearch.value = ''
  renderProjectList('')
  pickerSearch.focus()
}

function closeProjectPicker() {
  pickerDropdown.classList.add('hidden')
  pickerEl.classList.remove('open')
}

function selectProject(projectId, clientId) {
  selectedProjectId = projectId
  selectedClientId = clientId
  document.getElementById('task-project').value = projectId
  document.getElementById('task-client').value = clientId
  updatePickerDisplay()
  closeProjectPicker()
}

function updatePickerDisplay() {
  if (selectedProjectId) {
    const project = currentCtx.projects.find((p) => p.id === selectedProjectId)
    const client = selectedClientId ? currentCtx.clients.find((c) => c.id === selectedClientId) : null
    const label = client ? `${client.name} · ${project?.name || ''}` : (project?.name || '')
    pickerText.textContent = label
    pickerText.classList.remove('placeholder')
    pickerClear.classList.remove('hidden')
  } else {
    pickerText.textContent = 'Select project...'
    pickerText.classList.add('placeholder')
    pickerClear.classList.add('hidden')
  }
}

function renderProjectList(query) {
  const q = query.toLowerCase()
  const clients = currentCtx.clients || []
  const projects = currentCtx.projects || []

  // Group projects by client
  const grouped = []

  // Projects with a client
  clients.forEach((client) => {
    const clientProjects = projects
      .filter((p) => p.clientId === client.id)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || client.name.toLowerCase().includes(q))
    if (clientProjects.length > 0) {
      grouped.push({ client, projects: clientProjects })
    }
  })

  // Projects without a client
  const uncategorized = projects
    .filter((p) => !p.clientId)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
  if (uncategorized.length > 0) {
    grouped.push({ client: null, projects: uncategorized })
  }

  // Render
  if (grouped.length === 0 && !q) {
    pickerList.innerHTML = '<div class="project-picker-no-results">No projects yet</div>'
  } else if (grouped.length === 0) {
    pickerList.innerHTML = '<div class="project-picker-no-results">No matching projects</div>'
  } else {
    pickerList.innerHTML = grouped.map((group) => {
      const logoHtml = group.client?.logoUrl
        ? `<img src="${group.client.logoUrl}" alt="${esc(group.client.name)}">`
        : ''
      const groupLabel = group.client
        ? `<div class="project-picker-group-label">${logoHtml} ${esc(group.client.name)}</div>`
        : `<div class="project-picker-group-label">Uncategorized</div>`
      const options = group.projects.map((p) => {
        const isSelected = p.id === selectedProjectId
        return `<div class="project-picker-option${isSelected ? ' selected' : ''}" data-project-id="${p.id}" data-client-id="${p.clientId || ''}">
          ${esc(p.name)}
          ${isSelected ? '<i class="ph ph-check"></i>' : ''}
        </div>`
      }).join('')
      return `<div class="project-picker-group">${groupLabel}${options}</div>`
    }).join('')
  }

  // Bind option clicks
  pickerList.querySelectorAll('.project-picker-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      selectProject(opt.dataset.projectId, opt.dataset.clientId)
    })
  })

  // Show/hide create button
  if (q) {
    const exactMatch = projects.some((p) => p.name.toLowerCase() === q)
    if (!exactMatch) {
      pickerCreate.classList.remove('hidden')
      pickerCreate.innerHTML = `<button class="project-picker-create-btn" type="button">
        <i class="ph ph-plus"></i> Create "${esc(query)}"
      </button>`
      pickerCreate.querySelector('button').addEventListener('click', async () => {
        const newDoc = await createProject(currentCtx.db, { name: query })
        const newProject = { id: newDoc.id, name: query, clientId: '' }
        currentCtx.projects.push(newProject)
        selectProject(newDoc.id, '')
      })
    } else {
      pickerCreate.classList.add('hidden')
      pickerCreate.innerHTML = ''
    }
  } else {
    pickerCreate.classList.add('hidden')
    pickerCreate.innerHTML = ''
  }
}

// ===== Open Modal =====

export function openModal(task, ctx) {
  currentTask = task
  currentCtx = ctx

  titleEl.textContent = task ? (task.title || 'Edit Task') : 'New Task'
  deleteBtn.classList.toggle('hidden', !task)

  // Set project picker state
  selectedProjectId = task?.projectId || ''
  selectedClientId = task?.clientId || ''
  updatePickerDisplay()
  closeProjectPicker()

  // Populate assignees multi-select
  selectedAssignees = task?.assignees ? [...task.assignees] : (task?.assignee ? [task.assignee] : [])
  renderAssigneeSelector()

  // Fill form
  document.getElementById('task-title').value = task?.title || ''
  document.getElementById('task-description').value = task?.description || ''
  setStatusPill(task?.status || ctx.defaultStatus || 'todo')
  document.getElementById('task-priority').value = task?.priority || 'medium'
  document.getElementById('task-deadline').value = formatDateInput(task?.deadline)
  document.getElementById('task-closed-at').value = formatDateInput(task?.closedAt)
  document.getElementById('task-notes').value = ''

  // Render existing notes
  const notesList = document.getElementById('task-notes-list')
  const notes = task?.notes || []
  if (notes.length > 0) {
    notesList.innerHTML = notes
      .slice()
      .reverse()
      .map(
        (n) => `
      <div class="note-item">
        <div class="note-meta">${esc(n.author)} &middot; ${formatNoteDate(n.timestamp)}</div>
        <div>${esc(n.text)}</div>
      </div>
    `
      )
      .join('')
  } else {
    notesList.innerHTML = ''
  }

  // Show modal
  overlay.classList.remove('hidden')
  document.getElementById('task-title').focus()
}

function renderAssigneeSelector() {
  const rowEl = document.getElementById('task-assignees-inline')

  rowEl.innerHTML = TEAM.map((m) => {
    const checked = selectedAssignees.includes(m.email)
    const avatarHtml = m.photoURL
      ? `<img class="avatar-photo-xs" src="${m.photoURL}" alt="${m.name}">`
      : `<span class="avatar-xs" style="background:${m.color}">${m.name[0]}</span>`
    return `<label class="assignee-inline-item${checked ? ' selected' : ''}">
      <input type="checkbox" value="${m.email}" ${checked ? 'checked' : ''}>
      ${avatarHtml}
      <span>${esc(m.name)}</span>
    </label>`
  }).join('')

  // Bind checkbox toggles
  rowEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!selectedAssignees.includes(cb.value)) {
          selectedAssignees.push(cb.value)
        }
      } else {
        selectedAssignees = selectedAssignees.filter((em) => em !== cb.value)
      }
      renderAssigneeSelector()
    })
  })
}

function close() {
  overlay.classList.add('hidden')
  closeProjectPicker()
  currentTask = null
  currentCtx = null
  selectedAssignees = []
  selectedProjectId = ''
  selectedClientId = ''
}

function formatDateInput(deadline) {
  if (!deadline) return ''
  const d = deadline.toDate ? deadline.toDate() : deadline.seconds ? new Date(deadline.seconds * 1000) : new Date(deadline)
  return d.toISOString().split('T')[0]
}

function formatNoteDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
