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


test('shortlists page loads jobs and sends selected job when creating shortlist', () => {
  const createShortlistSource = getFunctionSource('createShortlist')
  assert.match(shortlistPageSource, /const \[jobDescriptions, setJobDescriptions\] = useState\(\[\]\)/)
  assert.match(shortlistPageSource, /fetch\(`\$\{API_BASE\}\/job-descriptions\?includeArchived=true`/)
  assert.match(createShortlistSource, /jobDescriptionId/)
  assert.match(createShortlistSource, /JSON\.stringify\(\{ name, description, jobDescriptionId \}\)/)
  assert.match(shortlistPageSource, /jobDescriptions=\{jobDescriptions\}/)
})

test('shortlist manager create form exposes job dropdown while filters stay shortlist scoped', () => {
  assert.match(shortlistManagerSource, /jobDescriptions = \[\]/)
  assert.match(shortlistManagerSource, /const \[createJobDescriptionId, setCreateJobDescriptionId\] = useState\(''\)/)
  assert.match(shortlistManagerSource, /Job<select value=\{createJobDescriptionId\}/)
  assert.match(shortlistManagerSource, /onCreateShortlist\(\{ name: name\.trim\(\), description: description\.trim\(\), jobDescriptionId: createJobDescriptionId \|\| null \}\)/)
  assert.match(shortlistManagerSource, /\(Array\.isArray\(jobDescriptions\) \? jobDescriptions : \[\]\)\.forEach/)
  assert.match(shortlistManagerSource, /shortlists\.forEach\(\(list\) => \{/)
  assert.match(shortlistManagerSource, /const value = String\(list\.job_description_id \|\| label\)\.trim\(\)/)
  assert.match(shortlistManagerSource, /<option key=\{job\.value\} value=\{job\.value\}>\{job\.label\}<\/option>/)
})

test('shortlist manager links scored chips back to the producing analysis', () => {
  assert.match(shortlistManagerSource, /const canLinkScore = analysisHref && scoreDisplay\.tone !== 'muted'/)
  assert.match(shortlistManagerSource, /<a className=\{scoreClassName\} href=\{analysisHref\}/)
  assert.match(shortlistManagerSource, /View analysis that produced/)
})


test('shortlist manager removes candidate status filter from toolbar', () => {
  assert.doesNotMatch(shortlistManagerSource, /Candidate status/)
  assert.doesNotMatch(shortlistManagerSource, /Candidate status unavailable/)
  assert.doesNotMatch(shortlistManagerSource, /hasAvailableDecisionStatuses/)
})

test('shortlist manager hides selected candidates when shortlist is filtered out', () => {
  assert.match(shortlistManagerSource, /const selectedShortlistIsVisible = Boolean/)
  assert.match(shortlistManagerSource, /selectedShortlistIsVisible \? shortlistDetails\?\.candidates \|\| \[\] : \[\]/)
  assert.match(shortlistManagerSource, /const hasSelectedShortlist = selectedShortlistIsVisible/)
})

test('shortlists page score sorting requests backend score ordering', () => {
  assert.match(shortlistPageSource, /rating_desc: 'sortBy=score&sortOrder=desc'/)
  assert.match(shortlistPageSource, /rating_asc: 'sortBy=score&sortOrder=asc'/)
  assert.match(shortlistManagerSource, /Score \(High to Low\)/)
})
