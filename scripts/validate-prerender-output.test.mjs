import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MIN_VISIBLE_WORDS, getVisibleText, inspectGeneratedHtml, validatePrerenderOutput } from './validate-prerender-output.mjs'

const enoughWords = Array.from({ length: MIN_VISIBLE_WORDS }, (_, index) => `word${index}`).join(' ')
const shell = (main) => `<html><head><meta name="description" content="${enoughWords}"><script type="application/ld+json">{"text":"${enoughWords}"}</script></head><body><header>${enoughWords}</header>${main}<footer>${enoughWords}</footer></body></html>`

test('route-specific main content passes at the threshold', () => {
  assert.equal(inspectGeneratedHtml(shell(`<main>${enoughWords}</main>`)).wordCount, MIN_VISIBLE_WORDS)
})

test('shared header and footer cannot make empty or thin main content pass', () => {
  assert.equal(inspectGeneratedHtml(shell('<main></main>')).wordCount, 0)
  assert.ok(inspectGeneratedHtml(shell('<main>only a few route words</main>')).wordCount < MIN_VISIBLE_WORDS)
})

test('missing main and forbidden route placeholder are reported', () => {
  assert.equal(inspectGeneratedHtml(shell('')).missingMainBoundary, true)
  assert.deepEqual(inspectGeneratedHtml(shell('<main>structured candidate signals for recruiter review</main>')).placeholders, ['structured candidate signals for recruiter review'])
})

test('non-visible elements and comments do not inflate main word count', () => {
  const hidden = `<script>${enoughWords}</script><style>${enoughWords}</style><template>${enoughWords}</template><noscript>${enoughWords}</noscript><!-- ${enoughWords} -->`
  assert.equal(inspectGeneratedHtml(shell(`<main>visible words ${hidden}</main>`)).wordCount, 2)
})

test('ordinary named and numeric HTML entities are decoded', () => {
  assert.equal(getVisibleText('Tom &amp; Jerry&nbsp; &#65; &#x42; &quot;team&quot;'), 'Tom & Jerry A B "team"')
})

test('validation reports missing boundaries and missing generated files', async (t) => {
  const distDir = await mkdtemp(join(tmpdir(), 'hireflow-prerender-'))
  t.after(() => rm(distDir, { recursive: true, force: true }))
  await mkdir(join(distDir, 'missing-main'), { recursive: true })
  await writeFile(join(distDir, 'missing-main', 'index.html'), shell(''))
  await assert.rejects(
    validatePrerenderOutput({ distDir, routes: [{ path: '/missing-main' }] }),
    /missing <main> boundary: yes/,
  )
  await assert.rejects(
    validatePrerenderOutput({ distDir, routes: [{ path: '/missing-file' }] }),
    /expected generated HTML is missing or unreadable.*route-specific visible words: 0/s,
  )
})
