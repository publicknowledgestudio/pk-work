# Attendance & Leave Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add leave tracking with accrual balances, a request/cancel workflow, and a monthly attendance calendar grid to PK Work.

**Architecture:** New `leaves` Firestore collection with API endpoints on the existing Cloud Function. Frontend gets a new `/attendance` route with balance cards and a month grid. Admin role (`role: 'admin'`) added to TEAM config controls who can see all balances and cancel leaves. Leave paid/unpaid status is auto-calculated from balance.

**Tech Stack:** Firebase/Firestore, Cloud Functions (Node.js), Vite + vanilla JS frontend (same as rest of app)

---

### Task 1: Add role and joinDate to TEAM config

**Files:**
- Modify: `src/config.js`

**Step 1: Update TEAM array**

Add `role` and `joinDate` to each team member. Remove Asty (not relevant for attendance).

```js
export const TEAM = [
  { email: 'gyan@publicknowledge.co', name: 'Gyan', color: '#4f46e5', role: 'admin', joinDate: '2024-01-01' },
  { email: 'charu@publicknowledge.co', name: 'Charu', color: '#0891b2', role: 'admin', joinDate: '2024-01-01' },
  { email: 'sharang@publicknowledge.co', name: 'Sharang', color: '#c026d3', role: 'member', joinDate: '2024-01-01' },
  { email: 'anandu@publicknowledge.co', name: 'Anandu', color: '#ea580c', role: 'member', joinDate: '2024-01-01' },
  { email: 'mohit@publicknowledge.co', name: 'Mohit', color: '#059669', role: 'member', joinDate: '2024-01-01' },
  { email: 'asty@publicknowledge.co', name: 'Asty', color: '#10b981' },
]
```

Note: Keep Asty in the array (other views use it) but omit `role`/`joinDate`. The attendance view filters to members who have `joinDate`.

**Step 2: Add helper exports**

```js
export const ATTENDANCE_STATUSES = [
  { id: 'wfo', label: 'Working from Office', color: '#22c55e' },
  { id: 'wfh', label: 'Working from Home', color: '#22c55e' },
  { id: 'half_day', label: 'Half Day', color: '#eab308' },
  { id: 'medical_leave', label: 'Medical Leave', color: '#ef4444' },
  { id: 'personal_leave', label: 'Personal Leave', color: '#ef4444' },
  { id: 'unpaid_leave', label: 'Unpaid Leave', color: '#ef4444' },
]

export function isAdmin(email) {
  return TEAM.find(m => m.email === email)?.role === 'admin'
}

export function getAttendanceTeam() {
  return TEAM.filter(m => m.joinDate)
}
```

**Step 3: Verify dev server still works**

Run: `npm run dev`
Expected: App loads without errors, existing views unaffected.

**Step 4: Commit**

```bash
git add src/config.js
git commit -m "feat: add role, joinDate to TEAM config for attendance feature"
```

---

### Task 2: Add Firestore indexes and security rules for leaves

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `firestore.rules`

**Step 1: Add leaves indexes to `firestore.indexes.json`**

Add these entries to the `indexes` array:

```json
{
  "collectionGroup": "leaves",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userEmail", "order": "ASCENDING" },
    { "fieldPath": "startDate", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "leaves",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "startDate", "order": "DESCENDING" }
  ]
}
```

**Step 2: Add leaves rules to `firestore.rules`**

Add before the closing `}}`:

```
    // Leaves collection (attendance & leave tracking)
    match /leaves/{leaveId} {
      allow read: if isTeamMember();
      allow create: if isTeamMember();
      allow update: if isTeamMember();
      allow delete: if isTeamMember();
    }
```

**Step 3: Commit**

```bash
git add firestore.indexes.json firestore.rules
git commit -m "feat: add Firestore indexes and rules for leaves collection"
```

---

### Task 3: Add leave API endpoints to Cloud Functions

**Files:**
- Modify: `functions/index.js`

**Step 1: Add TEAM config at top of functions/index.js**

After the `db` initialization (line 20), add:

```js
// Team config for leave balance calculations
const TEAM_MEMBERS = [
  { email: 'gyan@publicknowledge.co', name: 'Gyan', role: 'admin', joinDate: '2024-01-01' },
  { email: 'charu@publicknowledge.co', name: 'Charu', role: 'admin', joinDate: '2024-01-01' },
  { email: 'sharang@publicknowledge.co', name: 'Sharang', role: 'member', joinDate: '2024-01-01' },
  { email: 'anandu@publicknowledge.co', name: 'Anandu', role: 'member', joinDate: '2024-01-01' },
  { email: 'mohit@publicknowledge.co', name: 'Mohit', role: 'member', joinDate: '2024-01-01' },
]
```

**Step 2: Add route handling in the `api` function**

In the routing section of `exports.api` (around line 66-192), add before the `res.status(404)` line:

```js
    // --- LEAVES ---
    if (segments[0] === 'leaves') {
      if (segments.length === 2 && segments[1] === 'balances' && req.method === 'GET') {
        return await getLeaveBalances(req, res)
      }
      if (req.method === 'GET' && segments.length === 1) {
        return await listLeaves(req, res)
      }
      if (req.method === 'POST' && segments.length === 1) {
        return await createLeave(req, res)
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        return await cancelLeave(req, res, segments[1])
      }
    }
```

**Step 3: Add helper functions**

```js
// === Leave Helpers ===

// Count weekdays between two YYYY-MM-DD date strings (inclusive)
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

// Calculate months between joinDate and today
function monthsSinceJoin(joinDate) {
  const join = new Date(joinDate + 'T00:00:00')
  const now = new Date()
  let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
  // Only count completed months
  if (now.getDate() < join.getDate()) months--
  return Math.max(0, months)
}
```

**Step 4: Add leave handler functions**

```js
// === Leave Handlers ===

async function listLeaves(req, res) {
  let q = db.collection('leaves')

  if (req.query.userEmail) q = q.where('userEmail', '==', req.query.userEmail)
  if (req.query.status) q = q.where('status', '==', req.query.status)

  q = q.orderBy('startDate', 'desc')

  const snap = await q.get()
  let leaves = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  // Client-side date range filter (to avoid needing more composite indexes)
  if (req.query.startDate) {
    leaves = leaves.filter((l) => l.startDate >= req.query.startDate)
  }
  if (req.query.endDate) {
    leaves = leaves.filter((l) => l.startDate <= req.query.endDate)
  }

  res.json({ leaves })
}

async function createLeave(req, res) {
  const data = req.body
  if (!data.userEmail) return res.status(400).json({ error: 'userEmail is required' })
  if (!data.type || !['personal', 'medical'].includes(data.type)) {
    return res.status(400).json({ error: 'type must be "personal" or "medical"' })
  }
  if (!data.startDate) return res.status(400).json({ error: 'startDate is required' })

  const endDate = data.endDate || data.startDate
  const halfDay = !!data.halfDay
  const days = halfDay ? 0.5 : countWeekdays(data.startDate, endDate)

  // Calculate paid vs unpaid for personal leaves
  let paidDays = days
  let unpaidDays = 0

  if (data.type === 'personal') {
    // Get current balance
    const member = TEAM_MEMBERS.find((m) => m.email === data.userEmail)
    if (member) {
      const accrued = monthsSinceJoin(member.joinDate)
      // Count existing approved personal leave days
      const existingSnap = await db.collection('leaves')
        .where('userEmail', '==', data.userEmail)
        .where('type', '==', 'personal')
        .where('status', '==', 'approved')
        .get()
      let usedDays = 0
      existingSnap.docs.forEach((d) => {
        const l = d.data()
        usedDays += l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)
      })
      const available = Math.max(0, accrued - usedDays)
      paidDays = Math.min(days, available)
      unpaidDays = days - paidDays
    }
  }

  const leave = {
    userEmail: data.userEmail,
    userName: data.userName || '',
    type: data.type,
    startDate: data.startDate,
    endDate: endDate,
    halfDay,
    days,
    paidDays,
    unpaidDays,
    status: 'approved',
    note: data.note || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: data.createdBy || '',
    cancelledBy: null,
    cancelledAt: null,
  }

  const ref = await db.collection('leaves').add(leave)
  res.status(201).json({ id: ref.id, ...leave })
}

async function cancelLeave(req, res, leaveId) {
  const data = req.body
  const docRef = db.collection('leaves').doc(leaveId)
  const doc = await docRef.get()

  if (!doc.exists) return res.status(404).json({ error: 'Leave not found' })

  await docRef.update({
    status: 'cancelled',
    cancelledBy: data.cancelledBy || '',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  res.json({ id: leaveId, cancelled: true })
}

async function getLeaveBalances(req, res) {
  const members = req.query.userEmail
    ? TEAM_MEMBERS.filter((m) => m.email === req.query.userEmail)
    : TEAM_MEMBERS

  // Get all approved leaves
  const snap = await db.collection('leaves').where('status', '==', 'approved').get()
  const allLeaves = snap.docs.map((d) => d.data())

  const balances = members.map((member) => {
    const accrued = monthsSinceJoin(member.joinDate)
    const memberLeaves = allLeaves.filter((l) => l.userEmail === member.email)

    const personalLeaves = memberLeaves.filter((l) => l.type === 'personal')
    const medicalLeaves = memberLeaves.filter((l) => l.type === 'medical')

    const personalUsed = personalLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
    const medicalUsed = medicalLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
    const personalUnpaid = personalLeaves.reduce((sum, l) => sum + (l.unpaidDays || 0), 0)

    return {
      userEmail: member.email,
      userName: member.name,
      joinDate: member.joinDate,
      personal: {
        accrued,
        used: personalUsed,
        unpaid: personalUnpaid,
        available: Math.max(0, accrued - personalUsed + personalUnpaid),
      },
      medical: {
        accrued,
        used: medicalUsed,
        available: Math.max(0, accrued - medicalUsed),
      },
    }
  })

  res.json({ balances })
}
```

**Step 5: Verify functions build**

Run: `cd functions && npm run lint 2>/dev/null; echo "ok"` (or just check for syntax errors)

**Step 6: Commit**

```bash
git add functions/index.js
git commit -m "feat: add leave API endpoints (list, create, cancel, balances)"
```

---

### Task 4: Add leave database functions to frontend db.js

**Files:**
- Modify: `src/db.js`

**Step 1: Add leave Firestore functions**

Add at the end of `src/db.js`:

```js
// ===== Leaves (Attendance) =====

export function subscribeToLeaves(db, callback) {
  const q = query(collection(db, 'leaves'), orderBy('startDate', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function createLeave(db, data) {
  return addDoc(collection(db, 'leaves'), {
    userEmail: data.userEmail,
    userName: data.userName || '',
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    halfDay: data.halfDay || false,
    days: data.days || 0,
    paidDays: data.paidDays || 0,
    unpaidDays: data.unpaidDays || 0,
    status: 'approved',
    note: data.note || '',
    createdBy: data.createdBy || '',
    cancelledBy: null,
    cancelledAt: null,
    createdAt: serverTimestamp(),
  })
}

export async function cancelLeave(db, leaveId, cancelledBy) {
  return updateDoc(doc(db, 'leaves', leaveId), {
    status: 'cancelled',
    cancelledBy,
    cancelledAt: serverTimestamp(),
  })
}

export async function loadLeaves(db, filters = {}) {
  let q = collection(db, 'leaves')
  const constraints = []

  if (filters.userEmail) constraints.push(where('userEmail', '==', filters.userEmail))
  if (filters.status) constraints.push(where('status', '==', filters.status))
  constraints.push(orderBy('startDate', 'desc'))

  const snap = await getDocs(query(q, ...constraints))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
```

**Step 2: Commit**

```bash
git add src/db.js
git commit -m "feat: add leave Firestore functions (subscribe, create, cancel, load)"
```

---

### Task 5: Create the leave request modal

**Files:**
- Create: `src/leave-modal.js`
- Modify: `index.html` (add modal markup)

**Step 1: Add modal HTML to `index.html`**

Add after the existing task modal closing `</div>` (before the `<script>` tag):

```html
  <!-- Leave Request Modal -->
  <div id="leave-modal" class="modal-overlay hidden">
    <div class="modal modal-sm">
      <div class="modal-header">
        <h2 class="modal-title" id="leave-modal-title">Request Leave</h2>
        <button class="modal-close" id="leave-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-row" id="leave-person-row" style="display:none">
          <label class="form-label">Person</label>
          <select id="leave-person" class="form-select"></select>
        </div>
        <div class="form-row">
          <label class="form-label">Type</label>
          <div id="leave-type-pills" class="status-pills">
            <button type="button" class="status-pill active" data-type="personal">
              <i class="ph ph-calendar"></i>
              <span>Personal</span>
            </button>
            <button type="button" class="status-pill" data-type="medical">
              <i class="ph ph-first-aid-kit"></i>
              <span>Medical</span>
            </button>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">Start Date</label>
            <input type="date" id="leave-start" class="form-input">
          </div>
          <div class="form-row">
            <label class="form-label">End Date</label>
            <input type="date" id="leave-end" class="form-input">
          </div>
        </div>
        <div class="form-row">
          <label class="leave-half-day-label">
            <input type="checkbox" id="leave-half-day">
            <span>Half day (0.5 days)</span>
          </label>
        </div>
        <div class="form-row">
          <label class="form-label">Note <span class="form-hint">(optional)</span></label>
          <textarea id="leave-note" class="form-textarea" rows="2" placeholder="Reason or context..."></textarea>
        </div>
        <div id="leave-summary" class="leave-summary hidden"></div>
      </div>
      <div class="modal-footer">
        <div class="modal-footer-right">
          <button id="leave-cancel-btn" class="btn-ghost">Cancel</button>
          <button id="leave-save-btn" class="btn-primary">Request Leave</button>
        </div>
      </div>
    </div>
  </div>
```

**Step 2: Create `src/leave-modal.js`**

```js
import { TEAM, isAdmin, getAttendanceTeam } from './config.js'
import { createLeave } from './db.js'

const overlay = document.getElementById('leave-modal')
const closeBtn = document.getElementById('leave-modal-close')
const cancelBtn = document.getElementById('leave-cancel-btn')
const saveBtn = document.getElementById('leave-save-btn')
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
  // Half day only makes sense for single-day leaves
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

  // Determine target user (admin can request for others)
  const targetEmail = personRow.style.display !== 'none'
    ? personSelect.value
    : currentCtx.currentUser.email
  const targetMember = TEAM.find((m) => m.email === targetEmail)

  // Calculate paid/unpaid for personal leaves
  let paidDays = days
  let unpaidDays = 0

  if (selectedType === 'personal' && targetMember?.joinDate) {
    const accrued = monthsSinceJoin(targetMember.joinDate)
    const used = getUsedDays(targetEmail, 'personal', currentCtx.allLeaves || [])
    const available = Math.max(0, accrued - used)
    paidDays = Math.min(days, available)
    unpaidDays = days - paidDays
  }

  saveBtn.disabled = true
  saveBtn.textContent = 'Saving...'

  try {
    await createLeave(currentCtx.db, {
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
      createdBy: currentCtx.currentUser.email,
    })
    if (onSaveCallback) onSaveCallback()
    close()
  } catch (err) {
    console.error('Failed to create leave:', err)
    saveBtn.disabled = false
    saveBtn.textContent = 'Request Leave'
  }
})

export function openLeaveModal(ctx, options = {}) {
  currentCtx = ctx
  onSaveCallback = options.onSave || null
  selectedType = 'personal'

  // Reset form
  typePills.querySelectorAll('.status-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.type === 'personal')
  })

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = tomorrow.toISOString().split('T')[0]
  startInput.value = options.date || defaultDate
  endInput.value = options.date || defaultDate
  endInput.disabled = false
  halfDayCheckbox.checked = false
  noteInput.value = ''
  summaryEl.classList.add('hidden')

  // Show person picker for admins
  if (isAdmin(ctx.currentUser.email)) {
    personRow.style.display = ''
    const team = getAttendanceTeam()
    personSelect.innerHTML = team
      .map((m) => `<option value="${m.email}"${m.email === (options.forEmail || ctx.currentUser.email) ? ' selected' : ''}>${m.name}</option>`)
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
    const used = getUsedDays(targetEmail, 'personal', currentCtx?.allLeaves || [])
    const available = Math.max(0, accrued - used)
    const paidDays = Math.min(days, available)
    const unpaidDays = days - paidDays

    if (unpaidDays > 0) {
      html += `<br><span class="leave-summary-warn">⚠ ${paidDays} paid, ${unpaidDays} unpaid (balance exceeded)</span>`
    }
  }

  summaryEl.innerHTML = html
  summaryEl.classList.remove('hidden')
}

// Utility functions (duplicated from backend for client-side calculation)
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
  let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
  if (now.getDate() < join.getDate()) months--
  return Math.max(0, months)
}

function getUsedDays(email, type, allLeaves) {
  return allLeaves
    .filter((l) => l.userEmail === email && l.type === type && l.status === 'approved')
    .reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
}
```

**Step 3: Commit**

```bash
git add src/leave-modal.js index.html
git commit -m "feat: add leave request modal with type toggle, date range, paid/unpaid calculation"
```

---

### Task 6: Create the attendance view

**Files:**
- Create: `src/attendance.js`

**Step 1: Create `src/attendance.js`**

This is the main attendance page with balance cards and month grid. Full file:

```js
import { TEAM, isAdmin, getAttendanceTeam } from './config.js'
import { subscribeToLeaves, cancelLeave } from './db.js'
import { openLeaveModal } from './leave-modal.js'

let unsubLeaves = null
let allLeaves = []
let currentMonth = '' // 'YYYY-MM'

export function renderAttendance(container, ctx) {
  if (!currentMonth) {
    const now = new Date()
    currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  // Subscribe to leaves (real-time)
  if (unsubLeaves) unsubLeaves()
  unsubLeaves = subscribeToLeaves(ctx.db, (leaves) => {
    allLeaves = leaves
    renderContent(container, ctx)
  })
}

export function cleanupAttendance() {
  if (unsubLeaves) {
    unsubLeaves()
    unsubLeaves = null
  }
}

function renderContent(container, ctx) {
  const userEmail = ctx.currentUser.email
  const admin = isAdmin(userEmail)
  const team = getAttendanceTeam()
  const approvedLeaves = allLeaves.filter((l) => l.status === 'approved')

  container.innerHTML = `
    <div class="attendance-view">
      <div class="attendance-header">
        <h2>Attendance</h2>
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

      <div class="attendance-leave-list">
        <h3>Leave History</h3>
        <div id="att-leave-list"></div>
      </div>
    </div>
  `

  // Bind month navigation
  document.getElementById('att-prev-month').addEventListener('click', () => {
    const [y, m] = currentMonth.split('-').map(Number)
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
      openLeaveModal({ ...ctx, allLeaves: approvedLeaves }, {
        onSave: () => {},
        forEmail: btn.dataset.email || userEmail,
      })
    })
  })

  renderMonthGrid(team, approvedLeaves)
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

    return `
      <div class="balance-card">
        <div class="balance-card-header">
          ${avatarHtml}
          <span class="balance-card-name">${esc(member.name)}</span>
          <button class="btn-ghost btn-sm" data-action="request-leave" data-email="${member.email}">
            <i class="ph ph-plus"></i> Request Leave
          </button>
        </div>
        <div class="balance-card-rows">
          <div class="balance-row">
            <span class="balance-label">Personal</span>
            ${renderBalanceBar(personal.available, personal.accrued, personal.used, personal.unpaid, '#6366f1')}
          </div>
          <div class="balance-row">
            <span class="balance-label">Medical</span>
            ${renderBalanceBar(medical.available, medical.accrued, medical.used, 0, '#06b6d4')}
          </div>
        </div>
      </div>
    `
  }).join('')
}

function renderBalanceBar(available, accrued, used, unpaid, color) {
  const paidUsed = used - unpaid
  const paidPct = accrued > 0 ? (paidUsed / accrued) * 100 : 0
  const unpaidPct = accrued > 0 ? (unpaid / accrued) * 100 : 0

  return `
    <div class="balance-bar-container">
      <div class="balance-bar">
        <div class="balance-bar-used" style="width:${paidPct}%;background:${color}"></div>
        <div class="balance-bar-unpaid" style="width:${unpaidPct}%"></div>
      </div>
      <span class="balance-numbers">${available} left of ${accrued}${unpaid > 0 ? ` · ${unpaid} unpaid` : ''}</span>
    </div>
  `
}

function renderMonthGrid(team, leaves) {
  const [year, month] = currentMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const label = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  document.getElementById('att-month-label').textContent = label

  // Build header row (day numbers)
  let headerHtml = '<div class="att-grid-cell att-grid-name-header"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'narrow' })
    headerHtml += `<div class="att-grid-cell att-grid-day-header${isWeekend ? ' att-weekend' : ''}">
      <span class="att-day-name">${dayLabel}</span>
      <span class="att-day-num">${d}</span>
    </div>`
  }

  // Build rows per team member
  let rowsHtml = ''
  team.forEach((member) => {
    const memberObj = TEAM.find((m) => m.email === member.email)
    const avatarHtml = memberObj?.photoURL
      ? `<img class="avatar-photo-xs" src="${memberObj.photoURL}" alt="${member.name}">`
      : `<span class="avatar-xs" style="background:${memberObj?.color || '#6b7280'}">${member.name[0]}</span>`

    rowsHtml += `<div class="att-grid-cell att-grid-name">${avatarHtml} ${esc(member.name)}</div>`

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const date = new Date(year, month - 1, d)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      if (isWeekend) {
        rowsHtml += `<div class="att-grid-cell att-weekend"></div>`
        continue
      }

      // Check if there's a leave for this person on this date
      const leave = leaves.find((l) =>
        l.userEmail === member.email &&
        l.startDate <= dateStr &&
        (l.endDate || l.startDate) >= dateStr
      )

      let dotClass = 'att-dot-green' // default: present
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

      // Only show dots for today and past dates (future without leave = no dot)
      const today = new Date().toISOString().split('T')[0]
      const showDot = dateStr <= today || leave

      rowsHtml += `<div class="att-grid-cell${leave ? ' att-has-leave' : ''}" title="${tooltip}">
        ${showDot ? `<span class="att-dot ${dotClass}"></span>` : ''}
      </div>`
    }
  })

  const grid = document.getElementById('att-grid')
  grid.style.gridTemplateColumns = `140px repeat(${daysInMonth}, 1fr)`
  grid.innerHTML = headerHtml + rowsHtml
}

function renderLeaveList(leaves, userEmail, admin, ctx) {
  const [year, month] = currentMonth.split('-').map(Number)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  // Filter leaves that overlap with current month
  const monthLeaves = leaves.filter((l) => {
    const end = l.endDate || l.startDate
    return l.startDate <= monthEnd && end >= monthStart
  })

  // Non-admins only see their own
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
      : `${formatDate(l.startDate)} – ${formatDate(l.endDate)}`
    const typeLabel = l.type === 'medical' ? 'Medical' : 'Personal'
    const daysLabel = l.halfDay ? '½ day' : `${l.days || countWeekdays(l.startDate, l.endDate || l.startDate)} day${(l.days || 0) !== 1 ? 's' : ''}`
    const unpaidBadge = l.unpaidDays > 0 ? `<span class="leave-badge-unpaid">${l.unpaidDays} unpaid</span>` : ''
    const cancelBtn = admin ? `<button class="btn-ghost btn-sm leave-cancel-btn" data-leave-id="${l.id}"><i class="ph ph-x"></i></button>` : ''

    return `
      <div class="leave-list-item">
        <div class="leave-list-left">
          <span class="leave-list-dot" style="background:${l.type === 'medical' ? '#ef4444' : '#6366f1'}"></span>
          <strong>${esc(memberObj?.name || l.userName)}</strong>
          <span class="leave-list-type">${typeLabel} · ${daysLabel}</span>
          ${unpaidBadge}
        </div>
        <div class="leave-list-right">
          <span class="leave-list-date">${dateRange}</span>
          ${cancelBtn}
        </div>
      </div>
    `
  }).join('')

  // Bind cancel buttons
  listEl.querySelectorAll('.leave-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this leave?')) return
      btn.disabled = true
      await cancelLeave(ctx.db, btn.dataset.leaveId, userEmail)
    })
  })
}

// === Helpers ===

function getBalance(member, type, leaves) {
  const accrued = monthsSinceJoin(member.joinDate)
  const typeLeaves = leaves.filter((l) => l.userEmail === member.email && l.type === type)
  const used = typeLeaves.reduce((sum, l) => sum + (l.halfDay ? 0.5 : countWeekdays(l.startDate, l.endDate || l.startDate)), 0)
  const unpaid = type === 'personal'
    ? typeLeaves.reduce((sum, l) => sum + (l.unpaidDays || 0), 0)
    : 0
  return {
    accrued,
    used,
    unpaid,
    available: Math.max(0, accrued - used + unpaid),
  }
}

function monthsSinceJoin(joinDate) {
  const join = new Date(joinDate + 'T00:00:00')
  const now = new Date()
  let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth())
  if (now.getDate() < join.getDate()) months--
  return Math.max(0, months)
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
```

**Step 2: Commit**

```bash
git add src/attendance.js
git commit -m "feat: add attendance view with balance cards, month grid, and leave history"
```

---

### Task 7: Wire up attendance route in main.js

**Files:**
- Modify: `src/main.js`

**Step 1: Add imports**

Add at the top with other imports:

```js
import { renderAttendance, cleanupAttendance } from './attendance.js'
```

**Step 2: Add route**

In the `ROUTES` object, add:

```js
'/attendance': { view: 'attendance' },
```

In `VIEW_TO_PATH`, add:

```js
'attendance': '/attendance',
```

**Step 3: Add to renderCurrentView**

In the `switch (currentView)` block, add:

```js
    case 'attendance':
      renderAttendance(mainContent, ctx)
      break
```

**Step 4: Add cleanup**

In the cleanup section (around line 626-629), add:

```js
  if (currentView !== 'attendance') cleanupAttendance()
```

Also add `cleanupAttendance` to the sign-out cleanup block (around line 393-396).

**Step 5: Add to team-only views list**

In the client role UI adaptation (line 351), make sure 'attendance' is in the `teamOnlyViews` array.

**Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: wire up attendance route and view in main.js"
```

---

### Task 8: Add attendance nav tab to HTML

**Files:**
- Modify: `index.html`

**Step 1: Add nav tab**

In the `<nav class="header-nav">` section, add after the timesheets tab:

```html
<button class="nav-tab" data-view="attendance"><i class="ph-fill ph-calendar-check"></i> <span class="nav-label">Attendance</span></button>
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add Attendance nav tab to header"
```

---

### Task 9: Add attendance CSS styles

**Files:**
- Modify: `src/style.css`

**Step 1: Add styles**

Append to `src/style.css`:

```css
/* ===== Attendance View ===== */

.attendance-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 20px;
}

.attendance-header {
  margin-bottom: 24px;
}

.attendance-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #111);
}

/* Balance Cards */
.attendance-balances {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.balance-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
}

.balance-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.balance-card-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.balance-card-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.balance-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.balance-label {
  font-size: 12px;
  color: #6b7280;
  width: 60px;
  flex-shrink: 0;
}

.balance-bar-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.balance-bar {
  flex: 1;
  height: 8px;
  background: #f3f4f6;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
}

.balance-bar-used {
  height: 100%;
  border-radius: 4px 0 0 4px;
  transition: width 0.3s;
}

.balance-bar-unpaid {
  height: 100%;
  background: #fbbf24;
}

.balance-numbers {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
}

/* Calendar Grid */
.attendance-calendar-section {
  margin-bottom: 32px;
}

.attendance-calendar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.attendance-month-label {
  font-size: 16px;
  font-weight: 600;
  min-width: 160px;
  text-align: center;
}

.attendance-grid {
  display: grid;
  gap: 1px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.att-grid-cell {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  font-size: 12px;
}

.att-grid-name-header {
  background: #f9fafb;
}

.att-grid-day-header {
  background: #f9fafb;
  flex-direction: column;
  padding: 4px 0;
  font-size: 10px;
  color: #6b7280;
}

.att-day-name {
  font-size: 9px;
  text-transform: uppercase;
  color: #9ca3af;
}

.att-day-num {
  font-weight: 500;
  font-size: 11px;
  color: #374151;
}

.att-grid-name {
  justify-content: flex-start;
  padding: 0 10px;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  background: #f9fafb;
  white-space: nowrap;
}

.att-weekend {
  background: #f9fafb !important;
}

.att-weekend.att-grid-day-header {
  opacity: 0.5;
}

.att-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.att-dot-green {
  background: #22c55e;
}

.att-dot-yellow {
  background: #eab308;
}

.att-dot-red {
  background: #ef4444;
}

/* Leave History List */
.attendance-leave-list h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #374151;
}

.attendance-empty {
  color: #9ca3af;
  font-size: 13px;
}

.leave-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
  background: #fff;
}

.leave-list-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.leave-list-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.leave-list-type {
  color: #6b7280;
}

.leave-list-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.leave-list-date {
  font-size: 12px;
  color: #9ca3af;
}

.leave-badge-unpaid {
  font-size: 10px;
  background: #fef3c7;
  color: #92400e;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

/* Leave Modal */
.leave-half-day-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.leave-summary {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: #166534;
}

.leave-summary-warn {
  color: #92400e;
}

.modal-sm {
  max-width: 480px;
}
```

**Step 2: Commit**

```bash
git add src/style.css
git commit -m "feat: add attendance view CSS — balance cards, month grid, leave list, modal"
```

---

### Task 10: Test end-to-end and deploy

**Step 1: Run dev server and test**

Run: `npm run dev`

Test checklist:
- [ ] Navigate to `/attendance` — page loads with balance cards and grid
- [ ] Balance cards show correct accrual (months since joinDate × 1 per type)
- [ ] Click "Request Leave" → modal opens with type toggle, date picker
- [ ] Submit a personal leave → appears on grid as red dot
- [ ] Submit a half-day leave → appears as yellow dot
- [ ] Submit enough personal leaves to exceed balance → shows unpaid warning
- [ ] Admin sees all balance cards; non-admin sees only their own
- [ ] Admin can cancel a leave from the leave history list
- [ ] Month navigation (prev/next) works
- [ ] Weekends are greyed out on grid

**Step 2: Build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 3: Deploy functions**

Run: `firebase deploy --only functions`
Expected: Functions deploy successfully with new leave endpoints.

**Step 4: Deploy indexes and rules**

Run: `firebase deploy --only firestore:indexes,firestore:rules`
Expected: New indexes begin building, rules updated.

**Step 5: Deploy hosting**

Run: `firebase deploy --only hosting`
Expected: Hosting deployed, attendance view accessible at work.publicknowledge.co.

**Step 6: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat: complete attendance & leave management feature"
```
