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

describe('clients.js (master-detail layout)', () => {
  let container
  let mockCtx
  let clientsCallback
  let projectsCallback
  let usersCallback

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(db.subscribeToClients).mockImplementation((_db, cb) => {
      clientsCallback = cb
      return vi.fn()
    })
    vi.mocked(db.subscribeToProjects).mockImplementation((_db, cb) => {
      projectsCallback = cb
      return vi.fn()
    })
    vi.mocked(db.subscribeToClientUsers).mockImplementation((_db, cb) => {
      usersCallback = cb
      return vi.fn()
    })

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
    if (container.parentNode) document.body.removeChild(container)
  })

  describe('renderClients', () => {
    it('renders the manage view with header', () => {
      renderClients(container, mockCtx)
      expect(container.querySelector('.manage-view')).toBeTruthy()
      expect(container.querySelector('h2').textContent).toBe('Clients & Projects')
    })

    it('renders the add-client button in the sidebar', () => {
      renderClients(container, mockCtx)
      const addBtn = container.querySelector('#add-client-btn')
      expect(addBtn).toBeTruthy()
      expect(addBtn.textContent).toContain('Client')
    })

    it('subscribes to clients, projects, and client users', () => {
      renderClients(container, mockCtx)
      expect(db.subscribeToClients).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
      expect(db.subscribeToProjects).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
      expect(db.subscribeToClientUsers).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
    })

    it('shows empty state in sidebar when no clients', () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])
      const sidebarList = container.querySelector('#manage-client-list')
      expect(sidebarList.textContent).toContain('No clients yet')
    })

    it('renders empty state in detail pane when no client selected', () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])
      const detail = container.querySelector('#manage-detail')
      expect(detail.textContent).toContain('Pick a client')
    })

    it('renders sidebar rows when clients are seeded', () => {
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: '', defaultHourlyRate: 100, currency: 'USD' },
        { id: 'c2', name: 'Client Two', logoUrl: '', defaultHourlyRate: 150, currency: 'INR' },
      ])
      projectsCallback([])
      usersCallback([])
      const rows = container.querySelectorAll('.manage-client-row')
      expect(rows).toHaveLength(2)
    })

    it('shows client logo when provided', () => {
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Client One', logoUrl: 'https://example.com/logo.png' },
      ])
      projectsCallback([])
      usersCallback([])
      const logo = container.querySelector('.manage-client-logo')
      expect(logo.tagName).toBe('IMG')
      expect(logo.getAttribute('src')).toBe('https://example.com/logo.png')
    })

    it('displays project count in sidebar row meta', () => {
      renderClients(container, mockCtx)
      clientsCallback([{ id: 'c1', name: 'Client One' }])
      projectsCallback([
        { id: 'p1', name: 'Project 1', clientId: 'c1' },
        { id: 'p2', name: 'Project 2', clientId: 'c1' },
      ])
      usersCallback([])
      const meta = container.querySelector('.manage-client-row-meta')
      expect(meta.textContent).toContain('2 projects')
    })

    it('auto-selects the first client and renders its detail pane', () => {
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Acme', defaultHourlyRate: 150, currency: 'USD', slackChannelId: 'CHAN1' },
      ])
      projectsCallback([])
      usersCallback([])
      const name = container.querySelector('.manage-detail-name')
      expect(name.textContent).toBe('Acme')
      // Rate chip is in detail pane, not sidebar
      const chips = container.querySelector('.manage-detail-chips').textContent
      expect(chips).toContain('USD 150/hr')
      expect(chips).toContain('CHAN1')
    })

    it('shows slack indicator in sidebar for clients with slackChannelId', () => {
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'With Slack', slackChannelId: 'C1' },
        { id: 'c2', name: 'Without' },
      ])
      projectsCallback([])
      usersCallback([])
      const rows = container.querySelectorAll('.manage-client-row')
      expect(rows[0].querySelector('.manage-slack-indicator')).toBeTruthy()
      expect(rows[1].querySelector('.manage-slack-indicator')).toBeFalsy()
    })

    it('shows the empty-projects state in the detail pane when selected client has none', () => {
      renderClients(container, mockCtx)
      clientsCallback([{ id: 'c1', name: 'Acme' }])
      projectsCallback([])
      usersCallback([])
      const projectsList = container.querySelector('#projects-list')
      expect(projectsList.textContent).toContain('No projects yet')
    })
  })

  describe('Add Client Form (sidebar slot)', () => {
    it('shows form when add button clicked', () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])

      const addBtn = container.querySelector('#add-client-btn')
      const form = container.querySelector('#add-client-form')
      expect(form.classList.contains('hidden')).toBe(true)
      addBtn.click()
      expect(form.classList.contains('hidden')).toBe(false)
    })

    it('hides form when cancel clicked', () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])

      container.querySelector('#add-client-btn').click()
      const form = container.querySelector('#add-client-form')
      expect(form.classList.contains('hidden')).toBe(false)
      container.querySelector('#cf-cancel').click()
      expect(form.classList.contains('hidden')).toBe(true)
    })

    it('creates client when save clicked', async () => {
      vi.mocked(db.createClient).mockResolvedValue({ id: 'new-client' })
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])

      container.querySelector('#add-client-btn').click()
      container.querySelector('#cf-name').value = 'New Client'
      container.querySelector('#cf-rate').value = '200'
      container.querySelector('#cf-save').click()

      await new Promise((r) => setTimeout(r, 50))

      expect(db.createClient).toHaveBeenCalledWith(
        mockCtx.db,
        expect.objectContaining({
          name: 'New Client',
          logoUrl: '',
          defaultHourlyRate: 200,
          currency: 'INR',
          slackChannelId: '',
        }),
      )
    })

    it('does not save with empty name', async () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])

      container.querySelector('#add-client-btn').click()
      // Leave #cf-name empty
      container.querySelector('#cf-save').click()
      await new Promise((r) => setTimeout(r, 50))
      expect(db.createClient).not.toHaveBeenCalled()
    })
  })

  describe('Edit Client Form (detail pane slot)', () => {
    it('routes edit form into the detail pane, not the sidebar', () => {
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Acme', defaultHourlyRate: 100, currency: 'INR', slackChannelId: 'C1' },
      ])
      projectsCallback([])
      usersCallback([])

      const sidebarForm = container.querySelector('#add-client-form')
      const detailForm = container.querySelector('#edit-client-form')

      expect(sidebarForm.classList.contains('hidden')).toBe(true)
      expect(detailForm.classList.contains('hidden')).toBe(true)

      container.querySelector('#edit-client-btn').click()

      expect(detailForm.classList.contains('hidden')).toBe(false)
      expect(sidebarForm.classList.contains('hidden')).toBe(true)
      expect(detailForm.querySelector('#cf-name').value).toBe('Acme')
      expect(detailForm.querySelector('#cf-slack').value).toBe('C1')
    })

    it('updates the client on save', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Acme', defaultHourlyRate: 100, currency: 'INR' },
      ])
      projectsCallback([])
      usersCallback([])

      container.querySelector('#edit-client-btn').click()
      const detailForm = container.querySelector('#edit-client-form')
      detailForm.querySelector('#cf-name').value = 'Acme Renamed'
      detailForm.querySelector('#cf-rate').value = '250'
      detailForm.querySelector('#cf-save').click()

      await new Promise((r) => setTimeout(r, 50))

      expect(db.updateClient).toHaveBeenCalledWith(
        mockCtx.db,
        'c1',
        expect.objectContaining({
          name: 'Acme Renamed',
          defaultHourlyRate: 250,
          currency: 'INR',
        }),
      )
    })
  })

  describe('Add Project Form (detail pane)', () => {
    it('only available once a client is selected', () => {
      renderClients(container, mockCtx)
      clientsCallback([])
      projectsCallback([])
      usersCallback([])
      // No selection → no add-project button
      expect(container.querySelector('#add-project-btn')).toBeFalsy()
    })

    it('creates a project scoped to the selected client', async () => {
      vi.mocked(db.createProject).mockResolvedValue()
      renderClients(container, mockCtx)
      clientsCallback([
        { id: 'c1', name: 'Acme', defaultHourlyRate: 100, currency: 'INR' },
      ])
      projectsCallback([])
      usersCallback([])

      container.querySelector('#add-project-btn').click()
      container.querySelector('#pf-name').value = 'New Project'
      container.querySelector('#pf-save').click()

      await new Promise((r) => setTimeout(r, 50))

      expect(db.createProject).toHaveBeenCalledWith(
        mockCtx.db,
        expect.objectContaining({
          name: 'New Project',
          clientId: 'c1',
          hourlyRate: 100, // inherits from client
          currency: 'INR',
        }),
      )
    })
  })

  describe('Archive & dormant states', () => {
    it('shows an Archive action and archives the client on click', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      renderClients(container, mockCtx)
      clientsCallback([{ id: 'c1', name: 'Acme' }])
      projectsCallback([])
      usersCallback([])

      const btn = container.querySelector('#archive-client-btn')
      expect(btn).toBeTruthy()
      expect(btn.textContent).toContain('Archive')
      btn.click()
      await new Promise((r) => setTimeout(r, 20))
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { archived: true })
    })

    it('shows Unarchive and an Archived badge/chip for an archived client', () => {
      renderClients(container, mockCtx)
      clientsCallback([{ id: 'c1', name: 'Acme', archived: true }])
      projectsCallback([])
      usersCallback([])

      expect(container.querySelector('#archive-client-btn').textContent).toContain('Unarchive')
      expect(container.querySelector('.manage-chip-archived')).toBeTruthy()
      expect(container.querySelector('.manage-state-badge.archived')).toBeTruthy()
    })

    it('marks a client with no open items as Inactive', () => {
      renderClients(container, mockCtx) // mockCtx.allTasks = []
      clientsCallback([{ id: 'c1', name: 'Acme' }])
      projectsCallback([])
      usersCallback([])

      expect(container.querySelector('.manage-state-badge.inactive')).toBeTruthy()
      expect(container.querySelector('.manage-chip-inactive')).toBeTruthy()
    })

    it('shows no state badge for a client that has an open item', () => {
      const ctx = { ...mockCtx, allTasks: [{ id: 't1', clientId: 'c1', status: 'todo' }] }
      renderClients(container, ctx)
      clientsCallback([{ id: 'c1', name: 'Acme' }])
      projectsCallback([])
      usersCallback([])

      expect(container.querySelector('.manage-state-badge')).toBeFalsy()
      expect(container.querySelector('.manage-chip-archived')).toBeFalsy()
      expect(container.querySelector('.manage-chip-inactive')).toBeFalsy()
    })

    it('orders active clients above archived/inactive ones in the sidebar', () => {
      const ctx = { ...mockCtx, allTasks: [{ id: 't1', clientId: 'c_active', status: 'todo' }] }
      renderClients(container, ctx)
      clientsCallback([
        { id: 'c_archived', name: 'Archived Co', archived: true },
        { id: 'c_active', name: 'Active Co' },
      ])
      projectsCallback([])
      usersCallback([])

      const rows = container.querySelectorAll('.manage-client-row')
      expect(rows[0].dataset.id).toBe('c_active')
      expect(rows[1].dataset.id).toBe('c_archived')
    })
  })

  describe('cleanupClients', () => {
    it('unsubscribes from all listeners', () => {
      const unsubClients = vi.fn()
      const unsubProjects = vi.fn()
      const unsubUsers = vi.fn()
      vi.mocked(db.subscribeToClients).mockReturnValue(unsubClients)
      vi.mocked(db.subscribeToProjects).mockReturnValue(unsubProjects)
      vi.mocked(db.subscribeToClientUsers).mockReturnValue(unsubUsers)

      renderClients(container, mockCtx)
      cleanupClients()

      expect(unsubClients).toHaveBeenCalled()
      expect(unsubProjects).toHaveBeenCalled()
      expect(unsubUsers).toHaveBeenCalled()
    })

    it('is a no-op when no subscriptions active', () => {
      expect(() => cleanupClients()).not.toThrow()
    })
  })
})
