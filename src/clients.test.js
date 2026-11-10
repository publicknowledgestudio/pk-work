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

vi.mock('./slack-channels.js', () => ({
  openChannelPicker: vi.fn(),
  loadSlackChannels: vi.fn(() => Promise.resolve([])),
  knownChannelName: vi.fn(() => ''),
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
import { openChannelPicker } from './slack-channels.js'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

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
    document.querySelectorAll('.modal-overlay, .manage-toast').forEach((el) => el.remove())
  })

  const seed = ({ clients = [], projects = [], users = [] } = {}, ctx = mockCtx) => {
    renderClients(container, ctx)
    clientsCallback(clients)
    projectsCallback(projects)
    usersCallback(users)
  }

  describe('renderClients', () => {
    it('renders the manage view with a Clients heading and a New client button', () => {
      renderClients(container, mockCtx)
      expect(container.querySelector('.manage-view')).toBeTruthy()
      expect(container.querySelector('h2').textContent).toBe('Clients')
      expect(container.querySelector('#add-client-btn').textContent).toContain('New client')
    })

    it('subscribes to clients, projects, and client users', () => {
      renderClients(container, mockCtx)
      expect(db.subscribeToClients).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
      expect(db.subscribeToProjects).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
      expect(db.subscribeToClientUsers).toHaveBeenCalledWith(mockCtx.db, expect.any(Function))
    })

    it('shows empty states (with a way to add the first client) when there are none', () => {
      seed()
      expect(container.querySelector('#manage-client-list').textContent).toContain('No clients yet')
      expect(container.querySelector('#manage-detail').textContent).toContain('Add your first client')
      container.querySelector('#empty-add-client').click()
      expect(document.getElementById('new-client-overlay')).toBeTruthy()
    })

    it('renders sidebar rows with logo, project count and open-task count', () => {
      const ctx = { ...mockCtx, allTasks: [
        { id: 't1', clientId: 'c1', status: 'todo' },
        { id: 't2', clientId: 'c1', status: 'done' },
      ] }
      seed({
        clients: [
          { id: 'c1', name: 'Client One', logoUrl: 'https://example.com/logo.png' },
          { id: 'c2', name: 'Client Two', logoUrl: '' },
        ],
        projects: [{ id: 'p1', name: 'P1', clientId: 'c1' }, { id: 'p2', name: 'P2', clientId: 'c1' }],
      }, ctx)
      const rows = container.querySelectorAll('.manage-client-row')
      expect(rows).toHaveLength(2)
      expect(rows[0].querySelector('img.manage-client-logo').getAttribute('src')).toBe('https://example.com/logo.png')
      expect(rows[0].textContent).toContain('2 projects')
      expect(rows[0].textContent).toContain('1 open')
      expect(rows[1].textContent).toContain('No projects')
    })

    it('auto-selects the first active client and renders its detail pane', () => {
      // Fresh ids: the selected client is remembered between visits to the page.
      const ctx = { ...mockCtx, allTasks: [{ id: 't1', clientId: 'fresh2', status: 'todo' }] }
      seed({ clients: [{ id: 'fresh1', name: 'Alpha' }, { id: 'fresh2', name: 'Beta' }] }, ctx)
      expect(container.querySelector('#client-name-input').value).toBe('Beta')
      expect(container.querySelector('.manage-client-row.active').dataset.id).toBe('fresh2')
    })

    it('filters the sidebar by search term', () => {
      seed({ clients: [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }] })
      const search = container.querySelector('#manage-client-search')
      search.value = 'bet'
      search.dispatchEvent(new Event('input'))
      const rows = container.querySelectorAll('.manage-client-row')
      expect(rows).toHaveLength(1)
      expect(rows[0].dataset.id).toBe('c2')
      search.value = ''
      search.dispatchEvent(new Event('input'))
    })

    it('has no delete-client control', () => {
      seed({ clients: [{ id: 'c1', name: 'Alpha' }] })
      expect(container.querySelector('#delete-client-btn')).toBeFalsy()
      expect(db.deleteClient).not.toHaveBeenCalled()
    })
  })

  describe('New client dialog', () => {
    const open = () => {
      container.querySelector('#add-client-btn').click()
      return document.getElementById('new-client-overlay')
    }

    it('opens as a dialog and closes on Cancel', () => {
      seed()
      const dialog = open()
      expect(dialog.querySelector('[role="dialog"]')).toBeTruthy()
      expect(document.activeElement.id).toBe('nc-name')
      dialog.querySelector('#nc-cancel').click()
      expect(document.getElementById('new-client-overlay')).toBeFalsy()
    })

    it('creates the client with its first project and selects it', async () => {
      vi.mocked(db.createClient).mockResolvedValue({ id: 'new-id' })
      vi.mocked(db.createProject).mockResolvedValue({ id: 'p-new' })
      seed({ clients: [{ id: 'c1', name: 'Alpha' }] })
      const dialog = open()
      dialog.querySelector('#nc-name').value = 'New Client'
      dialog.querySelector('#nc-project').value = 'Website'
      dialog.querySelector('#nc-rate').value = '200'
      dialog.querySelector('#nc-currency').value = 'USD'
      dialog.querySelector('#nc-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await tick()

      expect(db.createClient).toHaveBeenCalledWith(mockCtx.db, expect.objectContaining({
        name: 'New Client', defaultHourlyRate: 200, currency: 'USD',
      }))
      expect(db.createProject).toHaveBeenCalledWith(mockCtx.db, expect.objectContaining({
        name: 'Website', clientId: 'new-id', hourlyRate: 200, currency: 'USD',
      }))
      expect(document.getElementById('new-client-overlay')).toBeFalsy()

      clientsCallback([{ id: 'c1', name: 'Alpha' }, { id: 'new-id', name: 'New Client' }])
      expect(container.querySelector('#client-name-input').value).toBe('New Client')
    })

    it('does not save with an empty name', async () => {
      seed()
      const dialog = open()
      dialog.querySelector('#nc-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await tick()
      expect(db.createClient).not.toHaveBeenCalled()
      expect(dialog.querySelector('#nc-error').textContent).toContain('name')
    })

    it('refuses a duplicate name', async () => {
      seed({ clients: [{ id: 'c1', name: 'Alpha' }] })
      const dialog = open()
      dialog.querySelector('#nc-name').value = ' alpha '
      dialog.querySelector('#nc-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await tick()
      expect(db.createClient).not.toHaveBeenCalled()
      expect(dialog.querySelector('#nc-error').textContent).toContain('already a client')
    })

    it('stays open and shows the error when the save fails', async () => {
      vi.mocked(db.createClient).mockRejectedValue(new Error('offline'))
      seed()
      const dialog = open()
      dialog.querySelector('#nc-name').value = 'New Client'
      dialog.querySelector('#nc-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await tick()
      expect(document.getElementById('new-client-overlay')).toBeTruthy()
      expect(dialog.querySelector('#nc-error').textContent).toContain('offline')
      expect(dialog.querySelector('#nc-save').disabled).toBe(false)
    })
  })

  describe('Editing a client in place', () => {
    const client = { id: 'c1', name: 'Original', logoUrl: '', defaultHourlyRate: 100, currency: 'INR' }

    it('clicking the logo opens the file picker', () => {
      seed({ clients: [client] })
      const input = container.querySelector('#client-logo-input')
      const spy = vi.spyOn(input, 'click')
      container.querySelector('#client-logo-btn').click()
      expect(spy).toHaveBeenCalled()
    })

    it('uploads a chosen image and saves it as the logo', async () => {
      vi.mocked(db.uploadClientLogo).mockResolvedValue('data:image/webp;base64,xx')
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [client] })
      const input = container.querySelector('#client-logo-input')
      const file = new File(['x'], 'logo.png', { type: 'image/png' })
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      input.dispatchEvent(new Event('change'))
      await tick()
      expect(db.uploadClientLogo).toHaveBeenCalledWith(file, 'c1')
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { logoUrl: 'data:image/webp;base64,xx' })
    })

    it('rejects a non-image file', async () => {
      seed({ clients: [client] })
      const input = container.querySelector('#client-logo-input')
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], configurable: true })
      input.dispatchEvent(new Event('change'))
      await tick()
      expect(db.uploadClientLogo).not.toHaveBeenCalled()
    })

    it('offers Remove only when there is a logo', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [client] })
      expect(container.querySelector('#client-logo-remove')).toBeFalsy()
      clientsCallback([{ ...client, logoUrl: 'https://example.com/l.png' }])
      container.querySelector('#client-logo-remove').click()
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { logoUrl: '' })
    })

    it('renames on blur', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [client] })
      const name = container.querySelector('#client-name-input')
      name.value = 'Updated'
      name.dispatchEvent(new Event('blur'))
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { name: 'Updated' })
    })

    it('reverts an empty or duplicate name instead of saving it', async () => {
      seed({ clients: [client, { id: 'c2', name: 'Taken' }] })
      const name = container.querySelector('#client-name-input')
      name.value = '  '
      name.dispatchEvent(new Event('blur'))
      expect(name.value).toBe('Original')
      name.value = 'taken'
      name.dispatchEvent(new Event('blur'))
      expect(name.value).toBe('Original')
      expect(db.updateClient).not.toHaveBeenCalled()
    })

    it('saves rate and currency on change', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [client] })
      container.querySelector('#client-rate').value = '250'
      container.querySelector('#client-rate').dispatchEvent(new Event('change'))
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { defaultHourlyRate: 250, currency: 'INR' })
    })

    it('shows the Slack channel by name and saves a picked channel', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [{ ...client, slackChannelId: 'C012345678', slackChannelName: 'original' }] })
      const btn = container.querySelector('#client-slack-btn')
      expect(btn.textContent).toContain('#original')
      btn.click()
      const { onPick, value } = vi.mocked(openChannelPicker).mock.calls[0][1]
      expect(value).toBe('C012345678')
      onPick({ id: 'C0NEW00000', name: 'new-home', isMember: true })
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { slackChannelId: 'C0NEW00000', slackChannelName: 'new-home' })
    })

    it('saves the default owner and the client-shared channel', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [{ ...client, defaultOwner: 'bob@example.com', clientSharedChannelId: 'C0SHARED000' }] })
      const owner = container.querySelector('#client-default-owner')
      expect(owner.querySelector('option[selected]').value).toBe('bob@example.com')
      owner.value = 'alice@example.com'
      owner.dispatchEvent(new Event('change'))
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { defaultOwner: 'alice@example.com' })

      const btn = container.querySelector('#client-shared-btn')
      expect(btn.textContent).toContain('C0SHARED000')
      btn.click()
      const { onPick } = vi.mocked(openChannelPicker).mock.calls.at(-1)[1]
      onPick({ id: 'C0CLIENT000', name: 'acme-shared', isMember: true })
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', {
        clientSharedChannelId: 'C0CLIENT000', clientSharedChannelName: 'acme-shared',
      })
    })

    it('keeps the focused field and its text when a snapshot re-renders the pane', () => {
      seed({ clients: [client] })
      container.querySelector('#add-project-btn').click()
      const field = container.querySelector('#pf-name')
      field.value = 'Half-typed'
      field.focus()
      projectsCallback([{ id: 'p9', name: 'From a teammate', clientId: 'c1' }])
      expect(document.activeElement.id).toBe('pf-name')
      expect(container.querySelector('#pf-name').value).toBe('Half-typed')
      container.querySelector('#pf-cancel').click()
    })

    it('reports a failed save instead of failing silently', async () => {
      vi.mocked(db.updateClient).mockRejectedValue(new Error('permission denied'))
      seed({ clients: [client] })
      const name = container.querySelector('#client-name-input')
      name.value = 'Updated'
      name.dispatchEvent(new Event('blur'))
      await tick()
      expect(document.getElementById('manage-toast').textContent).toContain('permission denied')
    })
  })

  describe('Projects', () => {
    const client = { id: 'c1', name: 'Client', defaultHourlyRate: 100, currency: 'USD' }
    const submitProject = (name) => {
      container.querySelector('#add-project-btn').click()
      container.querySelector('#pf-name').value = name
      container.querySelector('#add-project-form').dispatchEvent(new Event('submit', { cancelable: true }))
    }

    it('shows an empty state when the client has no projects', () => {
      seed({ clients: [client] })
      expect(container.querySelector('#projects-list').textContent).toContain('No projects yet')
    })

    it('adds a project at the client rate and keeps the row open for the next one', async () => {
      vi.mocked(db.createProject).mockResolvedValue({ id: 'p-new' })
      seed({ clients: [client] })
      submitProject('New Project')
      await tick()
      expect(db.createProject).toHaveBeenCalledWith(mockCtx.db, {
        name: 'New Project', clientId: 'c1', hourlyRate: 100, currency: 'USD',
      })
      expect(container.querySelector('#add-project-form').classList.contains('hidden')).toBe(false)
      container.querySelector('#pf-cancel').click()
    })

    it('refuses a duplicate project name', async () => {
      seed({ clients: [client], projects: [{ id: 'p1', name: 'Website', clientId: 'c1' }] })
      submitProject('website')
      await tick()
      expect(db.createProject).not.toHaveBeenCalled()
      container.querySelector('#pf-cancel').click()
    })

    it('opens project settings from a row; rename, and delete only after confirming', async () => {
      vi.mocked(db.updateProject).mockResolvedValue()
      vi.mocked(db.deleteProject).mockResolvedValue()
      seed({ clients: [client], projects: [{ id: 'p1', name: 'Website', clientId: 'c1', hourlyRate: 100 }] })
      container.querySelector('.project-row').click()
      container.querySelector('.tab[data-tab="settings"]').click()

      const name = container.querySelector('#project-name')
      name.value = 'Web'
      name.dispatchEvent(new Event('change'))
      await tick()
      expect(db.updateProject).toHaveBeenCalledWith(mockCtx.db, 'p1', { name: 'Web' })

      container.querySelector('#project-delete-btn').click()
      document.querySelector('.manage-confirm [data-act="cancel"]').click()
      await tick()
      expect(db.deleteProject).not.toHaveBeenCalled()

      container.querySelector('#project-delete-btn').click()
      document.querySelector('.manage-confirm [data-act="confirm"]').click()
      await tick()
      expect(db.deleteProject).toHaveBeenCalledWith(mockCtx.db, 'p1')
    })
  })

  describe('People with access', () => {
    const client = { id: 'c1', name: 'Client' }
    const submitPerson = (name, email) => {
      container.querySelector('#add-cu-btn').click()
      container.querySelector('#cuf-name').value = name
      container.querySelector('#cuf-email').value = email
      container.querySelector('#add-cu-form').dispatchEvent(new Event('submit', { cancelable: true }))
    }

    it('gives access with a lowercased email', async () => {
      vi.mocked(db.createClientUser).mockResolvedValue()
      seed({ clients: [client] })
      submitPerson('Sam', 'Sam@Client.com')
      await tick()
      expect(db.createClientUser).toHaveBeenCalledWith(mockCtx.db, 'sam@client.com', {
        name: 'Sam', clientId: 'c1', invitedBy: 'test@example.com',
      })
    })

    it('rejects a malformed email, a studio email, and an email already tied to another client', async () => {
      seed({
        clients: [client, { id: 'c2', name: 'Other Co' }],
        users: [{ email: 'pat@other.com', name: 'Pat', clientId: 'c2' }],
      })
      const note = () => container.querySelector('#cuf-note').textContent
      submitPerson('Sam', 'not-an-email')
      expect(note()).toContain('full email')
      submitPerson('Sam', 'sam@publicknowledge.co')
      expect(note()).toContain('Studio accounts')
      submitPerson('Pat', 'pat@other.com')
      expect(note()).toContain('Other Co')
      await tick()
      expect(db.createClientUser).not.toHaveBeenCalled()
      container.querySelector('#cuf-cancel').click()
    })

    it('removes access only after confirming', async () => {
      vi.mocked(db.deleteClientUser).mockResolvedValue()
      seed({ clients: [client], users: [{ email: 'sam@client.com', name: 'Sam', clientId: 'c1' }] })
      container.querySelector('.cu-delete').click()
      document.querySelector('.manage-confirm [data-act="confirm"]').click()
      await tick()
      expect(db.deleteClientUser).toHaveBeenCalledWith(mockCtx.db, 'sam@client.com')
    })
  })

  describe('Archive & dormant states', () => {
    it('archives the client on click', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [{ id: 'c1', name: 'Acme' }] })
      const btn = container.querySelector('#archive-client-btn')
      expect(btn.textContent).toContain('Archive')
      btn.click()
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { archived: true })
    })

    it('shows an Archived banner with Unarchive for an archived client', async () => {
      vi.mocked(db.updateClient).mockResolvedValue()
      seed({ clients: [{ id: 'c1', name: 'Acme', archived: true }] })
      expect(container.querySelector('.manage-banner').textContent).toContain('Archived')
      const btn = container.querySelector('#archive-client-btn')
      expect(btn.textContent).toContain('Unarchive')
      btn.click()
      await tick()
      expect(db.updateClient).toHaveBeenCalledWith(mockCtx.db, 'c1', { archived: false })
    })

    it('groups a client with no open items under "No open work"', () => {
      seed({ clients: [{ id: 'c1', name: 'Acme' }] }) // mockCtx.allTasks = []
      expect(container.querySelector('.manage-sidebar-group').textContent).toContain('No open work')
      expect(container.querySelector('.manage-banner-quiet')).toBeTruthy()
    })

    it('shows no group label or banner for a client that has an open item', () => {
      const ctx = { ...mockCtx, allTasks: [{ id: 't1', clientId: 'c1', status: 'todo' }] }
      seed({ clients: [{ id: 'c1', name: 'Acme' }] }, ctx)
      expect(container.querySelector('.manage-sidebar-group')).toBeFalsy()
      expect(container.querySelector('.manage-banner')).toBeFalsy()
    })

    it('tucks archived clients into a collapsed group below the active ones', () => {
      const ctx = { ...mockCtx, allTasks: [{ id: 't1', clientId: 'c_active', status: 'todo' }] }
      seed({ clients: [
        { id: 'c_archived', name: 'Archived Co', archived: true },
        { id: 'c_active', name: 'Active Co' },
      ] }, ctx)

      let rows = container.querySelectorAll('.manage-client-row')
      expect(rows).toHaveLength(1)
      expect(rows[0].dataset.id).toBe('c_active')

      const toggle = container.querySelector('#manage-archived-toggle')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      toggle.click()
      rows = container.querySelectorAll('.manage-client-row')
      expect(rows).toHaveLength(2)
      expect(rows[1].dataset.id).toBe('c_archived')
      container.querySelector('#manage-archived-toggle').click()
    })
  })

  describe('cleanupClients', () => {
    it('unsubscribes from all listeners', () => {
      const unsubs = [vi.fn(), vi.fn(), vi.fn()]
      vi.mocked(db.subscribeToClients).mockReturnValue(unsubs[0])
      vi.mocked(db.subscribeToProjects).mockReturnValue(unsubs[1])
      vi.mocked(db.subscribeToClientUsers).mockReturnValue(unsubs[2])
      renderClients(container, mockCtx)
      cleanupClients()
      unsubs.forEach((u) => expect(u).toHaveBeenCalled())
    })

    it('is a no-op when no subscriptions active', () => {
      expect(() => cleanupClients()).not.toThrow()
    })
  })
})
