import { describe, expect, it } from 'vitest'
import { handleImageError } from './image-fallbacks.js'

describe('client logo image fallbacks', () => {
  it('replaces a broken client logo with an initial placeholder', () => {
    const img = document.createElement('img')
    img.className = 'manage-client-logo'
    img.alt = 'Absential Labs'
    document.body.appendChild(img)

    handleImageError({ target: img })

    const fallback = document.body.querySelector('.manage-client-logo')
    expect(fallback?.tagName).toBe('SPAN')
    expect(fallback?.classList.contains('manage-client-logo-placeholder')).toBe(true)
    expect(fallback?.textContent).toBe('A')
  })

  it('ignores non-client images', () => {
    const img = document.createElement('img')
    img.className = 'avatar-photo-sm'
    img.alt = 'Gyan'
    document.body.appendChild(img)

    handleImageError({ target: img })

    expect(document.body.querySelector('img.avatar-photo-sm')).toBe(img)
  })
})
