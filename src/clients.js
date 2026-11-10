import {
  createClient,
  updateClient,
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
import { openItemIndex, clientState, isOpenItem } from './utils/client-visibility.js'
import { openChannelPicker, loadSlackChannels, knownChannelName } from './slack-channels.js'

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
let showArchived = false

// Project-detail (within right pane) state
let activeProjectId = null
let projectActiveTab = 'page'
let projectIsEditing = false

// Inline add-row state (detail pane)
let addingProject = false
let addingPerson = false

const CURRENCIES = ['INR', 'USD']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LOGO_BYTES = 10 * 1024 * 1024

export function renderClients(container, ctx) {
  if (unsubClients) unsubClients()
  if (unsubProjects) unsubProjects()
  if (unsubClientUsers) unsubClientUsers()
  currentCtx = ctx
  activeProjectId = null
  projectIsEditing = false
  addingProject = false
  addingPerson = false

  container.innerHTML = `
    <div class="manage-view">
      <div class="manage-layout">
        <aside class="manage-sidebar">
          <div class="manage-sidebar-head">
            <h2>Clients</h2>
            <button class="btn-primary btn-sm" id="add-client-btn"><i class="ph ph-plus"></i> New client</button>
          </div>
          <div class="manage-sidebar-search">
            <i class="ph ph-magnifying-glass"></i>
            <input type="text" id="manage-client-search" placeholder="Search clients…" autocomplete="off" aria-label="Search clients" value="${escHtml(clientSearchTerm)}">
          </div>
          <div class="manage-sidebar-list" id="manage-client-list"></div>
        </aside>

        <section class="manage-detail" id="manage-detail"></section>
      </div>
    </div>
  `

  // Real-time subscriptions
  unsubClients = subscribeToClients(ctx.db, (clients) => {
    localClients = clients
    if (!selectedClientId || !localClients.some((c) => c.id === selectedClientId)) {
      selectedClientId = defaultClientId()
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
    renderDetail()
  })

  const searchInput = document.getElementById('manage-client-search')
  searchInput.addEventListener('input', () => {
    clientSearchTerm = searchInput.value.trim().toLowerCase()
    renderSidebar()
  })

  document.getElementById('add-client-btn').addEventListener('click', openNewClientDialog)

  // Resolve channel IDs to #names in the background; IDs show until it lands.
  if (ctx.currentUser) {
    loadSlackChannels(ctx.currentUser).then(() => { if (currentCtx === ctx) renderDetail() }).catch(() => {})
  }
}

// ─────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────

function openClientIds() {
  return openItemIndex(currentCtx?.allTasks).clientIds
}

function openTaskCount(field, id) {
  return (currentCtx?.allTasks || []).filter((t) => t[field] === id && isOpenItem(t)).length
}

// First client to show: the first active one, else the first non-archived, else any.
function defaultClientId() {
  const open = openClientIds()
  const pick = localClients.find((c) => clientState(c, open) === 'active')
    || localClients.find((c) => !c.archived)
    || localClients[0]
  return pick?.id || null
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function logoMarkup(client, cls) {
  return client?.logoUrl
    ? `<img class="${cls}" src="${escHtml(client.logoUrl)}" alt="">`
    : `<span class="${cls} manage-client-logo-placeholder" aria-hidden="true">${escHtml((client?.name || '?')[0].toUpperCase())}</span>`
}

function channelLabel(id, storedName) {
  if (!id) return ''
  const name = knownChannelName(id) || storedName
  return name ? `#${name}` : id
}

function currencyOptions(selected) {
  return CURRENCIES.map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('')
}

function nameTaken(name, exceptId) {
  const n = name.trim().toLowerCase()
  return localClients.find((c) => c.id !== exceptId && c.name.trim().toLowerCase() === n)
}

function toast(message, kind = 'ok') {
  let el = document.getElementById('manage-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'manage-toast'
    el.className = 'manage-toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    document.body.appendChild(el)
  }
  el.textContent = message
  el.dataset.kind = kind
  el.classList.add('show')
  clearTimeout(el._timer)
  el._timer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 2600)
}

// Run a write; on failure say so instead of failing silently. Resolves true/false.
async function attempt(fn, { ok, fail }) {
  try {
    await fn()
    if (ok) toast(ok)
    return true
  } catch (err) {
    console.error(fail, err)
    toast(`${fail}. ${err?.message || 'Try again.'}`, 'error')
    return false
  }
}

function confirmDialog({ title, body, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay manage-overlay'
    overlay.innerHTML = `
      <div class="modal manage-confirm" role="alertdialog" aria-modal="true" aria-labelledby="manage-confirm-title">
        <div class="modal-body">
          <h3 class="modal-title" id="manage-confirm-title">${escHtml(title)}</h3>
          <p class="manage-confirm-body">${escHtml(body)}</p>
        </div>
        <div class="modal-footer">
          <div class="modal-footer-right">
            <button class="btn-ghost" data-act="cancel">Cancel</button>
            <button class="${danger ? 'btn-primary manage-btn-danger' : 'btn-primary'}" data-act="confirm">${escHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `
    const done = (result) => {
      overlay.remove()
      previous?.focus?.()
      resolve(result)
    }
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false) })
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false) })
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false))
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => done(true))
    document.body.appendChild(overlay)
    overlay.querySelector('[data-act="cancel"]').focus()
  })
}

function validLogoFile(file) {
  if (!file) return false
  if (!file.type?.startsWith('image/')) { toast('That file isn\'t an image.', 'error'); return false }
  if (file.size > MAX_LOGO_BYTES) { toast('That image is over 10 MB. Pick a smaller one.', 'error'); return false }
  return true
}

// Make an element a logo target: click opens the file picker, an image can be dropped on it.
function wireLogoTarget(button, fileInput, onFile) {
  button.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]
    fileInput.value = ''
    if (validLogoFile(file)) onFile(file)
  })
  button.addEventListener('dragover', (e) => { e.preventDefault(); button.classList.add('drag-over') })
  button.addEventListener('dragleave', () => button.classList.remove('drag-over'))
  button.addEventListener('drop', (e) => {
    e.preventDefault()
    button.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (validLogoFile(file)) onFile(file)
  })
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('manage-client-list')
  if (!list) return

  const open = openClientIds()
  const matched = clientSearchTerm
    ? localClients.filter((c) => c.name.toLowerCase().includes(clientSearchTerm))
    : localClients

  if (matched.length === 0) {
    list.innerHTML = clientSearchTerm
      ? `<div class="manage-sidebar-empty">No client matches “${escHtml(clientSearchTerm)}”.</div>`
      : `<div class="manage-sidebar-empty">No clients yet.<br>Add your first one with <strong>New client</strong>.</div>`
    return
  }

  const groups = { active: [], inactive: [], archived: [] }
  for (const c of matched) groups[clientState(c, open)].push(c)

  const row = (c) => {
    const state = clientState(c, open)
    const projectCount = localProjects.filter((p) => p.clientId === c.id).length
    const tasks = openTaskCount('clientId', c.id)
    const meta = [
      projectCount ? plural(projectCount, 'project') : 'No projects',
      tasks ? `${tasks} open` : '',
    ].filter(Boolean).join(' · ')
    const isSelected = c.id === selectedClientId
    return `
      <button class="manage-client-row${isSelected ? ' active' : ''}${state !== 'active' ? ' dimmed' : ''}" data-id="${c.id}"${isSelected ? ' aria-current="true"' : ''}>
        ${logoMarkup(c, 'manage-client-logo')}
        <span class="manage-client-row-info">
          <span class="manage-client-row-name">${escHtml(c.name)}</span>
          <span class="manage-client-row-meta">${meta}</span>
        </span>
      </button>
    `
  }

  // While searching, or when the selected client is archived, archived rows are shown.
  const selectedIsArchived = groups.archived.some((c) => c.id === selectedClientId)
  const archivedOpen = showArchived || !!clientSearchTerm || selectedIsArchived

  let html = groups.active.map(row).join('')
  if (groups.inactive.length) {
    html += `<div class="manage-sidebar-group" title="Clients with no open tasks. They are hidden from the board until new work is added.">No open work</div>`
    html += groups.inactive.map(row).join('')
  }
  if (groups.archived.length) {
    html += `
      <button class="manage-sidebar-group manage-archived-toggle" id="manage-archived-toggle" aria-expanded="${archivedOpen}">
        <i class="ph ${archivedOpen ? 'ph-caret-down' : 'ph-caret-right'}"></i> Archived <span class="manage-section-count">${groups.archived.length}</span>
      </button>
    `
    if (archivedOpen) html += groups.archived.map(row).join('')
  }
  list.innerHTML = html

  list.querySelectorAll('.manage-client-row').forEach((el) => {
    el.addEventListener('click', () => {
      selectedClientId = el.dataset.id
      activeProjectId = null
      projectIsEditing = false
      addingProject = false
      addingPerson = false
      renderSidebar()
      renderDetail()
    })
  })
  document.getElementById('manage-archived-toggle')?.addEventListener('click', () => {
    showArchived = !archivedOpen
    renderSidebar()
  })
}

// ─────────────────────────────────────────────────────────────
// DETAIL PANE
// ─────────────────────────────────────────────────────────────

// Subscriptions re-render the whole pane, including while someone is typing in
// it. Carry the focused field and any unsaved add-row text across the render.
function snapshotPane(pane) {
  const active = pane.contains(document.activeElement) ? document.activeElement : null
  const drafts = {}
  pane.querySelectorAll('[data-draft]').forEach((el) => { if (el.id) drafts[el.id] = el.value })
  return {
    key: pane.dataset.key || '',
    drafts,
    focusId: active?.id || '',
    focusValue: active && 'value' in active ? active.value : null,
    selection: active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null,
  }
}

function restorePane(pane, snap) {
  if (!snap.key || pane.dataset.key !== snap.key) return
  for (const [id, value] of Object.entries(snap.drafts)) {
    const el = document.getElementById(id)
    if (el) el.value = value
  }
  if (!snap.focusId) return
  const el = document.getElementById(snap.focusId)
  if (!el || !pane.contains(el)) return
  if (snap.focusValue != null && el.tagName !== 'SELECT' && el.tagName !== 'BUTTON') el.value = snap.focusValue
  el.focus()
  if (snap.selection) { try { el.setSelectionRange(...snap.selection) } catch (_) { /* number inputs */ } }
}

function renderDetail() {
  const pane = document.getElementById('manage-detail')
  if (!pane) return
  const snap = snapshotPane(pane)
  renderDetailInner(pane)
  restorePane(pane, snap)
}

function renderDetailInner(pane) {
  // Project detail overrides client detail when active
  if (activeProjectId) {
    const project = localProjects.find((p) => p.id === activeProjectId)
    if (project) {
      pane.dataset.key = `project:${project.id}`
      renderProjectDetail(pane, project)
      return
    }
    activeProjectId = null
  }

  const client = localClients.find((c) => c.id === selectedClientId)
  if (!client) {
    pane.dataset.key = ''
    const none = localClients.length === 0
    pane.innerHTML = `
      <div class="manage-detail-empty">
        <i class="ph ph-buildings"></i>
        <h3>${none ? 'Add your first client' : 'Pick a client'}</h3>
        <p>${none
          ? 'A client holds its projects, its Slack channel and the people on their side who can sign in.'
          : 'Select a client on the left to see its projects and who has access.'}</p>
        ${none ? '<button class="btn-primary" id="empty-add-client"><i class="ph ph-plus"></i> New client</button>' : ''}
      </div>
    `
    document.getElementById('empty-add-client')?.addEventListener('click', openNewClientDialog)
    return
  }

  pane.dataset.key = `client:${client.id}`
  renderClientDetail(pane, client)
}

function renderClientDetail(pane, client) {
  const db = currentCtx.db
  const projects = localProjects.filter((p) => p.clientId === client.id)
  const users = localClientUsers.filter((u) => u.clientId === client.id)
  const state = clientState(client, openClientIds())
  const tasks = openTaskCount('clientId', client.id)
  const currency = client.currency || 'INR'
  const slackText = channelLabel(client.slackChannelId, client.slackChannelName)
  const sharedText = channelLabel(client.clientSharedChannelId, client.clientSharedChannelName)
  const defaultOwner = client.defaultOwner || ''

  const summary = [plural(projects.length, 'project'), tasks ? plural(tasks, 'open task') : 'no open tasks'].join(' · ')

  pane.innerHTML = `
    <div class="manage-detail-header">
      <div class="manage-logo-wrap">
        <button class="manage-logo-btn" id="client-logo-btn" title="${client.logoUrl ? 'Change logo' : 'Add a logo'}" aria-label="${client.logoUrl ? 'Change logo' : 'Add a logo'} for ${escHtml(client.name)}">
          ${logoMarkup(client, 'manage-detail-logo')}
          <span class="manage-logo-overlay" aria-hidden="true"><i class="ph ph-camera"></i></span>
        </button>
        ${client.logoUrl ? '<button class="manage-logo-remove" id="client-logo-remove" title="Remove logo" aria-label="Remove logo"><i class="ph ph-x"></i></button>' : ''}
        <input type="file" id="client-logo-input" accept="image/*" class="hidden">
      </div>
      <div class="manage-detail-identity">
        <input type="text" id="client-name-input" class="manage-name-input" value="${escHtml(client.name)}" aria-label="Client name" title="Click to rename" autocomplete="off" spellcheck="false">
        <div class="manage-detail-sub">${summary}</div>
      </div>
      <div class="manage-detail-actions">
        ${client.archived ? '' : '<button class="btn-ghost" id="archive-client-btn"><i class="ph ph-archive"></i> Archive</button>'}
      </div>
    </div>

    ${client.archived ? `
      <div class="manage-banner">
        <i class="ph ph-archive"></i>
        <span><strong>Archived.</strong> Hidden from the board, backlog and task pickers. Its projects, tasks and timesheets are kept.</span>
        <button class="btn-ghost" id="archive-client-btn">Unarchive</button>
      </div>` : state === 'inactive' ? `
      <div class="manage-banner manage-banner-quiet">
        <i class="ph ph-moon"></i>
        <span>No open tasks, so this client is hidden from the board until new work is added.</span>
      </div>` : ''}

    <div class="manage-fields">
      <div class="manage-field">
        <label class="manage-field-label" for="client-rate">Default hourly rate</label>
        <div class="manage-rate-control">
          <select id="client-currency" class="form-select" aria-label="Currency">${currencyOptions(currency)}</select>
          <input type="number" id="client-rate" class="form-input" min="0" step="1" inputmode="decimal" placeholder="Not set" value="${client.defaultHourlyRate || ''}">
        </div>
        <p class="manage-field-hint">New projects start at this rate. Existing projects keep their own.</p>
      </div>
      <div class="manage-field">
        <span class="manage-field-label" id="client-slack-label">Slack channel</span>
        <button class="manage-channel-btn${slackText ? '' : ' empty'}" id="client-slack-btn" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="client-slack-label client-slack-btn">
          <i class="ph ph-slack-logo"></i>
          <span class="manage-channel-text">${slackText ? escHtml(slackText) : 'Choose a channel'}</span>
          <i class="ph ph-caret-down"></i>
        </button>
        <p class="manage-field-hint">Task updates for this client are posted here.</p>
      </div>
      <div class="manage-field">
        <label class="manage-field-label" for="client-default-owner">Default owner</label>
        <select id="client-default-owner" class="form-select">
          <option value="">None</option>
          ${TEAM.map((m) => `<option value="${escHtml(m.email)}"${m.email === defaultOwner ? ' selected' : ''}>${escHtml(m.name)}</option>`).join('')}
        </select>
      </div>
      <div class="manage-field">
        <span class="manage-field-label" id="client-shared-label">Channel shared with the client</span>
        <button class="manage-channel-btn${sharedText ? '' : ' empty'}" id="client-shared-btn" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="client-shared-label client-shared-btn">
          <i class="ph ph-slack-logo"></i>
          <span class="manage-channel-text">${sharedText ? escHtml(sharedText) : 'Choose a channel'}</span>
          <i class="ph ph-caret-down"></i>
        </button>
        <p class="manage-field-hint">The Slack channel the client is in. Asterisk may read it.</p>
      </div>
    </div>

    <div class="manage-section">
      <div class="manage-section-header">
        <h3 class="manage-section-title">Projects <span class="manage-section-count">${projects.length}</span></h3>
        <button class="btn-ghost btn-sm" id="add-project-btn"><i class="ph ph-plus"></i> Add project</button>
      </div>
      <form id="add-project-form" class="manage-add-row${addingProject ? '' : ' hidden'}" novalidate>
        <input type="text" id="pf-name" class="form-input" data-draft placeholder="Project name, e.g. Brand identity" autocomplete="off" aria-label="Project name">
        <button type="submit" class="btn-primary">Add</button>
        <button type="button" class="btn-ghost" id="pf-cancel">Done</button>
      </form>
      <div class="manage-rows" id="projects-list"></div>
    </div>

    <div class="manage-section">
      <div class="manage-section-header">
        <h3 class="manage-section-title">People with access <span class="manage-section-count">${users.length}</span></h3>
        <button class="btn-ghost btn-sm" id="add-cu-btn"><i class="ph ph-plus"></i> Add person</button>
      </div>
      <p class="manage-section-hint">People on the client's side who can sign in and see this client's board, timeline and timesheets.</p>
      <form id="add-cu-form" class="manage-add-row manage-add-person${addingPerson ? '' : ' hidden'}" novalidate>
        <input type="text" id="cuf-name" class="form-input" data-draft placeholder="Name" autocomplete="off" aria-label="Name">
        <input type="email" id="cuf-email" class="form-input" data-draft placeholder="Google account email" autocomplete="off" aria-label="Email">
        <button type="submit" class="btn-primary">Give access</button>
        <button type="button" class="btn-ghost" id="cuf-cancel">Cancel</button>
        <p class="manage-form-note" id="cuf-note">No email is sent. Tell them to sign in at work.publicknowledge.co with this Google account.</p>
      </form>
      <div class="manage-rows" id="client-users-list"></div>
    </div>
  `

  // ── Logo: click or drop to change, × to remove ──
  const logoBtn = document.getElementById('client-logo-btn')
  wireLogoTarget(logoBtn, document.getElementById('client-logo-input'), async (file) => {
    logoBtn.classList.add('busy')
    const done = await attempt(async () => {
      const url = await uploadClientLogo(file, client.id)
      await updateClient(db, client.id, { logoUrl: url })
    }, { ok: 'Logo updated', fail: 'Couldn\'t update the logo' })
    if (!done) logoBtn.classList.remove('busy')
  })
  document.getElementById('client-logo-remove')?.addEventListener('click', () => {
    attempt(() => updateClient(db, client.id, { logoUrl: '' }), { ok: 'Logo removed', fail: 'Couldn\'t remove the logo' })
  })

  // ── Name: edit in place ──
  const nameInput = document.getElementById('client-name-input')
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur() }
    if (e.key === 'Escape') { nameInput.value = client.name; nameInput.blur() }
  })
  nameInput.addEventListener('blur', () => {
    const next = nameInput.value.trim()
    if (!next || next === client.name) { nameInput.value = client.name; return }
    if (nameTaken(next, client.id)) {
      toast(`There's already a client called “${next}”.`, 'error')
      nameInput.value = client.name
      return
    }
    attempt(() => updateClient(db, client.id, { name: next }), { ok: 'Renamed', fail: 'Couldn\'t rename the client' })
  })

  // ── Rate + currency: save on change ──
  const rateInput = document.getElementById('client-rate')
  const currencySelect = document.getElementById('client-currency')
  const saveRate = () => {
    const rate = Math.max(0, parseFloat(rateInput.value) || 0)
    const cur = currencySelect.value
    if (rate === (client.defaultHourlyRate || 0) && cur === currency) return
    attempt(() => updateClient(db, client.id, { defaultHourlyRate: rate, currency: cur }), { ok: 'Rate saved', fail: 'Couldn\'t save the rate' })
  }
  rateInput.addEventListener('change', saveRate)
  rateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') rateInput.blur() })
  currencySelect.addEventListener('change', saveRate)

  // ── Slack channel ──
  const slackBtn = document.getElementById('client-slack-btn')
  slackBtn.addEventListener('click', () => {
    openChannelPicker(slackBtn, {
      currentUser: currentCtx.currentUser,
      value: client.slackChannelId || '',
      onPick: (ch) => saveChannel((data) => updateClient(db, client.id, data), ch),
    })
  })

  const sharedBtn = document.getElementById('client-shared-btn')
  sharedBtn.addEventListener('click', () => {
    openChannelPicker(sharedBtn, {
      currentUser: currentCtx.currentUser,
      value: client.clientSharedChannelId || '',
      onPick: (ch) => saveChannel((data) => updateClient(db, client.id, data), ch, {
        idField: 'clientSharedChannelId', nameField: 'clientSharedChannelName',
        what: 'Shared channel', needsBot: 'so Asterisk can read it',
      }),
    })
  })

  // ── Default owner ──
  const ownerSelect = document.getElementById('client-default-owner')
  ownerSelect.addEventListener('change', () => {
    attempt(() => updateClient(db, client.id, { defaultOwner: ownerSelect.value }), { ok: 'Default owner saved', fail: 'Couldn\'t save the default owner' })
  })

  // ── Archive / unarchive. Reversible, so no confirmation — just say what happened. ──
  document.getElementById('archive-client-btn')?.addEventListener('click', () => {
    const archiving = !client.archived
    attempt(() => updateClient(db, client.id, { archived: archiving }), {
      ok: archiving ? `${client.name} archived` : `${client.name} is back in use`,
      fail: archiving ? 'Couldn\'t archive the client' : 'Couldn\'t unarchive the client',
    })
  })

  // ── Add project (stays open so several can be added in a row) ──
  const projectForm = document.getElementById('add-project-form')
  const projectName = document.getElementById('pf-name')
  document.getElementById('add-project-btn').addEventListener('click', () => {
    addingProject = true
    projectForm.classList.remove('hidden')
    projectName.focus()
  })
  const closeProjectForm = () => {
    addingProject = false
    projectName.value = ''
    projectForm.classList.add('hidden')
  }
  document.getElementById('pf-cancel').addEventListener('click', closeProjectForm)
  projectName.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProjectForm() })
  projectForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = projectName.value.trim()
    if (!name) { projectName.focus(); return }
    if (projects.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
      toast(`${client.name} already has a project called “${name}”.`, 'error')
      return
    }
    projectName.value = ''
    const done = await attempt(() => createProject(db, {
      name, clientId: client.id, hourlyRate: client.defaultHourlyRate || 0, currency,
    }), { ok: `Added “${name}”`, fail: 'Couldn\'t add the project' })
    const field = document.getElementById('pf-name')
    if (field) { if (!done) field.value = name; field.focus() }
  })

  // ── Add person ──
  const personForm = document.getElementById('add-cu-form')
  const personNote = document.getElementById('cuf-note')
  const personNoteDefault = personNote.textContent
  const setPersonError = (msg) => {
    personNote.textContent = msg || personNoteDefault
    personNote.classList.toggle('error', !!msg)
  }
  document.getElementById('add-cu-btn').addEventListener('click', () => {
    addingPerson = true
    personForm.classList.remove('hidden')
    document.getElementById('cuf-name').focus()
  })
  const closePersonForm = () => {
    addingPerson = false
    personForm.reset()
    setPersonError('')
    personForm.classList.add('hidden')
  }
  document.getElementById('cuf-cancel').addEventListener('click', closePersonForm)
  personForm.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePersonForm() })
  personForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = document.getElementById('cuf-name').value.trim()
    const email = document.getElementById('cuf-email').value.trim().toLowerCase()
    if (!name) { setPersonError('Add their name.'); document.getElementById('cuf-name').focus(); return }
    if (!EMAIL_RE.test(email)) { setPersonError('Enter a full email address, like sam@client.com.'); document.getElementById('cuf-email').focus(); return }
    if (email.endsWith('@publicknowledge.co')) { setPersonError('Studio accounts already have full access.'); return }
    // clientUsers is keyed by email: saving would silently move them to this client.
    const existing = localClientUsers.find((u) => u.email === email)
    if (existing) {
      const other = localClients.find((c) => c.id === existing.clientId)
      setPersonError(existing.clientId === client.id
        ? `${email} already has access.`
        : `${email} already has access to ${other?.name || 'another client'}. One email can belong to one client. Remove it there first.`)
      return
    }
    const done = await attempt(() => createClientUser(db, email, {
      name, clientId: client.id, invitedBy: currentCtx.currentUser?.email || '',
    }), { ok: `${name} can now sign in`, fail: 'Couldn\'t give access' })
    if (done) closePersonForm()
  })

  renderProjectsList(projects, client)
  renderClientUsersList(users, client)
}

// Save a picked channel (or '' to clear) through `write`, then say what happened.
async function saveChannel(write, ch, { idField = 'slackChannelId', nameField = 'slackChannelName', what = 'Slack channel', needsBot = 'so updates can post' } = {}) {
  const done = await attempt(() => write({ [idField]: ch.id, [nameField]: ch.name }), {
    fail: `Couldn't save the ${what.toLowerCase()}`,
  })
  if (!done) return
  if (!ch.id) toast(`${what} cleared`)
  else if (!ch.isMember) toast(`Saved, but the bot isn't in #${ch.name} yet. Invite it there ${needsBot}.`, 'error')
  else toast(`${what} set to ${ch.name ? '#' + ch.name : ch.id}`)
}

function renderProjectsList(projects, client) {
  const list = document.getElementById('projects-list')
  if (!list) return

  if (projects.length === 0) {
    list.innerHTML = `<div class="manage-empty-row">No projects yet. Tasks are filed under a project, so add one to start.</div>`
    return
  }

  list.innerHTML = projects.map((p) => {
    const pRate = p.hourlyRate ?? client?.defaultHourlyRate ?? 0
    const pCurrency = p.currency || client?.currency || 'INR'
    const tasks = openTaskCount('projectId', p.id)
    const meta = [
      tasks ? plural(tasks, 'open task') : 'No open tasks',
      pRate ? `${escHtml(pCurrency)} ${pRate}/hr` : '',
      p.slackChannelId ? escHtml(channelLabel(p.slackChannelId, p.slackChannelName)) : '',
    ].filter(Boolean).join(' · ')
    return `
      <button class="manage-row project-row" data-id="${p.id}">
        <span class="manage-row-main">
          <span class="manage-row-name">${escHtml(p.name)}</span>
          <span class="manage-row-meta">${meta}</span>
        </span>
        <i class="ph ph-caret-right manage-row-chevron" aria-hidden="true"></i>
      </button>
    `
  }).join('')

  list.querySelectorAll('.project-row').forEach((row) => {
    row.addEventListener('click', () => {
      activeProjectId = row.dataset.id
      projectActiveTab = 'page'
      renderDetail()
    })
  })
}

function renderClientUsersList(users, client) {
  const list = document.getElementById('client-users-list')
  if (!list) return

  if (users.length === 0) {
    list.innerHTML = `<div class="manage-empty-row">Nobody at ${escHtml(client.name)} can sign in yet.</div>`
    return
  }

  list.innerHTML = users.map((cu) => {
    const inviter = TEAM.find((m) => m.email === cu.invitedBy)
    return `
      <div class="manage-row" data-email="${escHtml(cu.email)}">
        <span class="manage-person-avatar" aria-hidden="true">${escHtml((cu.name || cu.email || '?')[0].toUpperCase())}</span>
        <div class="manage-row-main">
          <span class="manage-row-name">${escHtml(cu.name)}</span>
          <span class="manage-row-meta">${escHtml(cu.email)}${inviter ? ' · added by ' + escHtml(inviter.name) : ''}</span>
        </div>
        <button class="btn-ghost btn-sm cu-delete" data-email="${escHtml(cu.email)}" data-name="${escHtml(cu.name)}">Remove access</button>
      </div>
    `
  }).join('')

  list.querySelectorAll('.cu-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const who = btn.dataset.name || btn.dataset.email
      const yes = await confirmDialog({
        title: `Remove ${who}'s access?`,
        body: `${btn.dataset.email} will no longer be able to sign in and see ${client.name}'s work. You can add them again later.`,
        confirmLabel: 'Remove access',
        danger: true,
      })
      if (yes) attempt(() => deleteClientUser(currentCtx.db, btn.dataset.email), { ok: `${who} no longer has access`, fail: 'Couldn\'t remove access' })
    })
  })
}

// ─────────────────────────────────────────────────────────────
// NEW CLIENT DIALOG
// ─────────────────────────────────────────────────────────────

function openNewClientDialog() {
  if (document.getElementById('new-client-overlay')) return
  const previous = document.activeElement
  let logoFile = null
  let logoPreviewUrl = ''
  let channel = { id: '', name: '' }
  let saving = false

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay manage-overlay'
  overlay.id = 'new-client-overlay'
  overlay.innerHTML = `
    <div class="modal manage-dialog" role="dialog" aria-modal="true" aria-labelledby="nc-title">
      <div class="modal-header">
        <h3 class="modal-title" id="nc-title">New client</h3>
        <button type="button" class="modal-close" id="nc-close" aria-label="Close">&times;</button>
      </div>
      <form class="modal-body" id="nc-form" novalidate>
        <div class="nc-identity">
          <div class="manage-logo-wrap">
            <button type="button" class="manage-logo-btn nc-logo-btn" id="nc-logo-btn" aria-label="Add a logo">
              <span class="nc-logo-empty" id="nc-logo-empty"><i class="ph ph-image"></i><span>Logo</span></span>
              <img class="manage-detail-logo hidden" id="nc-logo-preview" alt="">
              <span class="manage-logo-overlay" aria-hidden="true"><i class="ph ph-camera"></i></span>
            </button>
            <button type="button" class="manage-logo-remove hidden" id="nc-logo-remove" title="Remove logo" aria-label="Remove logo"><i class="ph ph-x"></i></button>
            <input type="file" id="nc-logo-input" accept="image/*" class="hidden">
          </div>
          <div class="manage-field nc-name-field">
            <label class="manage-field-label" for="nc-name">Client name</label>
            <input type="text" id="nc-name" class="form-input" placeholder="e.g. Brunk" autocomplete="off">
            <p class="manage-field-hint">Click the square to add a logo, or drop or paste an image. You can add it later too.</p>
          </div>
        </div>

        <div class="manage-field">
          <label class="manage-field-label" for="nc-project">First project <span class="manage-optional">optional</span></label>
          <input type="text" id="nc-project" class="form-input" placeholder="e.g. Brand identity" autocomplete="off">
          <p class="manage-field-hint">Tasks are filed under a project. You can add more afterwards.</p>
        </div>

        <details class="nc-more" id="nc-more">
          <summary>Billing and Slack <span class="manage-optional">optional</span></summary>
          <div class="manage-fields">
            <div class="manage-field">
              <label class="manage-field-label" for="nc-rate">Default hourly rate</label>
              <div class="manage-rate-control">
                <select id="nc-currency" class="form-select" aria-label="Currency">${currencyOptions('INR')}</select>
                <input type="number" id="nc-rate" class="form-input" min="0" step="1" inputmode="decimal" placeholder="Not set">
              </div>
            </div>
            <div class="manage-field">
              <span class="manage-field-label" id="nc-slack-label">Slack channel</span>
              <button type="button" class="manage-channel-btn empty" id="nc-slack-btn" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="nc-slack-label nc-slack-btn">
                <i class="ph ph-slack-logo"></i>
                <span class="manage-channel-text" id="nc-slack-text">Choose a channel</span>
                <i class="ph ph-caret-down"></i>
              </button>
            </div>
          </div>
        </details>

        <p class="manage-form-note error hidden" id="nc-error" role="alert"></p>
      </form>
      <div class="modal-footer">
        <div class="modal-footer-right">
          <button type="button" class="btn-ghost" id="nc-cancel">Cancel</button>
          <button type="submit" form="nc-form" class="btn-primary" id="nc-save">Create client</button>
        </div>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const $ = (id) => overlay.querySelector('#' + id)
  const nameInput = $('nc-name')
  const errorEl = $('nc-error')
  const saveBtn = $('nc-save')

  const showError = (msg) => {
    errorEl.textContent = msg
    errorEl.classList.toggle('hidden', !msg)
  }

  const close = () => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    document.removeEventListener('paste', onPaste)
    overlay.remove()
    previous?.focus?.()
  }

  const setLogo = (file) => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl)
    logoFile = file
    logoPreviewUrl = file ? URL.createObjectURL(file) : ''
    $('nc-logo-preview').src = logoPreviewUrl
    $('nc-logo-preview').classList.toggle('hidden', !file)
    $('nc-logo-empty').classList.toggle('hidden', !!file)
    $('nc-logo-remove').classList.toggle('hidden', !file)
    $('nc-logo-btn').setAttribute('aria-label', file ? 'Change logo' : 'Add a logo')
  }
  wireLogoTarget($('nc-logo-btn'), $('nc-logo-input'), setLogo)
  $('nc-logo-remove').addEventListener('click', () => setLogo(null))

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
    if (file && validLogoFile(file)) { e.preventDefault(); setLogo(file) }
  }
  document.addEventListener('paste', onPaste)

  $('nc-slack-btn').addEventListener('click', () => {
    openChannelPicker($('nc-slack-btn'), {
      currentUser: currentCtx?.currentUser,
      value: channel.id,
      onPick: (ch) => {
        channel = ch
        $('nc-slack-text').textContent = ch.id ? (ch.name ? '#' + ch.name : ch.id) : 'Choose a channel'
        $('nc-slack-btn').classList.toggle('empty', !ch.id)
      },
    })
  })

  nameInput.addEventListener('input', () => showError(''))
  $('nc-close').addEventListener('click', close)
  $('nc-cancel').addEventListener('click', close)
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !saving) close() })
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !saving) close() })

  $('nc-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (saving) return
    const name = nameInput.value.trim()
    if (!name) { showError('Give the client a name.'); nameInput.focus(); return }
    const clash = nameTaken(name)
    if (clash) {
      showError(clash.archived
        ? `“${clash.name}” already exists but is archived. Unarchive it from the list instead.`
        : `There's already a client called “${clash.name}”.`)
      nameInput.focus()
      return
    }
    const rate = Math.max(0, parseFloat($('nc-rate').value) || 0)
    const currency = $('nc-currency').value || 'INR'
    const projectName = $('nc-project').value.trim()
    const db = currentCtx.db

    saving = true
    saveBtn.disabled = true
    saveBtn.textContent = 'Creating…'
    showError('')

    let clientId
    try {
      const ref = await createClient(db, {
        name, logoUrl: '', defaultHourlyRate: rate, currency,
        slackChannelId: channel.id, slackChannelName: channel.name,
      })
      clientId = ref.id
    } catch (err) {
      console.error('Error creating client:', err)
      saving = false
      saveBtn.disabled = false
      saveBtn.textContent = 'Create client'
      showError(`Couldn't create the client. ${err?.message || 'Try again.'}`)
      return
    }

    // The client exists now. Logo and first project are extras: if one fails,
    // keep the client and say what's missing rather than leaving the dialog stuck.
    const missed = []
    if (logoFile) {
      try {
        const url = await uploadClientLogo(logoFile, clientId)
        await updateClient(db, clientId, { logoUrl: url })
      } catch (err) { console.error('Logo upload failed:', err); missed.push('the logo') }
    }
    if (projectName) {
      try {
        await createProject(db, { name: projectName, clientId, hourlyRate: rate, currency })
      } catch (err) { console.error('First project failed:', err); missed.push('the first project') }
    }

    selectedClientId = clientId
    activeProjectId = null
    clientSearchTerm = ''
    const search = document.getElementById('manage-client-search')
    if (search) search.value = ''
    close()
    renderSidebar()
    renderDetail()
    if (missed.length) toast(`${name} was created, but ${missed.join(' and ')} didn't save. Add it from the client page.`, 'error')
    else toast(`${name} added`)
  })

  nameInput.focus()
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
        <button class="btn-ghost person-back-btn" id="project-back-btn" aria-label="Back to ${escHtml(client?.name || 'client')}" title="Back to ${escHtml(client?.name || 'client')}">
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
        <textarea id="project-page-textarea" class="page-editor-textarea" data-draft placeholder="Write about this project using markdown...">${escHtml(content)}</textarea>
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
  const db = currentCtx.db
  const client = localClients.find((c) => c.id === project.clientId)
  const rate = project.hourlyRate ?? client?.defaultHourlyRate ?? 0
  const currency = project.currency || client?.currency || 'INR'
  const inherited = project.hourlyRate == null

  const projectSlack = channelLabel(project.slackChannelId, project.slackChannelName)
  const clientSlack = channelLabel(client?.slackChannelId, client?.slackChannelName)
  const taskCount = (currentCtx?.allTasks || []).filter((t) => t.projectId === project.id).length

  container.innerHTML = `
    <div class="project-settings">
      <div class="manage-fields">
        <div class="manage-field manage-field-wide">
          <label class="manage-field-label" for="project-name">Project name</label>
          <input type="text" id="project-name" class="form-input" value="${escHtml(project.name)}" autocomplete="off">
        </div>
        <div class="manage-field">
          <label class="manage-field-label" for="project-rate">Hourly rate</label>
          <div class="manage-rate-control">
            <select id="project-currency" class="form-select" aria-label="Currency">${currencyOptions(currency)}</select>
            <input type="number" id="project-rate" class="form-input" value="${rate}" min="0" step="1" inputmode="decimal" placeholder="0">
          </div>
          ${inherited && client ? `<p class="manage-field-hint settings-hint">Inherited from ${escHtml(client.name)} default rate</p>` : ''}
        </div>
        <div class="manage-field">
          <span class="manage-field-label" id="project-slack-label">Slack channel</span>
          <button class="manage-channel-btn${projectSlack ? '' : ' empty'}" id="project-slack-btn" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="project-slack-label project-slack-btn">
            <i class="ph ph-slack-logo"></i>
            <span class="manage-channel-text">${projectSlack ? escHtml(projectSlack) : (clientSlack ? `Same as client (${escHtml(clientSlack)})` : 'Choose a channel')}</span>
            <i class="ph ph-caret-down"></i>
          </button>
          <p class="manage-field-hint">Only set this if the project has its own channel.</p>
        </div>
      </div>
      <p class="manage-field-hint">Changes save as you make them.</p>

      <div class="manage-danger-zone">
        <div>
          <strong>Delete this project</strong>
          <p class="manage-field-hint">${taskCount ? `Its ${plural(taskCount, 'task')} are kept but will no longer belong to a project.` : 'It has no tasks.'}</p>
        </div>
        <button class="btn-ghost danger" id="project-delete-btn"><i class="ph ph-trash"></i> Delete project</button>
      </div>
    </div>
  `

  const nameInput = document.getElementById('project-name')
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur()
    if (e.key === 'Escape') { nameInput.value = project.name; nameInput.blur() }
  })
  nameInput.addEventListener('change', () => {
    const next = nameInput.value.trim()
    if (!next || next === project.name) { nameInput.value = project.name; return }
    attempt(() => updateProject(db, project.id, { name: next }), { ok: 'Renamed', fail: 'Couldn\'t rename the project' })
  })

  const rateInput = document.getElementById('project-rate')
  const currencySelect = document.getElementById('project-currency')
  const saveRate = () => {
    const newRate = Math.max(0, parseFloat(rateInput.value) || 0)
    attempt(() => updateProject(db, project.id, { hourlyRate: newRate, currency: currencySelect.value || 'INR' }), { ok: 'Rate saved', fail: 'Couldn\'t save the rate' })
  }
  rateInput.addEventListener('change', saveRate)
  rateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') rateInput.blur() })
  currencySelect.addEventListener('change', saveRate)

  const slackBtn = document.getElementById('project-slack-btn')
  slackBtn.addEventListener('click', () => {
    openChannelPicker(slackBtn, {
      currentUser: currentCtx.currentUser,
      value: project.slackChannelId || '',
      onPick: (ch) => saveChannel((data) => updateProject(db, project.id, data), ch),
    })
  })

  document.getElementById('project-delete-btn').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: `Delete “${project.name}”?`,
      body: taskCount
        ? `This can't be undone. Its ${plural(taskCount, 'task')} stay under ${client?.name || 'the client'} without a project.`
        : 'This can\'t be undone.',
      confirmLabel: 'Delete project',
      danger: true,
    })
    if (!yes) return
    const done = await attempt(() => deleteProject(db, project.id), { ok: `Deleted “${project.name}”`, fail: 'Couldn\'t delete the project' })
    if (done) { activeProjectId = null; renderDetail() }
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
  addingProject = false
  addingPerson = false
  document.getElementById('new-client-overlay')?.remove()
}
