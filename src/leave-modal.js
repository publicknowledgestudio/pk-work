import { TEAM, isAdmin, getAttendanceTeam } from './config.js'
import { createLeave, updateLeave } from './db.js'

const overlay = document.getElementById('leave-modal')
const closeBtn = document.getElementById('leave-modal-close')
const cancelBtn = document.getElementById('leave-cancel-btn')
const saveBtn = document.getElementById('leave-save-btn')
const titleEl = document.getElementById('leave-modal-title')
const typePills = document.getElementById('leave-type-pills')
const startInput = document.getElementById('leave-start')
const endInput = document.getElementById('leave-end')
const halfDayCheckbox = document.getElementById('leave-half-day')
const noteInput = document.getElementById('leave-note')
const summaryEl = document.getElementById('leave-summary')
const personRow = document.getElementById('leave-person-row')
const personSelect = document.getElementById('leave-person')

let currentCtx = null
let selectedType = 'personal'
let onSaveCallback = null
let editingLeaveId = null // null = creating, string = editing

// Close handlers
closeBtn.addEventListener('click', close)
cancelBtn.addEventListener('click', close)
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) close()
})

// Type pills
typePills.addEventListener('click', (e) => {
  const pill = e.target.closest('.status-pill')
  if (!pill) return
  selectedType = pill.dataset.type
  typePills.querySelectorAll('.status-pill').forEach((p) => p.classList.remove('active'))
  pill.classList.add('active')
  updateSummary()
})

// Date change → update summary
startInput.addEventListener('change', () => {
  if (!endInput.value || endInput.value < startInput.value) {
    endInput.value = startInput.value
  }
  updateSummary()
})
endInput.addEventListener('change', updateSummary)
halfDayCheckbox.addEventListener('change', () => {
  if (halfDayCheckbox.checked) {
    endInput.value = startInput.value
    endInput.disabled = true
  } else {
    endInput.disabled = false
  }
  updateSummary()
})

// Save
saveBtn.addEventListener('click', async () => {
  const startDate = startInput.value
  if (!startDate) {
    startInput.focus()
    return
  }

  const endDate = endInput.value || startDate
  const halfDay = halfDayCheckbox.checked
  const days = halfDay ? 0.5 : countWeekdays(startDate, endDate)

  const targetEmail = personRow.style.display !== 'none'
    ? personSelect.value
    : currentCtx.currentUser.email
  const targetMember = TEAM.find((m) => m.email === targetEmail)

  let paidDays = days
  let unpaidDays = 0

  if (selectedType === 'personal' && targetMember?.joinDate) {
    const accrued = monthsSinceJoin(targetMember.joinDate)
    // When editing, exclude the current leave from "used" calculation
    const excludeId = editingLeaveId
    const used = getUsedDays(targetEmail, 'personal', currentCtx.allLeaves || [], excludeId)
    const available = Math.max(0, accrued - used)
    paidDays = Math.min(days, available)
    unpaidDays = days - paidDays
  }

  saveBtn.disabled = true
  saveBtn.textContent = 'Saving...'

  try {
    const leaveData = {
      userEmail: targetEmail,
      userName: targetMember?.name || '',
      type: selectedType,
      startDate,
      endDate,
      halfDay,
      days,
      paidDays,
      unpaidDays,
      note: noteInput.value.trim(),
    }

    if (editingLeaveId) {
      await updateLeave(currentCtx.db, editingLeaveId, leaveData)
    } else {
      leaveData.createdBy = currentCtx.currentUser.email
      await createLeave(currentCtx.db, leaveData)
    }
    if (onSaveCallback) onSaveCallback()
    close()
  } catch (err) {
    console.error('Failed to save leave:', err)
    saveBtn.disabled = false
    saveBtn.textContent = editingLeaveId ? 'Save Changes' : 'Request Leave'
  }
})

export function openLeaveModal(ctx, options = {}) {
  currentCtx = ctx
  onSaveCallback = options.onSave || null
  editingLeaveId = options.editLeave?.id || null

  const isEdit = !!editingLeaveId
  const leave = options.editLeave

  titleEl.textContent = isEdit ? 'Edit Leave' : 'Request Leave'
  saveBtn.textContent = isEdit ? 'Save Changes' : 'Request Leave'

  selectedType = leave?.type || options.defaultType || 'personal'
  typePills.querySelectorAll('.status-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.type === selectedType)
  })

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = tomorrow.toISOString().split('T')[0]

  startInput.value = leave?.startDate || options.date || defaultDate
  endInput.value = leave?.endDate || leave?.startDate || options.date || defaultDate
  halfDayCheckbox.checked = leave?.halfDay || !!options.defaultHalfDay
  endInput.disabled = halfDayCheckbox.checked
  noteInput.value = leave?.note || ''
  summaryEl.classList.add('hidden')

  if (isAdmin(ctx.currentUser.email)) {
    personRow.style.display = ''
    const team = getAttendanceTeam()
    const targetEmail = leave?.userEmail || options.forEmail || ctx.currentUser.email
    personSelect.innerHTML = team
      .map((m) => `<option value="${m.email}"${m.email === targetEmail ? ' selected' : ''}>${m.name}</option>`)
      .join('')
  } else {
    personRow.style.display = 'none'
  }

  overlay.classList.remove('hidden')
  startInput.focus()
  updateSummary()
}

function close() {
  overlay.classList.add('hidden')
  currentCtx = null
  onSaveCallback = null
  editingLeaveId = null
  saveBtn.disabled = false
  saveBtn.textContent = 'Request Leave'
}

function updateSummary() {
  const startDate = startInput.value
  const endDate = endInput.value || startDate
  if (!startDate) {
    summaryEl.classList.add('hidden')
    return
  }

  const halfDay = halfDayCheckbox.checked
  const days = halfDay ? 0.5 : countWeekdays(startDate, endDate)

  if (days === 0) {
    summaryEl.innerHTML = '<span class="leave-summary-warn">No weekdays in selected range</span>'
    summaryEl.classList.remove('hidden')
    return
  }

  const targetEmail = personRow.style.display !== 'none'
    ? personSelect.value
    : currentCtx?.currentUser?.email
  const targetMember = TEAM.find((m) => m.email === targetEmail)

  let html = `<strong>${days} day${days !== 1 ? 's' : ''}</strong> of ${selectedType} leave`

  if (selectedType === 'personal' && targetMember?.joinDate) {
    const accrued = monthsSinceJoin(targetMember.joinDate)
    const used = getUsedDays(targetEmail, 'personal', currentCtx?.allLeaves || [], editingLeaveId)
    const available = Math.max(0, accrued - used)
    const paidDays = Math.min(days, available)
    const unpaidDays = days - paidDays

    if (unpaidDays > 0) {
      html += `<br><span class="leave-summary-warn">\u26a0 ${paidDays} paid, ${unpaidDays} unpaid (balance exceeded)</span>`
    }
  }

  summaryEl.innerHTML = html
  summaryEl.classList.remove('hidden')
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

function monthsSinceJoin(joinDate) {
  const join = new Date(joinDate + 'T00:00:00')
  const now = new Date()
  let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth()) + 1
  return Math.max(0, months)
}

function getUsedDays(email, type, allLeaves, excludeId) {
  return allLeaves
    .filter((l) => l.userEmail === email && l.type === type && l.status === 'approved' && l.id !== excludeId)
    .reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
}
