import { subscribeToCaptures, undoCapture } from './db.js'

let unsubscribe = null
let captures = []
let tab = 'captured'

const STATUS_LABELS = {
  dry: 'Dry run',
  filing: 'Check: filing stopped',
  filed: 'Filed',
  failed: 'Failed',
  undone: 'Undone',
  skipped: 'Skipped',
}

function esc(value) {
  const el = document.createElement('div')
  el.textContent = value ?? ''
  return el.innerHTML
}

function safeUrl(url) {
  return /^https:\/\//.test(url || '') ? url : ''
}

export function canUndo(capture) {
  return capture.status === 'filed' && !!capture.taskId && capture.kind !== 'followup'
}

export function splitCaptures(items) {
  return {
    captured: items.filter((c) => c.status !== 'skipped'),
    skipped: items.filter((c) => c.status === 'skipped'),
  }
}

function renderRow(c) {
  const url = safeUrl(c.url)
  return `
    <article class="capture-row">
      <div class="capture-meta">
        <span>${esc(c.clientName || 'Unknown client')}</span>
        <span>${esc(STATUS_LABELS[c.status] || c.status)}</span>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Slack</a>` : ''}
      </div>
      ${c.title ? `<h3 class="capture-title">${esc(c.title)}</h3>` : ''}
      <p class="capture-text">${esc(c.text)}</p>
      ${c.reasoning ? `<p class="capture-reason">${esc(c.reasoning)}</p>` : ''}
      ${canUndo(c) ? `<button class="btn-ghost capture-undo" data-id="${esc(c.id)}">Undo</button>` : ''}
    </article>`
}

function render(container, ctx) {
  const groups = splitCaptures(captures)
  const items = groups[tab]
  container.innerHTML = `
    <div class="capture-view">
      <h2>Asterisk</h2>
      <div class="capture-tabs">
        <button class="${tab === 'captured' ? 'btn-primary' : 'btn-ghost'}" data-tab="captured">Captured (${groups.captured.length})</button>
        <button class="${tab === 'skipped' ? 'btn-primary' : 'btn-ghost'}" data-tab="skipped">Skipped (${groups.skipped.length})</button>
      </div>
      ${items.length ? items.map(renderRow).join('') : `<p class="capture-empty">No ${tab} messages yet.</p>`}
    </div>`

  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab
      render(container, ctx)
    })
  })
  container.querySelectorAll('.capture-undo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const capture = captures.find((c) => c.id === btn.dataset.id)
      if (!capture || !confirm(`Delete the task "${capture.title}"?`)) return
      btn.disabled = true
      try {
        await undoCapture(ctx.db, capture, ctx.currentUser?.email || '')
      } catch (err) {
        console.error('Undo failed:', err)
        btn.disabled = false
        alert('Could not undo this capture.')
      }
    })
  })
}

export function renderAsterisk(container, ctx) {
  cleanupAsterisk()
  render(container, ctx)
  unsubscribe = subscribeToCaptures(ctx.db, (items) => {
    captures = items
    render(container, ctx)
  })
}

export function cleanupAsterisk() {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
}
