import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(__dirname, 'style.css'), 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

function findBlock(text, selectorRegex) {
  const m = text.match(selectorRegex)
  if (!m) return null
  const headStart = text.indexOf(m[0])
  const braceStart = text.indexOf('{', headStart)
  let depth = 0
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        return {
          headStart,
          end: i + 1,
          body: text.slice(braceStart + 1, i),
        }
      }
    }
  }
  return null
}

const rootBlock = findBlock(css, /^:root\s*\{/m)
const darkBlock = findBlock(css, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/)
const darkRoot = darkBlock ? findBlock(darkBlock.body, /:root\s*\{/) : null

const extractDecls = (body) => {
  const out = new Map()
  for (const m of body.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

const lightTokens = rootBlock ? extractDecls(rootBlock.body) : new Map()
const darkTokens = darkRoot ? extractDecls(darkRoot.body) : new Map()

// Tokens that are intentionally mode-invariant (geometry, typography, aliases).
// They live in :root but don't need a counterpart in the dark block.
const MODE_INVARIANT_TOKENS = new Set([
  '--radius',
  '--radius-lg',
  '--font',
  '--font-mono',
  '--hover', // alias of --surface-hover, which itself flips
])

const cssOutsideTokenBlocks =
  css.slice(0, rootBlock.headStart) +
  css.slice(rootBlock.end, darkBlock.headStart) +
  css.slice(darkBlock.end)

// Intentional literals — color values that don't need to theme-switch.
// Add to this list with a comment explaining why.
const LITERAL_ALLOWLIST_PATTERNS = [
  // White text reads on every colored accent (avatars, primary buttons, etc.)
  /\bcolor:\s*(white|#fff(?:fff)?)\b/i,
  // Gradients use literal stops; the few that exist are decorative
  /\blinear-gradient\(/,
  /\bradial-gradient\(/,
]

const LITERAL_ALLOWED_LINES = new Set([
  'background-color: #FF4343;', // PK brand login splash
  'border: solid #fff;', // checkbox tick — sits on --primary
  'background: rgba(0, 0, 0, 0.6);', // ref-card domain chip — overlay on image
])

const LITERAL_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/

describe('design system contract', () => {
  it('parses the :root and dark @media blocks', () => {
    expect(rootBlock).not.toBeNull()
    expect(darkBlock).not.toBeNull()
    expect(darkRoot).not.toBeNull()
    expect(lightTokens.size).toBeGreaterThan(0)
    expect(darkTokens.size).toBeGreaterThan(0)
  })

  it('every theme-aware token in :root has a matching override in the dark @media block', () => {
    const missing = []
    for (const name of lightTokens.keys()) {
      if (MODE_INVARIANT_TOKENS.has(name)) continue
      if (!darkTokens.has(name)) missing.push(name)
    }
    expect(missing, `tokens declared in :root but missing from dark block:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('every token in the dark @media block is declared in :root', () => {
    const extra = []
    for (const name of darkTokens.keys()) {
      if (!lightTokens.has(name)) extra.push(name)
    }
    expect(extra, `tokens declared in dark block but missing from :root:\n  ${extra.join('\n  ')}`).toEqual([])
  })

  it('contains no literal colors outside the token blocks (except allowlist)', () => {
    const violations = []
    for (const rawLine of cssOutsideTokenBlocks.split('\n')) {
      const line = rawLine.trim()
      if (!LITERAL_COLOR_RE.test(line)) continue
      if (LITERAL_ALLOWED_LINES.has(line)) continue
      if (LITERAL_ALLOWLIST_PATTERNS.some((p) => p.test(line))) continue
      violations.push(line)
    }
    expect(
      violations,
      `literal colors found outside the token blocks. tokenize them or add to LITERAL_ALLOWED_LINES with a comment:\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })
})
