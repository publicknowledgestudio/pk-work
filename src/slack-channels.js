// Slack channel lookup + picker for the Manage page.
//
// Channels come from the `slackChannels` Cloud Function (functions/slack-channels.cjs),
// which lists what the bot can see. If that call fails — function not deployed,
// bot missing a scope — the picker still works by pasting a channel link or ID.

import { isDemo, demo } from './demo.js'

const ENDPOINT = 'https://us-central1-workdotpk-a06dc.cloudfunctions.net/slackChannels'

let cached = null   // [{ id, name, isPrivate, isMember }]
let inflight = null

export async function loadSlackChannels(currentUser, { force = false } = {}) {
  if (cached && !force) return cached
  if (inflight) return inflight
  inflight = (async () => {
    if (isDemo()) return demo.listSlackChannels()
    const token = await currentUser.getIdToken()
    const resp = await fetch(ENDPOINT + (force ? '?refresh=1' : ''), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(body.error || `Request failed (${resp.status})`)
    return body.channels || []
  })()
  try {
    cached = await inflight
    return cached
  } finally {
    inflight = null
  }
}

// Name for a channel ID from the already-loaded list (no fetch). '' if unknown.
export function knownChannelName(id) {
  return cached?.find((c) => c.id === id)?.name || ''
}

// Pull a channel ID out of whatever was pasted: a bare ID (C08UCQXH7D0) or a
// Slack link (…/archives/C08UCQXH7D0, …/client/T…/C08UCQXH7D0). null if neither.
export function parseChannelRef(text) {
  const t = (text || '').trim()
  if (/^[CG][A-Z0-9]{8,}$/.test(t)) return t
  const m = t.match(/\/(?:archives|client\/[A-Z0-9]+)\/([CG][A-Z0-9]{8,})/)
  return m ? m[1] : null
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}

let closeOpenPicker = null

// Opens a searchable channel list anchored under `anchor`.
// onPick receives { id, name, isMember } — or { id: '', name: '' } for "no channel".
export function openChannelPicker(anchor, { currentUser, value = '', onPick }) {
  if (closeOpenPicker) closeOpenPicker()

  const pop = document.createElement('div')
  pop.className = 'channel-picker'
  pop.setAttribute('role', 'dialog')
  pop.setAttribute('aria-label', 'Choose a Slack channel')
  pop.innerHTML = `
    <div class="channel-picker-search">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" class="channel-picker-input" placeholder="Search, or paste a channel link" autocomplete="off" aria-label="Search Slack channels">
    </div>
    <div class="channel-picker-list" role="listbox"></div>
    ${value ? '<button type="button" class="channel-picker-clear"><i class="ph ph-x"></i> No channel</button>' : ''}
  `
  document.body.appendChild(pop)

  const input = pop.querySelector('.channel-picker-input')
  const list = pop.querySelector('.channel-picker-list')
  let channels = null
  let loadError = ''
  let activeIndex = 0

  const place = () => {
    const r = anchor.getBoundingClientRect()
    const width = Math.max(280, r.width)
    pop.style.width = width + 'px'
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px'
    const below = window.innerHeight - r.bottom
    if (below < 320 && r.top > below) {
      pop.style.top = ''
      pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'
    } else {
      pop.style.bottom = ''
      pop.style.top = (r.bottom + 4) + 'px'
    }
  }

  const close = () => {
    pop.remove()
    document.removeEventListener('mousedown', onOutside, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', onScroll, true)
    closeOpenPicker = null
    anchor.setAttribute('aria-expanded', 'false')
  }
  const onOutside = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) close()
  }
  const onScroll = (e) => {
    if (!pop.contains(e.target)) close()
  }
  const pick = (choice) => {
    close()
    anchor.focus()
    onPick(choice)
  }

  const options = () => {
    const q = input.value.trim().toLowerCase().replace(/^#/, '')
    const pastedId = parseChannelRef(input.value)
    const out = []
    if (pastedId) {
      const known = channels?.find((c) => c.id === pastedId)
      out.push(known || { id: pastedId, name: '', pasted: true, isMember: true })
    } else if (channels) {
      out.push(...channels.filter((c) => !q || c.name.toLowerCase().includes(q)))
    }
    return out
  }

  const render = () => {
    const opts = options()
    if (activeIndex >= opts.length) activeIndex = Math.max(0, opts.length - 1)
    if (opts.length === 0) {
      let msg
      if (!channels && !loadError) msg = 'Loading channels…'
      else if (loadError) msg = `Couldn't load the channel list. Paste a channel link or ID instead (in Slack: right-click the channel → Copy link).`
      else msg = 'No channel matches. Private channels only appear once the bot has been invited to them.'
      list.innerHTML = `<div class="channel-picker-empty">${esc(msg)}</div>`
      return
    }
    list.innerHTML = opts.map((c, i) => `
      <button type="button" role="option" class="channel-picker-option${i === activeIndex ? ' active' : ''}${c.id === value ? ' selected' : ''}" data-index="${i}" aria-selected="${c.id === value}">
        <i class="ph ${c.isPrivate ? 'ph-lock-simple' : 'ph-hash'}"></i>
        <span class="channel-picker-name">${c.pasted ? `Use channel ${esc(c.id)}` : esc(c.name)}</span>
        ${c.isMember === false ? '<span class="channel-picker-note">bot not invited</span>' : ''}
        ${c.id === value ? '<i class="ph ph-check channel-picker-check"></i>' : ''}
      </button>
    `).join('')
    list.querySelectorAll('.channel-picker-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = opts[Number(btn.dataset.index)]
        pick({ id: c.id, name: c.name || '', isMember: c.isMember !== false })
      })
    })
    list.querySelector('.channel-picker-option.active')?.scrollIntoView?.({ block: 'nearest' })
  }

  input.addEventListener('input', () => { activeIndex = 0; render() })
  input.addEventListener('keydown', (e) => {
    const opts = options()
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(opts.length - 1, activeIndex + 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const c = opts[activeIndex]
      if (c) pick({ id: c.id, name: c.name || '', isMember: c.isMember !== false })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      anchor.focus()
    }
  })
  pop.querySelector('.channel-picker-clear')?.addEventListener('click', () => pick({ id: '', name: '', isMember: true }))

  document.addEventListener('mousedown', onOutside, true)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
  closeOpenPicker = close
  anchor.setAttribute('aria-expanded', 'true')

  place()
  render()
  input.focus()

  loadSlackChannels(currentUser)
    .then((result) => { channels = result })
    .catch((err) => { loadError = err.message || 'failed'; console.error('Slack channel list failed:', err) })
    .finally(() => { if (pop.isConnected) render() })

  return close
}
