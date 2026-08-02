import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { STATIC_PUBLIC_ROUTES } from '../src/config/publicRouteManifest.js'

// Keep this threshold high enough to catch placeholder regressions without rejecting concise public pages.
export const MIN_VISIBLE_WORDS = 72
export const FORBIDDEN_PLACEHOLDERS = Object.freeze([
  'structured candidate signals for recruiter review',
])

const DEFAULT_DIST_DIR = resolve(process.cwd(), 'dist')

function routeToFile(pathname, distDir = DEFAULT_DIST_DIR) {
  return pathname === '/' ? resolve(distDir, 'index.html') : resolve(distDir, pathname.slice(1), 'index.html')
}

function decodeHtmlEntities(text) {
  const namedEntities = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }
  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, value) => {
    if (value[0] === '#') {
      const hexadecimal = value[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    }
    return namedEntities[value.toLowerCase()] ?? ' '
  })
}

export function getVisibleText(html) {
  return decodeHtmlEntities(html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractMainHtml(html) {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  return match ? match[1] : null
}

export function countVisibleWords(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0
}

export function inspectGeneratedHtml(html) {
  const mainHtml = extractMainHtml(html)
  const visibleText = mainHtml === null ? '' : getVisibleText(mainHtml)
  return {
    missingMainBoundary: mainHtml === null,
    visibleText,
    wordCount: countVisibleWords(visibleText),
    placeholders: FORBIDDEN_PLACEHOLDERS.filter((phrase) => visibleText.toLowerCase().includes(phrase.toLowerCase())),
  }
}

export async function validatePrerenderOutput({ distDir = DEFAULT_DIST_DIR, routes = STATIC_PUBLIC_ROUTES } = {}) {
  const failures = []
  const results = []

  for (const route of routes) {
    const filePath = routeToFile(route.path, distDir)
    let html
    try {
      html = await readFile(filePath, 'utf8')
    } catch (error) {
      failures.push(`${route.path} (${filePath}): expected generated HTML is missing or unreadable (${error.code || error.message}); route-specific visible words: 0; minimum: ${MIN_VISIBLE_WORDS}; missing <main> boundary: unknown; forbidden placeholder: none`)
      continue
    }

    const result = { route: route.path, filePath, ...inspectGeneratedHtml(html) }
    results.push(result)
    if (result.missingMainBoundary || result.wordCount < MIN_VISIBLE_WORDS || result.placeholders.length > 0) {
      failures.push(`${route.path} (${filePath}): route-specific visible words: ${result.wordCount}; minimum: ${MIN_VISIBLE_WORDS}; missing <main> boundary: ${result.missingMainBoundary ? 'yes' : 'no'}; forbidden placeholder: ${result.placeholders.join(', ') || 'none'}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Prerender content validation failed:\n- ${failures.join('\n- ')}`)
  }

  return results
}

async function main() {
  const results = await validatePrerenderOutput()
  console.log(`Prerender content validation passed for ${results.length} public routes (minimum ${MIN_VISIBLE_WORDS} route-specific visible words; ${FORBIDDEN_PLACEHOLDERS.length} forbidden placeholder checked).`)
  for (const result of results) console.log(`${result.route}: ${result.wordCount} route-specific visible words.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
