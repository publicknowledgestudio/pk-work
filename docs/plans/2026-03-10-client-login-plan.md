# Client Login — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow external client users to log in via Google, view their projects' kanban board, edit tasks, and see aggregated timesheets — scoped to their client org.

**Architecture:** Extend existing Firebase Auth (Google sign-in) + Firestore rules. A new `clientUsers/{email}` allowlist collection determines access. The web app detects user role post-login and renders either the team UI or a simplified client UI. No API changes needed.

**Tech Stack:** Vite + vanilla JS, Firebase Auth, Firestore, Firestore security rules

**Design doc:** `docs/plans/2026-03-10-client-login-design.md`

---

### Task 0: Firestore Rules — Add client user helpers and update all collection rules

**Files:**
- Modify: `firestore.rules`

**Step 1: Add helper functions after `isTeamMember()`**

Add these two functions inside the `match /databases/{database}/documents` block, right after the `isTeamMember()` function (after line 14):

```javascript
function isClientUser() {
  return request.auth != null &&
    exists(/databases/$(database)/documents/clientUsers/$(request.auth.token.email));
}

function clientIdForUser() {
  return get(/databases/$(database)/documents/clientUsers/$(request.auth.token.email)).data.clientId;
}
```

**Step 2: Add `clientUsers` collection rules**

Add after the `users` match block (after line 87):

```javascript
// Client users (allowlist for external client login)
match /clientUsers/{email} {
  allow read, write: if isTeamMember();
  allow read: if isClientUser() && email == request.auth.token.email;
}
```

**Step 3: Update `tasks` rules to allow client access**

Replace the tasks match block (lines 17-22) with:

```javascript
match /tasks/{taskId} {
  allow read: if isTeamMember();
  allow read: if isClientUser() && resource.data.clientId == clientIdForUser();
  allow create: if isTeamMember();
  allow create: if isClientUser() && request.resource.data.clientId == clientIdForUser();
  allow update: if isTeamMember();
  allow update: if isClientUser() && resource.data.clientId == clientIdForUser()
                   && request.resource.data.clientId == clientIdForUser();
  allow delete: if isTeamMember();
}
```

**Step 4: Update `projects` rules**

Replace the projects match block (lines 44-48) with:

```javascript
match /projects/{projectId} {
  allow read: if isTeamMember();
  allow read: if isClientUser() && resource.data.clientId == clientIdForUser();
  allow write: if isTeamMember();
}
```

**Step 5: Update `clients` rules**

Replace the clients match block (lines 38-42) with:

```javascript
match /clients/{clientId} {
  allow read: if isTeamMember();
  allow read: if isClientUser() && clientId == clientIdForUser();
  allow write: if isTeamMember();
}
```

**Step 6: Deploy rules**

Run: `firebase deploy --only firestore:rules`
Expected: Deploy succeeds. Rules now support both team and client users.

**Step 7: Commit**

```bash
git add firestore.rules
git commit -m "feat: add client user Firestore rules with scoped access"
```

---

### Task 1: Firestore Index — Add clientUsers composite index

**Files:**
- Modify: `firestore.indexes.json`

**Step 1: Add the new index**

Add this entry to the `indexes` array in `firestore.indexes.json`:

```json
{
  "collectionGroup": "clientUsers",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "clientId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**Step 2: Deploy indexes**

Run: `firebase deploy --only firestore:indexes`
Expected: Index creation starts (may take a few minutes to build).

**Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat: add clientUsers composite index"
```

---

### Task 2: DB Layer — Add clientUsers CRUD functions

**Files:**
- Modify: `src/db.js`

**Step 1: Add clientUsers functions**

Add the following at the end of `src/db.js`, before the `// ===== Moodboards =====` section (or at the end of the file):

```javascript
// ===== Client Users =====

export async function loadClientUser(db, email) {
  const snap = await getDoc(doc(db, 'clientUsers', email))
  if (snap.exists()) return { id: snap.id, ...snap.data() }
  return null
}

export async function loadClientUsers(db) {
  const q = query(collection(db, 'clientUsers'), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createClientUser(db, email, data) {
  return setDoc(doc(db, 'clientUsers', email.toLowerCase()), {
    email: email.toLowerCase(),
    name: data.name || '',
    clientId: data.clientId,
    invitedBy: data.invitedBy || '',
    createdAt: serverTimestamp(),
  })
}

export async function deleteClientUser(db, email) {
  return deleteDoc(doc(db, 'clientUsers', email))
}

export function subscribeToClientUsers(db, callback) {
  const q = query(collection(db, 'clientUsers'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}
```

**Step 2: Commit**

```bash
git add src/db.js
git commit -m "feat: add clientUsers CRUD to db layer"
```

---

### Task 3: Auth Flow — Role detection and client routing in main.js

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

**Step 1: Add imports**

At the top of `src/main.js`, add `loadClientUser` to the db.js import:

```javascript
import { loadClients, loadProjects, loadPeople, subscribeToTasks, saveUserProfile, loadUserProfiles, updateTask, loadClientUser } from './db.js'
```

Add a new import for the client board and client timesheets (we'll create these files in later tasks — for now just add the imports and we'll stub them):

```javascript
import { renderClientBoard } from './client-board.js'
import { renderClientTimesheets } from './client-timesheets.js'
```

**Step 2: Add role state variables**

After line 34 (`let allTasks = []`), add:

```javascript
let userRole = null       // 'team' | 'client' | null
let userClientId = null   // only set for client users
let userClientName = null // client org name
```

**Step 3: Remove the `hd` restriction from Google provider**

Find this line (line 206):
```javascript
provider.setCustomParameters({ hd: 'publicknowledge.co' })
```

Remove the `hd` parameter — change it to:
```javascript
provider.setCustomParameters({ prompt: 'select_account' })
```

This allows any Google account to sign in but keeps the account chooser.

**Step 4: Update onAuthStateChanged to detect role**

Replace the `onAuthStateChanged` callback (lines 246-304). The key changes are:
1. After Firebase auth, check if the user is a team member or client user
2. If client user, set `userRole = 'client'`, load their clientId, hide team-only UI
3. If neither, show access denied and sign out

In the `if (user)` branch, after setting `currentUser = user` and before loading reference data, add role detection:

```javascript
// Detect user role
if (user.email.endsWith('@publicknowledge.co')) {
  userRole = 'team'
  userClientId = null
  userClientName = null
} else {
  // Check clientUsers allowlist
  const clientUserDoc = await loadClientUser(db, user.email)
  if (clientUserDoc) {
    userRole = 'client'
    userClientId = clientUserDoc.clientId
  } else {
    // Not authorized — sign out
    userRole = null
    const loginNote = document.querySelector('.login-note')
    if (loginNote) loginNote.textContent = 'Access denied. Contact your project manager for an invitation.'
    await signOut(auth)
    return
  }
}
```

After loading clients (the `clients = await loadClients(db)` line), add:

```javascript
// Resolve client name for client users
if (userRole === 'client' && userClientId) {
  const clientDoc = clients.find((c) => c.id === userClientId)
  userClientName = clientDoc?.name || 'Client'
}
```

**Step 5: Adapt header and nav for client role**

After role detection and before `handleRouteChange()`, add UI adaptation:

```javascript
// Adapt UI for client role
if (userRole === 'client') {
  // Update header logo
  const headerLogo = document.querySelector('.header-logo')
  if (headerLogo) headerLogo.innerHTML = `PK<span class="header-logo-dot">.</span> <span class="header-logo-client">for ${esc(userClientName)}</span>`

  // Hide team-only nav tabs
  navTabs.forEach((tab) => {
    const view = tab.dataset.view
    const clientViews = ['client-board', 'client-timesheets']
    const teamOnlyViews = ['my-day', 'my-tasks', 'board', 'standup', 'timesheets', 'people', 'wiki', 'references', 'clients']
    if (teamOnlyViews.includes(view)) tab.style.display = 'none'
  })

  // Hide team-only header controls
  const filterGroup = document.getElementById('filter-group')
  if (filterGroup) filterGroup.style.display = 'none'
  newTaskBtn.style.display = 'none'
}
```

**Step 6: Add client routes**

Add to the `ROUTES` object:

```javascript
'/client-board':      { view: 'client-board' },
'/client-timesheets': { view: 'client-timesheets' },
```

Add to `VIEW_TO_PATH`:

```javascript
'client-board': '/client-board',
'client-timesheets': '/client-timesheets',
```

**Step 7: Update handleRouteChange default**

In `handleRouteChange()`, change the default route based on role:

```javascript
} else {
  currentView = userRole === 'client' ? 'client-board' : 'my-day'
  history.replaceState(null, '', userRole === 'client' ? '#/client-board' : '#/my-day')
}
```

**Step 8: Add client views to renderCurrentView switch**

In the `switch (currentView)` block in `renderCurrentView()`, add:

```javascript
case 'client-board':
  renderClientBoard(mainContent, tasks, { ...ctx, userClientId, userClientName })
  break
case 'client-timesheets':
  renderClientTimesheets(mainContent, allTasks, { ...ctx, userClientId, userClientName })
  break
```

**Step 9: Update index.html — add client nav tabs**

In `index.html`, inside the `<nav class="header-nav">` block, add client nav tabs (they'll be hidden for team users via JS):

After the existing nav tabs but before `</nav>`, add:

```html
<button class="nav-tab client-nav hidden" data-view="client-board"><i class="ph-fill ph-columns"></i> <span class="nav-label">Board</span></button>
<button class="nav-tab client-nav hidden" data-view="client-timesheets"><i class="ph-fill ph-receipt"></i> <span class="nav-label">Timesheets</span></button>
```

Back in `main.js`, in the client role adaptation code, show client nav tabs:

```javascript
document.querySelectorAll('.client-nav').forEach((tab) => {
  tab.style.display = ''
  tab.classList.remove('hidden')
})
```

**Step 10: Update login screen note**

In `index.html`, change the login note (line 26):
```html
<p class="login-note">Sign in with your Google account</p>
```

**Step 11: Commit**

```bash
git add src/main.js index.html
git commit -m "feat: role detection, client routing, and adapted header/nav"
```

---

### Task 4: Client Board View — New file `src/client-board.js`

**Files:**
- Create: `src/client-board.js`

**Step 1: Create the client board module**

This is a simplified version of `board.js` with the `clientId` filter locked and no client/assignee sub-nav. The kanban columns are the same 5 statuses. Task cards are clickable to open the existing modal. Inline add-task auto-sets `clientId`.

```javascript
import { STATUSES, TEAM } from './config.js'
import { createTask, updateTask } from './db.js'
import { openModal } from './modal.js'
import { attachMention } from './mention.js'

export function renderClientBoard(container, tasks, ctx) {
  const clientId = ctx.userClientId
  const clientTasks = tasks.filter((t) => t.clientId === clientId)

  // Project filter for client's projects only
  const clientProjects = ctx.projects.filter((p) => p.clientId === clientId)
  let selectedProjectId = ''

  function render() {
    const filtered = selectedProjectId
      ? clientTasks.filter((t) => t.projectId === selectedProjectId)
      : clientTasks

    container.innerHTML = `
      <div class="client-board-view">
        <div class="client-board-header">
          <h2>Public Knowledge for ${esc(ctx.userClientName)}</h2>
          ${clientProjects.length > 1 ? `
            <select class="form-select client-project-filter" id="client-project-filter">
              <option value="">All Projects</option>
              ${clientProjects.map((p) => `<option value="${p.id}"${p.id === selectedProjectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          ` : ''}
        </div>
        <div class="board">
          ${STATUSES.map((s) => `
            <div class="column" data-status="${s.id}">
              <div class="column-header">
                <span class="column-dot" style="background:${s.color}"></span>
                <span class="column-label">${s.label}</span>
                <span class="column-count">${filtered.filter((t) => t.status === s.id).length}</span>
              </div>
              <div class="column-tasks" data-status="${s.id}">
                ${filtered.filter((t) => t.status === s.id)
                  .map((t) => taskCard(t, ctx))
                  .join('')}
              </div>
              <div class="column-add-wrap" data-status="${s.id}">
                <input class="column-add-input" data-status="${s.id}" placeholder="+ Add task (@ to tag)" type="text">
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `

    // Project filter
    const filterEl = container.querySelector('#client-project-filter')
    if (filterEl) {
      filterEl.addEventListener('change', () => {
        selectedProjectId = filterEl.value
        render()
      })
    }

    // Task card clicks
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.status-btn')) return
        const task = clientTasks.find((t) => t.id === card.dataset.id)
        if (task) openModal(task, ctx)
      })
    })

    // Inline add-task with mention support
    container.querySelectorAll('.column-add-input').forEach((input) => {
      const mention = attachMention(input, { projects: clientProjects, clients: ctx.clients })
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !mention.isOpen()) {
          const title = input.value.trim()
          if (!title) return
          const mentionTags = mention.getTags()
          input.disabled = true
          await createTask(ctx.db, {
            title,
            status: input.dataset.status,
            assignees: mentionTags.assignees,
            clientId,
            projectId: mentionTags.projectId || selectedProjectId || '',
            createdBy: ctx.currentUser?.email || '',
          })
          input.value = ''
          input.disabled = false
          mention.reset()
          input.focus()
        }
        if (e.key === 'Escape' && !mention.isOpen()) {
          input.value = ''
          input.blur()
        }
      })
    })

    // Drag and drop
    container.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id)
        e.dataTransfer.effectAllowed = 'move'
        card.classList.add('dragging')
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging')
        container.querySelectorAll('.column-tasks').forEach((col) => col.classList.remove('drag-over'))
      })
    })

    container.querySelectorAll('.column-tasks').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        col.classList.add('drag-over')
      })
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'))
      col.addEventListener('drop', async (e) => {
        e.preventDefault()
        col.classList.remove('drag-over')
        const taskId = e.dataTransfer.getData('text/plain')
        const newStatus = col.dataset.status
        if (taskId && newStatus) {
          await updateTask(ctx.db, taskId, { status: newStatus })
        }
      })
    })
  }

  render()
}

function taskCard(task, ctx) {
  const project = task.projectId ? ctx.projects.find((p) => p.id === task.projectId) : null
  const client = project?.clientId ? ctx.clients.find((c) => c.id === project.clientId) : null
  const assigneeAvatars = (task.assignees || []).map((email) => {
    const m = TEAM.find((t) => t.email === email)
    if (!m) return ''
    return m.photoURL
      ? `<img class="avatar-photo-xs" src="${m.photoURL}" alt="${m.name}" title="${m.name}">`
      : `<span class="avatar-xs" style="background:${m.color}" title="${m.name}">${m.name[0]}</span>`
  }).join('')

  const priorityBadge = task.priority === 'urgent' || task.priority === 'high'
    ? `<span class="priority-badge priority-${task.priority}">${task.priority}</span>`
    : ''

  const projectLabel = project ? `<span class="task-card-project">${esc(project.name)}</span>` : ''

  return `
    <div class="task-card" data-id="${task.id}" draggable="true">
      <div class="task-card-top">
        ${projectLabel}
        ${priorityBadge}
      </div>
      <div class="task-card-title">${esc(task.title)}</div>
      <div class="task-card-bottom">
        <div class="task-card-avatars">${assigneeAvatars}</div>
      </div>
    </div>
  `
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
```

**Step 2: Commit**

```bash
git add src/client-board.js
git commit -m "feat: add client board view (kanban scoped to client org)"
```

---

### Task 5: Client Timesheets View — New file `src/client-timesheets.js`

**Files:**
- Create: `src/client-timesheets.js`

**Step 1: Create the client timesheets module**

This is a simplified version of `timesheets.js` that auto-locks to the client's org, hides the "Logged by" column (aggregated only — no per-person breakdown), and removes the client picker.

```javascript
import { loadAllDailyFocusForRange } from './db.js'

let currentMonth = ''

export async function renderClientTimesheets(container, tasks, ctx) {
  const clientId = ctx.userClientId

  if (!currentMonth) {
    const now = new Date()
    currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  container.innerHTML = `
    <div class="timesheets-view">
      <div class="timesheets-header">
        <h2>Timesheets</h2>
        <p>Time tracked for your projects</p>
      </div>
      <div class="timesheets-controls">
        <div class="timesheets-control-group">
          <label class="form-label">Month</label>
          <input type="month" id="cts-month" class="form-input" value="${currentMonth}">
        </div>
        <div class="timesheets-control-group ts-generate-group">
          <button class="btn-ghost ts-print-btn hidden" id="cts-print">
            <i class="ph ph-printer"></i> Print
          </button>
        </div>
      </div>
      <div id="cts-result"></div>
    </div>
  `

  const monthInput = document.getElementById('cts-month')
  const printBtn = document.getElementById('cts-print')

  monthInput.addEventListener('change', () => {
    currentMonth = monthInput.value
    generate(container, tasks, ctx, clientId)
  })

  printBtn.addEventListener('click', () => window.print())

  generate(container, tasks, ctx, clientId)
}

async function generate(container, tasks, ctx, clientId) {
  const resultEl = document.getElementById('cts-result')
  const printBtn = document.getElementById('cts-print')
  if (!resultEl) return

  if (!currentMonth || !/^\d{4}-\d{2}$/.test(currentMonth)) {
    resultEl.innerHTML = '<div class="ts-empty">Please select a valid month.</div>'
    printBtn?.classList.add('hidden')
    return
  }

  resultEl.innerHTML = '<div class="ts-loading"><i class="ph ph-spinner"></i> Loading...</div>'

  try {
    const data = await generateTimesheet(ctx, tasks, clientId, currentMonth)
    renderTable(resultEl, data, ctx)
    printBtn?.classList.toggle('hidden', data.lineItems.length === 0)
  } catch (err) {
    console.error('Client timesheet error:', err)
    resultEl.innerHTML = '<div class="ts-empty">Error generating timesheet.</div>'
    printBtn?.classList.add('hidden')
  }
}

async function generateTimesheet(ctx, tasks, clientId, monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const clientProjectIds = new Set(
    ctx.projects.filter((p) => p.clientId === clientId).map((p) => p.id)
  )
  const clientTaskIds = new Set(
    tasks.filter((t) => t.clientId === clientId || (t.projectId && clientProjectIds.has(t.projectId))).map((t) => t.id)
  )

  const focusDocs = await loadAllDailyFocusForRange(ctx.db, startDate, endDate)

  // Aggregate time per task (no per-person breakdown)
  const taskTimeMap = {}
  for (const doc of focusDocs) {
    for (const block of (doc.timeBlocks || [])) {
      if (!clientTaskIds.has(block.taskId)) continue
      if (!taskTimeMap[block.taskId]) taskTimeMap[block.taskId] = { totalMinutes: 0, dates: new Set() }
      const minutes = durationMinutes(block.start, block.end)
      taskTimeMap[block.taskId].totalMinutes += minutes
      taskTimeMap[block.taskId].dates.add(doc.date)
    }
  }

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
        status: task?.status || '',
        project: project?.name || '',
        totalMinutes: data.totalMinutes,
        dateCount: data.dates.size,
        rate,
        currency,
      }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)

  const totalMinutes = lineItems.reduce((sum, i) => sum + i.totalMinutes, 0)
  const ratedItems = lineItems.filter((i) => i.rate > 0)
  const currencies = [...new Set(ratedItems.map((i) => i.currency))]
  const totalAmount = currencies.length <= 1 ? ratedItems.reduce((sum, i) => sum + (i.totalMinutes / 60) * i.rate, 0) : null
  const currency = currencies.length === 1 ? currencies[0] : client?.currency || 'INR'

  return { clientId, month: monthStr, lineItems, totalMinutes, totalAmount, currency }
}

function renderTable(container, data, ctx) {
  if (!data || data.lineItems.length === 0) {
    const client = ctx.clients.find((c) => c.id === data?.clientId)
    container.innerHTML = `
      <div class="ts-empty">
        <i class="ph ph-clipboard-text" style="font-size:32px;opacity:0.3"></i>
        <p>No tracked time found for ${formatMonth(data?.month || '')}.</p>
      </div>
    `
    return
  }

  const client = ctx.clients.find((c) => c.id === data.clientId)
  const hasRates = data.lineItems.some((i) => i.rate > 0)

  container.innerHTML = `
    <div class="ts-sheet">
      <div class="ts-sheet-header">
        <div class="ts-sheet-title">
          ${client?.logoUrl ? `<img class="client-logo" src="${esc(client.logoUrl)}" alt="${esc(client.name)}">` : ''}
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
            <th>Project</th>
            <th>Status</th>
            <th class="ts-col-time">Time</th>
            ${hasRates ? '<th class="ts-col-amount">Amount</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.lineItems.map((item, i) => {
            const hours = item.totalMinutes / 60
            const amount = item.rate > 0 ? hours * item.rate : 0
            const statusLabel = item.status.replace('_', ' ')
            return `
              <tr>
                <td class="ts-col-num">${i + 1}</td>
                <td class="ts-col-task">${esc(item.title)}</td>
                <td>${esc(item.project)}</td>
                <td><span class="ts-status ts-status-${item.status}">${esc(statusLabel)}</span></td>
                <td class="ts-col-time">${formatDuration(item.totalMinutes)}</td>
                ${hasRates ? `<td class="ts-col-amount">${item.rate > 0 ? formatCurrency(amount, item.currency) : ''}</td>` : ''}
              </tr>
            `
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="ts-total-row">
            <td colspan="${4}" class="ts-total-label">Total</td>
            <td class="ts-col-time"><strong>${formatDuration(data.totalMinutes)}</strong></td>
            ${hasRates ? `<td class="ts-col-amount"><strong>${data.totalAmount != null ? formatCurrency(data.totalAmount, data.currency) : '\u2014'}</strong></td>` : ''}
          </tr>
        </tfoot>
      </table>
    </div>
  `
}

function durationMinutes(s, e) {
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  let d = (eh * 60 + em) - (sh * 60 + sm)
  if (d < 0) d += 24 * 60
  return Math.max(0, d)
}

function formatDuration(m) {
  if (m <= 0) return '0m'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

function formatCurrency(amount, currency) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: currency || 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount)
}

function formatMonth(ms) {
  if (!ms) return ''
  const [y, m] = ms.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
```

**Step 2: Commit**

```bash
git add src/client-timesheets.js
git commit -m "feat: add client timesheets view (aggregated, no per-person)"
```

---

### Task 6: Client User Management — Add section to Manage page

**Files:**
- Modify: `src/clients.js`
- Modify: `src/db.js` (already done in Task 2)

**Step 1: Add imports to clients.js**

Add `createClientUser`, `deleteClientUser`, `subscribeToClientUsers` to the import from `./db.js`:

```javascript
import {
  createClient, updateClient, deleteClient,
  createProject, updateProject, deleteProject,
  subscribeToClients, subscribeToProjects, uploadClientLogo,
  updateProjectContent,
  createClientUser, deleteClientUser, subscribeToClientUsers,
} from './db.js'
```

**Step 2: Add state variables**

After line 25 (`let projectIsEditing = false`), add:

```javascript
let unsubClientUsers = null
let localClientUsers = []
```

**Step 3: Add Client Users section to the HTML**

In `renderClients()`, inside the `clients-sections` div (after the Projects section), add a third section:

```html
<div class="clients-section">
  <div class="section-title-row">
    <h3 class="section-title">Client Users</h3>
    <button class="btn-primary" id="add-client-user-btn"><i class="ph ph-plus"></i> Invite</button>
  </div>
  <div id="add-client-user-form" class="inline-form hidden">
    <input type="email" id="new-cu-email" class="form-input" placeholder="Email address">
    <input type="text" id="new-cu-name" class="form-input" placeholder="Name">
    <select id="new-cu-client" class="form-select">
      <option value="">Select client...</option>
    </select>
    <div class="inline-form-actions">
      <button class="btn-primary" id="save-cu-btn">Invite</button>
      <button class="btn-ghost" id="cancel-cu-btn">Cancel</button>
    </div>
  </div>
  <div id="client-users-list"></div>
</div>
```

**Step 4: Subscribe to client users**

In `renderClients()`, after the `unsubProjects = subscribeToProjects(...)` line, add:

```javascript
unsubClientUsers = subscribeToClientUsers(ctx.db, (users) => {
  localClientUsers = users
  renderClientUsersList()
  updateCUClientDropdown()
})
```

**Step 5: Wire up add/cancel/save for client users**

Add the following event handlers in `renderClients()`, after the project event handlers:

```javascript
// Add client user
const addCUBtn = document.getElementById('add-client-user-btn')
const addCUForm = document.getElementById('add-client-user-form')
const newCUEmail = document.getElementById('new-cu-email')
const newCUName = document.getElementById('new-cu-name')
const newCUClient = document.getElementById('new-cu-client')
const saveCUBtn = document.getElementById('save-cu-btn')
const cancelCUBtn = document.getElementById('cancel-cu-btn')

addCUBtn.addEventListener('click', () => {
  newCUEmail.value = ''
  newCUName.value = ''
  newCUClient.value = ''
  addCUForm.classList.remove('hidden')
  newCUEmail.focus()
})

cancelCUBtn.addEventListener('click', () => addCUForm.classList.add('hidden'))

saveCUBtn.addEventListener('click', async () => {
  const email = newCUEmail.value.trim().toLowerCase()
  const name = newCUName.value.trim()
  const clientId = newCUClient.value
  if (!email || !name || !clientId) return
  saveCUBtn.disabled = true
  saveCUBtn.textContent = 'Inviting...'
  try {
    await createClientUser(ctx.db, email, {
      name,
      clientId,
      invitedBy: ctx.currentUser?.email || '',
    })
  } catch (err) {
    console.error('Error inviting client user:', err)
  }
  newCUEmail.value = ''
  newCUName.value = ''
  newCUClient.value = ''
  addCUForm.classList.add('hidden')
  saveCUBtn.disabled = false
  saveCUBtn.textContent = 'Invite'
})

newCUEmail.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCUBtn.click()
  if (e.key === 'Escape') cancelCUBtn.click()
})
```

**Step 6: Add helper functions**

Add these functions inside `clients.js`:

```javascript
function updateCUClientDropdown() {
  const dropdown = document.getElementById('new-cu-client')
  if (!dropdown) return
  const val = dropdown.value
  dropdown.innerHTML = '<option value="">Select client...</option>'
  localClients.forEach((c) => {
    dropdown.innerHTML += `<option value="${c.id}">${c.name}</option>`
  })
  dropdown.value = val
}

function renderClientUsersList() {
  const list = document.getElementById('client-users-list')
  if (!list) return

  if (localClientUsers.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-text">No client users yet. Invite someone to give them access.</div></div>'
    return
  }

  list.innerHTML = localClientUsers.map((cu) => {
    const client = localClients.find((c) => c.id === cu.clientId)
    const inviter = TEAM.find((m) => m.email === cu.invitedBy)
    return `
      <div class="client-row" data-email="${cu.email}">
        <div class="client-row-info">
          <span class="client-row-name">${escHtml(cu.name)}</span>
          <span class="client-row-meta">${escHtml(cu.email)} · ${client ? escHtml(client.name) : 'Unknown client'}${inviter ? ' · Invited by ' + escHtml(inviter.name) : ''}</span>
        </div>
        <div class="client-row-actions">
          <button class="btn-ghost cu-delete" data-email="${cu.email}" data-name="${escHtml(cu.name)}"><i class="ph ph-trash"></i></button>
        </div>
      </div>
    `
  }).join('')

  list.querySelectorAll('.cu-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (confirm(`Remove access for "${btn.dataset.name}"?`)) {
        await deleteClientUser(currentCtx.db, btn.dataset.email)
      }
    })
  })
}
```

**Step 7: Update cleanup**

In `cleanupClients()`, add:

```javascript
if (unsubClientUsers) { unsubClientUsers(); unsubClientUsers = null }
```

**Step 8: Commit**

```bash
git add src/clients.js
git commit -m "feat: add client user management to Manage page"
```

---

### Task 7: CSS — Add client-specific styles

**Files:**
- Modify: `src/style.css`

**Step 1: Add client header styles**

Add to `src/style.css`:

```css
/* Client header */
.header-logo-client {
  font-weight: 400;
  font-size: 13px;
  color: var(--text-secondary);
  margin-left: 4px;
}

/* Client board header */
.client-board-view .client-board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 8px;
}

.client-board-view .client-board-header h2 {
  font-size: 18px;
  font-weight: 600;
}

.client-project-filter {
  min-width: 160px;
}

/* Client timesheet status badges */
.ts-status {
  font-size: 11px;
  text-transform: capitalize;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  white-space: nowrap;
}
.ts-status-done { background: rgba(34,197,94,0.1); color: #16a34a; }
.ts-status-in_progress { background: rgba(245,158,11,0.1); color: #d97706; }
.ts-status-review { background: rgba(139,92,246,0.1); color: #7c3aed; }
.ts-status-todo { background: rgba(59,130,246,0.1); color: #2563eb; }
.ts-status-backlog { background: rgba(107,114,128,0.1); color: #6b7280; }
```

**Step 2: Commit**

```bash
git add src/style.css
git commit -m "feat: add client-specific CSS styles"
```

---

### Task 8: Subscribed Task Query — Client users need scoped subscription

**Files:**
- Modify: `src/main.js`
- Modify: `src/db.js`

**Step 1: Add scoped task subscription to db.js**

Add to `src/db.js`:

```javascript
export function subscribeToTasksByClient(db, clientId, callback) {
  const q = query(
    collection(db, 'tasks'),
    where('clientId', '==', clientId),
    orderBy('updatedAt', 'desc')
  )
  return onSnapshot(q, (snap) => {
    const tasks = snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }))
    callback(tasks)
  })
}
```

**Step 2: Update main.js subscription for client users**

In `main.js`, change the `subscribeToTasks` call to be role-aware:

```javascript
// Subscribe to tasks (real-time) — scoped for client users
if (userRole === 'client') {
  unsubTasks = subscribeToTasksByClient(db, userClientId, (tasks) => {
    allTasks = tasks
    renderCurrentView()
  })
} else {
  unsubTasks = subscribeToTasks(db, (tasks) => {
    allTasks = tasks
    renderCurrentView()
  })
}
```

Also add `subscribeToTasksByClient` to the import from `db.js`.

**Step 3: Commit**

```bash
git add src/db.js src/main.js
git commit -m "feat: scoped task subscription for client users"
```

---

### Task 9: End-to-End Testing — Manual test checklist

**Files:**
- No code changes — manual testing

**Test Plan:**

1. **Team login still works:**
   - Sign in with @publicknowledge.co account
   - Verify all existing views work (My Day, Board, Standup, Timesheets, etc.)
   - Verify "PK." header shows (not "PK. for ...")

2. **Invite a client user:**
   - Go to Manage page
   - See "Client Users" section
   - Click "Invite", fill in email/name/client, save
   - Verify user appears in list

3. **Client login works:**
   - Open incognito window
   - Sign in with the invited Google account
   - Verify header shows "PK. for [Client Name]"
   - Verify only Board and Timesheets tabs are visible

4. **Client board is scoped:**
   - Verify only tasks with matching clientId are visible
   - Create a task — verify it auto-sets clientId
   - Drag task between columns — verify status updates
   - Click task — verify modal opens with full edit

5. **Client timesheets are scoped:**
   - Switch to Timesheets tab
   - Select a month with tracked time
   - Verify aggregated view (no "Logged by" column)

6. **Access denied for unknown users:**
   - Sign in with a Google account NOT in clientUsers and NOT @publicknowledge.co
   - Verify "Access denied" message appears and user is signed out

7. **Revoke access:**
   - As team member, delete the client user from Manage
   - Refresh client browser — verify they can no longer access the app

**Step 1: Deploy and test**

```bash
npm run build
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

**Step 2: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found during client login testing"
```

---

### Task 10: Update CLAUDE.md — Document client login feature

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add clientUsers to Firestore Collections section**

Add after the `moodboards` entry:

```
- **clientUsers** — email (doc ID), name, clientId, invitedBy, createdAt
```

**Step 2: Add client routes to Project Structure notes**

Add a note about the new files:

```
  client-board.js       Client kanban board (scoped to client org)
  client-timesheets.js  Client timesheets (aggregated, no per-person)
```

**Step 3: Add client login section**

Add a new section "## Client Login" documenting:
- `clientUsers/{email}` allowlist pattern
- Role detection flow
- Client routes: `#client-board`, `#client-timesheets`
- Scoped Firestore rules (isClientUser, clientIdForUser)

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document client login feature in CLAUDE.md"
```
