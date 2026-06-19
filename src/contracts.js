import { TEAM, isAdmin, getAttendanceTeam } from './config.js'
import {
  subscribeToContracts,
  subscribeToLeaves,
  createContract,
  updateContract,
  deleteContract,
} from './db.js'
import {
  accrualMonthsFromContracts,
  contractsForUser,
  earliestContractStart,
} from './utils/contracts.js'
import { toLocalISODate } from './utils/dates.js'

let unsubContracts = null
let unsubLeaves = null
let allContracts = []
let allLeaves = []
let currentCtx = null

export function renderContracts(container, ctx) {
  if (unsubContracts) unsubContracts()
  if (unsubLeaves) unsubLeaves()
  currentCtx = ctx

  const admin = isAdmin(ctx.currentUser.email)

  container.innerHTML = `
    <div class="contracts-view">
      <div class="contracts-header">
        <h2>Contracts</h2>
        ${admin ? `<button class="btn-primary" id="contracts-new-btn"><i class="ph ph-plus"></i> New Contract</button>` : ''}
      </div>
      <div id="contracts-list"></div>
    </div>
  `

  let ready = 0
  const checkReady = () => { if (++ready >= 2) renderList() }

  unsubContracts = subscribeToContracts(ctx.db, (contracts) => {
    allContracts = contracts
    if (ready >= 2) renderList()
    else checkReady()
  })
  unsubLeaves = subscribeToLeaves(ctx.db, (leaves) => {
    allLeaves = leaves
    if (ready >= 2) renderList()
    else checkReady()
  })

  if (admin) {
    document.getElementById('contracts-new-btn').addEventListener('click', () => openContractModal({ mode: 'create' }))
  }
}

export function cleanupContracts() {
  if (unsubContracts) { unsubContracts(); unsubContracts = null }
  if (unsubLeaves) { unsubLeaves(); unsubLeaves = null }
}

function renderList() {
  const userEmail = currentCtx.currentUser.email
  const admin = isAdmin(userEmail)
  const team = getAttendanceTeam()
  const visibleMembers = admin ? team : team.filter((m) => m.email === userEmail)
  const approvedLeaves = allLeaves.filter((l) => l.status === 'approved')

  const listEl = document.getElementById('contracts-list')
  if (!listEl) return

  if (visibleMembers.length === 0) {
    listEl.innerHTML = '<p class="contracts-empty">No team members.</p>'
    return
  }

  listEl.innerHTML = visibleMembers.map((member) => {
    const memberContracts = contractsForUser(allContracts, member.email)
      .slice()
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))

    const accrued = memberContracts.length > 0 ? accrualMonthsFromContracts(memberContracts) : 0
    const personalUsed = approvedLeaves
      .filter((l) => l.userEmail === member.email && l.type === 'personal')
      .reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
    const unpaid = Math.max(0, personalUsed - accrued)

    const memberObj = TEAM.find((m) => m.email === member.email)
    const avatarHtml = memberObj?.photoURL
      ? `<img class="avatar-photo-sm" src="${memberObj.photoURL}" alt="${esc(member.name)}">`
      : `<span class="avatar-sm" style="background:${memberObj?.color || '#6b7280'}">${esc(member.name[0])}</span>`

    const contractsHtml = memberContracts.length === 0
      ? `<p class="contracts-empty-row">No contracts yet${admin ? ' — click "New Contract" to add one.' : '.'}</p>`
      : memberContracts.map((c) => renderContractRow(c, admin)).join('')

    return `
      <div class="contracts-card" data-email="${esc(member.email)}">
        <div class="contracts-card-header">
          ${avatarHtml}
          <div class="contracts-card-info">
            <span class="contracts-card-name">${esc(member.name)}</span>
            <span class="contracts-card-meta">${accrued} mo accrued · ${personalUsed} used${unpaid > 0 ? ` · <span class="contracts-unpaid">${unpaid} unpaid</span>` : ''}</span>
          </div>
          ${admin ? `<button class="btn-ghost btn-sm" data-action="add-for" data-email="${esc(member.email)}"><i class="ph ph-plus"></i> Contract</button>` : ''}
        </div>
        <div class="contracts-card-rows">
          ${contractsHtml}
        </div>
      </div>
    `
  }).join('')

  listEl.querySelectorAll('[data-action="add-for"]').forEach((btn) => {
    btn.addEventListener('click', () => openContractModal({ mode: 'create', forEmail: btn.dataset.email }))
  })
  listEl.querySelectorAll('[data-action="edit-contract"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = allContracts.find((x) => x.id === btn.dataset.id)
      if (c) openContractModal({ mode: 'edit', contract: c })
    })
  })
  listEl.querySelectorAll('[data-action="delete-contract"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this contract?')) return
      btn.disabled = true
      await deleteContract(currentCtx.db, btn.dataset.id)
    })
  })
}

function renderContractRow(c, admin) {
  const start = c.startDate || '?'
  const end = c.endDate || 'ongoing'
  const isOngoing = !c.endDate
  const today = toLocalISODate(new Date()) // local day — endDate keys are local
  const ended = c.endDate && c.endDate < today
  const statusBadge = isOngoing
    ? `<span class="contract-status contract-status-active">Active</span>`
    : (ended
        ? `<span class="contract-status contract-status-ended">Ended</span>`
        : `<span class="contract-status contract-status-active">Active</span>`)

  return `
    <div class="contract-row">
      <div class="contract-row-dates">
        <strong>${esc(start)}</strong>
        <span class="contract-row-arrow">→</span>
        <strong>${esc(end)}</strong>
        ${statusBadge}
      </div>
      ${c.notes ? `<div class="contract-row-notes">${esc(c.notes)}</div>` : ''}
      ${admin ? `
        <div class="contract-row-actions">
          <button class="btn-ghost btn-xs" data-action="edit-contract" data-id="${esc(c.id)}"><i class="ph ph-pencil-simple"></i></button>
          <button class="btn-ghost btn-xs" data-action="delete-contract" data-id="${esc(c.id)}"><i class="ph ph-trash"></i></button>
        </div>
      ` : ''}
    </div>
  `
}

// === Modal ===

function openContractModal({ mode, contract = null, forEmail = null }) {
  const team = getAttendanceTeam()
  const isEdit = mode === 'edit'
  const defaultEmail = isEdit ? contract.userEmail : (forEmail || team[0]?.email || '')

  // Build modal markup dynamically and append
  closeContractModal()
  const overlay = document.createElement('div')
  overlay.id = 'contract-modal'
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${isEdit ? 'Edit Contract' : 'New Contract'}</h2>
        <button class="modal-close" id="contract-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label class="form-label">Person</label>
          <select id="contract-person" class="form-select">
            ${team.map((m) => `<option value="${esc(m.email)}" ${m.email === defaultEmail ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">Start date</label>
          <input type="date" id="contract-start" class="form-input" value="${esc(contract?.startDate || '')}">
        </div>
        <div class="form-row">
          <label class="form-label">End date <span class="form-label-hint">(leave empty for ongoing)</span></label>
          <input type="date" id="contract-end" class="form-input" value="${esc(contract?.endDate || '')}">
        </div>
        <div class="form-row">
          <label class="form-label">Notes <span class="form-label-hint">(e.g. "Renewal — extended 5 days for unpaid balance")</span></label>
          <textarea id="contract-notes" class="form-textarea" rows="2" placeholder="Optional context...">${esc(contract?.notes || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button id="contract-cancel-btn" class="btn-ghost">Cancel</button>
        <button id="contract-save-btn" class="btn-primary">${isEdit ? 'Save' : 'Add Contract'}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  document.getElementById('contract-modal-close').addEventListener('click', closeContractModal)
  document.getElementById('contract-cancel-btn').addEventListener('click', closeContractModal)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeContractModal() })

  document.getElementById('contract-save-btn').addEventListener('click', async () => {
    const userEmail = document.getElementById('contract-person').value
    const startDate = document.getElementById('contract-start').value
    const endDate = document.getElementById('contract-end').value || null
    const notes = document.getElementById('contract-notes').value.trim()

    if (!userEmail || !startDate) {
      alert('Person and start date are required.')
      return
    }
    if (endDate && endDate < startDate) {
      alert('End date must be on or after start date.')
      return
    }

    const saveBtn = document.getElementById('contract-save-btn')
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving...'
    try {
      if (isEdit) {
        await updateContract(currentCtx.db, contract.id, { userEmail, startDate, endDate, notes })
      } else {
        await createContract(currentCtx.db, { userEmail, startDate, endDate, notes, createdBy: currentCtx.currentUser.email })
      }
      closeContractModal()
    } catch (err) {
      console.error(err)
      alert('Failed to save: ' + (err?.message || 'unknown error'))
      saveBtn.disabled = false
      saveBtn.textContent = isEdit ? 'Save' : 'Add Contract'
    }
  })
}

function closeContractModal() {
  const existing = document.getElementById('contract-modal')
  if (existing) existing.remove()
}

function countWeekdays(startDate, endDate) {
  let count = 0
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const current = new Date(start)
  while (current <= end) {
    const day = current.getDay()
    if (day !== 0 && day !== 6) count++
    current.setDate(current.getDate() + 1)
  }
  return count
}

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
