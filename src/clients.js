import {
  createClient,
  updateClient,
  deleteClient,
  createProject,
  updateProject,
  deleteProject,
  subscribeToClients,
  subscribeToProjects,
  uploadClientLogo,
  updateProjectContent,
  createClientUser,
  deleteClientUser,
  subscribeToClientUsers,
} from './db.js'
import { renderMarkdown } from './markdown.js'
import { TEAM } from './config.js'
import { openItemIndex, clientState } from './utils/client-visibility.js'

let unsubClients = null
let unsubProjects = null
let unsubClientUsers = null
let localClients = []
let localProjects = []
let localClientUsers = []
let currentCtx = null

// Master-detail state
let selectedClientId = null
let clientSearchTerm = ''

// Project-detail (within right pane) state
let activeProjectId = null
let projectActiveTab = 'page'
let projectIsEditing = false

// Inline-form state
let editingClientId = null
let editingProjectId = null

export function renderClients(container, ctx) {
  if (unsubClients) unsubClients()
  if (unsubProjects) unsubProjects()
  if (unsubClientUsers) unsubClientUsers()
  currentCtx = ctx
  activeProjectId = null
  projectIsEditing = false

  container.innerHTML = `
    <div class="manage-view">
      <div class="manage-header">
        <h2>Clients & Projects</h2>
        <p>Manage your clients and their projects</p>
      </div>

      <div class="manage-layout">
        <aside class="manage-sidebar">
          <div class="manage-sidebar-actions">
            <button class="btn-primary" id="add-client-btn"><i class="ph ph-plus"></i> Client</button>
          </div>
          <div class="manage-sidebar-search">
            <i class="ph ph-magnifying-glass"></i>
            <input type="text" id="manage-client-search" placeholder="Search clients…" autocomplete="off">
          </div>
          <div id="add-client-form" class="manage-inline-form hidden"></div>
          <div class="manage-sidebar-list" id="manage-client-list"></div>
        </aside>

        <section class="manage-detail" id="manage-detail"></section>
      </div>
    </div>
  `

  // Real-time subscriptions
  unsubClients = subscribeToClients(ctx.db, (clients) => {
    localClients = clients
    // Auto-select first client on initial load
    if (!selectedClientId && localClients.length > 0) {
      selectedClientId = localClients[0].id
    }
    renderSidebar()
    renderDetail()
  })

  unsubProjects = subscribeToProjects(ctx.db, (projects) => {
    localProjects = projects
    renderSidebar() // counts may have changed
    renderDetail()
  })

  unsubClientUsers = subscribeToClientUsers(ctx.db, (users) => {
    localClientUsers = users
    renderSidebar()
    renderDetail()
  })

  // Search
  const searchInput = document.getElementById('manage-client-search')
  searchInput.addEventListener('input', () => {
    clientSearchTerm = searchInput.value.trim().toLowerCase()
    renderSidebar()
  })

  // Add Client button
  document.getElementById('add-client-btn').addEventListener('click', () => {
    editingClientId = null
    openClientForm()
  })
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('manage-client-list')
  if (!list) return

  const { clientIds: openClientIds } = openItemIndex(currentCtx?.allTasks)
  // Active first, then dormant ("Inactive"), then archived — preserving the
  // name order within each group (localClients arrives ordered by name).
  const rank = (c) => {
    const s = clientState(c, openClientIds)
    return s === 'active' ? 0 : s === 'inactive' ? 1 : 2
  }

  const matched = clientSearchTerm
    ? localClients.filter((c) => c.name.toLowerCase().includes(clientSearchTerm))
    : localClients
  const filtered = [...matched].sort((a, b) => rank(a) - rank(b))

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="manage-sidebar-empty">
        ${clientSearchTerm ? 'No matches' : 'No clients yet'}
      </div>
    `
    return
  }

  list.innerHTML = filtered.map((c) => {
    const projectCount = localProjects.filter((p) => p.clientId === c.id).length
    const userCount = localClientUsers.filter((u) => u.clientId === c.id).length
    const hasSlack = !!c.slackChannelId
    const logo = c.logoUrl
      ? `<img class="manage-client-logo" src="${c.logoUrl}" alt="${escHtml(c.name)}">`
      : `<span class="manage-client-logo manage-client-logo-placeholder">${escHtml(c.name[0] || '?')}</span>`
    const isActive = c.id === selectedClientId && !activeProjectId
    const state = clientState(c, openClientIds)
    const badge = state === 'archived'
      ? '<span class="manage-state-badge archived">Archived</span>'
      : state === 'inactive'
        ? '<span class="manage-state-badge inactive">Inactive</span>'
        : ''
    return `
      <button class="manage-client-row${isActive ? ' active' : ''}${state !== 'active' ? ' dimmed' : ''}" data-id="${c.id}">
        ${logo}
        <div class="manage-client-row-info">
          <span class="manage-client-row-name">${escHtml(c.name)}${badge}</span>
          <span class="manage-client-row-meta">
            ${projectCount} project${projectCount !== 1 ? 's' : ''}
            ${userCount > 0 ? ` · ${userCount} user${userCount !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
        ${hasSlack ? `<i class="ph-fill ph-hash manage-slack-indicator" title="Slack channel set"></i>` : ''}
      </button>
    `
  }).join('')

  list.querySelectorAll('.manage-client-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedClientId = row.dataset.id
      activeProjectId = null
      renderSidebar()
      renderDetail()
    })
  })
}

// ─────────────────────────────────────────────────────────────
// DETAIL PANE
// ─────────────────────────────────────────────────────────────

function renderDetail() {
  const pane = document.getElementById('manage-detail')
  if (!pane) return

  // Project detail overrides client detail when active
  if (activeProjectId) {
    const project = localProjects.find((p) => p.id === activeProjectId)
    if (project) {
      renderProjectDetail(pane, project)
      return
    }
    activeProjectId = null
  }

  if (!selectedClientId) {
    pane.innerHTML = `
      <div class="manage-detail-empty">
        <i class="ph ph-users-three"></i>
        <h3>Pick a client</h3>
        <p>Select a client from the sidebar to manage its projects and team access.</p>
      </div>
    `
    return
  }

  const client = localClients.find((c) => c.id === selectedClientId)
  if (!client) {
    // Selected client was deleted — fall back
    selectedClientId = localClients[0]?.id || null
    renderSidebar()
    renderDetail()
    return
  }

  renderClientDetail(pane, client)
}

function renderClientDetail(pane, client) {
  const projects = localProjects.filter((p) => p.clientId === client.id)
  const users = localClientUsers.filter((u) => u.clientId === client.id)

  const logo = client.logoUrl
    ? `<img class="manage-detail-logo" src="${client.logoUrl}" alt="${escHtml(client.name)}">`
    : `<span class="manage-detail-logo manage-client-logo-placeholder">${escHtml(client.name[0] || '?')}</span>`

  const rateLabel = client.defaultHourlyRate
    ? `${escHtml(client.currency || 'INR')} ${client.defaultHourlyRate}/hr`
    : 'No default rate'
  const slackLabel = client.slackChannelId
    ? `<code>${escHtml(client.slackChannelId)}</code>`
    : '<span class="muted">Not set</span>'

  const { clientIds: openClientIds } = openItemIndex(currentCtx?.allTasks)
  const state = clientState(client, openClientIds)
  const stateChip = state === 'archived'
    ? '<span class="manage-chip manage-chip-archived"><i class="ph ph-archive"></i> Archived</span>'
    : state === 'inactive'
      ? '<span class="manage-chip manage-chip-inactive"><i class="ph ph-moon"></i> Inactive · no open items</span>'
      : ''

  pane.innerHTML = `
    <div class="manage-detail-header">
      ${logo}
      <div class="manage-detail-identity">
        <h2 class="manage-detail-name">${escHtml(client.name)}</h2>
        <div class="manage-detail-chips">
          ${stateChip}
          <span class="manage-chip"><i class="ph ph-currency-circle-dollar"></i> ${rateLabel}</span>
          <span class="manage-chip"><i class="ph ph-hash"></i> ${slackLabel}</span>
        </div>
      </div>
      <div class="manage-detail-actions">
        <button class="btn-ghost" id="archive-client-btn"><i class="ph ${client.archived ? 'ph-arrow-counter-clockwise' : 'ph-archive'}"></i> ${client.archived ? 'Unarchive' : 'Archive'}</button>
        <button class="btn-ghost" id="edit-client-btn"><i class="ph ph-pencil-simple"></i> Edit</button>
        <button class="btn-ghost danger" id="delete-client-btn"><i class="ph ph-trash"></i></button>
      </div>
    </div>

    <div id="edit-client-form" class="manage-inline-form hidden"></div>

    <div class="manage-section">
      <div class="manage-section-header">
        <h3 class="manage-section-title">Projects <span class="manage-section-count">${projects.length}</span></h3>
        <button class="btn-primary btn-sm" id="add-project-btn"><i class="ph ph-plus"></i> Project</button>
      </div>
      <div id="add-project-form" class="manage-inline-form hidden"></div>
      <div class="manage-rows" id="projects-list"></div>
    </div>

    <div class="manage-section">
      <div class="manage-section-header">
        <h3 class="manage-section-title">Client Users <span class="manage-section-count">${users.length}</span></h3>
        <button class="btn-primary btn-sm" id="add-cu-btn"><i class="ph ph-plus"></i> Invite</button>
      </div>
      <div id="add-cu-form" class="manage-inline-form hidden"></div>
      <div class="manage-rows" id="client-users-list"></div>
    </div>
  `

  // Archive / unarchive client. Archived clients drop off every working view
  // (board, backlog, pickers, references filter) but keep their data and stay
  // visible here, dimmed. Toggling re-renders via the clients subscription.
  document.getElementById('archive-client-btn').addEventListener('click', async () => {
    await updateClient(currentCtx.db, client.id, { archived: !client.archived })
  })

  // Edit client
  document.getElementById('edit-client-btn').addEventListener('click', () => {
    editingClientId = client.id
    openClientForm(client)
  })

  // Delete client
  document.getElementById('delete-client-btn').addEventListener('click', async () => {
    if (confirm(`Delete client "${client.name}"? This won't delete associated tasks.`)) {
      await deleteClient(currentCtx.db, client.id)
      selectedClientId = null
    }
  })

  // Add project
  document.getElementById('add-project-btn').addEventListener('click', () => {
    editingProjectId = null
    openProjectForm(null, client)
  })

  // Add client user
  document.getElementById('add-cu-btn').addEventListener('click', () => {
    openClientUserForm(client)
  })

  renderProjectsList(projects, client)
  renderClientUsersList(users)
}

function renderProjectsList(projects, client) {
  const list = document.getElementById('projects-list')
  if (!list) return

  if (projects.length === 0) {
    list.innerHTML = `<div class="manage-empty-row">No projects yet.</div>`
    return
  }

  list.innerHTML = projects.map((p) => {
    const pRate = p.hourlyRate ?? client?.defaultHourlyRate ?? 0
    const pCurrency = p.currency || client?.currency || 'INR'
    const rateLabel = pRate ? `${pCurrency} ${pRate}/hr` : ''
    const hasSlack = !!p.slackChannelId
    return `
      <div class="manage-row project-row" data-id="${p.id}">
        <div class="manage-row-main">
          <span class="manage-row-name">${escHtml(p.name)}</span>
          <span class="manage-row-meta">
            ${rateLabel}
            ${hasSlack ? `${rateLabel ? ' · ' : ''}<i class="ph ph-hash"></i> own channel` : ''}
          </span>
        </div>
        <div class="manage-row-actions">
          <button class="btn-ghost project-edit" data-id="${p.id}"><i class="ph ph-pencil-simple"></i></button>
          <button class="btn-ghost danger project-delete" data-id="${p.id}" data-name="${escHtml(p.name)}"><i class="ph ph-trash"></i></button>
        </div>
      </div>
    `
  }).join('')

  // Row click → project detail
  list.querySelectorAll('.project-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      const project = projects.find((p) => p.id === row.dataset.id)
      if (project) {
        activeProjectId = project.id
        projectActiveTab = 'page'
        renderSidebar()
        renderDetail()
      }
    })
  })

  list.querySelectorAll('.project-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const project = projects.find((p) => p.id === btn.dataset.id)
      editingProjectId = project.id
      openProjectForm(project, client)
    })
  })

  list.querySelectorAll('.project-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (confirm(`Delete project "${btn.dataset.name}"? This won't delete associated tasks.`)) {
        await deleteProject(currentCtx.db, btn.dataset.id)
      }
    })
  })
}

function renderClientUsersList(users) {
  const list = document.getElementById('client-users-list')
  if (!list) return

  if (users.length === 0) {
    list.innerHTML = `<div class="manage-empty-row">No client users yet. Invite someone to give them access.</div>`
    return
  }

  list.innerHTML = users.map((cu) => {
    const inviter = TEAM.find((m) => m.email === cu.invitedBy)
    return `
      <div class="manage-row" data-email="${escHtml(cu.email)}">
        <div class="manage-row-main">
          <span class="manage-row-name">${escHtml(cu.name)}</span>
          <span class="manage-row-meta">${escHtml(cu.email)}${inviter ? ' · Invited by ' + escHtml(inviter.name) : ''}</span>
        </div>
        <div class="manage-row-actions">
          <button class="btn-ghost danger cu-delete" data-email="${escHtml(cu.email)}" data-name="${escHtml(cu.name)}"><i class="ph ph-trash"></i></button>
        </div>
      </div>
    `
  }).join('')

  list.querySelectorAll('.cu-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm(`Remove access for "${btn.dataset.name}"?`)) {
        await deleteClientUser(currentCtx.db, btn.dataset.email)
      }
    })
  })
}

// ─────────────────────────────────────────────────────────────
// INLINE FORMS
// ─────────────────────────────────────────────────────────────

function openClientForm(existing) {
  // Add → sidebar slot (add-client-form). Edit → detail-pane slot (edit-client-form).
  const targetId = existing ? 'edit-client-form' : 'add-client-form'
  const otherId = existing ? 'add-client-form' : 'edit-client-form'
  const form = document.getElementById(targetId)
  if (!form) return
  const otherForm = document.getElementById(otherId)
  if (otherForm) otherForm.classList.add('hidden')

  const name = existing?.name || ''
  const rate = existing?.defaultHourlyRate || ''
  const currency = existing?.currency || 'INR'
  const slack = existing?.slackChannelId || ''
  const logoUrl = existing?.logoUrl || ''

  form.innerHTML = `
    <input type="text" id="cf-name" class="form-input" placeholder="Client name" value="${escHtml(name)}">
    <div class="logo-upload-row">
      <label class="btn-ghost logo-upload-btn">
        <i class="ph ph-upload-simple"></i> <span id="cf-logo-text">${logoUrl ? 'Change logo' : 'Choose logo'}</span>
        <input type="file" id="cf-logo" accept="image/*" class="hidden">
      </label>
      <img id="cf-logo-preview" class="client-logo" src="${logoUrl}" style="${logoUrl ? '' : 'display:none'}">
      <button class="btn-ghost" id="cf-logo-clear" style="${logoUrl ? '' : 'display:none'};font-size:12px;">Remove</button>
    </div>
    <div class="rate-row">
      <div class="rate-field">
        <label class="form-label-sm">Default hourly rate</label>
        <input type="number" id="cf-rate" class="form-input" placeholder="0" min="0" step="1" value="${rate}">
      </div>
      <div class="rate-field rate-currency-field">
        <label class="form-label-sm">Currency</label>
        <select id="cf-currency" class="form-select">
          <option value="INR"${currency === 'INR' ? ' selected' : ''}>INR</option>
          <option value="USD"${currency === 'USD' ? ' selected' : ''}>USD</option>
        </select>
      </div>
    </div>
    <div class="rate-field" style="width:100%">
      <label class="form-label-sm">Slack Channel ID</label>
      <input type="text" id="cf-slack" class="form-input" placeholder="e.g. C08UCQXH7D0" value="${escHtml(slack)}">
    </div>
    <div class="inline-form-actions">
      <button class="btn-primary" id="cf-save">${existing ? 'Save' : 'Add'}</button>
      <button class="btn-ghost" id="cf-cancel">Cancel</button>
    </div>
  `
  form.classList.remove('hidden')

  let selectedLogoFile = null
  let logoUrlState = logoUrl

  const logoInput = document.getElementById('cf-logo')
  const logoText = document.getElementById('cf-logo-text')
  const logoPreview = document.getElementById('cf-logo-preview')
  const logoClear = document.getElementById('cf-logo-clear')

  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0]
    if (file) {
      selectedLogoFile = file
      logoPreview.src = URL.createObjectURL(file)
      logoPreview.style.display = ''
      logoClear.style.display = ''
      logoText.textContent = file.name
    }
  })

  logoClear.addEventListener('click', () => {
    selectedLogoFile = null
    logoUrlState = ''
    logoInput.value = ''
    logoPreview.style.display = 'none'
    logoClear.style.display = 'none'
    logoText.textContent = 'Choose logo'
  })

  document.getElementById('cf-name').focus()

  document.getElementById('cf-cancel').addEventListener('click', () => {
    form.classList.add('hidden')
    editingClientId = null
  })

  const save = async () => {
    const newName = document.getElementById('cf-name').value.trim()
    if (!newName) return
    const newRate = parseFloat(document.getElementById('cf-rate').value) || 0
    const newCurrency = document.getElementById('cf-currency').value || 'INR'
    const newSlack = document.getElementById('cf-slack').value.trim()
    const saveBtn = document.getElementById('cf-save')
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving…'

    try {
      if (editingClientId) {
        let finalLogoUrl = logoUrlState
        if (selectedLogoFile) {
          finalLogoUrl = await uploadClientLogo(selectedLogoFile, editingClientId)
        }
        await updateClient(currentCtx.db, editingClientId, {
          name: newName, logoUrl: finalLogoUrl, defaultHourlyRate: newRate, currency: newCurrency, slackChannelId: newSlack,
        })
      } else {
        const docRef = await createClient(currentCtx.db, {
          name: newName, logoUrl: '', defaultHourlyRate: newRate, currency: newCurrency, slackChannelId: newSlack,
        })
        if (selectedLogoFile) {
          const url = await uploadClientLogo(selectedLogoFile, docRef.id)
          await updateClient(currentCtx.db, docRef.id, { logoUrl: url })
        }
        selectedClientId = docRef.id
      }
    } catch (err) {
      console.error('Error saving client:', err)
    }

    editingClientId = null
    form.classList.add('hidden')
  }

  document.getElementById('cf-save').addEventListener('click', save)
  document.getElementById('cf-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') document.getElementById('cf-cancel').click()
  })
}

function openProjectForm(existing, client) {
  const form = document.getElementById('add-project-form')
  if (!form) return

  const name = existing?.name || ''
  const slack = existing?.slackChannelId || ''
  const rate = existing?.hourlyRate ?? ''

  form.innerHTML = `
    <input type="text" id="pf-name" class="form-input" placeholder="Project name" value="${escHtml(name)}">
    <div class="rate-row">
      <div class="rate-field">
        <label class="form-label-sm">Hourly rate (optional)</label>
        <input type="number" id="pf-rate" class="form-input" placeholder="Inherits ${client?.defaultHourlyRate || 0}" min="0" step="1" value="${rate}">
      </div>
    </div>
    <div class="rate-field" style="width:100%">
      <label class="form-label-sm">Slack Channel ID (optional, overrides client channel)</label>
      <input type="text" id="pf-slack" class="form-input" placeholder="e.g. C08UCQXH7D0" value="${escHtml(slack)}">
    </div>
    <div class="inline-form-actions">
      <button class="btn-primary" id="pf-save">${existing ? 'Save' : 'Add'}</button>
      <button class="btn-ghost" id="pf-cancel">Cancel</button>
    </div>
  `
  form.classList.remove('hidden')
  document.getElementById('pf-name').focus()

  document.getElementById('pf-cancel').addEventListener('click', () => {
    form.classList.add('hidden')
    editingProjectId = null
  })

  const save = async () => {
    const newName = document.getElementById('pf-name').value.trim()
    if (!newName) return
    const newSlack = document.getElementById('pf-slack').value.trim()
    const rateInput = document.getElementById('pf-rate').value
    const newRate = rateInput === '' ? null : parseFloat(rateInput)

    const data = { name: newName, clientId: client.id, slackChannelId: newSlack }
    if (newRate != null) data.hourlyRate = newRate

    if (editingProjectId) {
      await updateProject(currentCtx.db, editingProjectId, data)
    } else {
      const currency = client?.currency || 'INR'
      await createProject(currentCtx.db, { ...data, hourlyRate: newRate ?? (client?.defaultHourlyRate || 0), currency })
    }

    editingProjectId = null
    form.classList.add('hidden')
  }

  document.getElementById('pf-save').addEventListener('click', save)
  document.getElementById('pf-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') document.getElementById('pf-cancel').click()
  })
}

function openClientUserForm(client) {
  const form = document.getElementById('add-cu-form')
  if (!form) return

  form.innerHTML = `
    <input type="email" id="cuf-email" class="form-input" placeholder="Email address">
    <input type="text" id="cuf-name" class="form-input" placeholder="Name">
    <div class="inline-form-actions">
      <button class="btn-primary" id="cuf-save">Invite</button>
      <button class="btn-ghost" id="cuf-cancel">Cancel</button>
    </div>
  `
  form.classList.remove('hidden')
  document.getElementById('cuf-email').focus()

  document.getElementById('cuf-cancel').addEventListener('click', () => form.classList.add('hidden'))

  const save = async () => {
    const email = document.getElementById('cuf-email').value.trim().toLowerCase()
    const name = document.getElementById('cuf-name').value.trim()
    if (!email || !name) return
    const saveBtn = document.getElementById('cuf-save')
    saveBtn.disabled = true
    saveBtn.textContent = 'Inviting…'
    try {
      await createClientUser(currentCtx.db, email, {
        name, clientId: client.id, invitedBy: currentCtx.currentUser?.email || '',
      })
    } catch (err) {
      console.error('Error inviting client user:', err)
    }
    form.classList.add('hidden')
  }

  document.getElementById('cuf-save').addEventListener('click', save)
  document.getElementById('cuf-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') document.getElementById('cuf-cancel').click()
  })
}

// ─────────────────────────────────────────────────────────────
// PROJECT DETAIL (Page / Activity / Settings)
// ─────────────────────────────────────────────────────────────

function renderProjectDetail(pane, project) {
  const client = localClients.find((c) => c.id === project.clientId)
  const logoHtml = client?.logoUrl
    ? `<img class="avatar-photo-lg" src="${client.logoUrl}" alt="${escHtml(client.name)}">`
    : `<span class="avatar-lg" style="background:#6b7280">${(project.name || '?')[0]}</span>`

  pane.innerHTML = `
    <div class="person-detail">
      <div class="person-detail-header">
        <button class="btn-ghost person-back-btn" id="project-back-btn">
          <i class="ph ph-arrow-left"></i>
        </button>
        <div class="person-detail-identity">
          ${logoHtml}
          <div>
            <h2 class="person-detail-name">${escHtml(project.name)}</h2>
            <p class="person-detail-role">${client ? escHtml(client.name) : 'No client'}</p>
          </div>
        </div>
      </div>

      <div class="tab-bar">
        <button class="tab${projectActiveTab === 'page' ? ' active' : ''}" data-tab="page">Page</button>
        <button class="tab${projectActiveTab === 'activity' ? ' active' : ''}" data-tab="activity">Activity</button>
        <button class="tab${projectActiveTab === 'settings' ? ' active' : ''}" data-tab="settings">Settings</button>
      </div>

      <div class="tab-content" id="project-tab-content"></div>
    </div>
  `

  document.getElementById('project-back-btn').addEventListener('click', () => {
    activeProjectId = null
    projectIsEditing = false
    renderSidebar()
    renderDetail()
  })

  pane.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      projectActiveTab = tab.dataset.tab
      projectIsEditing = false
      pane.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === projectActiveTab))
      renderProjectTabContent(project)
    })
  })

  renderProjectTabContent(project)
}

function renderProjectTabContent(project) {
  const container = document.getElementById('project-tab-content')
  if (!container) return

  if (projectActiveTab === 'page') renderProjectPageTab(container, project)
  else if (projectActiveTab === 'settings') renderProjectSettingsTab(container, project)
  else renderProjectActivityTab(container, project)
}

function renderProjectPageTab(container, project) {
  const content = project.content || ''
  const updatedBy = project.contentUpdatedBy || ''
  const updatedAt = project.contentUpdatedAt
  let metaLine = ''
  if (updatedBy) {
    const editor = TEAM.find((m) => m.email === updatedBy)
    const editorName = editor?.name || updatedBy
    const dateStr = updatedAt ? formatDateClients(updatedAt) : ''
    metaLine = `<div class="page-meta">Last edited by ${escHtml(editorName)}${dateStr ? ' · ' + dateStr : ''}</div>`
  }

  if (projectIsEditing) {
    container.innerHTML = `
      <div class="page-editor">
        <textarea id="project-page-textarea" class="page-editor-textarea" placeholder="Write about this project using markdown...">${escHtml(content)}</textarea>
        <div class="page-editor-actions">
          <button class="btn-primary" id="project-page-save">Save</button>
          <button class="btn-ghost" id="project-page-cancel">Cancel</button>
        </div>
      </div>
    `
    const textarea = document.getElementById('project-page-textarea')
    textarea.focus()
    textarea.style.height = Math.max(200, textarea.scrollHeight) + 'px'
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto'
      textarea.style.height = Math.max(200, textarea.scrollHeight) + 'px'
    })

    document.getElementById('project-page-save').addEventListener('click', async () => {
      const newContent = textarea.value
      await updateProjectContent(currentCtx.db, project.id, newContent, currentCtx.currentUser?.email || '')
      projectIsEditing = false
    })

    document.getElementById('project-page-cancel').addEventListener('click', () => {
      projectIsEditing = false
      renderProjectTabContent(project)
    })
  } else {
    if (content) {
      container.innerHTML = `
        <div class="page-display">
          ${metaLine}
          <div class="page-content">${renderMarkdown(content)}</div>
          <button class="btn-ghost page-edit-btn" id="project-page-edit"><i class="ph ph-pencil-simple"></i> Edit</button>
        </div>
      `
    } else {
      container.innerHTML = `
        <div class="page-empty">
          <p>No content yet. Add notes, context, or details about this project.</p>
          <button class="btn-primary" id="project-page-edit"><i class="ph ph-pencil-simple"></i> Start writing</button>
        </div>
      `
    }

    const editBtn = document.getElementById('project-page-edit')
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        projectIsEditing = true
        renderProjectTabContent(project)
      })
    }
  }
}

function renderProjectSettingsTab(container, project) {
  const client = localClients.find((c) => c.id === project.clientId)
  const rate = project.hourlyRate ?? client?.defaultHourlyRate ?? 0
  const currency = project.currency || client?.currency || 'INR'
  const inherited = project.hourlyRate == null || project.hourlyRate === undefined

  const projectSlack = project.slackChannelId || ''
  const clientSlack = client?.slackChannelId || ''

  container.innerHTML = `
    <div class="project-settings">
      <div class="settings-section">
        <h4 class="settings-section-title">Billing</h4>
        <div class="settings-row">
          <div class="rate-field">
            <label class="form-label-sm">Hourly rate</label>
            <input type="number" id="project-rate" class="form-input" value="${rate}" min="0" step="1" placeholder="0">
          </div>
          <div class="rate-field rate-currency-field">
            <label class="form-label-sm">Currency</label>
            <select id="project-currency" class="form-select">
              <option value="INR"${currency === 'INR' ? ' selected' : ''}>INR</option>
              <option value="USD"${currency === 'USD' ? ' selected' : ''}>USD</option>
            </select>
          </div>
        </div>
        ${inherited && client ? `<p class="settings-hint">Inherited from ${escHtml(client.name)} default rate</p>` : ''}
      </div>
      <div class="settings-section">
        <h4 class="settings-section-title">Slack</h4>
        <div class="rate-field" style="width:100%">
          <label class="form-label-sm">Slack Channel ID (overrides client channel)</label>
          <input type="text" id="project-slack-channel" class="form-input" value="${escHtml(projectSlack)}" placeholder="e.g. C08UCQXH7D0">
        </div>
        ${clientSlack && !projectSlack ? `<p class="settings-hint">Using client channel: ${escHtml(clientSlack)}</p>` : ''}
      </div>
      <button class="btn-primary" id="project-settings-save" style="margin-top:8px">Save</button>
    </div>
  `

  document.getElementById('project-settings-save').addEventListener('click', async () => {
    const newRate = parseFloat(document.getElementById('project-rate').value) || 0
    const newCurrency = document.getElementById('project-currency').value || 'INR'
    const newSlack = document.getElementById('project-slack-channel').value.trim()
    await updateProject(currentCtx.db, project.id, { hourlyRate: newRate, currency: newCurrency, slackChannelId: newSlack })
  })
}

function renderProjectActivityTab(container, project) {
  const allTasks = currentCtx?.allTasks || []
  const projectTasks = allTasks.filter((t) => t.projectId === project.id)

  const active = projectTasks.filter((t) => t.status !== 'done')
  const done = projectTasks.filter((t) => t.status === 'done')

  if (projectTasks.length === 0) {
    container.innerHTML = `<div class="page-empty"><p>No tasks in this project yet.</p></div>`
    return
  }

  const statusIcons = {
    backlog: 'ph-prohibit',
    todo: 'ph-circle',
    in_progress: 'ph-circle-half',
    review: 'ph-fast-forward',
    done: 'ph-check-circle',
  }

  function renderTask(t) {
    const icon = statusIcons[t.status] || 'ph-circle'
    const assigneeNames = (t.assignees || []).map((email) => {
      const m = TEAM.find((m) => m.email === email)
      return m?.name || email.split('@')[0]
    }).join(', ')
    return `
      <div class="activity-task ${t.status === 'done' ? 'is-done' : ''}">
        <i class="ph ${icon} activity-task-icon status-${t.status}"></i>
        <div class="activity-task-info">
          <span class="activity-task-title">${escHtml(t.title)}</span>
          ${assigneeNames ? `<span class="activity-task-meta">${escHtml(assigneeNames)}</span>` : ''}
        </div>
        ${t.priority === 'urgent' || t.priority === 'high' ? `<span class="priority-badge priority-${t.priority}">${t.priority}</span>` : ''}
      </div>
    `
  }

  let html = ''
  if (active.length > 0) {
    html += `<div class="activity-section">
      <h4 class="activity-section-title">Active Tasks (${active.length})</h4>
      ${active.map(renderTask).join('')}
    </div>`
  }
  if (done.length > 0) {
    html += `<div class="activity-section">
      <h4 class="activity-section-title">Completed (${done.length})</h4>
      ${done.slice(0, 20).map(renderTask).join('')}
      ${done.length > 20 ? `<div class="activity-more">+ ${done.length - 20} more</div>` : ''}
    </div>`
  }

  container.innerHTML = `<div class="activity-timeline">${html}</div>`
}

function formatDateClients(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })
}

function escHtml(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

export function cleanupClients() {
  if (unsubClients) { unsubClients(); unsubClients = null }
  if (unsubProjects) { unsubProjects(); unsubProjects = null }
  if (unsubClientUsers) { unsubClientUsers(); unsubClientUsers = null }
  currentCtx = null
  activeProjectId = null
  projectIsEditing = false
}
