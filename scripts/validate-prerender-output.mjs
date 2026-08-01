import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { STATIC_PUBLIC_ROUTES } from '../src/config/publicRouteManifest.js'

export const MIN_VISIBLE_WORDS = 70
export const FORBIDDEN_PLACEHOLDERS = Object.freeze([
  'structured candidate signals for recruiter review',
])

const DIST_DIR = resolve(process.cwd(), 'dist')

function routeToFile(pathname) {
  return pathname === '/' ? resolve(DIST_DIR, 'index.html') : resolve(DIST_DIR, pathname.slice(1), 'index.html')
}

function decodeHtmlEntities(text) {
  const namedEntities = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }
  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, value) => {
    if (value[0] === '#') {
      const hexadecimal = value[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(value.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity
    }
    return namedEntities[value.toLowerCase()] ?? ' '
  })
}

export function getVisibleBodyText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? ''
  return decodeHtmlEntities(body
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function countVisibleWords(html) {
  return getVisibleBodyText(html).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0
}

async function validatePrerenderOutput() {
  const failures = []

  for (const route of STATIC_PUBLIC_ROUTES) {
    const filePath = routeToFile(route.path)
    let html
    try {
      html = await readFile(filePath, 'utf8')
    } catch (error) {
      failures.push(`${route.path} (${filePath}): expected generated HTML is missing or unreadable (${error.code || error.message}); visible words: 0; minimum: ${MIN_VISIBLE_WORDS}; forbidden placeholder: none`)
      continue
    }

    const visibleText = getVisibleBodyText(html)
    const wordCount = countVisibleWords(html)
    const placeholders = FORBIDDEN_PLACEHOLDERS.filter((phrase) => visibleText.toLowerCase().includes(phrase.toLowerCase()))
    if (wordCount < MIN_VISIBLE_WORDS || placeholders.length > 0) {
      failures.push(`${route.path} (${filePath}): visible words: ${wordCount}; minimum: ${MIN_VISIBLE_WORDS}; forbidden placeholder: ${placeholders.join(', ') || 'none'}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Prerender content validation failed:\n- ${failures.join('\n- ')}`)
  }

  console.log(`Prerender content validation passed for ${STATIC_PUBLIC_ROUTES.length} public routes (minimum ${MIN_VISIBLE_WORDS} visible words; ${FORBIDDEN_PLACEHOLDERS.length} forbidden placeholder checked).`)
}

validatePrerenderOutput().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
