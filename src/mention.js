import { TEAM } from './config.js'

/**
 * Attaches @ mention behavior to an input element.
 * Typing @ shows a dropdown with people and projects.
 * Multiple people can be tagged, but only one project.
 *
 * Returns a controller object with:
 *  - getTags() → { assignees: string[], projectId: string, projectName: string }
 *  - destroy()  → cleanup listeners
 */
export function attachMention(input, { projects = [], clients = [] } = {}) {
  const tags = { assignees: [], projectId: '', projectName: '' }
  let dropdown = null
  let activeIdx = 0
  let mentionStart = -1

  function getFilteredItems(query) {
    const q = query.toLowerCase()
    const people = TEAM
      .filter((m) => !tags.assignees.includes(m.email))
      .filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .map((m) => ({ type: 'person', id: m.email, name: m.name, color: m.color, photoURL: m.photoURL }))

    const projs = tags.projectId
      ? [] // already selected a project
      : projects
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => {
          const client = clients.find((c) => c.id === p.clientId)
          return {
            type: 'project',
            id: p.id,
            name: p.name,
            clientName: client?.name || '',
            clientLogo: client?.logoUrl || '',
          }
        })

    return [...people, ...projs]
  }

  function showDropdown(items) {
    removeDropdown()
    if (items.length === 0) return

    dropdown = document.createElement('div')
    dropdown.className = 'mention-dropdown'

    // Position relative to the input — open upward if near bottom of viewport
    const rect = input.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const openUpward = spaceBelow < 200

    dropdown.style.left = rect.left + 'px'
    dropdown.style.minWidth = Math.min(rect.width, 260) + 'px'

    if (openUpward) {
      dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px'
      dropdown.style.top = 'auto'
    } else {
      dropdown.style.top = (rect.bottom + 4) + 'px'
      dropdown.style.bottom = 'auto'
    }

    items.forEach((item, i) => {
      const opt = document.createElement('div')
      opt.className = 'mention-option' + (i === activeIdx ? ' active' : '')
      opt.dataset.index = i

      if (item.type === 'person') {
        const avatarHtml = item.photoURL
          ? `<img class="avatar-photo-xs" src="${item.photoURL}" alt="${item.name}">`
          : `<span class="avatar-xs" style="background:${item.color}">${item.name[0]}</span>`
        opt.innerHTML = `${avatarHtml} <span>${esc(item.name)}</span>`
      } else {
        const logoHtml = item.clientLogo
          ? `<img class="client-logo-xs" src="${item.clientLogo}" alt="${esc(item.clientName)}">`
          : '<i class="ph ph-folder-simple" style="color:var(--text-tertiary);font-size:16px"></i>'
        const label = item.clientName ? `${item.clientName} · ${item.name}` : item.name
        opt.innerHTML = `${logoHtml} <span>${esc(label)}</span>`
      }

      opt.addEventListener('mousedown', (e) => {
        e.preventDefault() // keep focus on input
        selectItem(items[i])
      })
      opt.addEventListener('mouseenter', () => {
        activeIdx = i
        highlightActive()
      })
      dropdown.appendChild(opt)
    })

    document.body.appendChild(dropdown)
  }

  function removeDropdown() {
    if (dropdown) {
      dropdown.remove()
      dropdown = null
    }
    mentionStart = -1
  }

  function highlightActive() {
    if (!dropdown) return
    dropdown.querySelectorAll('.mention-option').forEach((opt, i) => {
      opt.classList.toggle('active', i === activeIdx)
    })
  }

  function selectItem(item) {
    if (item.type === 'person') {
      tags.assignees.push(item.id)
    } else {
      tags.projectId = item.id
      tags.projectName = item.name
    }

    // Replace @query with the tag display in the input
    const before = input.value.substring(0, mentionStart)
    const after = input.value.substring(input.selectionStart)
    input.value = before + after
    input.setSelectionRange(before.length, before.length)

    removeDropdown()
    renderChips()
  }

  function renderChips() {
    // Remove old chip container
    let chipWrap = input.parentElement.querySelector('.mention-chips')
    if (!chipWrap) {
      chipWrap = document.createElement('div')
      chipWrap.className = 'mention-chips'
      input.parentElement.insertBefore(chipWrap, input)
      // Make parent a flex wrapper
      input.parentElement.style.display = 'flex'
      input.parentElement.style.flexWrap = 'wrap'
      input.parentElement.style.alignItems = 'center'
      input.parentElement.style.gap = '4px'
    }

    let html = ''
    // People chips
    tags.assignees.forEach((email) => {
      const m = TEAM.find((t) => t.email === email)
      if (!m) return
      const avatarHtml = m.photoURL
        ? `<img class="avatar-photo-xs" src="${m.photoURL}" alt="${m.name}">`
        : `<span class="avatar-xs" style="background:${m.color}">${m.name[0]}</span>`
      html += `<span class="mention-chip person" data-email="${email}">
        ${avatarHtml}
        <span>${esc(m.name)}</span>
        <button class="mention-chip-remove" data-type="person" data-id="${email}">&times;</button>
      </span>`
    })
    // Project chip
    if (tags.projectId) {
      const proj = projects.find((p) => p.id === tags.projectId)
      const client = proj ? clients.find((c) => c.id === proj.clientId) : null
      const logoHtml = client?.logoUrl
        ? `<img class="client-logo-xs" src="${client.logoUrl}" alt="">`
        : '<i class="ph ph-folder-simple" style="font-size:14px;color:var(--text-tertiary)"></i>'
      const label = client ? `${client.name} · ${tags.projectName}` : tags.projectName
      html += `<span class="mention-chip project" data-project-id="${tags.projectId}">
        ${logoHtml}
        <span>${esc(label)}</span>
        <button class="mention-chip-remove" data-type="project" data-id="${tags.projectId}">&times;</button>
      </span>`
    }

    chipWrap.innerHTML = html

    // Bind remove buttons
    chipWrap.querySelectorAll('.mention-chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (btn.dataset.type === 'person') {
          tags.assignees = tags.assignees.filter((em) => em !== btn.dataset.id)
        } else {
          tags.projectId = ''
          tags.projectName = ''
        }
        renderChips()
        input.focus()
      })
    })

    // Hide chip container if empty
    chipWrap.style.display = html ? 'flex' : 'none'
  }

  function onInput() {
    const val = input.value
    const caret = input.selectionStart

    // Find the last @ before caret that isn't preceded by a non-space character
    let atPos = -1
    for (let i = caret - 1; i >= 0; i--) {
      if (val[i] === '@') {
        if (i === 0 || /\s/.test(val[i - 1])) {
          atPos = i
        }
        break
      }
      if (/\s/.test(val[i])) break
    }

    if (atPos >= 0) {
      mentionStart = atPos
      const query = val.substring(atPos + 1, caret)
      const items = getFilteredItems(query)
      activeIdx = 0
      showDropdown(items)
    } else {
      removeDropdown()
    }
  }

  function onKeydown(e) {
    // Backspace on empty input removes the last chip
    if (e.key === 'Backspace' && !input.value && !dropdown) {
      if (tags.projectId) {
        tags.projectId = ''
        tags.projectName = ''
        renderChips()
        return
      }
      if (tags.assignees.length > 0) {
        tags.assignees.pop()
        renderChips()
        return
      }
    }

    if (!dropdown) return

    const items = dropdown.querySelectorAll('.mention-option')
    if (items.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIdx = (activeIdx + 1) % items.length
      highlightActive()
      items[activeIdx]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIdx = (activeIdx - 1 + items.length) % items.length
      highlightActive()
      items[activeIdx]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && dropdown) {
      // If dropdown is open, select the active item instead of creating the task
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const filtered = getFilteredItems(input.value.substring(mentionStart + 1, input.selectionStart))
      if (filtered.length > 0 && activeIdx < filtered.length) {
        selectItem(filtered[activeIdx])
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      removeDropdown()
    } else if (e.key === 'Tab') {
      const filtered = getFilteredItems(input.value.substring(mentionStart + 1, input.selectionStart))
      if (filtered.length > 0 && activeIdx < filtered.length) {
        e.preventDefault()
        selectItem(filtered[activeIdx])
      }
    }
  }

  function onBlur() {
    // Delay to allow mousedown on dropdown items
    setTimeout(removeDropdown, 200)
  }

  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKeydown, true) // capture phase so we intercept Enter before board handler
  input.addEventListener('blur', onBlur)

  // Initial render
  renderChips()

  return {
    getTags() {
      return { ...tags }
    },
    reset() {
      tags.assignees = []
      tags.projectId = ''
      tags.projectName = ''
      renderChips()
      removeDropdown()
    },
    destroy() {
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeydown, true)
      input.removeEventListener('blur', onBlur)
      removeDropdown()
      const chipWrap = input.parentElement?.querySelector('.mention-chips')
      if (chipWrap) chipWrap.remove()
    },
    isOpen() {
      return dropdown !== null
    },
  }
}

function esc(str) {
  const el = document.createElement('span')
  el.textContent = str || ''
  return el.innerHTML
}
