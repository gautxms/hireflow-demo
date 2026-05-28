import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shortlistPageSource = readFileSync(new URL('./ShortlistsPage.jsx', import.meta.url), 'utf8')
const shortlistManagerSource = readFileSync(new URL('../components/ShortlistManager.jsx', import.meta.url), 'utf8')

function getFunctionSource(functionName) {
  const marker = `const ${functionName} = useCallback`
  const start = shortlistPageSource.indexOf(marker)
  assert.notEqual(start, -1, `${functionName} source should exist`)
  const nextFunction = shortlistPageSource.indexOf('\n\n  const ', start + marker.length)
  const nextEffect = shortlistPageSource.indexOf('\n\n  useEffect', start + marker.length)
  const candidates = [nextFunction, nextEffect].filter((index) => index !== -1)
  const end = Math.min(...candidates)
  return shortlistPageSource.slice(start, end)
}

test('shortlists page does not auto-refresh on focus or visibilitychange', () => {
  assert.doesNotMatch(shortlistPageSource, /window\.addEventListener\('focus'/)
  assert.doesNotMatch(shortlistPageSource, /document\.addEventListener\('visibilitychange'/)
  assert.doesNotMatch(shortlistPageSource, /document\.visibilityState === 'visible'/)
})

test('shortlists page uses queued refresh guard to avoid overlapping request storms', () => {
  assert.match(shortlistPageSource, /refreshInFlightRef/)
  assert.match(shortlistPageSource, /queuedRefreshRef/)
  assert.match(shortlistPageSource, /if \(refreshInFlightRef\.current\) \{/)
})

test('shortlists page preserves selection during refresh unless missing from response', () => {
  const loadShortlistsSource = getFunctionSource('loadShortlists')
  assert.match(loadShortlistsSource, /preserveSelectedId \?\? selectedShortlistIdRef\.current/)
  assert.match(loadShortlistsSource, /currentSelectedId && !nextShortlists\.some/)
  assert.match(loadShortlistsSource, /setSelectedShortlistId\(nextSelectedId\)/)
})

test('shortlists page removes candidates optimistically without full refresh', () => {
  const removeCandidateSource = getFunctionSource('removeCandidateFromShortlist')
  assert.match(removeCandidateSource, /batch-remove/)
  assert.match(removeCandidateSource, /removeShortlistCandidate\(currentDetails, resumeId\)/)
  assert.match(removeCandidateSource, /candidate_count: Math\.max\(0, currentCount - countDelta\)/)
  assert.doesNotMatch(removeCandidateSource, /refreshShortlists\(/)
  assert.doesNotMatch(removeCandidateSource, /loadShortlists\(/)
  assert.doesNotMatch(removeCandidateSource, /loadShortlistDetails\(/)
})

test('shortlist manager exposes retry in error state and removes manual refresh control', () => {
  assert.doesNotMatch(shortlistManagerSource, />Refresh</)
  assert.match(shortlistManagerSource, /onRetry/)
  assert.match(shortlistManagerSource, /Retry<\/button>/)
})
