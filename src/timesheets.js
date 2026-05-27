import { loadAllDailyFocusForRange } from './db.js'
import { TEAM } from './config.js'

let currentClientId = ''
let currentMonth = '' // 'YYYY-MM'
let timesheetData = null
let latestRequestId = 0

export async function renderTimesheets(container, tasks, ctx) {
  // Default to current month
  if (!currentMonth) {
    const now = new Date()
    currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  const clients = ctx.clients.filter((c) => c.name)

  container.innerHTML = `
    <div class="timesheets-view">
      <div class="timesheets-header">
        <h2>Timesheets</h2>
        <p>Generate timesheets from tracked time blocks</p>
      </div>

      <div class="timesheets-controls">
        <div class="timesheets-control-group">
          <label class="form-label">Client</label>
          <select id="ts-client" class="form-select">
            <option value="">Select a client...</option>
            ${clients.map((c) => `<option value="${c.id}"${c.id === currentClientId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="timesheets-control-group">
          <label class="form-label">Month</label>
          <input type="month" id="ts-month" class="form-input" value="${currentMonth}">
        </div>
        <div class="timesheets-control-group ts-generate-group">
          <button class="btn-ghost ts-print-btn hidden" id="ts-print">
            <i class="ph ph-printer"></i> Print
          </button>
        </div>
      </div>

      <div id="ts-result"></div>
    </div>
  `

  const clientSelect = document.getElementById('ts-client')
  const monthInput = document.getElementById('ts-month')
  const printBtn = document.getElementById('ts-print')

  clientSelect.addEventListener('change', () => {
    currentClientId = clientSelect.value
    autoGenerate(container, tasks, ctx)
  })

  monthInput.addEventListener('change', () => {
    currentMonth = monthInput.value
    autoGenerate(container, tasks, ctx)
  })

  printBtn.addEventListener('click', () => {
    window.print()
  })

  // Auto-generate if we already have a selection
  if (currentClientId && currentMonth) {
    autoGenerate(container, tasks, ctx)
  }
}

async function autoGenerate(container, tasks, ctx) {
  const resultEl = document.getElementById('ts-result')
  const printBtn = document.getElementById('ts-print')
  if (!resultEl) return

  if (!currentClientId) {
    timesheetData = null
    printBtn?.classList.add('hidden')
    resultEl.innerHTML = ''
    return
  }

  if (!currentMonth || !/^\d{4}-\d{2}$/.test(currentMonth)) {
    timesheetData = null
    printBtn?.classList.add('hidden')
    resultEl.innerHTML = '<div class="ts-empty">Please select a valid month.</div>'
    return
  }

  resultEl.innerHTML = '<div class="ts-loading"><i class="ph ph-spinner"></i> Loading...</div>'

  const requestId = ++latestRequestId

  try {
    const data = await generateTimesheet(ctx, tasks, currentClientId, currentMonth)
    if (requestId !== latestRequestId) return // stale response, discard
    timesheetData = data
    renderTimesheetTable(resultEl, timesheetData, ctx)
    printBtn?.classList.toggle('hidden', timesheetData.lineItems.length === 0)
  } catch (err) {
    if (requestId !== latestRequestId) return
    console.error('Timesheet generation error:', err)
    resultEl.innerHTML = '<div class="ts-empty">Error generating timesheet.</div>'
    printBtn?.classList.add('hidden')
  }
}

async function generateTimesheet(ctx, tasks, clientId, monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Get tasks belonging to this client (directly or via project)
  const clientProjectIds = new Set(
    ctx.projects.filter((p) => p.clientId === clientId).map((p) => p.id)
  )
  const clientTaskIds = new Set(
    tasks.filter((t) => t.clientId === clientId || (t.projectId && clientProjectIds.has(t.projectId))).map((t) => t.id)
  )

  // Load all dailyFocus docs for this date range
  const focusDocs = await loadAllDailyFocusForRange(ctx.db, startDate, endDate)

  // Aggregate time blocks per task
  const taskTimeMap = {} // taskId -> { totalMinutes, blocks: [...] }

  for (const doc of focusDocs) {
    const blocks = doc.timeBlocks || []
    for (const block of blocks) {
      if (!clientTaskIds.has(block.taskId)) continue

      if (!taskTimeMap[block.taskId]) {
        taskTimeMap[block.taskId] = { totalMinutes: 0, blocks: [] }
      }

      const minutes = durationMinutes(block.start, block.end)
      taskTimeMap[block.taskId].totalMinutes += minutes
      taskTimeMap[block.taskId].blocks.push({
        date: doc.date,
        start: block.start,
        end: block.end,
        userEmail: doc.userEmail,
        minutes,
      })
    }
  }

  // Build line items with per-task rate from project
  const client = ctx.clients.find((c) => c.id === clientId)
  const lineItems = Object.entries(taskTimeMap)
    .map(([taskId, data]) => {
      const task = tasks.find((t) => t.id === taskId)
      const project = task?.projectId ? ctx.projects.find((p) => p.id === task.projectId) : null
      const rate = project?.hourlyRate ?? client?.defaultHourlyRate ?? 0
      const currency = project?.currency || client?.currency || 'INR'
      return {
        taskId,
        title: task?.title || 'Unknown task',
        project: project?.name || '',
        totalMinutes: data.totalMinutes,
        rate,
        currency,
        blocks: data.blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)

  const totalMinutes = lineItems.reduce((sum, item) => sum + item.totalMinutes, 0)
  const ratedItems = lineItems.filter((item) => item.rate > 0)
  const currencies = [...new Set(ratedItems.map((item) => item.currency))]
  const mixedCurrency = currencies.length > 1
  const totalAmount = mixedCurrency ? null : ratedItems.reduce((sum, item) => sum + (item.totalMinutes / 60) * item.rate, 0)
  const currency = currencies.length === 1 ? currencies[0] : client?.currency || 'INR'

  return {
    clientId,
    month: monthStr,
    startDate,
    endDate,
    lineItems,
    totalMinutes,
    totalAmount,
    currency,
  }
}

function renderTimesheetTable(container, data, ctx) {
  if (!data || data.lineItems.length === 0) {
    const client = ctx.clients.find((c) => c.id === data?.clientId)
    container.innerHTML = `
      <div class="ts-empty">
        <i class="ph ph-clipboard-text" style="font-size:32px;opacity:0.3"></i>
        <p>No tracked time found for ${esc(client?.name || 'this client')} in ${formatMonth(data?.month || '')}.</p>
        <p class="ts-empty-hint">Time blocks are created by dragging tasks onto the time grid in My Day.</p>
      </div>
    `
    return
  }

  const client = ctx.clients.find((c) => c.id === data.clientId)
  const hasRates = data.lineItems.some((item) => item.rate > 0)
  const memberByEmail = new Map(TEAM.map((m) => [m.email, m]))
  const colCount = 5 + (hasRates ? 1 : 0) // #, Task, Date, Logged By, Time, [Amount]

  container.innerHTML = `
    <div class="ts-sheet">
      <div class="ts-sheet-header">
        <div class="ts-sheet-title">
          ${safeUrl(client?.logoUrl) ? `<img class="client-logo" src="${esc(safeUrl(client.logoUrl))}" alt="${esc(client.name)}">` : ''}
          <div>
            <h3>${esc(client?.name || 'Client')}</h3>
            <span class="ts-sheet-period">${formatMonth(data.month)}</span>
          </div>
        </div>
        <div class="ts-sheet-summary">
          <span class="ts-summary-item">${data.lineItems.length} task${data.lineItems.length !== 1 ? 's' : ''}</span>
          <span class="ts-summary-item">${formatDuration(data.totalMinutes)}</span>
          ${hasRates && data.totalAmount != null ? `<span class="ts-summary-total">${formatCurrency(data.totalAmount, data.currency)}</span>` : ''}
        </div>
      </div>

      <table class="ts-table">
        <thead>
          <tr>
            <th class="ts-col-num">#</th>
            <th class="ts-col-task">Task</th>
            <th class="ts-col-date">Date</th>
            <th class="ts-col-person">Logged by</th>
            <th class="ts-col-time">Time</th>
            ${hasRates ? '<th class="ts-col-amount">Amount</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.lineItems.map((item, i) => {
            const hours = item.totalMinutes / 60
            const amount = item.rate > 0 ? hours * item.rate : 0
            return item.blocks.map((b, bi) => {
              const member = memberByEmail.get(b.userEmail)
              const avatarHtml = member
                ? (safeUrl(member.photoURL)
                    ? `<img class="avatar-photo-xs" src="${esc(safeUrl(member.photoURL))}" alt="${esc(member.name)}">`
                    : `<span class="avatar-xs" style="background:${member.color}">${member.name[0]}</span>`)
                : ''
              const nameHtml = member ? esc(member.name) : esc(b.userEmail)
              const isFirst = bi === 0
              const isLast = bi === item.blocks.length - 1
              return `
              <tr class="ts-entry-row${isLast ? ' ts-entry-last' : ''}">
                <td class="ts-col-num">${isFirst ? i + 1 : ''}</td>
                <td class="ts-col-task">${isFirst ? `<div class="ts-task-title">${esc(item.title)}</div>${item.project ? `<div class="ts-task-project">${esc(item.project)}</div>` : ''}` : ''}</td>
                <td class="ts-col-date">${formatDateShort(b.date)}</td>
                <td class="ts-col-person"><span class="ts-person">${avatarHtml} ${nameHtml}</span></td>
                <td class="ts-col-time">${fmtTime(b.start)}\u2013${fmtTime(b.end)} <span class="ts-block-duration">(${formatDuration(b.minutes)})</span>${isLast && item.blocks.length > 1 ? ` <span class="ts-duration">\u2014 ${formatDuration(item.totalMinutes)}</span>` : ''}</td>
                ${hasRates ? `<td class="ts-col-amount">${isFirst && item.rate > 0 ? formatCurrency(amount, item.currency) : ''}</td>` : ''}
              </tr>`
            }).join('')
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="ts-total-row">
            <td colspan="${colCount - 1 - (hasRates ? 1 : 0)}" class="ts-total-label">Total</td>
            <td class="ts-col-time"><strong>${formatDuration(data.totalMinutes)}</strong></td>
            ${hasRates ? `<td class="ts-col-amount"><strong>${data.totalAmount != null ? formatCurrency(data.totalAmount, data.currency) : '\u2014'}</strong></td>` : ''}
          </tr>
        </tfoot>
      </table>
    </div>
  `
}

// ── Helpers ──

function durationMinutes(startStr, endStr) {
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60
  return Math.max(0, diff)
}

function formatDuration(minutes) {
  if (minutes <= 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function formatCurrency(amount, currency) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatMonth(monthStr) {
  if (!monthStr) return ''
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
}

function fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

function safeUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (url.startsWith('data:image/')) return url
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url
  } catch (_) { /* invalid URL */ }
  return null
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
