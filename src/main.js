import { initializeApp } from 'firebase/app'
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { firebaseConfig, TEAM, STATUSES } from './config.js'
import { loadClients, loadProjects, loadPeople, subscribeToTasks, saveUserProfile, loadUserProfiles, updateTask, loadClientUser, subscribeToTasksByClient } from './db.js'
import { renderBoard, renderBoardByAssignee, renderBoardByClient, renderBoardByProject } from './board.js'
import { renderMyTasks } from './my-tasks.js'
import { renderMyDay } from './my-day.js'
import { renderStandup } from './standup.js'
import { renderClients, cleanupClients } from './clients.js'
import { renderPeople, cleanupPeople } from './people.js'
import { renderWiki, cleanupWiki } from './wiki.js'
import { renderReferences, cleanupReferences } from './references.js'
import { renderTimesheets } from './timesheets.js'
import { openModal } from './modal.js'
import { initContextMenu } from './context-menu.js'
import { setAccessToken, clearAccessToken } from './calendar.js'
import { renderClientBoard } from './client-board.js'
import { renderClientTimesheets } from './client-timesheets.js'

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
export const db = getFirestore(app)

// State
let currentUser = null
let currentView = 'my-day'
let currentBoardView = 'status'
let allTasks = []
let userRole = null       // 'team' | 'client' | null
let userClientId = null   // only set for client users
let userClientName = null // client org name
let clients = []
let projects = []
let people = []
let unsubTasks = null

// ── Hash-based routing ──
const ROUTES = {
  '/my-day':        { view: 'my-day' },
  '/my-tasks':      { view: 'my-tasks' },
  '/board':         { view: 'board', boardView: 'status' },
  '/board/backlog': { view: 'board', boardView: 'status' },
  '/board/team':    { view: 'board', boardView: 'assignee' },
  '/board/clients': { view: 'board', boardView: 'client' },
  '/board/projects':{ view: 'board', boardView: 'project' },
  '/standup':       { view: 'standup' },
  '/timesheets':    { view: 'timesheets' },
  '/people':        { view: 'people' },
  '/wiki':          { view: 'wiki' },
  '/references':    { view: 'references' },
  '/manage':        { view: 'clients' },
  '/client-board':      { view: 'client-board' },
  '/client-timesheets': { view: 'client-timesheets' },
}

const VIEW_TO_PATH = {
  'my-day': '/my-day', 'my-tasks': '/my-tasks', 'standup': '/standup',
  'timesheets': '/timesheets', 'people': '/people', 'wiki': '/wiki',
  'references': '/references', 'clients': '/manage',
  'client-board': '/client-board', 'client-timesheets': '/client-timesheets',
}
const BOARD_TO_PATH = {
  'status': '/board/backlog', 'assignee': '/board/team',
  'client': '/board/clients', 'project': '/board/projects',
}

function navigateTo(view, boardView) {
  const path = view === 'board'
    ? (BOARD_TO_PATH[boardView || currentBoardView] || '/board/backlog')
    : (VIEW_TO_PATH[view] || '/my-day')
  location.hash = path
}

function handleRouteChange() {
  const hash = (location.hash || '').replace(/^#/, '')
  const route = ROUTES[hash]

  if (route) {
    currentView = route.view
    if (route.boardView) currentBoardView = route.boardView
  } else {
    currentView = userRole === 'client' ? 'client-board' : 'my-day'
    history.replaceState(null, '', userRole === 'client' ? '#/client-board' : '#/my-day')
  }

  // Sync nav-tab active state
  navTabs.forEach((t) => t.classList.toggle('active', t.dataset.view === currentView))

  if (currentUser) renderCurrentView()
}

window.addEventListener('hashchange', handleRouteChange)

// DOM refs
const loginScreen = document.getElementById('login-screen')
const appShell = document.getElementById('app-shell')
const loginBtn = document.getElementById('login-btn')
const logoutBtn = document.getElementById('logout-btn')
const userAvatar = document.getElementById('user-avatar')
const mainContent = document.getElementById('main-content')
const newTaskBtn = document.getElementById('new-task-btn')
const navTabs = document.querySelectorAll('.nav-tab')
const filterAssignee = document.getElementById('filter-assignee')

// Header project filter picker refs
const hfPicker = document.getElementById('header-project-filter')
const hfDisplay = document.getElementById('header-filter-display')
const hfText = document.getElementById('header-filter-text')
const hfClear = document.getElementById('header-filter-clear')
const hfDropdown = document.getElementById('header-filter-dropdown')
const hfSearch = document.getElementById('header-filter-search')
const hfList = document.getElementById('header-filter-list')

// Filter state — multiselect: set of selected project IDs
let selectedFilterIds = new Set()

// Context menu (right-click on any task card)
initContextMenu(() => ({
  db, currentUser, clients, projects, allTasks, onSave: renderCurrentView,
}))

// Status icon cycle click (delegated globally)
const STATUS_CYCLE = ['todo', 'in_progress', 'review', 'done']
let statusToastTimer = null
let statusToastTaskId = null
let statusOriginal = null // status before first click in a burst

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="cycle-status"]')
  if (!btn) return
  e.stopPropagation()
  e.preventDefault()

  // Find the task card ancestor (data-id for my-day cards, data-task-id for time grid blocks)
  const card = btn.closest('[data-id]') || btn.closest('[data-task-id]')
  if (!card) return
  const taskId = card.dataset.id || card.dataset.taskId
  const task = allTasks.find((t) => t.id === taskId)
  if (!task) return

  // Capture original status on first click of a burst
  if (!statusToastTimer || statusToastTaskId !== taskId) {
    statusOriginal = task.status
  }

  const idx = STATUS_CYCLE.indexOf(task.status)
  const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]

  btn.disabled = true
  await updateTask(db, taskId, { status: nextStatus })

  // Debounced toast — wait 500ms after last click to show final status
  if (statusToastTimer) clearTimeout(statusToastTimer)
  statusToastTaskId = taskId
  const origForUndo = statusOriginal
  statusToastTimer = setTimeout(() => {
    const freshTask = allTasks.find((t) => t.id === statusToastTaskId)
    if (freshTask) {
      const statusLabel = STATUSES.find((s) => s.id === freshTask.status)?.label || freshTask.status
      showStatusToast(freshTask.title, statusLabel, statusToastTaskId, origForUndo)
    }
    statusToastTimer = null
    statusToastTaskId = null
    statusOriginal = null
  }, 500)
})

// Status toast with Undo
function showStatusToast(title, statusLabel, taskId, previousStatus) {
  let toast = document.getElementById('status-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'status-toast'
    toast.className = 'status-toast'
    document.body.appendChild(toast)
  }

  const prevLabel = STATUSES.find((s) => s.id === previousStatus)?.label || previousStatus
  toast.innerHTML = `
    <span class="status-toast-msg">${esc(title)} → <strong>${statusLabel}</strong></span>
    <button class="status-toast-undo" id="status-toast-undo">Undo</button>
  `
  toast.classList.remove('hide')
  toast.classList.add('show')

  // Wire undo
  const undoBtn = toast.querySelector('#status-toast-undo')
  undoBtn.addEventListener('click', async () => {
    undoBtn.disabled = true
    undoBtn.textContent = '...'
    await updateTask(db, taskId, { status: previousStatus })
    toast.classList.remove('show')
    toast.classList.add('hide')
  })

  // Auto-hide after 4s (longer to give time to undo)
  clearTimeout(toast._hideTimer)
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show')
    toast.classList.add('hide')
  }, 4000)
}

// Auth
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })
provider.addScope('https://www.googleapis.com/auth/calendar.events.readonly')

loginBtn.addEventListener('click', async () => {
  try {
    const result = await signInWithPopup(auth, provider)
    // Capture Google OAuth access token for Calendar API
    const credential = GoogleAuthProvider.credentialFromResult(result)
    if (credential?.accessToken) {
      setAccessToken(credential.accessToken)
    }
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Login error:', err)
    }
  }
})

logoutBtn.addEventListener('click', () => {
  clearAccessToken()
  signOut(auth)
})

// Re-authenticate to get a fresh Google Calendar access token
export async function reconnectCalendar() {
  try {
    const result = await signInWithPopup(auth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    if (credential?.accessToken) {
      setAccessToken(credential.accessToken)
      return true
    }
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Calendar reconnect error:', err)
    }
  }
  return false
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user

    // Detect user role
    if (user.email.endsWith('@publicknowledge.co')) {
      userRole = 'team'
      userClientId = null
      userClientName = null
    } else {
      // Check clientUsers allowlist
      const clientUserDoc = await loadClientUser(db, user.email)
      if (clientUserDoc) {
        userRole = 'client'
        userClientId = clientUserDoc.clientId
      } else {
        // Not authorized — sign out
        userRole = null
        const loginNote = document.querySelector('.login-note')
        if (loginNote) loginNote.textContent = 'Access denied. Contact your project manager for an invitation.'
        await signOut(auth)
        return
      }
    }

    loginScreen.classList.add('hidden')
    appShell.classList.remove('hidden')

    // Set avatar — use Google photo
    const member = TEAM.find((m) => m.email === user.email)
    if (user.photoURL) {
      userAvatar.innerHTML = `<img class="avatar-photo-sm" src="${user.photoURL}" alt="${user.displayName || ''}">`
      userAvatar.style.background = 'none'
      // Store photoURL on the TEAM member for use in board/standup
      if (member) member.photoURL = user.photoURL
      // Persist photo to Firestore so other users can see it (team only)
      if (userRole === 'team') {
        saveUserProfile(db, user.email, {
          photoURL: user.photoURL,
          displayName: user.displayName || '',
        })
      }
    } else {
      const initial = (user.displayName || user.email)[0].toUpperCase()
      userAvatar.textContent = initial
      userAvatar.style.background = member?.color || '#6b7280'
    }

    // Load all user profiles and apply photos to TEAM members
    if (userRole === 'team') {
      const profiles = await loadUserProfiles(db)
      TEAM.forEach((m) => {
        if (profiles[m.email]?.photoURL) {
          m.photoURL = profiles[m.email].photoURL
        }
      })
    }

    // Load reference data
    clients = await loadClients(db)
    projects = await loadProjects(db)
    if (userRole === 'team') {
      people = await loadPeople(db)
    }
    populateFilters()

    // Resolve client name for client users
    if (userRole === 'client' && userClientId) {
      const clientDoc = clients.find((c) => c.id === userClientId)
      userClientName = clientDoc?.name || 'Client'
    }

    // Adapt UI for client role
    if (userRole === 'client') {
      // Update header logo
      const headerLogo = document.querySelector('.header-logo')
      if (headerLogo) headerLogo.innerHTML = `PK<span class="header-logo-dot">.</span> <span class="header-logo-client">for ${esc(userClientName)}</span>`

      // Hide team-only nav tabs
      navTabs.forEach((tab) => {
        const view = tab.dataset.view
        const teamOnlyViews = ['my-day', 'my-tasks', 'board', 'standup', 'timesheets', 'people', 'wiki', 'references', 'clients']
        if (teamOnlyViews.includes(view)) tab.style.display = 'none'
      })

      // Show client nav tabs
      document.querySelectorAll('.client-nav').forEach((tab) => {
        tab.style.display = ''
        tab.classList.remove('hidden')
      })

      // Hide team-only header controls
      const filterGroup = document.getElementById('filter-group')
      if (filterGroup) filterGroup.style.display = 'none'
      newTaskBtn.style.display = 'none'
    }

    // Subscribe to tasks (real-time) — scoped for client users
    if (userRole === 'client') {
      unsubTasks = subscribeToTasksByClient(db, userClientId, (tasks) => {
        allTasks = tasks
        renderCurrentView()
      })
    } else {
      unsubTasks = subscribeToTasks(db, (tasks) => {
        allTasks = tasks
        renderCurrentView()
      })
    }

    // Read initial route from hash (or default)
    handleRouteChange()
  } else {
    currentUser = null
    userRole = null
    userClientId = null
    userClientName = null
    loginScreen.classList.remove('hidden')
    appShell.classList.add('hidden')
    if (unsubTasks) {
      unsubTasks()
      unsubTasks = null
    }
    cleanupClients()
    cleanupPeople()
    cleanupWiki()
    cleanupReferences()
  }
})

// Navigation — clicks update the hash, hashchange handler does the rest
navTabs.forEach((tab) => {
  tab.addEventListener('click', () => navigateTo(tab.dataset.view))
})

// Filters
filterAssignee.addEventListener('change', renderCurrentView)

// Header project filter picker (multiselect)
hfDisplay.addEventListener('click', () => {
  if (hfDropdown.classList.contains('hidden')) {
    openHeaderFilter()
  } else {
    closeHeaderFilter()
  }
})

hfClear.addEventListener('click', (e) => {
  e.stopPropagation()
  selectedFilterIds.clear()
  updateHeaderFilterDisplay()
  renderCurrentView()
})

hfSearch.addEventListener('input', () => {
  renderHeaderFilterList(hfSearch.value.trim())
})

document.addEventListener('mousedown', (e) => {
  if (!hfPicker.contains(e.target) && !hfDropdown.classList.contains('hidden')) {
    closeHeaderFilter()
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !hfDropdown.classList.contains('hidden')) {
    closeHeaderFilter()
  }
})

function openHeaderFilter() {
  hfDropdown.classList.remove('hidden')
  hfPicker.classList.add('open')
  hfSearch.value = ''
  renderHeaderFilterList('')
  hfSearch.focus()
}

function closeHeaderFilter() {
  hfDropdown.classList.add('hidden')
  hfPicker.classList.remove('open')
}

function toggleProject(projectId) {
  if (selectedFilterIds.has(projectId)) {
    selectedFilterIds.delete(projectId)
  } else {
    selectedFilterIds.add(projectId)
  }
  updateHeaderFilterDisplay()
  renderHeaderFilterList(hfSearch.value.trim())
  renderCurrentView()
}

function toggleClient(clientId) {
  const clientProjects = projects.filter((p) => p.clientId === clientId)
  const allSelected = clientProjects.length > 0 && clientProjects.every((p) => selectedFilterIds.has(p.id))
  clientProjects.forEach((p) => {
    if (allSelected) {
      selectedFilterIds.delete(p.id)
    } else {
      selectedFilterIds.add(p.id)
    }
  })
  updateHeaderFilterDisplay()
  renderHeaderFilterList(hfSearch.value.trim())
  renderCurrentView()
}

function updateHeaderFilterDisplay() {
  const count = selectedFilterIds.size
  if (count === 0) {
    hfText.textContent = 'All Projects'
    hfText.classList.remove('active')
    hfClear.classList.add('hidden')
  } else if (count === 1) {
    const id = [...selectedFilterIds][0]
    const project = projects.find((p) => p.id === id)
    hfText.textContent = project?.name || '1 project'
    hfText.classList.add('active')
    hfClear.classList.remove('hidden')
  } else {
    hfText.textContent = `${count} projects`
    hfText.classList.add('active')
    hfClear.classList.remove('hidden')
  }
}

function renderHeaderFilterList(query) {
  const q = query.toLowerCase()

  // Build grouped list: clients with their projects
  const grouped = []

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

  let html = ''

  // Client groups with projects
  grouped.forEach((group) => {
    const logoHtml = group.client.logoUrl
      ? `<img src="${group.client.logoUrl}" alt="${esc(group.client.name)}">`
      : ''
    const allClientSelected = group.projects.length > 0 && group.projects.every((p) => selectedFilterIds.has(p.id))
    const someClientSelected = !allClientSelected && group.projects.some((p) => selectedFilterIds.has(p.id))
    const checkClass = allClientSelected ? 'checked' : (someClientSelected ? 'partial' : '')
    html += `<div class="header-filter-client" data-client-id="${group.client.id}">
      <span class="header-filter-checkbox ${checkClass}"></span>
      ${logoHtml}
      <span class="header-filter-client-name">${esc(group.client.name)}</span>
    </div>`
    group.projects.forEach((p) => {
      const isSelected = selectedFilterIds.has(p.id)
      html += `<div class="header-filter-option${isSelected ? ' selected' : ''}" data-project-id="${p.id}">
        <span class="header-filter-checkbox ${isSelected ? 'checked' : ''}"></span>
        ${esc(p.name)}
      </div>`
    })
  })

  // Uncategorized projects
  if (uncategorized.length > 0) {
    html += `<div class="header-filter-group-label">Uncategorized</div>`
    uncategorized.forEach((p) => {
      const isSelected = selectedFilterIds.has(p.id)
      html += `<div class="header-filter-option${isSelected ? ' selected' : ''}" data-project-id="${p.id}">
        <span class="header-filter-checkbox ${isSelected ? 'checked' : ''}"></span>
        ${esc(p.name)}
      </div>`
    })
  }

  if (!html || (q && grouped.length === 0 && uncategorized.length === 0)) {
    html = '<div class="header-filter-no-results">No matching projects</div>'
  }

  hfList.innerHTML = html

  // Bind project clicks
  hfList.querySelectorAll('.header-filter-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      toggleProject(opt.dataset.projectId)
    })
  })

  // Bind client clicks (toggle all projects in client)
  hfList.querySelectorAll('.header-filter-client').forEach((opt) => {
    opt.addEventListener('click', () => {
      toggleClient(opt.dataset.clientId)
    })
  })
}

// New Task
newTaskBtn.addEventListener('click', () => {
  openModal(null, { db, currentUser, clients, projects, onSave: renderCurrentView })
})

function populateFilters() {
  // Assignee filter
  filterAssignee.innerHTML = '<option value="">Everyone</option>'
  TEAM.forEach((m) => {
    filterAssignee.innerHTML += `<option value="${m.email}">${m.name}</option>`
  })
  // Reset header filter state
  selectedFilterIds.clear()
  updateHeaderFilterDisplay()
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

function getFilteredTasks() {
  let tasks = allTasks
  const assignee = filterAssignee.value

  if (selectedFilterIds.size > 0) {
    tasks = tasks.filter((t) => selectedFilterIds.has(t.projectId))
  }
  if (assignee) tasks = tasks.filter((t) => (t.assignees || []).includes(assignee))

  return tasks
}

function renderCurrentView() {
  const tasks = getFilteredTasks()
  const ctx = {
    db, currentUser, clients, projects, people, allTasks, onSave: renderCurrentView,
    filterClientId: '',
    filterProjectId: '',
    reconnectCalendar,
  }

  // Hide filters and new-task button on non-task views
  const filterGroup = document.getElementById('filter-group')
  const isBoardView = currentView === 'board'
  const isTaskView = isBoardView || currentView === 'my-tasks' || currentView === 'my-day'
  filterGroup.style.display = isTaskView ? '' : 'none'
  newTaskBtn.style.display = isTaskView ? '' : 'none'

  // Clean up subscriptions when leaving views
  if (currentView !== 'clients') cleanupClients()
  if (currentView !== 'people') cleanupPeople()
  if (currentView !== 'wiki') cleanupWiki()
  if (currentView !== 'references') cleanupReferences()

  switch (currentView) {
    case 'board':
      renderBoardContainer(mainContent, tasks, ctx)
      break
    case 'my-day':
      renderMyDay(mainContent, tasks, currentUser, ctx)
      break
    case 'my-tasks':
      renderMyTasks(mainContent, tasks, currentUser, ctx)
      break
    case 'standup':
      renderStandup(mainContent, allTasks, ctx)
      break
    case 'clients':
      renderClients(mainContent, ctx)
      break
    case 'people':
      renderPeople(mainContent, ctx)
      break
    case 'wiki':
      renderWiki(mainContent, ctx)
      break
    case 'references':
      renderReferences(mainContent, ctx)
      break
    case 'timesheets':
      renderTimesheets(mainContent, allTasks, ctx)
      break
    case 'client-board':
      renderClientBoard(mainContent, tasks, { ...ctx, userClientId, userClientName })
      break
    case 'client-timesheets':
      renderClientTimesheets(mainContent, allTasks, { ...ctx, userClientId, userClientName })
      break
  }
}

function renderBoardContainer(container, tasks, ctx) {
  const BOARD_TABS = [
    { id: 'status',   label: 'Backlog' },
    { id: 'assignee', label: 'Team' },
    { id: 'client',   label: 'Clients' },
    { id: 'project',  label: 'Projects' },
  ]

  container.innerHTML = `
    <div class="board-subnav">
      ${BOARD_TABS.map((t) => `
        <button class="board-subnav-tab${currentBoardView === t.id ? ' active' : ''}" data-board="${t.id}">${t.label}</button>
      `).join('')}
    </div>
    <div id="board-body"></div>
  `

  container.querySelectorAll('.board-subnav-tab').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo('board', btn.dataset.board))
  })

  const body = document.getElementById('board-body')
  switch (currentBoardView) {
    case 'status':   renderBoard(body, tasks, ctx); break
    case 'assignee': renderBoardByAssignee(body, tasks, ctx); break
    case 'client':   renderBoardByClient(body, tasks, ctx); break
    case 'project':  renderBoardByProject(body, tasks, ctx); break
  }
}
