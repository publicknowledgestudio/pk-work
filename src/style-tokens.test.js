import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(__dirname, 'style.css'), 'utf8')

describe('style tokens', () => {
  it('maps semantic tokens automatically for dark-mode devices', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toMatch(/color-scheme:\s*dark/)

    const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    expect(darkBlock).toContain('--bg:')
    expect(darkBlock).toContain('--surface:')
    expect(darkBlock).toContain('--surface-hover:')
    expect(darkBlock).toContain('--input-bg:')
    expect(darkBlock).toContain('--overlay:')
    expect(darkBlock).toContain('--status-warning-bg:')
  })

  it('defines shared semantic tokens for core UI surfaces and status states', () => {
    const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('html,'))
    ;[
      '--surface-hover:',
      '--surface-raised:',
      '--input-bg:',
      '--input-border:',
      '--overlay:',
      '--success:',
      '--warning:',
      '--status-todo-bg:',
      '--status-review-bg:',
      '--status-done-bg:',
      '--status-warning-bg:',
    ].forEach((token) => {
      expect(rootBlock).toContain(token)
    })
  })
})
