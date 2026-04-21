import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as db from './db.js'

// Mock dependencies
vi.mock('./db.js', () => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  subscribeToClients: vi.fn(),
  subscribeToProjects: vi.fn(),
  uploadClientLogo: vi.fn(),
  updateProjectContent: vi.fn(),
  createClientUser: vi.fn(),
  deleteClientUser: vi.fn(),
  subscribeToClientUsers: vi.fn(),
}))

vi.mock('./markdown.js', () => ({
  renderMarkdown: vi.fn((text) => `<p>${text}</p>`),
}))

vi.mock('./config.js', () => ({
  TEAM: [
    { email: 'alice@example.com', name: 'Alice Smith' },
    { email: 'bob@example.com', name: 'Bob Jones' },
  ],
}))

// Import after mocking
import { renderClients, cleanupClients } from './clients.js'

describe('clients.js', () => {
  let container
  let mockCtx
  let clientsCallback
  let projectsCallback

  beforeEach(() => {
    vi.clearAllMocks()

    // Capture the callbacks
    vi.mocked(db.subscribeToClients).mockImplementation((database, cb) => {
      clientsCallback = cb
      return vi.fn() // unsubscribe function
    })

    vi.mocked(db.subscribeToProjects).mockImplementation((database, cb) => {
      projectsCallback = cb
      return vi.fn() // unsubscribe function
    })

    // Default: no-op subscription that returns an unsubscribe fn so
    // cleanupClients() doesn't blow up. Tests that care about the
    // callback can override this implementation per-test.
    vi.mocked(db.subscribeToClientUsers).mockImplementation(() => vi.fn())

    container = document.createElement('div')
    document.body.appendChild(container)

    mockCtx = {
      db: { _type: 'firestore' },
      clients: [],
      projects: [],
      allTasks: [],
      currentUser: { email: 'test@example.com' },
    }
  })

  afterEach(() => {
    cleanupClients()
    if (container.parentNode) {
      document.body.removeChild(container)
    }
  })

  describe('renderClients', () => {
    it('should render the clients view with header', () => {
      renderClients(container, mockCtx)

      expect(container.querySelector('.clients-view')).toBeTruthy()
      expect(container.querySelector('h2').textContent).toBe('Clients & Projects')
    })

    it('should render add client button', () => {
      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-client-btn')
      expect(addBtn).toBeTruthy()
      expect(addBtn.textContent).toContain('Client')
    })

    it('should render add project button', () => {
      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-project-btn')
      expect(addBtn).toBeTruthy()
      expect(addBtn.textContent).toContain('Project')
    })

    it('should subscribe to clients and projects', () => {
      renderClients(container, mockCtx)

      expect(db.subscribeToClients).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
      expect(db.subscribeToProjects).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
    })

    it('should show empty state when no clients', () => {
      renderClients(container, mockCtx)
      clientsCallback([])

      const clientsList = container.querySelector('#clients-list')
      expect(clientsList.textContent).toContain('No clients yet')
    })

    it('should show empty state when no projects', () => {
      renderClients(container, mockCtx)
      projectsCallback([])

      const projectsList = container.querySelector('#projects-list')
      expect(projectsList.textContent).toContain('No projects yet')
    })

    it('should render client list when clients are provided', () => {
      renderClients(container, mockCtx)

      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: '', defaultHourlyRate: 100, currency: 'USD' },
        { id: 'c2', name: 'Client Two', logoUrl: '', defaultHourlyRate: 150, currency: 'INR' },
      ])

      const clientRows = container.querySelectorAll('.client-row')
      expect(clientRows).toHaveLength(2)
    })

    it('should display client logo when available', () => {
      renderClients(container, mockCtx)

      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: 'https://example.com/logo.png', defaultHourlyRate: 0, currency: 'INR' },
      ])

      const logo = container.querySelector('.client-logo')
      expect(logo.tagName).toBe('IMG')
      // Check the HTML contains the URL since innerHTML rendering
      const clientRow = container.querySelector('.client-row')
      expect(clientRow.innerHTML).toContain('https://example.com/logo.png')
    })

    it('should display project count for each client', () => {
      renderClients(container, mockCtx)

      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: '', defaultHourlyRate: 0, currency: 'INR' },
      ])

      projectsCallback([
        { id: 'p1', name: 'Project 1', clientId: 'c1' },
        { id: 'p2', name: 'Project 2', clientId: 'c1' },
      ])

      const clientMeta = container.querySelector('.client-row-meta')
      expect(clientMeta.textContent).toContain('2 projects')
    })

    it('should display hourly rate in client meta when available', () => {
      renderClients(container, mockCtx)

      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: '', defaultHourlyRate: 150, currency: 'USD' },
      ])

      projectsCallback([])

      const clientMeta = container.querySelector('.client-row-meta')
      expect(clientMeta.textContent).toContain('USD 150/hr')
    })
  })

  describe('Add Client Form', () => {
    it('should show add client form when add button clicked', () => {
      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-client-btn')
      const form = container.querySelector('#add-client-form')

      expect(form.classList.contains('hidden')).toBe(true)
      addBtn.click()
      expect(form.classList.contains('hidden')).toBe(false)
    })

    it('should hide form when cancel button clicked', () => {
      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-client-btn')
      const cancelBtn = container.querySelector('#cancel-client-btn')
      const form = container.querySelector('#add-client-form')

      addBtn.click()
      expect(form.classList.contains('hidden')).toBe(false)

      cancelBtn.click()
      expect(form.classList.contains('hidden')).toBe(true)
    })

    it('should create client when save button clicked', async () => {
      vi.mocked(db.createClient).mockResolvedValue({ id: 'new-client' })

      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-client-btn')
      addBtn.click()

      const nameInput = container.querySelector('#new-client-name')
      const rateInput = container.querySelector('#new-client-rate')
      const saveBtn = container.querySelector('#save-client-btn')

      nameInput.value = 'New Client'
      rateInput.value = '200'

      saveBtn.click()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(db.createClient).toHaveBeenCalledWith(
        mockCtx.db,
        expect.objectContaining({
          name: 'New Client',
          logoUrl: '',
          defaultHourlyRate: 200,
          currency: 'INR',
        })
      )
    })

    it('should not create client when name is empty', async () => {
      renderClients(container, mockCtx)

      const addBtn = container.querySelector('#add-client-btn')
      addBtn.click()

      const saveBtn = container.querySelector('#save-project-btn')
      saveBtn.click()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(db.createClient).not.toHaveBeenCalled()
    })
  })

  describe('cleanupClients', () => {
    it('should unsubscribe from listeners', () => {
      const unsubClients = vi.fn()
      const unsubProjects = vi.fn()

      vi.mocked(db.subscribeToClients).mockReturnValue(unsubClients)
      vi.mocked(db.subscribeToProjects).mockReturnValue(unsubProjects)

      renderClients(container, mockCtx)

      cleanupClients()

      expect(unsubClients).toHaveBeenCalled()
      expect(unsubProjects).toHaveBeenCalled()
    })

    it('should handle cleanup when no subscriptions active', () => {
      expect(() => cleanupClients()).not.toThrow()
    })
  })
})