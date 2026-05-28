import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shortlistPageSource = readFileSync(new URL('./ShortlistsPage.jsx', import.meta.url), 'utf8')
const shortlistManagerSource = readFileSync(new URL('../components/ShortlistManager.jsx', import.meta.url), 'utf8')

test('shortlists page auto-refreshes on focus and visibilitychange', () => {
  assert.match(shortlistPageSource, /window\.addEventListener\('focus', handleFocus\)/)
  assert.match(shortlistPageSource, /document\.addEventListener\('visibilitychange', handleVisibility\)/)
  assert.match(shortlistPageSource, /document\.visibilityState === 'visible'/)
})

test('shortlists page uses queued refresh guard to avoid overlapping request storms', () => {
  assert.match(shortlistPageSource, /refreshInFlightRef/)
  assert.match(shortlistPageSource, /queuedRefreshRef/)
  assert.match(shortlistPageSource, /if \(refreshInFlightRef\.current\) \{/)
})

test('shortlist manager exposes retry in error state and removes manual refresh control', () => {
  assert.doesNotMatch(shortlistManagerSource, />Refresh</)
  assert.match(shortlistManagerSource, /onRetry/)
  assert.match(shortlistManagerSource, /Retry<\/button>/)
})
