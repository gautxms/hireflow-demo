#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TOKENS_FILE = path.join(ROOT, 'src/styles/variables.css')
const target = process.argv.includes('--aaa') ? 'AAA' : 'AA'

const textThreshold = target === 'AAA' ? 7 : 4.5
const uiThreshold = 3

const SPEC = {
  surfaces: ['--color-bg-primary', '--color-bg-secondary', '--color-bg-elevated'],
  textCombos: [
    ['--color-text-primary', '--color-bg-primary', 'primary text'],
    ['--color-text-secondary', '--color-bg-primary', 'secondary text'],
    ['--color-text-nav', '--color-bg-primary', 'nav text'],
    ['--color-text-muted', '--color-bg-primary', 'muted text'],
    ['--color-bg-primary', '--color-accent-green', 'primary button text'],
    ['--color-bg-primary', '--color-accent-green-hover', 'primary button hover text'],
    ['--color-accent-green', '--color-bg-primary', 'accent text'],
    ['--color-success-text', '--color-bg-primary', 'success text'],
    ['--color-warning-text', '--color-bg-primary', 'warning text'],
    ['--color-error', '--color-bg-primary', 'error text'],
    ['--color-info', '--color-bg-primary', 'info text'],
    ['--color-success-text', '--color-bg-secondary', 'success text on secondary'],
    ['--color-warning-text', '--color-bg-secondary', 'warning text on secondary'],
    ['--color-error', '--color-bg-secondary', 'error text on secondary'],
    ['--color-info', '--color-bg-secondary', 'info text on secondary'],
  ],
  alertCombos: [
    ['--color-success-text', '--color-success-alpha-12', '--color-bg-primary', 'success alert'],
    ['--color-warning-text', '--color-warning-alpha-12', '--color-bg-primary', 'warning alert'],
    ['--color-error', '--color-danger-alpha-15', '--color-bg-primary', 'error alert'],
    ['--color-info', '--color-info-alpha-16', '--color-bg-primary', 'info alert'],
  ],
  uiCombos: [
    ['--color-accent-green', '--color-bg-primary', 'focus ring on bg-primary'],
    ['--color-accent-green', '--color-bg-secondary', 'focus ring on bg-secondary'],
    ['--color-accent-green', '--color-bg-elevated', 'focus ring on bg-elevated'],
  ],
}

function parseTokens(css) {
  const tokens = new Map()
  for (const match of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(`--${match[1]}`, match[2].trim())
  }
  return tokens
}

function parseColor(value, tokens, depth = 0) {
  if (depth > 8) throw new Error(`Could not resolve color from ${value}`)
  const cleaned = value.trim()
  if (cleaned.startsWith('var(')) {
    const tokenName = cleaned.slice(4, -1).trim()
    return parseColor(tokens.get(tokenName), tokens, depth + 1)
  }

  const hex = cleaned.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
      a: 1,
    }
  }

  const rgba = cleaned.match(/^rgba?\(([^)]+)\)$/i)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim())
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) }
  }

  throw new Error(`Unsupported color format: ${cleaned}`)
}

function blend(fg, bg) {
  const alpha = fg.a ?? 1
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
    a: 1,
  }
}

function luminance(color) {
  const toLinear = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)
}

function ratio(c1, c2) {
  const l1 = luminance(c1)
  const l2 = luminance(c2)
  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return (light + 0.05) / (dark + 0.05)
}

function resolveTokenColor(token, tokens) {
  const raw = tokens.get(token)
  if (!raw) throw new Error(`Missing token ${token}`)
  return parseColor(raw, tokens)
}

function fmt(n) {
  return n.toFixed(2)
}

function main() {
  const css = fs.readFileSync(TOKENS_FILE, 'utf8')
  const tokens = parseTokens(css)
  const failures = []

  console.log(`WCAG ${target} text threshold: ${textThreshold}:1 | UI threshold: ${uiThreshold}:1`)

  for (const [fgToken, bgToken, label] of SPEC.textCombos) {
    const contrast = ratio(resolveTokenColor(fgToken, tokens), resolveTokenColor(bgToken, tokens))
    const pass = contrast >= textThreshold
    console.log(`${pass ? '✅' : '❌'} text ${label}: ${fgToken} on ${bgToken} = ${fmt(contrast)}:1`)
    if (!pass) failures.push(`text ${label} (${fmt(contrast)}:1)`)
  }

  for (const [fgToken, bgToken, surfaceToken, label] of SPEC.alertCombos) {
    const surface = resolveTokenColor(surfaceToken, tokens)
    const bg = blend(resolveTokenColor(bgToken, tokens), surface)
    const contrast = ratio(resolveTokenColor(fgToken, tokens), bg)
    const pass = contrast >= textThreshold
    console.log(`${pass ? '✅' : '❌'} alert ${label}: ${fgToken} on ${bgToken} over ${surfaceToken} = ${fmt(contrast)}:1`)
    if (!pass) failures.push(`alert ${label} (${fmt(contrast)}:1)`)
  }

  for (const [fgToken, bgToken, label] of SPEC.uiCombos) {
    const contrast = ratio(resolveTokenColor(fgToken, tokens), resolveTokenColor(bgToken, tokens))
    const pass = contrast >= uiThreshold
    console.log(`${pass ? '✅' : '❌'} ui ${label}: ${fgToken} on ${bgToken} = ${fmt(contrast)}:1`)
    if (!pass) failures.push(`ui ${label} (${fmt(contrast)}:1)`)
  }

  if (failures.length) {
    console.error(`\nFound ${failures.length} WCAG contrast failure(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.log('\nAll configured semantic combinations passed contrast checks.')
}

main()
