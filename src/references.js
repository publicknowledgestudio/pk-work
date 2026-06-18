import {
  subscribeToReferences,
  subscribeToMoodboards,
  deleteReference,
  updateReference,
  createMoodboard,
  updateMoodboard,
  deleteMoodboard,
} from './db.js'
import { selectableClients } from './utils/client-visibility.js'

// Module-level state
let unsubReferences = null
let unsubMoodboards = null
let localReferences = []
let localMoodboards = []
let currentSubTab = 'references' // 'references' | 'moodboards'
let searchQuery = ''
let filterClientId = ''
let filterTag = ''
let activeMoodboardId = null
let currentCtx = null

export function renderReferences(container, ctx) {
  // Clean up previous subscriptions
  if (unsubReferences) unsubReferences()
  if (unsubMoodboards) unsubMoodboards()
  currentCtx = ctx
  currentSubTab = 'references'
  searchQuery = ''
  filterClientId = ''
  filterTag = ''
  activeMoodboardId = null

  container.innerHTML = `
    <div class="references-view">
      <div class="references-header">
        <h2>References</h2>
        <p>Design references from #references</p>
      </div>
      <div class="board-subnav" style="padding: 0 24px;">
        <button class="board-subnav-tab active" data-subtab="references">All References</button>
        <button class="board-subnav-tab" data-subtab="moodboards">Mood Boards</button>
      </div>
      <div id="references-toolbar-wrap"></div>
      <div class="references-body" id="references-body"></div>
    </div>
  `

  // Sub-tab navigation
  container.querySelectorAll('.board-subnav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSubTab = btn.dataset.subtab
      activeMoodboardId = null
      container.querySelectorAll('.board-subnav-tab').forEach((b) =>
        b.classList.toggle('active', b.dataset.subtab === currentSubTab)
      )
      renderToolbar()
      renderBody()
    })
  })

  // Subscribe to Firestore data
  unsubReferences = subscribeToReferences(ctx.db, (refs) => {
    localReferences = refs
    renderToolbar()
    renderBody()
  })

  unsubMoodboards = subscribeToMoodboards(ctx.db, (boards) => {
    localMoodboards = boards
    if (currentSubTab === 'moodboards') renderBody()
  })
}

function renderToolbar() {
  const wrap = document.getElementById('references-toolbar-wrap')
  if (!wrap) return

  if (currentSubTab === 'moodboards' && !activeMoodboardId) {
    wrap.innerHTML = ''
    return
  }

  // Collect all unique tags from references
  const allTags = []
  localReferences.forEach((r) => {
    ;(r.tags || []).forEach((t) => {
      if (!allTags.includes(t)) allTags.push(t)
    })
  })
  allTags.sort()

  const clientOptions = selectableClients(currentCtx?.clients)
    .map((c) => `<option value="${c.id}"${filterClientId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('')

  const tagOptions = allTags
    .map((t) => `<option value="${esc(t)}"${filterTag === t ? ' selected' : ''}>${esc(t)}</option>`)
    .join('')

  wrap.innerHTML = `
    <div class="references-toolbar">
      <input type="text" class="references-search" id="ref-search" placeholder="Search references..." value="${esc(searchQuery)}">
      <select class="references-filter" id="ref-filter-client">
        <option value="">All Clients</option>
        ${clientOptions}
      </select>
      <select class="references-filter" id="ref-filter-tag">
        <option value="">All Tags</option>
        ${tagOptions}
      </select>
    </div>
  `

  document.getElementById('ref-search').addEventListener('input', (e) => {
    searchQuery = e.target.value
    renderBody()
  })

  document.getElementById('ref-filter-client').addEventListener('change', (e) => {
    filterClientId = e.target.value
    renderBody()
  })

  document.getElementById('ref-filter-tag').addEventListener('change', (e) => {
    filterTag = e.target.value
    renderBody()
  })
}

function getFilteredReferences(refs) {
  let filtered = refs || localReferences

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    filtered = filtered.filter((r) =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.url || '').toLowerCase().includes(q) ||
      (r.tags || []).some((t) => t.toLowerCase().includes(q))
    )
  }

  if (filterClientId) {
    filtered = filtered.filter((r) => r.clientId === filterClientId)
  }

  if (filterTag) {
    filtered = filtered.filter((r) => (r.tags || []).includes(filterTag))
  }

  return filtered
}

function renderBody() {
  const body = document.getElementById('references-body')
  if (!body) return

  if (currentSubTab === 'references') {
    renderAllReferences(body)
  } else if (activeMoodboardId) {
    renderMoodboardDetail(body)
  } else {
    renderMoodboardsList(body)
  }
}

function renderAllReferences(body) {
  const filtered = getFilteredReferences()

  if (filtered.length === 0) {
    if (localReferences.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <i class="ph ph-image-square empty-state-icon"></i>
          <div class="empty-state-text">No references yet</div>
          <p class="references-empty-subtext">References shared in #references on Slack will appear here</p>
        </div>
      `
    } else {
      body.innerHTML = `
        <div class="empty-state">
          <i class="ph ph-magnifying-glass empty-state-icon"></i>
          <div class="empty-state-text">No matching references</div>
          <p class="references-empty-subtext">Try a different search or filter</p>
        </div>
      `
    }
    return
  }

  body.innerHTML = `<div class="references-grid">${filtered.map(refCard).join('')}</div>`
}

function refCard(ref) {
  let domain = ''
  try {
    domain = new URL(ref.url).hostname.replace('www.', '')
  } catch (e) {
    domain = ref.url || ''
  }

  const title = ref.title || ref.url || 'Untitled'
  const tags = (ref.tags || []).slice(0, 3)
  const dateStr = formatRelativeDate(ref.createdAt)
  const sharedBy = ref.sharedBy || ''

  const imageHtml = ref.imageUrl
    ? `<div class="ref-card-image" style="background-image: url('${esc(ref.imageUrl)}')">
        <span class="ref-card-domain">${esc(domain)}</span>
      </div>`
    : `<div class="ref-card-placeholder">
        <span>${esc(domain ? domain[0].toUpperCase() : '?')}</span>
        <span class="ref-card-domain">${esc(domain)}</span>
      </div>`

  const tagsHtml = tags.length > 0
    ? `<div class="ref-card-tags">${tags.map((t) => `<span class="ref-tag">${esc(t)}</span>`).join('')}</div>`
    : ''

  return `
    <a class="ref-card" href="${esc(ref.url)}" target="_blank" rel="noopener" data-ref-id="${ref.id}">
      ${imageHtml}
      <div class="ref-card-body">
        <h3 class="ref-card-title">${esc(title)}</h3>
        ${tagsHtml}
        <div class="ref-card-meta">
          <span class="ref-card-author">${esc(sharedBy)}</span>
          <span class="ref-card-date">${dateStr}</span>
        </div>
      </div>
    </a>
  `
}

function renderMoodboardsList(body) {
  if (localMoodboards.length === 0) {
    body.innerHTML = `
      <div id="moodboard-new-form-wrap"></div>
      <div class="empty-state">
        <i class="ph ph-squares-four empty-state-icon"></i>
        <div class="empty-state-text">No mood boards yet</div>
        <p class="references-empty-subtext">Create a mood board to organize your references</p>
      </div>
    `
    renderNewMoodboardButton(body)
    return
  }

  body.innerHTML = `
    <div id="moodboard-new-form-wrap" style="margin-bottom: 16px;"></div>
    <div class="references-grid">
      ${localMoodboards.map((board) => moodboardCard(board)).join('')}
    </div>
  `

  renderNewMoodboardButton(body)

  // Click handlers for moodboard cards
  body.querySelectorAll('.moodboard-card').forEach((card) => {
    card.addEventListener('click', () => {
      activeMoodboardId = card.dataset.boardId
      renderToolbar()
      renderBody()
    })
  })
}

function renderNewMoodboardButton(body) {
  const wrap = body.querySelector('#moodboard-new-form-wrap') || document.getElementById('moodboard-new-form-wrap')
  if (!wrap) return

  wrap.innerHTML = `<button class="btn-primary" id="new-moodboard-btn"><i class="ph ph-plus"></i> New Mood Board</button>`

  wrap.querySelector('#new-moodboard-btn').addEventListener('click', () => {
    wrap.innerHTML = `
      <div class="inline-form" style="margin-bottom: 8px;">
        <input type="text" class="form-input" id="moodboard-name-input" placeholder="Mood board name">
        <input type="text" class="form-input" id="moodboard-desc-input" placeholder="Description (optional)" style="margin-top: 6px;">
        <div class="inline-form-actions" style="margin-top: 8px;">
          <button class="btn-primary" id="save-moodboard-btn">Create</button>
          <button class="btn-ghost" id="cancel-moodboard-btn">Cancel</button>
        </div>
      </div>
    `

    const nameInput = wrap.querySelector('#moodboard-name-input')
    nameInput.focus()

    wrap.querySelector('#cancel-moodboard-btn').addEventListener('click', () => {
      renderNewMoodboardButton(body)
    })

    wrap.querySelector('#save-moodboard-btn').addEventListener('click', async () => {
      const name = nameInput.value.trim()
      if (!name) { nameInput.focus(); return }
      const desc = wrap.querySelector('#moodboard-desc-input').value.trim()
      await createMoodboard(currentCtx.db, {
        name,
        description: desc,
        createdBy: currentCtx.currentUser?.email || '',
      })
      renderNewMoodboardButton(body)
    })

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') wrap.querySelector('#save-moodboard-btn').click()
      if (e.key === 'Escape') wrap.querySelector('#cancel-moodboard-btn').click()
    })
  })
}

function moodboardCard(board) {
  const refIds = board.referenceIds || []
  const boardRefs = refIds
    .map((id) => localReferences.find((r) => r.id === id))
    .filter(Boolean)
  const thumbs = boardRefs.slice(0, 4)
  const count = refIds.length

  const thumbsHtml = thumbs.length > 0
    ? `<div class="moodboard-thumbs">${thumbs.map((r) => {
        if (r.imageUrl) {
          return `<div class="moodboard-thumb" style="background-image: url('${esc(r.imageUrl)}')"></div>`
        }
        return `<div class="moodboard-thumb" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"></div>`
      }).join('')}</div>`
    : ''

  return `
    <div class="moodboard-card" data-board-id="${board.id}">
      ${thumbsHtml}
      <h3 class="moodboard-card-name">${esc(board.name)}</h3>
      ${board.description ? `<p class="moodboard-card-desc">${esc(board.description)}</p>` : ''}
      <span class="moodboard-card-count">${count} reference${count !== 1 ? 's' : ''}</span>
    </div>
  `
}

function renderMoodboardDetail(body) {
  const board = localMoodboards.find((b) => b.id === activeMoodboardId)
  if (!board) {
    activeMoodboardId = null
    renderMoodboardsList(body)
    return
  }

  const refIds = board.referenceIds || []
  const boardRefs = refIds
    .map((id) => localReferences.find((r) => r.id === id))
    .filter(Boolean)
  const filtered = getFilteredReferences(boardRefs)

  body.innerHTML = `
    <div style="margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
      <button class="btn-ghost" id="back-to-moodboards"><i class="ph ph-arrow-left"></i> Back to Mood Boards</button>
      <h3 style="margin: 0; font-size: 16px; font-weight: 600;">${esc(board.name)}</h3>
      <span style="font-size: 12px; color: var(--text-secondary);">${filtered.length} reference${filtered.length !== 1 ? 's' : ''}</span>
    </div>
    ${filtered.length > 0
      ? `<div class="references-grid">${filtered.map(refCard).join('')}</div>`
      : `<div class="empty-state">
          <i class="ph ph-image-square empty-state-icon"></i>
          <div class="empty-state-text">No references in this mood board</div>
          <p class="references-empty-subtext">Add references via the API or Slack</p>
        </div>`
    }
  `

  body.querySelector('#back-to-moodboards').addEventListener('click', () => {
    activeMoodboardId = null
    renderToolbar()
    renderBody()
  })
}

function formatRelativeDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 0) return 'just now'
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  const diffWeeks = Math.floor(diffDays / 7)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 5) return `${diffWeeks}w ago`

  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

export function cleanupReferences() {
  if (unsubReferences) { unsubReferences(); unsubReferences = null }
  if (unsubMoodboards) { unsubMoodboards(); unsubMoodboards = null }
  localReferences = []
  localMoodboards = []
  currentCtx = null
  currentSubTab = 'references'
  searchQuery = ''
  filterClientId = ''
  filterTag = ''
  activeMoodboardId = null
}
