import { calculate } from '../functions/leave-policy.mjs'
import { TEAM, isAdmin, getAttendanceTeam } from './config.js'
import { createLeave, updateLeave } from './db.js'
import { toLocalISODate } from './utils/dates.js'

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
  const targetEmail = personRow.style.display !== 'none' ? personSelect.value : currentCtx.currentUser.email
  const targetMember = TEAM.find(m => m.email === targetEmail)
  let split
  try { split = proposedSplit(targetEmail, startDate, endDate, halfDay) }
  catch (err) { alert(err.message); return }
  const { days, paidDays, unpaidDays } = split

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
      leaveData.updatedBy = currentCtx.currentUser.email
      await updateLeave(currentCtx.db, editingLeaveId, leaveData)
    } else {
      leaveData.createdBy = currentCtx.currentUser.email
      await createLeave(currentCtx.db, leaveData)
    }
    if (onSaveCallback) onSaveCallback()
    close()
  } catch (err) {
    console.error('Failed to save leave:', err)
    summaryEl.textContent = err.message || 'Failed to save leave'
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
  const defaultDate = toLocalISODate(tomorrow) // local day — leave dates are local YYYY-MM-DD

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

function proposedSplit(email, startDate, endDate, halfDay) {
  if (!getAttendanceTeam().some(m => m.email === email)) throw new Error('Leave policy does not apply to this person')
  if (endDate < startDate) throw new Error('End date must not precede start date')
  const id = '__preview__'
  const candidate = { id, userEmail:email, type:selectedType, startDate, endDate, halfDay, status:'approved' }
  const result = calculate({ userEmail:email, contracts:currentCtx.allContracts || [], holidays:currentCtx.allHolidays || [],
    leaves:[...(currentCtx.allLeaves || []).filter(l=>l.id !== editingLeaveId), candidate], asOf:endDate })
  const entries = result.entries.filter(e=>e.leaveId === id)
  if(entries.some(e=>e.error)) throw new Error('Add a contract covering these dates before recording leave')
  return entries.reduce((s,e)=>({days:s.days+e.days,paidDays:s.paidDays+e.paidDays,unpaidDays:s.unpaidDays+e.unpaidDays}),{days:0,paidDays:0,unpaidDays:0})
}
function updateSummary() {
  if (!startInput.value || !currentCtx) { summaryEl.textContent = ''; return }
  const email = personRow.style.display !== 'none' ? personSelect.value : currentCtx.currentUser.email
  try {
    const s=proposedSplit(email,startInput.value,endInput.value || startInput.value,halfDayCheckbox.checked)
    summaryEl.textContent = `${s.days} day(s): ${s.paidDays} paid, ${s.unpaidDays} unpaid. Final deduction is reviewed at monthly close.`
  } catch(err) { summaryEl.textContent = err.message }
}
