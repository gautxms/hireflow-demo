import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeCandidateResultsPayload } from './candidateResultsPayload.js'
import { buildExpandedCandidateDrawerViewModel } from './candidateResultsState.js'

const candidateResultsSource = readFileSync(new URL('./CandidateResults.jsx', import.meta.url), 'utf8')
const candidateResultsStyles = readFileSync(new URL('../styles/candidate-results.css', import.meta.url), 'utf8')
const designTokens = readFileSync(new URL('../styles/variables.css', import.meta.url), 'utf8')

test('normalizeCandidateResultsPayload handles empty payload', () => {
  assert.deepEqual(normalizeCandidateResultsPayload(null), {
    candidates: [],
    parseMeta: {},
    isInvalid: false,
  })
})

test('normalizeCandidateResultsPayload handles array payload', () => {
  const candidate = { id: 'c1', name: 'Alice' }
  const normalized = normalizeCandidateResultsPayload([candidate])
  assert.equal(normalized.isInvalid, false)
  assert.equal(normalized.candidates[0].matchScore.score, 0)
  assert.equal(typeof normalized.candidates[0].matchScore.reason, 'string')
})

test('normalizeCandidateResultsPayload handles object payload with parseMeta', () => {
  const payload = {
    candidates: [{ id: 'c2', name: 'Bob' }],
    parseMeta: { hasJobDescription: true, source: 'parse-job-1' },
  }
  const normalized = normalizeCandidateResultsPayload(payload)
  assert.equal(normalized.isInvalid, false)
  assert.equal(normalized.parseMeta.source, 'parse-job-1')
  assert.equal(normalized.candidates[0].name, 'Bob')
  assert.equal(typeof normalized.candidates[0].matchScore.reason, 'string')
})

test('normalizeCandidateResultsPayload handles shared results payload', () => {
  const payload = {
    candidates: [{ id: 'shared-1', name: 'Casey' }],
    parseMeta: { shared: true },
  }
  const normalized = normalizeCandidateResultsPayload(payload)
  assert.equal(normalized.candidates[0].id, 'shared-1')
  assert.equal(normalized.parseMeta?.shared, true)
  assert.equal(normalized.isInvalid, false)
})

test('normalized CandidateResults payload still suppresses duplicate recommendation in drawer view-model', () => {
  const duplicate = 'Siddharth has 6.6 years of B2B SaaS marketing experience and strong sales collaboration skills, meeting the experience requirement. However, his background is heavily events and partnerships-focused, not growth and demand generation. He lacks hands-on paid acquisition (Google Ads, LinkedIn Ads, Meta Ads), funnel optimization, copywriting, and multi-channel campaign execution — all core to this role. Location mismatch (Kolkata vs. Mumbai) is an additional constraint.'
  const { candidates } = normalizeCandidateResultsPayload({
    candidates: [{
      id: 'siddharth-banerjee',
      name: 'Siddharth Banerjee',
      recommendationFull: duplicate,
      matchScore: { score: 66, reason: duplicate },
      fit_assessment: {
        rationale: `${duplicate} Recruiter can separately verify Mumbai relocation constraints if the team wants to proceed.`,
      },
    }],
  })
  const detailVm = buildExpandedCandidateDrawerViewModel(candidates[0])

  assert.equal(detailVm.reasoningText, duplicate)
  assert.equal(detailVm.hasRecommendedAction, false)
  assert.equal(detailVm.recommendationText, '')
})

test('normalized CandidateResults payload suppresses non-duplicate reasoning-like recommendation in drawer view-model', () => {
  const recommendation = 'Aanya exceeds the 4-7 year requirement with 6.4 years of direct B2B SaaS demand generation experience. She demonstrates mastery of required channels including paid acquisition, lifecycle marketing, and funnel analytics. Primary risk is location mismatch because she is based outside Mumbai.'
  const reasoning = 'Aanya is ranked highly because her 6.4 years of B2B SaaS demand generation experience aligns with the role. She has strong paid acquisition, lifecycle marketing, and funnel analytics experience, while the primary risk is location mismatch.'
  const { candidates } = normalizeCandidateResultsPayload({
    candidates: [{
      id: 'aanya-example',
      name: 'Aanya Example',
      recommendationFull: recommendation,
      matchScore: { score: 86, reason: reasoning },
    }],
  })
  const detailVm = buildExpandedCandidateDrawerViewModel(candidates[0])

  assert.equal(detailVm.reasoningText, reasoning)
  assert.equal(detailVm.hasRecommendedAction, false)
  assert.equal(detailVm.recommendationText, '')
})

test('normalized CandidateResults payload keeps clear action-oriented recommendation in drawer view-model', () => {
  const action = 'Shortlist for recruiter screen; confirm Mumbai relocation and Salesforce exposure.'
  const { candidates } = normalizeCandidateResultsPayload({
    candidates: [{
      id: 'action-example',
      name: 'Action Example',
      recommendationFull: action,
      matchScore: { score: 86, reason: 'Candidate ranks highly because of relevant B2B demand generation experience.' },
    }],
  })
  const detailVm = buildExpandedCandidateDrawerViewModel(candidates[0])

  assert.equal(detailVm.hasRecommendedAction, true)
  assert.equal(detailVm.recommendationText, action)
})

test('CandidateResults title contract: analysis title does not fall back to job description fields', () => {
  assert.match(candidateResultsSource, /return resolved \|\| 'Analysis Results'/)
  assert.match(
    candidateResultsSource,
    /const candidateFields = \[\s*firstCandidate\?\.analysisName,\s*firstCandidate\?\.analysisTitle,\s*firstCandidate\?\.analysis_name,\s*\]/s,
  )
})

test('CandidateResults does not invoke React hooks at module scope for selection helpers', () => {
  assert.doesNotMatch(
    candidateResultsSource,
    /\n}\s*const\s+resolveSelectionResumeId\s*=\s*useCallback\s*\(/,
  )
})

test('click-path regression: malformed expanded candidate only shows inline fallback note and keeps list rendering', () => {
  assert.match(
    candidateResultsSource,
    /\{isExpandedCandidateMissing && \(\s*<p className="candidate-results-page__empty-note" role="status">\s*Candidate details are unavailable for this entry\. Select another candidate from the list\./s,
  )
  assert.doesNotMatch(candidateResultsSource, /Back to Analyses/)
})

test('click-path regression: legacy matchScore numeric and object payload variants are both supported in score resolution', () => {
  assert.match(candidateResultsSource, /candidate\?\.matchScore\?\.score/)
  assert.match(candidateResultsSource, /candidate\?\.matchScore\s*\?\?/)
})

test('list/detail identity regression: candidate render keys derive from resolveCandidateKey instead of payload _bulkKey', () => {
  assert.match(candidateResultsSource, /const candidateKey = resolveCandidateKey\(candidate, index\)/)
  assert.match(candidateResultsSource, /<div\s+key=\{candidateKey\}/)
  assert.match(candidateResultsSource, /const expandedCandidateKey = detailVm\.candidateKey/)
  assert.match(candidateResultsSource, /selectedCandidateKey=\{expandedCandidateKey\}/)
  assert.doesNotMatch(candidateResultsSource, /key=\{candidate\._bulkKey\}/)
})

test('click-path regression: crash panel copy is never used for candidate click interactions', () => {
  assert.doesNotMatch(candidateResultsSource, /We could not render these results\./)
  assert.doesNotMatch(candidateResultsSource, /Please return to Analyses or retry\./)
})

test('candidate drawer includes compact Resume section with icon-only open handler', () => {
  assert.match(candidateResultsSource, /title="Resume"/)
  assert.match(candidateResultsSource, /className="dd-resume-file"/)
  assert.match(candidateResultsSource, /title=\{detailVm\.resumeFileLabel\}/)
  assert.match(candidateResultsSource, /\{detailVm\.resumeFileLabel\}/)
  assert.match(candidateResultsSource, /onClick=\{\(\) => openCandidateResumeInNewTab\(candidate\)\}/)
  assert.match(candidateResultsSource, /disabled=\{!hasResumeForOpen\}/)
  assert.match(candidateResultsSource, /aria-label="Open uploaded resume"/)
  assert.match(candidateResultsSource, /title="Open resume"/)
  assert.doesNotMatch(candidateResultsSource, /Uploaded resume available to open\./)
  assert.doesNotMatch(candidateResultsSource, />Open<\/span>/)
})

test('expanded drawer third-column order keeps resume after considerations and before integrity checks', () => {
  const strengthsIndex = candidateResultsSource.indexOf('title="Strengths"')
  const considerationsIndex = candidateResultsSource.indexOf('title="Considerations"')
  const viewResumeIndex = candidateResultsSource.indexOf('title="Resume"')
  const integrityIndex = candidateResultsSource.indexOf('integrityChecks.length > 0')

  assert.ok(strengthsIndex !== -1)
  assert.ok(considerationsIndex !== -1)
  assert.ok(viewResumeIndex !== -1)
  assert.ok(integrityIndex !== -1)
  assert.ok(strengthsIndex < considerationsIndex)
  assert.ok(considerationsIndex < viewResumeIndex)
  assert.ok(viewResumeIndex < integrityIndex)
})

test('expanded drawer renders restored legacy sections for facts, recommendation, skill gaps, and all skills', () => {
  assert.match(candidateResultsSource, /title="Key facts"/)
  assert.match(candidateResultsSource, /title="Recommended action"/)
  assert.match(candidateResultsSource, /title="Skill gaps"/)
  assert.match(candidateResultsSource, /title="All skills"/)
})

test('rendered drawer path gates Recommended action with view-model flag and text only', () => {
  assert.match(candidateResultsSource, /const detailVm = buildExpandedCandidateDrawerViewModel\(expandedCandidate\)/)
  assert.match(candidateResultsSource, /const shouldRenderRecommendedAction = Boolean\(detailVm\.hasRecommendedAction && detailVm\.recommendationText\)/)
  assert.match(candidateResultsSource, /\{shouldRenderRecommendedAction && \(\s*<DrawerSection title="Recommended action"/s)
  assert.match(candidateResultsSource, /<ExpandableText text=\{detailVm\.recommendationText\}/)
})

test('rendered drawer path does not read recommendation fields directly from candidate payload', () => {
  const drawerStart = candidateResultsSource.indexOf('const detailVm = buildExpandedCandidateDrawerViewModel(expandedCandidate)')
  const drawerEnd = candidateResultsSource.indexOf('</CandidateDetailErrorBoundary>', drawerStart)
  const drawerSource = candidateResultsSource.slice(drawerStart, drawerEnd)

  assert.ok(drawerStart >= 0)
  assert.ok(drawerEnd > drawerStart)
  assert.doesNotMatch(drawerSource, /candidate\?\.recommendationFull|candidate\.recommendationFull/)
  assert.doesNotMatch(drawerSource, /candidate\?\.recommendation\b|candidate\.recommendation\b/)
  assert.doesNotMatch(drawerSource, /expandedCandidate\?\.recommendationFull|expandedCandidate\.recommendationFull/)
  assert.doesNotMatch(drawerSource, /expandedCandidate\?\.recommendation\b|expandedCandidate\.recommendation\b/)
})

test('expanded drawer skill gaps heading includes amber count badge when gaps exist', () => {
  assert.match(
    candidateResultsSource,
    /title="Skill gaps"[\s\S]*dd-count-badge dd-count-badge--amber">\{detailVm\.missingSkills\.length\} gaps identified/,
  )
})

test('expanded drawer applies warning skill class to skill gap pills', () => {
  assert.match(candidateResultsSource, /className="dd-top-skill dd-top-skill--warn"/)
})

test('skill gap and matched skill pills use distinct classes and warning style contract', () => {
  assert.match(candidateResultsSource, /className="dd-top-skill dd-top-skill--matched"/)
  assert.match(candidateResultsSource, /className="dd-top-skill dd-top-skill--warn"/)
  assert.match(candidateResultsStyles, /\.dd-top-skill--warn[\s\S]*var\(--hf-warning\)/)
  assert.doesNotMatch(candidateResultsStyles, /\.dd-top-skill--warn[\s\S]*color:\s*#ffffff/)
})

test('skill gap warning pills resolve to canonical amber status tokens', () => {
  assert.match(designTokens, /--hf-warning:\s*var\(--hf-status-warning\)/)
  assert.match(designTokens, /--hf-score-possible:\s*var\(--hf-status-warning\)/)
  assert.match(candidateResultsStyles, /\.dd-top-skill--warn\s*\{[^}]*color:\s*var\(--hf-warning\)/)
  assert.doesNotMatch(candidateResultsStyles, /\.dd-top-skill--warn\s*\{[^}]*var\(--hf-score-possible\)/)
})

test('expanded drawer first-column section order keeps recommendation before key facts for recruiter scanning', () => {
  const summaryIndex = candidateResultsSource.indexOf('title="Summary"')
  const recommendationIndex = candidateResultsSource.indexOf('title="Recommended action"')
  const keyFactsIndex = candidateResultsSource.indexOf('title="Key facts"')
  const reasoningIndex = candidateResultsSource.indexOf('title="AI reasoning"')

  assert.ok(summaryIndex !== -1)
  assert.ok(recommendationIndex !== -1)
  assert.ok(keyFactsIndex !== -1)
  assert.ok(reasoningIndex !== -1)
  assert.ok(summaryIndex < recommendationIndex)
  assert.ok(recommendationIndex < keyFactsIndex)
  assert.ok(keyFactsIndex < reasoningIndex)
})

test('score breakdown rows include Skill Match, Experience, Education, and conditional Role Alignment', () => {
  assert.match(candidateResultsSource, /buildScoreBreakdownRows\(candidate\)/)
  assert.doesNotMatch(candidateResultsSource, /label: 'Overall fit'/)
})

test('drawer uses reusable expansion helpers with preview budgets and show more labels', () => {
  assert.match(candidateResultsSource, /function ExpandableList\(/)
  assert.match(candidateResultsSource, /previewCount=\{5\}/)
  assert.match(candidateResultsSource, /previewCount=\{3\}/)
  assert.match(candidateResultsSource, /slice\(0, 12\)/)
  assert.match(candidateResultsSource, /buttonLabel="Show more"/)
  assert.match(candidateResultsSource, /collapseLabel="Show less"/)
})

test('shortlist add flow supports create-or-select destination inline', () => {
  assert.match(candidateResultsSource, /destinationShortlistId = await createShortlistInAddFlow\(\)/)
  assert.match(candidateResultsSource, /No shortlist selected\. Create one to continue\./)
  assert.match(candidateResultsSource, /<AddToShortlistModal/)
  assert.doesNotMatch(candidateResultsSource, /Destination shortlist: \{selectedShortlistName\}/)
  assert.match(candidateResultsSource, /isCreatingShortlistInAddFlow/)
})

test('legacy shortlist add path still invokes single-candidate flow when shortlist id exists', () => {
  assert.match(candidateResultsSource, /if \(!shortlistV2Enabled\) \{\s*let fallbackSuccessCount = 0\s*for \(const candidate of selected\) \{\s*\/\/ Preserve legacy single-candidate shortlist flow when v2 is disabled\.\s*const ok = await addCandidateToShortlist\(candidate(?:, destinationShortlistId)?\)/s)
})

test('shortlist selector panel can render regardless of shortlistV2 flag', () => {
  assert.match(candidateResultsSource, /\{shortlistOpen && \(/)
  assert.doesNotMatch(candidateResultsSource, /\{shortlistV2Enabled && shortlistOpen && \(/)
})
