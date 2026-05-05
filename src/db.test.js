import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as firestore from 'firebase/firestore'
import * as storage from 'firebase/storage'

// Mock Firebase modules before importing db.js
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, collectionName) => ({ _type: 'collection', _name: collectionName })),
  doc: vi.fn((db, collectionName, docId) => ({ _type: 'doc', _collection: collectionName, _id: docId })),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn((...args) => ({ _type: 'query', _args: args })),
  orderBy: vi.fn((field, direction) => ({ _type: 'orderBy', field, direction })),
  where: vi.fn((field, op, value) => ({ _type: 'where', field, op, value })),
  Timestamp: {
    fromDate: vi.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 })),
  },
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
}))

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({ _type: 'storage' })),
  ref: vi.fn((storage, path) => ({ _type: 'storageRef', _path: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}))

// Import after mocking
import {
  saveUserProfile,
  loadUserProfiles,
  createClient,
  updateClient,
  deleteClient,
  loadClients,
  subscribeToClients,
  subscribeToProjects,
  createProject,
  updateProject,
  deleteProject,
  loadProjects,
  createPerson,
  updatePerson,
  deletePerson,
  subscribeToPeople,
  loadPeople,
  updatePersonContent,
  updateProjectContent,
  normalizeTask,
  subscribeToTasks,
  createTask,
  updateTask,
  deleteTask,
  loadDailyFocus,
  saveDailyFocus,
  findDailyFocusContainingTask,
  loadAllDailyFocusForRange,
  addNote,
  uploadClientLogo,
} from './db.js'

describe('db.js', () => {
  let mockDb

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = { _type: 'firestore' }
  })

  describe('User Profiles', () => {
    it('should save user profile with merge', async () => {
      vi.mocked(firestore.setDoc).mockResolvedValue(undefined)

      await saveUserProfile(mockDb, 'test@example.com', { name: 'Test User' })

      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'users', _id: 'test@example.com' }),
        expect.objectContaining({ name: 'Test User', updatedAt: expect.anything() }),
        { merge: true }
      )
    })

    it('should load all user profiles', async () => {
      vi.mocked(firestore.getDocs).mockResolvedValue({
        docs: [
          { id: 'user1@test.com', data: () => ({ name: 'User 1' }) },
          { id: 'user2@test.com', data: () => ({ name: 'User 2' }) },
        ],
      })

      const profiles = await loadUserProfiles(mockDb)

      expect(profiles).toEqual({
        'user1@test.com': { name: 'User 1' },
        'user2@test.com': { name: 'User 2' },
      })
    })

    it('should return empty object when no profiles exist', async () => {
      vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] })

      const profiles = await loadUserProfiles(mockDb)

      expect(profiles).toEqual({})
    })
  })

  describe('Clients', () => {
    it('should create client with all fields', async () => {
      const mockDocRef = { id: 'client-123' }
      vi.mocked(firestore.addDoc).mockResolvedValue(mockDocRef)

      const result = await createClient(mockDb, {
        name: 'Test Client',
        logoUrl: 'https://example.com/logo.png',
        defaultHourlyRate: 150,
        currency: 'USD',
      })

      expect(firestore.addDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _name: 'clients' }),
        expect.objectContaining({
          name: 'Test Client',
          logoUrl: 'https://example.com/logo.png',
          defaultHourlyRate: 150,
          currency: 'USD',
        })
      )
      expect(result).toBe(mockDocRef)
    })

    it('should create client with default values when optional fields missing', async () => {
      vi.mocked(firestore.addDoc).mockResolvedValue({ id: 'client-123' })

      await createClient(mockDb, { name: 'Minimal Client' })

      expect(firestore.addDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Minimal Client',
          logoUrl: '',
          defaultHourlyRate: 0,
          currency: 'INR',
        })
      )
    })

    it('should update client', async () => {
      vi.mocked(firestore.updateDoc).mockResolvedValue(undefined)

      await updateClient(mockDb, 'client-123', { name: 'Updated Name', defaultHourlyRate: 200 })

      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'clients', _id: 'client-123' }),
        { name: 'Updated Name', defaultHourlyRate: 200 }
      )
    })

    it('should delete client', async () => {
      vi.mocked(firestore.deleteDoc).mockResolvedValue(undefined)

      await deleteClient(mockDb, 'client-123')

      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'clients', _id: 'client-123' })
      )
    })

    it('should load clients ordered by name', async () => {
      vi.mocked(firestore.getDocs).mockResolvedValue({
        docs: [
          { id: 'c1', data: () => ({ name: 'Alpha Corp' }) },
          { id: 'c2', data: () => ({ name: 'Beta Inc' }) },
        ],
      })

      const clients = await loadClients(mockDb)

      expect(clients).toEqual([
        { id: 'c1', name: 'Alpha Corp' },
        { id: 'c2', name: 'Beta Inc' },
      ])
    })

    it('should subscribe to clients with real-time updates', () => {
      const callback = vi.fn()
      const unsubscribe = vi.fn()
      vi.mocked(firestore.onSnapshot).mockReturnValue(unsubscribe)

      const result = subscribeToClients(mockDb, callback)

      expect(firestore.onSnapshot).toHaveBeenCalled()
      expect(result).toBe(unsubscribe)

      // Simulate snapshot callback
      const mockSnap = {
        docs: [{ id: 'c1', data: () => ({ name: 'Test' }) }],
      }
      vi.mocked(firestore.onSnapshot).mock.calls[0][1](mockSnap)

      expect(callback).toHaveBeenCalledWith([{ id: 'c1', name: 'Test' }])
    })

    it('should upload client logo and return URL', async () => {
      const mockFile = new File(['logo'], 'logo.png', { type: 'image/png' })
      vi.mocked(storage.uploadBytes).mockResolvedValue(undefined)
      vi.mocked(storage.getDownloadURL).mockResolvedValue('https://storage.example.com/client-logos/client-123')

      const url = await uploadClientLogo(mockFile, 'client-123')

      expect(storage.uploadBytes).toHaveBeenCalled()
      expect(storage.getDownloadURL).toHaveBeenCalled()
      expect(url).toBe('https://storage.example.com/client-logos/client-123')
    })
  })

  describe('Tasks', () => {
    it('should normalize task with old assignee field', () => {
      const task = { id: 't1', title: 'Task', assignee: 'user@example.com' }
      const normalized = normalizeTask(task)

      expect(normalized.assignees).toEqual(['user@example.com'])
    })

    it('should normalize task with assignees array', () => {
      const task = { id: 't1', title: 'Task', assignees: ['user1@example.com', 'user2@example.com'] }
      const normalized = normalizeTask(task)

      expect(normalized.assignees).toEqual(['user1@example.com', 'user2@example.com'])
    })

    it('should normalize task with no assignee', () => {
      const task = { id: 't1', title: 'Task' }
      const normalized = normalizeTask(task)

      expect(normalized.assignees).toEqual([])
    })

    it('should coerce Firestore Timestamp-shaped fields to ISO strings', () => {
      const fakeDate = new Date('2026-04-01T12:00:00Z')
      const task = {
        id: 't1',
        title: 'Task',
        deadline: { toDate: () => fakeDate },                          // Firestore Timestamp
        createdAt: { seconds: 1711929600, nanoseconds: 0 },            // Serialized shape
        updatedAt: '2026-03-01T00:00:00.000Z',                         // Already ISO — leave alone
        closedAt: null,                                                 // Null — leave alone
      }
      const normalized = normalizeTask(task)

      expect(normalized.deadline).toBe('2026-04-01T12:00:00.000Z')
      expect(normalized.createdAt).toBe(new Date(1711929600 * 1000).toISOString())
      expect(normalized.updatedAt).toBe('2026-03-01T00:00:00.000Z')
      expect(normalized.closedAt).toBeNull()
    })

    it('should create task with defaults', async () => {
      vi.mocked(firestore.addDoc).mockResolvedValue({ id: 'task-123' })

      await createTask(mockDb, { title: 'Minimal Task' })

      expect(firestore.addDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'Minimal Task',
          description: '',
          clientId: '',
          projectId: '',
          assignees: [],
          status: 'todo',
          priority: 'medium',
          deadline: null,
          notes: [],
          closedAt: null,
          createdBy: '',
        })
      )
    })

    it('should update task and set closedAt when status changes to done', async () => {
      vi.mocked(firestore.updateDoc).mockResolvedValue(undefined)

      await updateTask(mockDb, 'task-123', { status: 'done' })

      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'tasks', _id: 'task-123' }),
        expect.objectContaining({
          status: 'done',
          closedAt: expect.anything(),
        })
      )
    })

    it('should update task and clear closedAt when reopening', async () => {
      vi.mocked(firestore.updateDoc).mockResolvedValue(undefined)

      await updateTask(mockDb, 'task-123', { status: 'in_progress' })

      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'tasks', _id: 'task-123' }),
        expect.objectContaining({
          status: 'in_progress',
          closedAt: null,
        })
      )
    })
  })

  describe('Daily Focus', () => {
    it('should load daily focus for user and date', async () => {
      vi.mocked(firestore.getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({
          taskIds: ['task-1', 'task-2'],
          timeBlocks: [{ taskId: 'task-1', start: '09:00', end: '10:00' }],
        }),
      })

      const focus = await loadDailyFocus(mockDb, 'user@example.com', '2026-02-21')

      expect(focus).toEqual({
        taskIds: ['task-1', 'task-2'],
        timeBlocks: [{ taskId: 'task-1', start: '09:00', end: '10:00' }],
      })
    })

    it('should return empty arrays when daily focus does not exist', async () => {
      vi.mocked(firestore.getDoc).mockResolvedValue({ exists: () => false })

      const focus = await loadDailyFocus(mockDb, 'user@example.com', '2026-02-21')

      expect(focus).toEqual({
        taskIds: [],
        timeBlocks: [],
      })
    })

    it('should save daily focus with task IDs and time blocks', async () => {
      vi.mocked(firestore.setDoc).mockResolvedValue(undefined)

      await saveDailyFocus(
        mockDb,
        'user@example.com',
        '2026-02-21',
        ['task-1', 'task-2'],
        [{ taskId: 'task-1', start: '09:00', end: '10:00' }]
      )

      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _collection: 'dailyFocus', _id: 'user@example.com_2026-02-21' }),
        expect.objectContaining({
          userEmail: 'user@example.com',
          date: '2026-02-21',
          taskIds: ['task-1', 'task-2'],
          timeBlocks: [{ taskId: 'task-1', start: '09:00', end: '10:00' }],
        }),
        { merge: true }
      )
    })

    it('should find daily focus docs containing task filtered by user', async () => {
      vi.mocked(firestore.getDocs).mockResolvedValue({
        docs: [
          { id: 'user1@example.com_2026-02-01', data: () => ({ userEmail: 'user1@example.com', date: '2026-02-01', taskIds: ['t1', 't2'] }) },
          { id: 'user2@example.com_2026-02-02', data: () => ({ userEmail: 'user2@example.com', date: '2026-02-02', taskIds: ['t1'] }) },
          { id: 'user1@example.com_2026-02-03', data: () => ({ userEmail: 'user1@example.com', date: '2026-02-03', taskIds: ['t1', 't3'] }) },
        ],
      })

      const results = await findDailyFocusContainingTask(mockDb, 'user1@example.com', 't1')

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.date).sort()).toEqual(['2026-02-01', '2026-02-03'])
      expect(firestore.where).toHaveBeenCalledWith('taskIds', 'array-contains', 't1')
    })

    it('should load all daily focus for date range', async () => {
      vi.mocked(firestore.getDocs).mockResolvedValue({
        docs: [
          { id: 'user1_2026-02-01', data: () => ({ date: '2026-02-01', taskIds: ['t1'] }) },
          { id: 'user2_2026-02-02', data: () => ({ date: '2026-02-02', taskIds: ['t2'] }) },
        ],
      })

      const results = await loadAllDailyFocusForRange(mockDb, '2026-02-01', '2026-02-28')

      expect(results).toEqual([
        { id: 'user1_2026-02-01', date: '2026-02-01', taskIds: ['t1'] },
        { id: 'user2_2026-02-02', date: '2026-02-02', taskIds: ['t2'] },
      ])
    })
  })
})