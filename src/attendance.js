import { TEAM, ATTENDANCE_STATUSES, isAdmin, getAttendanceTeam } from './config.js'
import { subscribeToLeaves, createLeave, cancelLeave, subscribeToHolidays, createHoliday, deleteHoliday, subscribeToContracts } from './db.js'
import { openLeaveModal } from './leave-modal.js'
import { accrualMonthsFromContracts, contractsForUser, earliestContractStart } from './utils/contracts.js'

let unsubLeaves = null
let unsubHolidays = null
let unsubContracts = null
let allLeaves = []
let allHolidays = []
let allContracts = []
let currentMonth = '' // 'YYYY-MM'
let activePopover = null // track open cell popover
let currentCtx = null // store ctx for popover use

export function renderAttendance(container, ctx) {
  if (!currentMonth) {
    const now = new Date()
    currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  // Subscribe to leaves + holidays + contracts (real-time)
  if (unsubLeaves) unsubLeaves()
  if (unsubHolidays) unsubHolidays()
  if (unsubContracts) unsubContracts()

  let ready = 0
  const checkReady = () => { if (++ready >= 3) renderContent(container, ctx) }

  unsubLeaves = subscribeToLeaves(ctx.db, (leaves) => {
    allLeaves = leaves
    if (ready >= 3) renderContent(container, ctx)
    else checkReady()
  })
  unsubHolidays = subscribeToHolidays(ctx.db, (holidays) => {
    allHolidays = holidays
    if (ready >= 3) renderContent(container, ctx)
    else checkReady()
  })
  unsubContracts = subscribeToContracts(ctx.db, (contracts) => {
    allContracts = contracts
    if (ready >= 3) renderContent(container, ctx)
    else checkReady()
  })
}

export function cleanupAttendance() {
  if (unsubLeaves) { unsubLeaves(); unsubLeaves = null }
  if (unsubHolidays) { unsubHolidays(); unsubHolidays = null }
  if (unsubContracts) { unsubContracts(); unsubContracts = null }
}

function renderContent(container, ctx) {
  currentCtx = ctx
  const userEmail = ctx.currentUser.email
  const admin = isAdmin(userEmail)
  const team = getAttendanceTeam()
  const approvedLeaves = allLeaves.filter((l) => l.status === 'approved')

  container.innerHTML = `
    <div class="attendance-view">
      <div class="attendance-header">
        <h2>Leaves</h2>
      </div>

      <div class="attendance-balances">
        ${renderBalanceCards(team, approvedLeaves, userEmail, admin)}
      </div>

      <div class="attendance-calendar-section">
        <div class="attendance-calendar-header">
          <button class="btn-ghost" id="att-prev-month"><i class="ph ph-caret-left"></i></button>
          <span class="attendance-month-label" id="att-month-label"></span>
          <button class="btn-ghost" id="att-next-month"><i class="ph ph-caret-right"></i></button>
        </div>
        <div class="attendance-grid" id="att-grid"></div>
      </div>

      <div class="attendance-holidays-section">
        <div class="attendance-holidays-header">
          <h3>Studio Holidays</h3>
          ${admin ? `<button class="btn-ghost btn-sm" id="att-add-holiday"><i class="ph ph-plus"></i> Add Holiday</button>` : ''}
        </div>
        <div id="att-holiday-list"></div>
        ${admin ? `<div id="att-holiday-form" class="att-holiday-form hidden">
          <input type="date" id="att-holiday-date" class="form-input">
          <input type="text" id="att-holiday-name" class="form-input" placeholder="Holiday name...">
          <button class="btn-primary btn-sm" id="att-holiday-save">Add</button>
          <button class="btn-ghost btn-sm" id="att-holiday-cancel">Cancel</button>
        </div>` : ''}
      </div>

      <div class="attendance-leave-list">
        <h3>Leave History</h3>
        <div id="att-leave-list"></div>
      </div>

      <div class="attendance-policy">
        <h3>Leave Policy</h3>
        <p class="policy-intro">As a contractor, you can take time off under these guidelines:</p>
        <div class="policy-items">
          <div class="policy-item">
            <div class="policy-item-number">1</div>
            <div class="policy-item-content">
              <strong>Planned Time Off</strong>
              <p>You can take up to 1 day off per month worked, with advance notice and alignment with project timelines.</p>
            </div>
          </div>
          <div class="policy-item">
            <div class="policy-item-number">2</div>
            <div class="policy-item-content">
              <strong>Sick Leave</strong>
              <p>You can take up to 3 days total for health reasons during your contract. Just inform the team promptly (documentation may be requested if needed).</p>
            </div>
          </div>
          <div class="policy-item">
            <div class="policy-item-number">3</div>
            <div class="policy-item-content">
              <strong>Additional Leave</strong>
              <p>Any extra time off needs approval and may be unpaid or lead to adjustments in timelines or fees.</p>
            </div>
          </div>
        </div>
        <p class="policy-note">Personal leave days roll over if unused. Medical leave days do not roll over. These days off are part of your contract terms only, can't be cashed out, and aren't the same as employee leave or statutory benefits.</p>
      </div>
    </div>
  `

  // Bind month navigation
  document.getElementById('att-prev-month').addEventListener('click', () => {
    const [y, m] = currentMonth.split('-').map(Number)
    // Don't go before March 2026 (system start date)
    if (y === 2026 && m <= 3) return
    const d = new Date(y, m - 2, 1)
    currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    renderMonthGrid(team, approvedLeaves)
    renderLeaveList(approvedLeaves, userEmail, admin, ctx)
  })
  document.getElementById('att-next-month').addEventListener('click', () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    renderMonthGrid(team, approvedLeaves)
    renderLeaveList(approvedLeaves, userEmail, admin, ctx)
  })

  // Bind request leave buttons
  container.querySelectorAll('[data-action="request-leave"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openLeaveModal({ ...ctx, allLeaves: approvedLeaves, allContracts }, {
        onSave: () => {},
        forEmail: btn.dataset.email || userEmail,
      })
    })
  })

  // Bind holiday form (admin only)
  const addHolidayBtn = document.getElementById('att-add-holiday')
  const holidayForm = document.getElementById('att-holiday-form')
  if (addHolidayBtn && holidayForm) {
    addHolidayBtn.addEventListener('click', () => {
      holidayForm.classList.toggle('hidden')
      if (!holidayForm.classList.contains('hidden')) {
        document.getElementById('att-holiday-date').focus()
      }
    })
    document.getElementById('att-holiday-cancel').addEventListener('click', () => {
      holidayForm.classList.add('hidden')
    })
    document.getElementById('att-holiday-save').addEventListener('click', async () => {
      const date = document.getElementById('att-holiday-date').value
      const name = document.getElementById('att-holiday-name').value.trim()
      if (!date || !name) return
      await createHoliday(ctx.db, { date, name, createdBy: userEmail })
      holidayForm.classList.add('hidden')
      document.getElementById('att-holiday-date').value = ''
      document.getElementById('att-holiday-name').value = ''
    })
  }

  renderMonthGrid(team, approvedLeaves)
  renderHolidayList(admin, ctx)
  renderLeaveList(approvedLeaves, userEmail, admin, ctx)
}

function renderBalanceCards(team, leaves, userEmail, admin) {
  const visibleMembers = admin ? team : team.filter((m) => m.email === userEmail)

  return visibleMembers.map((member) => {
    const personal = getBalance(member, 'personal', leaves)
    const medical = getBalance(member, 'medical', leaves)
    const memberObj = TEAM.find((m) => m.email === member.email)
    const avatarHtml = memberObj?.photoURL
      ? `<img class="avatar-photo-sm" src="${memberObj.photoURL}" alt="${member.name}">`
      : `<span class="avatar-sm" style="background:${memberObj?.color || '#6b7280'}">${member.name[0]}</span>`

    const memberContracts = contractsForUser(allContracts, member.email)
    const startDate = earliestContractStart(memberContracts)
    const joinLabel = startDate ? formatDate(startDate) : ''

    return `
      <div class="balance-card">
        <div class="balance-card-header">
          ${avatarHtml}
          <div class="balance-card-info">
            <span class="balance-card-name">${esc(member.name)}</span>
            <span class="balance-card-joined">Joined ${joinLabel}</span>
          </div>
          <button class="btn-ghost btn-sm" data-action="request-leave" data-email="${member.email}">
            <i class="ph ph-plus"></i> Request Leave
          </button>
        </div>
        <div class="balance-card-rows">
          <div class="balance-row">
            <span class="balance-label">Personal</span>
            ${renderBalanceNumbers(personal)}
          </div>
          <div class="balance-row">
            <span class="balance-label">Medical</span>
            ${renderBalanceNumbers(medical, true)}
          </div>
        </div>
      </div>
    `
  }).join('')
}

function renderBalanceNumbers(balance, isMonthly = false) {
  const overLimit = balance.unpaid > 0
  const periodSuffix = isMonthly ? ' this month' : ''
  const accruedSuffix = isMonthly ? ' this month' : ' so far'
  const usedLabel = isMonthly ? `used${periodSuffix}` : 'used or scheduled'

  const colorClass = overLimit ? 'balance-num-over' : 'balance-num-ok'
  const lines = [
    `<div class="balance-detail-line balance-detail-accrued"><strong>${balance.accrued}</strong> accrued${accruedSuffix}</div>`,
    `<div class="balance-detail-line"><strong>${balance.used}</strong> ${usedLabel}</div>`,
  ]
  if (balance.overtimeCredit > 0) {
    lines.push(`<div class="balance-detail-line balance-detail-accrued"><strong>+${balance.overtimeCredit}</strong> overtime credit</div>`)
  }

  const unpaidLine = balance.unpaid > 0
    ? `<div class="balance-unpaid"><strong>${balance.unpaid}</strong> unpaid</div>`
    : ''

  return `
    <div class="balance-nums ${colorClass}">
      ${lines.join('')}
      <div class="balance-result">
        <div class="balance-headline"><strong>${balance.available}</strong> left${periodSuffix}</div>
        ${unpaidLine}
      </div>
    </div>
  `
}

function renderMonthGrid(team, leaves) {
  const [year, month] = currentMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const label = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  document.getElementById('att-month-label').textContent = label

  let headerHtml = '<div class="att-grid-cell att-grid-name-header"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'narrow' })
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const holiday = allHolidays.find((h) => h.date === dateStr)
    const isOff = isWeekend || holiday
    headerHtml += `<div class="att-grid-cell att-grid-day-header${isWeekend ? ' att-weekend' : ''}${holiday ? ' att-holiday' : ''}" ${holiday ? `title="${esc(holiday.name)}"` : ''}>
      <span class="att-day-name">${dayLabel}</span>
      <span class="att-day-num">${d}</span>
      ${holiday ? `<span class="att-holiday-marker"></span>` : ''}
    </div>`
  }

  let rowsHtml = ''
  team.forEach((member) => {
    const memberObj = TEAM.find((m) => m.email === member.email)
    const avatarHtml = memberObj?.photoURL
      ? `<img class="avatar-photo-xs" src="${memberObj.photoURL}" alt="${member.name}">`
      : `<span class="avatar-xs" style="background:${memberObj?.color || '#6b7280'}">${member.name[0]}</span>`

    const memberStart = earliestContractStart(contractsForUser(allContracts, member.email))

    rowsHtml += `<div class="att-grid-cell att-grid-name">${avatarHtml} ${esc(member.name)}</div>`

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const date = new Date(year, month - 1, d)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      const holiday = allHolidays.find((h) => h.date === dateStr)

      // Overtime can be logged on any non-working day — weekends or holidays.
      const isOffDay = isWeekend || holiday
      const overtimeLeave = isOffDay ? leaves.find((l) =>
        l.userEmail === member.email &&
        l.type === 'overtime' &&
        l.startDate === dateStr
      ) : null

      if (holiday) {
        const otSuffix = overtimeLeave
          ? ` \u2022 Overtime (${overtimeLeave.halfDay ? 'half' : 'full'} day)`
          : ''
        const tooltip = `Holiday: ${holiday.name}${otSuffix}`
        const dotHtml = overtimeLeave
          ? `<span class="att-dot ${overtimeLeave.halfDay ? 'att-dot-yellow' : 'att-dot-green'}"></span>`
          : ''
        const leaveAttr = overtimeLeave ? ` data-leave-id="${overtimeLeave.id}"` : ''
        rowsHtml += `<div class="att-grid-cell att-holiday-cell att-clickable${overtimeLeave ? ' att-has-leave' : ''}" data-email="${member.email}" data-date="${dateStr}"${leaveAttr} title="${esc(tooltip)}">
          ${dotHtml}
        </div>`
        continue
      }

      if (isWeekend && !overtimeLeave) {
        rowsHtml += `<div class="att-grid-cell att-weekend att-clickable" data-email="${member.email}" data-date="${dateStr}"></div>`
        continue
      }
      if (isWeekend && overtimeLeave) {
        const dotClass = overtimeLeave.halfDay ? 'att-dot-yellow' : 'att-dot-green'
        const tooltip = overtimeLeave.halfDay ? 'Overtime (half day)' : 'Overtime (full day)'
        rowsHtml += `<div class="att-grid-cell att-weekend att-clickable att-has-leave" data-email="${member.email}" data-date="${dateStr}" data-leave-id="${overtimeLeave.id}" title="${tooltip}">
          <span class="att-dot ${dotClass}"></span>
        </div>`
        continue
      }

      const leave = leaves.find((l) =>
        l.userEmail === member.email &&
        l.startDate <= dateStr &&
        (l.endDate || l.startDate) >= dateStr
      )

      let dotClass = 'att-dot-green'
      let tooltip = 'Working'

      if (leave) {
        if (leave.halfDay) {
          dotClass = 'att-dot-yellow'
          tooltip = `Half day (${leave.type})`
        } else {
          dotClass = 'att-dot-red'
          tooltip = leave.type === 'medical' ? 'Medical leave' : (leave.unpaidDays > 0 ? 'Unpaid leave' : 'Personal leave')
        }
      }

      const today = new Date().toISOString().split('T')[0]
      const beforeJoin = memberStart && dateStr < memberStart
      const showDot = !beforeJoin && (dateStr <= today || leave)

      rowsHtml += `<div class="att-grid-cell att-clickable${leave ? ' att-has-leave' : ''}" title="${tooltip}" data-email="${member.email}" data-date="${dateStr}"${leave ? ` data-leave-id="${leave.id}"` : ''}>
        ${showDot ? `<span class="att-dot ${dotClass}"></span>` : ''}
      </div>`
    }
  })

  const grid = document.getElementById('att-grid')
  grid.style.gridTemplateColumns = `140px repeat(${daysInMonth}, 1fr)`
  grid.innerHTML = headerHtml + rowsHtml

  // Bind cell clicks for status popover
  grid.querySelectorAll('.att-clickable').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation()
      const email = cell.dataset.email
      const date = cell.dataset.date
      const leaveId = cell.dataset.leaveId || null
      const leave = leaveId ? leaves.find((l) => l.id === leaveId) : null
      showCellPopover(cell, email, date, leave)
    })
  })
}

function renderHolidayList(admin, ctx) {
  const [year, month] = currentMonth.split('-').map(Number)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  const monthHolidays = allHolidays.filter((h) => h.date >= monthStart && h.date <= monthEnd)
  const listEl = document.getElementById('att-holiday-list')

  if (monthHolidays.length === 0) {
    listEl.innerHTML = '<p class="attendance-empty">No studio holidays this month</p>'
    return
  }

  listEl.innerHTML = monthHolidays.map((h) => `
    <div class="leave-list-item">
      <div class="leave-list-left">
        <span class="leave-list-dot" style="background:#8b5cf6"></span>
        <strong>${esc(h.name)}</strong>
      </div>
      <div class="leave-list-right">
        <span class="leave-list-date">${formatDate(h.date)}</span>
        ${admin ? `<button class="btn-ghost btn-sm leave-cancel-btn" data-holiday-id="${h.id}"><i class="ph ph-x"></i></button>` : ''}
      </div>
    </div>
  `).join('')

  listEl.querySelectorAll('[data-holiday-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this holiday?')) return
      btn.disabled = true
      await deleteHoliday(ctx.db, btn.dataset.holidayId)
    })
  })
}

function renderLeaveList(leaves, userEmail, admin, ctx) {
  const [year, month] = currentMonth.split('-').map(Number)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  const monthLeaves = leaves.filter((l) => {
    const end = l.endDate || l.startDate
    return l.startDate <= monthEnd && end >= monthStart
  })

  const visibleLeaves = admin ? monthLeaves : monthLeaves.filter((l) => l.userEmail === userEmail)

  const listEl = document.getElementById('att-leave-list')

  if (visibleLeaves.length === 0) {
    listEl.innerHTML = '<p class="attendance-empty">No leaves this month</p>'
    return
  }

  listEl.innerHTML = visibleLeaves.map((l) => {
    const memberObj = TEAM.find((m) => m.email === l.userEmail)
    const dateRange = l.startDate === (l.endDate || l.startDate)
      ? formatDate(l.startDate)
      : `${formatDate(l.startDate)} \u2013 ${formatDate(l.endDate)}`
    const typeLabel = l.type === 'medical' ? 'Medical' : 'Personal'
    const daysLabel = l.halfDay ? '\u00bd day' : `${l.days || countWeekdays(l.startDate, l.endDate || l.startDate)} day${(l.days || 0) !== 1 ? 's' : ''}`
    const cancelBtn = admin ? `<button class="btn-ghost btn-sm leave-cancel-btn" data-leave-id="${l.id}"><i class="ph ph-x"></i></button>` : ''

    return `
      <div class="leave-list-item">
        <div class="leave-list-left">
          <span class="leave-list-dot" style="background:${l.type === 'medical' ? '#ef4444' : '#6366f1'}"></span>
          <strong>${esc(memberObj?.name || l.userName)}</strong>
          <span class="leave-list-type">${typeLabel} \u00b7 ${daysLabel}</span>
        </div>
        <div class="leave-list-right">
          <span class="leave-list-date">${dateRange}</span>
          ${cancelBtn}
        </div>
      </div>
    `
  }).join('')

  listEl.querySelectorAll('.leave-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this leave?')) return
      btn.disabled = true
      await cancelLeave(ctx.db, btn.dataset.leaveId, userEmail)
    })
  })
}

function getBalance(member, type, leaves) {
  const typeLeaves = leaves.filter((l) => l.userEmail === member.email && l.type === type)

  if (type === 'medical') {
    // Medical: 1 per month, does NOT roll over. Only current month matters.
    const now = new Date()
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const usedThisMonth = typeLeaves
      .filter((l) => l.startDate.startsWith(currentMonthStr))
      .reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
    const totalUsed = typeLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)

    return {
      accrued: 1,
      used: usedThisMonth,
      totalUsed,
      overtimeCredit: 0,
      unpaid: Math.max(0, usedThisMonth - 1),
      available: Math.max(0, 1 - usedThisMonth),
    }
  }

  // Personal: 1 per month, rolls over. Sum across all of this person's
  // contracts; months in gaps between contracts don't accrue. People with
  // no contracts on file accrue 0 — admin must add a contract on the
  // Contracts page.
  const memberContracts = contractsForUser(allContracts, member.email)
  const accrued = accrualMonthsFromContracts(memberContracts)
  const used = typeLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)

  // Overtime credits against personal leave balance
  let overtimeCredit = 0
  const overtimeLeaves = leaves.filter((l) => l.userEmail === member.email && l.type === 'overtime')
  overtimeCredit = overtimeLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : 1), 0)

  return {
    accrued,
    used,
    totalUsed: used,
    overtimeCredit,
    unpaid: Math.max(0, used - accrued - overtimeCredit),
    available: Math.max(0, accrued - used + overtimeCredit),
  }
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

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

// === Cell Click Popover ===

function closeCellPopover() {
  if (activePopover) {
    activePopover.remove()
    activePopover = null
  }
}

// Dismiss popover on outside click
document.addEventListener('click', () => closeCellPopover())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCellPopover()
})

function showCellPopover(cell, email, date, existingLeave) {
  closeCellPopover()

  const admin = isAdmin(currentCtx?.currentUser?.email)
  const isSelf = currentCtx?.currentUser?.email === email
  const canEdit = admin || isSelf
  const memberName = TEAM.find((m) => m.email === email)?.name || email
  const approvedLeaves = allLeaves.filter((l) => l.status === 'approved')

  const popover = document.createElement('div')
  popover.className = 'att-popover'
  popover.addEventListener('click', (e) => e.stopPropagation())

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  if (existingLeave) {
    // Show leave details with cancel option
    const typeLabel = existingLeave.type === 'overtime' ? 'Overtime' : (existingLeave.type === 'medical' ? 'Medical Leave' : 'Personal Leave')
    const halfLabel = existingLeave.halfDay ? ' (Half Day)' : (existingLeave.type === 'overtime' ? ' (Full Day)' : '')
    const canEdit = admin || isSelf
    popover.innerHTML = `
      <div class="att-popover-header">${esc(memberName)} · ${dateLabel}</div>
      <div class="att-popover-status">
        <span class="att-dot ${existingLeave.type === 'overtime' ? (existingLeave.halfDay ? 'att-dot-yellow' : 'att-dot-green') : 'att-dot-red'}"></span>
        <span>${typeLabel}${halfLabel}</span>
      </div>
      ${existingLeave.note ? `<div class="att-popover-note">${esc(existingLeave.note)}</div>` : ''}
      <div class="att-popover-actions">
        ${canEdit ? `<button class="att-popover-action att-popover-edit">Edit</button>` : ''}
        ${admin ? `<button class="att-popover-action att-popover-cancel" data-leave-id="${existingLeave.id}">Cancel</button>` : ''}
      </div>
    `
    const editBtn = popover.querySelector('.att-popover-edit')
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        closeCellPopover()
        openLeaveModal({ ...currentCtx, allLeaves: approvedLeaves, allContracts }, {
          onSave: () => {},
          editLeave: existingLeave,
        })
      })
    }
    const cancelBtn = popover.querySelector('.att-popover-cancel')
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true
        cancelBtn.textContent = 'Cancelling...'
        await cancelLeave(currentCtx.db, existingLeave.id, currentCtx.currentUser.email)
        closeCellPopover()
      })
    }
  } else if (canEdit) {
    // Show status options — off-days (weekends OR studio holidays) offer
    // overtime; regular weekdays offer work/leave options.
    const dateObj = new Date(date + 'T00:00:00')
    const isWeekendDay = dateObj.getDay() === 0 || dateObj.getDay() === 6
    const isHolidayDay = allHolidays.some((h) => h.date === date)
    const isOffDay = isWeekendDay || isHolidayDay

    const hasDot = !!cell.querySelector('.att-dot')
    const statuses = isOffDay ? [
      { id: 'overtime_full', label: 'Overtime (Full Day)', dotClass: 'att-dot-green', icon: 'ph-clock-clockwise', isOvertime: true },
      { id: 'overtime_half', label: 'Overtime (Half Day)', dotClass: 'att-dot-yellow', icon: 'ph-clock-afternoon', isOvertime: true, halfDay: true },
      ...(hasDot ? [{ id: 'clear', label: 'Clear', dotClass: '', icon: 'ph-x', isClear: true }] : []),
    ] : [
      { id: 'wfo', label: 'Working from Office', dotClass: 'att-dot-green', icon: 'ph-buildings' },
      { id: 'wfh', label: 'Working from Home', dotClass: 'att-dot-green', icon: 'ph-house' },
      { id: 'half_day', label: 'Half Day Leave', dotClass: 'att-dot-yellow', icon: 'ph-clock-afternoon', isLeave: true },
      { id: 'personal_leave', label: 'Personal Leave', dotClass: 'att-dot-red', icon: 'ph-calendar', isLeave: true },
      { id: 'medical_leave', label: 'Medical Leave', dotClass: 'att-dot-red', icon: 'ph-first-aid-kit', isLeave: true },
    ]

    popover.innerHTML = `
      <div class="att-popover-header">${esc(memberName)} · ${dateLabel}</div>
      <div class="att-popover-options">
        ${statuses.map((s) => `
          <button class="att-popover-option" data-status="${s.id}" data-is-leave="${s.isLeave || false}" data-is-overtime="${s.isOvertime || false}" data-half-day="${s.halfDay || false}">
            <span class="att-dot ${s.dotClass}"></span>
            <i class="ph ${s.icon}"></i>
            <span>${s.label}</span>
          </button>
        `).join('')}
      </div>
    `

    popover.querySelectorAll('.att-popover-option').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.status
        const isLeave = btn.dataset.isLeave === 'true'

        const isOvertime = btn.dataset.isOvertime === 'true'

        if (status === 'clear') {
          // Remove overtime leave doc if exists
          const leaveId = cell.dataset.leaveId
          if (leaveId) {
            await cancelLeave(currentCtx.db, leaveId, currentCtx.currentUser.email)
          }
          const dot = cell.querySelector('.att-dot')
          if (dot) dot.remove()
          cell.title = ''
          closeCellPopover()
        } else if (isOvertime) {
          // Create an overtime leave doc
          const isHalf = btn.dataset.halfDay === 'true'
          const memberObj = TEAM.find((m) => m.email === email)
          closeCellPopover()
          await createLeave(currentCtx.db, {
            userEmail: email,
            userName: memberObj?.name || '',
            type: 'overtime',
            startDate: date,
            endDate: date,
            halfDay: isHalf,
            days: isHalf ? 0.5 : 1,
            paidDays: 0,
            unpaidDays: 0,
            note: isHalf ? 'Overtime (half day)' : 'Overtime (full day)',
            createdBy: currentCtx.currentUser.email,
          })
        } else if (isLeave) {
          closeCellPopover()
          const leaveType = status === 'medical_leave' ? 'medical' : 'personal'
          const isHalfDay = status === 'half_day'
          openLeaveModal({ ...currentCtx, allLeaves: approvedLeaves, allContracts }, {
            onSave: () => {},
            forEmail: email,
            date,
            defaultType: leaveType,
            defaultHalfDay: isHalfDay,
          })
        } else {
          // WFO/WFH/half_day_work — update the dot visually
          const dotClass = status === 'half_day_work' ? 'att-dot-yellow' : 'att-dot-green'
          const dot = cell.querySelector('.att-dot')
          if (dot) {
            dot.className = `att-dot ${dotClass}`
          } else {
            cell.innerHTML = `<span class="att-dot ${dotClass}"></span>`
          }
          cell.title = status === 'wfh' ? 'Working from Home' : (status === 'half_day_work' ? 'Half Day Work' : 'Working from Office')
          closeCellPopover()
        }
      })
    })
  } else {
    // Non-admin, not self — just show status
    popover.innerHTML = `
      <div class="att-popover-header">${esc(memberName)} · ${dateLabel}</div>
      <div class="att-popover-status">
        <span class="att-dot att-dot-green"></span>
        <span>Working</span>
      </div>
    `
  }

  // Position popover near the cell
  document.body.appendChild(popover)
  const cellRect = cell.getBoundingClientRect()
  const popRect = popover.getBoundingClientRect()

  let left = cellRect.left + cellRect.width / 2 - popRect.width / 2
  let top = cellRect.bottom + 6

  // Keep within viewport
  if (left < 8) left = 8
  if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - 8 - popRect.width
  if (top + popRect.height > window.innerHeight - 8) top = cellRect.top - popRect.height - 6

  popover.style.left = `${left}px`
  popover.style.top = `${top}px`

  activePopover = popover
}
