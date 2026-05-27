const CLIENT_LOGO_CLASSES = [
  'client-logo',
  'client-logo-xs',
  'client-tab-logo',
  'manage-client-logo',
  'manage-detail-logo',
]

const CLIENT_LOGO_CONTEXT_SELECTOR = [
  '.header-filter-client',
  '.project-picker-group-label',
  '.client-tab',
  '.task-block',
  '.tb-project',
  '.person-row',
  '.mention-option',
  '.mention-chip',
  '.column-header',
  '.timesheet-header',
].join(',')

let installed = false

export function installImageFallbacks(root = document) {
  if (installed) return
  installed = true

  root.addEventListener('error', handleImageError, true)
}

export function handleImageError(event) {
  const img = event.target
  if (!(img instanceof HTMLImageElement) || !isClientLogoImage(img)) return

  const placeholder = document.createElement('span')
  placeholder.className = placeholderClassName(img)
  placeholder.textContent = fallbackInitial(img)
  placeholder.setAttribute('aria-label', img.alt || 'Client logo')

  img.replaceWith(placeholder)
}

function isClientLogoImage(img) {
  return CLIENT_LOGO_CLASSES.some((className) => img.classList.contains(className))
    || !!img.closest(CLIENT_LOGO_CONTEXT_SELECTOR)
}

function placeholderClassName(img) {
  const classes = [...img.classList].filter(Boolean)

  if (img.classList.contains('client-tab-logo')) {
    classes.push('client-tab-logo-placeholder')
  } else if (img.classList.contains('manage-client-logo') || img.classList.contains('manage-detail-logo')) {
    classes.push('manage-client-logo-placeholder')
  } else {
    classes.push('client-logo-placeholder')
    if (classes.length === 0) classes.push('client-logo-xs')
  }

  return [...new Set(classes)].join(' ')
}

function fallbackInitial(img) {
  const label = (img.alt || img.title || '').trim()
  return (label[0] || '?').toUpperCase()
}
