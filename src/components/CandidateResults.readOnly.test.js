import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const candidateResultsSource = readFileSync(new URL('./CandidateResults.jsx', import.meta.url), 'utf8')
const analysisDetailSource = readFileSync(new URL('../pages/AnalysisDetailPage.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('read-only candidate results preserve historical viewing while suppressing mutation controls', () => {
  assert.match(candidateResultsSource, /isReadOnly = false/)
  assert.match(candidateResultsSource, /Read-only access: historical results and resumes remain available/)
  assert.match(candidateResultsSource, /shortlistEnabled=\{!isReadOnly && shortlistV2Enabled\}/)
  assert.match(candidateResultsSource, /\{!isReadOnly && shortlistOpen && \(/)
  assert.match(candidateResultsSource, /\{!isReadOnly && selectedCandidates\.length > 0 && \(/)
  assert.match(candidateResultsSource, /\{!isReadOnly && <AddToShortlistModal/)
  assert.match(candidateResultsSource, /\{!isReadOnly && <div className="results-select-all">/)
  assert.match(candidateResultsSource, /\{!isReadOnly && <label className="rc-checkbox-wrap"/)
  assert.match(candidateResultsSource, /\{!isReadOnly && <button className="hf-btn hf-btn--secondary dd-btn-ghost"[\s\S]*?>Add to shortlist<\/button>\}/)

  assert.match(candidateResultsSource, /openCandidateResumeInNewTab\(candidate\)/)
  assert.match(candidateResultsSource, /method: 'GET'/)
  assert.match(candidateResultsSource, /aria-label="Open resume"/)
})

test('read-only candidate results defensively block mutation handlers and shortlist reads', () => {
  assert.match(candidateResultsSource, /const createShortlist = useCallback\(async[\s\S]*?if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /const addCandidateToShortlist = useCallback\(async[\s\S]*?if \(isReadOnly\) return false/)
  assert.match(candidateResultsSource, /const removeCandidateFromShortlist = useCallback\(async[\s\S]*?if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /const exportCSV = async \(selected\) => \{\s*if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /const emailForm = async \(selected\) => \{\s*if \(isReadOnly\) return \{ opened: false, recipients: \[\] \}/)
  assert.match(candidateResultsSource, /const sendFeedbackForm = async \(selected\) => \{\s*if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /const mutateSelectedTags = async \(operation\) => \{\s*if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /const createShareLink = async \(\) => \{\s*if \(isReadOnly\) return/)
  assert.match(candidateResultsSource, /useEffect\(\(\) => \{\s*if \(!isReadOnly\) loadShortlists\(\)/)
})

test('app routes propagate read-only access to current, historical, and shared results', () => {
  assert.match(analysisDetailSource, /AnalysisDetailPage\(\{ pathname = '', onPageTitleChange = null, isReadOnly = false \}\)/)
  assert.match(analysisDetailSource, /<CandidateResults[\s\S]*?isReadOnly=\{isReadOnly\}/)
  assert.match(appSource, /isSharedLoading=\{sharedResultsLoading\}[\s\S]*?isReadOnly/)
  assert.match(appSource, /userProfile=\{userProfile\}\s*isReadOnly=\{!profileBillingState\.canUsePaidMutation\}/)
  assert.match(appSource, /<AnalysisDetailPage[^>]*isReadOnly=\{!profileBillingState\.canUsePaidMutation\}/)
})
