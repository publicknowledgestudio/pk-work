import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  Timestamp,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'

// Current user email — set once on login by main.js. Lets updateTask
// stamp updatedBy without threading the email through every call site.
let currentUserEmail = ''
export function setCurrentUser(email) { currentUserEmail = email || '' }

// ===== User Profiles =====

export async function saveUserProfile(db, email, data) {
  return setDoc(doc(db, 'users', email), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function loadUserProfiles(db) {
  const snap = await getDocs(collection(db, 'users'))
  const profiles = {}
  snap.docs.forEach((d) => {
    profiles[d.id] = d.data()
  })
  return profiles
}

// ===== Clients =====

export async function loadClients(db) {
  const snap = await getDocs(query(collection(db, 'clients'), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function loadClientById(db, clientId) {
  const snap = await getDoc(doc(db, 'clients', clientId))
  if (snap.exists()) return [{ id: snap.id, ...snap.data() }]
  return []
}

export async function createClient(db, data) {
  return addDoc(collection(db, 'clients'), {
    name: data.name,
    logoUrl: data.logoUrl || '',
    defaultHourlyRate: data.defaultHourlyRate || 0,
    currency: data.currency || 'INR',
    slackChannelId: data.slackChannelId || '',
    createdAt: serverTimestamp(),
  })
}

export async function updateClient(db, clientId, data) {
  return updateDoc(doc(db, 'clients', clientId), data)
}

export async function deleteClient(db, clientId) {
  return deleteDoc(doc(db, 'clients', clientId))
}

export async function uploadClientLogo(file, clientId) {
  const storage = getStorage()
  const storageRef = ref(storage, `client-logos/${clientId}`)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}

export function subscribeToClients(db, callback) {
  const q = query(collection(db, 'clients'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export function subscribeToProjects(db, callback) {
  const q = query(collection(db, 'projects'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function updateProject(db, projectId, data) {
  return updateDoc(doc(db, 'projects', projectId), data)
}

export async function deleteProject(db, projectId) {
  return deleteDoc(doc(db, 'projects', projectId))
}

// ===== Projects =====

export async function loadProjects(db) {
  const snap = await getDocs(query(collection(db, 'projects'), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function loadProjectsByClient(db, clientId) {
  const snap = await getDocs(query(collection(db, 'projects'), where('clientId', '==', clientId), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createProject(db, data) {
  return addDoc(collection(db, 'projects'), {
    name: data.name,
    clientId: data.clientId || '',
    hourlyRate: data.hourlyRate || 0,
    currency: data.currency || 'INR',
    slackChannelId: data.slackChannelId || '',
    createdAt: serverTimestamp(),
  })
}

// ===== People =====

export function subscribeToPeople(db, callback) {
  const q = query(collection(db, 'people'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function loadPeople(db) {
  const snap = await getDocs(query(collection(db, 'people'), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createPerson(db, data) {
  return addDoc(collection(db, 'people'), {
    name: data.name || '',
    email: data.email || '',
    type: data.type || 'external',
    role: data.role || '',
    organization: data.organization || '',
    clientIds: data.clientIds || [],
    tags: data.tags || [],
    content: data.content || '',
    contentUpdatedAt: null,
    contentUpdatedBy: '',
    photoURL: data.photoURL || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updatePerson(db, personId, data) {
  return updateDoc(doc(db, 'people', personId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deletePerson(db, personId) {
  return deleteDoc(doc(db, 'people', personId))
}

export async function updatePersonContent(db, personId, content, updatedBy) {
  return updateDoc(doc(db, 'people', personId), {
    content,
    contentUpdatedAt: serverTimestamp(),
    contentUpdatedBy: updatedBy,
    updatedAt: serverTimestamp(),
  })
}

export async function updateProjectContent(db, projectId, content, updatedBy) {
  return updateDoc(doc(db, 'projects', projectId), {
    content,
    contentUpdatedAt: serverTimestamp(),
    contentUpdatedBy: updatedBy,
    updatedAt: serverTimestamp(),
  })
}

// ===== Tasks =====

// Normalize a task document read from Firestore into the shape the
// frontend uses. Two things happen here:
//   1. Backward compat — convert old `assignee` (single string) to the
//      `assignees` (array) shape.
//   2. Timestamp normalization — coerce every date-like field to an ISO
//      string. Firestore returns Timestamp objects; the REST API (see
//      functions/index.js) already returns ISO strings. Normalizing at
//      the read boundary means the rest of the app sees one shape and
//      doesn't need to shape-sniff.
const TASK_TIMESTAMP_FIELDS = ['deadline', 'createdAt', 'updatedAt', 'closedAt']

export function normalizeTask(task) {
  if (!task.assignees) {
    task.assignees = task.assignee ? [task.assignee] : []
  }
  for (const field of TASK_TIMESTAMP_FIELDS) {
    const v = task[field]
    if (v == null) continue
    if (typeof v === 'string') continue // already ISO
    if (typeof v.toDate === 'function') {
      task[field] = v.toDate().toISOString()
    } else if (typeof v.seconds === 'number') {
      task[field] = new Date(v.seconds * 1000).toISOString()
    }
  }
  return task
}

export function subscribeToTasks(db, callback) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  const cutoffTs = Timestamp.fromDate(cutoff)

  // Active tasks (everything not done)
  const activeQ = query(
    collection(db, 'tasks'),
    where('status', 'in', ['backlog', 'todo', 'in_progress', 'review']),
    orderBy('updatedAt', 'desc')
  )
  // Recent done tasks (closed in last 14 days)
  const doneQ = query(
    collection(db, 'tasks'),
    where('status', '==', 'done'),
    where('closedAt', '>=', cutoffTs),
    orderBy('closedAt', 'desc')
  )

  let activeTasks = []
  let doneTasks = []
  const merge = () => {
    const seen = new Set()
    const merged = []
    for (const t of [...activeTasks, ...doneTasks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id)
        merged.push(t)
      }
    }
    callback(merged)
  }

  const unsub1 = onSnapshot(activeQ, (snap) => {
    activeTasks = snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }))
    merge()
  })
  const unsub2 = onSnapshot(doneQ, (snap) => {
    doneTasks = snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }))
    merge()
  })

  return () => { unsub1(); unsub2() }
}

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

export async function createTask(db, data) {
  const assignees = data.assignees || (data.assignee ? [data.assignee] : [])
  return addDoc(collection(db, 'tasks'), {
    title: data.title,
    description: data.description || '',
    clientId: data.clientId || '',
    projectId: data.projectId || '',
    assignees,
    status: data.status || 'todo',
    priority: data.priority || 'medium',
    deadline: data.deadline ? Timestamp.fromDate(new Date(data.deadline)) : null,
    notes: data.notes || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: null,
    createdBy: data.createdBy || '',
  })
}

export async function updateTask(db, taskId, data) {
  const update = { ...data, updatedAt: serverTimestamp() }
  if (currentUserEmail && update.updatedBy === undefined) {
    update.updatedBy = currentUserEmail
  }

  // Set closedAt when moving to done
  if (data.status === 'done') {
    if (data.closedAt && typeof data.closedAt === 'string') {
      // User provided a specific date — convert to Timestamp
      update.closedAt = Timestamp.fromDate(new Date(data.closedAt + 'T23:59:59'))
    } else if (!data.closedAt) {
      // No date provided — auto-set to now
      update.closedAt = serverTimestamp()
    }
  }
  // Clear closedAt when reopening
  if (data.status && data.status !== 'done') {
    update.closedAt = null
  }

  // Handle deadline conversion
  if (data.deadline !== undefined) {
    update.deadline = data.deadline ? Timestamp.fromDate(new Date(data.deadline)) : null
  }

  return updateDoc(doc(db, 'tasks', taskId), update)
}

export async function deleteTask(db, taskId) {
  return deleteDoc(doc(db, 'tasks', taskId))
}

// ===== Standups =====

export async function submitStandup(db, data) {
  return addDoc(collection(db, 'standups'), {
    userEmail: data.userEmail,
    userName: data.userName,
    yesterday: data.yesterday,
    today: data.today,
    blockers: data.blockers,
    date: serverTimestamp(),
  })
}

export async function loadStandups(db, limit = 20) {
  const q = query(collection(db, 'standups'), orderBy('date', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() }))
}

// ===== Daily Focus =====

export async function loadDailyFocus(db, userEmail, dateStr) {
  const docId = `${userEmail}_${dateStr}`
  const snap = await getDoc(doc(db, 'dailyFocus', docId))
  if (snap.exists()) {
    const data = snap.data()
    return {
      taskIds: data.taskIds || [],
      timeBlocks: data.timeBlocks || [],
    }
  }
  return { taskIds: [], timeBlocks: [] }
}

export async function saveDailyFocus(db, userEmail, dateStr, taskIds, timeBlocks) {
  const docId = `${userEmail}_${dateStr}`
  const data = { userEmail, date: dateStr, taskIds: [...new Set(taskIds)], updatedAt: serverTimestamp() }
  if (timeBlocks !== undefined) {
    data.timeBlocks = timeBlocks
  }
  try {
    await setDoc(doc(db, 'dailyFocus', docId), data, { merge: true })
  } catch (err) {
    console.error('[saveDailyFocus] Failed to save:', docId, err)
    throw err
  }
}

// Find all dailyFocus docs for a user that currently contain the given taskId.
// Used when moving a task between scheduled days — to remove it from its previous day.
export async function findDailyFocusContainingTask(db, userEmail, taskId) {
  const q = query(
    collection(db, 'dailyFocus'),
    where('taskIds', 'array-contains', taskId)
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.userEmail === userEmail)
}

// ===== Timesheet Queries =====

export async function loadAllDailyFocusForRange(db, startDate, endDate) {
  const q = query(
    collection(db, 'dailyFocus'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ===== Notes (Granola / meeting notes) =====

export async function addNote(db, data) {
  return addDoc(collection(db, 'notes'), {
    content: data.content,
    source: data.source || 'manual',
    taskIds: data.taskIds || [],
    createdBy: data.createdBy || '',
    createdAt: serverTimestamp(),
  })
}

// ===== Processes =====

export function subscribeToProcesses(db, callback) {
  const q = query(collection(db, 'processes'), orderBy('name'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function createProcess(db, data) {
  return addDoc(collection(db, 'processes'), {
    name: data.name,
    content: '',
    contentUpdatedAt: null,
    contentUpdatedBy: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateProcess(db, processId, data) {
  return updateDoc(doc(db, 'processes', processId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProcess(db, processId) {
  return deleteDoc(doc(db, 'processes', processId))
}

export async function updateProcessContent(db, processId, content, updatedBy) {
  return updateDoc(doc(db, 'processes', processId), {
    content,
    contentUpdatedAt: serverTimestamp(),
    contentUpdatedBy: updatedBy,
    updatedAt: serverTimestamp(),
  })
}

// ===== References =====

export function subscribeToReferences(db, callback) {
  const q = query(collection(db, 'references'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function loadReferences(db, filters = {}) {
  let q = collection(db, 'references')
  const constraints = []

  if (filters.clientId) constraints.push(where('clientId', '==', filters.clientId))
  if (filters.projectId) constraints.push(where('projectId', '==', filters.projectId))
  if (filters.tag) constraints.push(where('tags', 'array-contains', filters.tag))
  if (filters.sharedBy) constraints.push(where('sharedBy', '==', filters.sharedBy))

  constraints.push(orderBy('createdAt', 'desc'))

  const snap = await getDocs(query(q, ...constraints))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createReference(db, data) {
  return addDoc(collection(db, 'references'), {
    url: data.url,
    title: data.title || '',
    description: data.description || '',
    imageUrl: data.imageUrl || '',
    tags: data.tags || [],
    clientId: data.clientId || '',
    projectId: data.projectId || '',
    sharedBy: data.sharedBy || '',
    slackMessageTs: data.slackMessageTs || '',
    slackChannel: data.slackChannel || '',
    createdAt: serverTimestamp(),
  })
}

export async function updateReference(db, refId, data) {
  return updateDoc(doc(db, 'references', refId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteReference(db, refId) {
  return deleteDoc(doc(db, 'references', refId))
}

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

// ===== Moodboards =====

export function subscribeToMoodboards(db, callback) {
  const q = query(collection(db, 'moodboards'), orderBy('updatedAt', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function createMoodboard(db, data) {
  return addDoc(collection(db, 'moodboards'), {
    name: data.name,
    description: data.description || '',
    referenceIds: data.referenceIds || [],
    clientId: data.clientId || '',
    projectId: data.projectId || '',
    createdBy: data.createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateMoodboard(db, boardId, data) {
  return updateDoc(doc(db, 'moodboards', boardId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteMoodboard(db, boardId) {
  return deleteDoc(doc(db, 'moodboards', boardId))
}

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

export async function updateLeave(db, leaveId, data) {
  return updateDoc(doc(db, 'leaves', leaveId), data)
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

// ===== Holidays =====

export function subscribeToHolidays(db, callback) {
  const q = query(collection(db, 'holidays'), orderBy('date', 'asc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function loadHolidays(db) {
  const q = query(collection(db, 'holidays'), orderBy('date', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createHoliday(db, data) {
  return addDoc(collection(db, 'holidays'), {
    date: data.date,
    name: data.name || '',
    createdBy: data.createdBy || '',
    createdAt: serverTimestamp(),
  })
}

export async function deleteHoliday(db, holidayId) {
  return deleteDoc(doc(db, 'holidays', holidayId))
}

// ===== Contracts =====

export function subscribeToContracts(db, callback) {
  const q = query(collection(db, 'contracts'), orderBy('startDate', 'desc'))
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })
}

export async function loadContracts(db) {
  const snap = await getDocs(query(collection(db, 'contracts'), orderBy('startDate', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createContract(db, data) {
  return addDoc(collection(db, 'contracts'), {
    userEmail: data.userEmail,
    startDate: data.startDate,
    endDate: data.endDate || null,
    notes: data.notes || '',
    createdBy: data.createdBy || currentUserEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateContract(db, contractId, data) {
  return updateDoc(doc(db, 'contracts', contractId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteContract(db, contractId) {
  return deleteDoc(doc(db, 'contracts', contractId))
}

