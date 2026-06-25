import test from 'node:test'
import assert from 'node:assert/strict'
import { CANDIDATE_RESULTS_PAYLOAD_FIXTURES } from './__fixtures__/candidateResultsPayloadFixtures.js'
import {
  buildResultsQueryParams,
  hasRenderableCandidates,
  normalizeCandidateForResults,
  normalizeNumericRange,
  normalizeSortBy,
  paginateCandidates,
  buildCandidateRenderContract,
  resolveCandidateResumeUuid,
  resolveCandidateKey,
  resolveActiveCandidateScore,
  sanitizeExpandedCandidate,
  toDisplayText,
  formatCandidateFieldForDisplay,
  resolveEducationLabel,
  toSafeScore,
  parseScorePercentage,
  resolveScoreBreakdownMetric,
  buildScoreBreakdownRows,
  cleanAiTextForDisplay,
  resolveCandidateYears,
  resolveFilterableSkills,
  sortCandidatesForResults,
} from './candidateResultsState.js'


test('cleanAiTextForDisplay preserves complete sentences and technical tokens', () => {
  assert.equal(
    cleanAiTextForDisplay('Rahul exceeds the 2-5 year experience requirement with 5 years of production backend work.'),
    'Rahul exceeds the 2-5 year experience requirement with 5 years of production backend work.',
  )
  assert.equal(cleanAiTextForDisplay('Node.js Next.js AWS EC2/S3 B.Tech PostgreSQL 2–5 80.5'), 'Node.js Next.js AWS EC2/S3 B.Tech PostgreSQL 2–5 80.5')
  assert.equal(cleanAiTextForDisplay('Strong Backend Match'), 'Strong Backend Match')
})

test('cleanAiTextForDisplay hides obvious dangling AI fragments without inventing text', () => {
  assert.equal(
    cleanAiTextForDisplay('Strong React and Next.js expertise with demonstrated ability to build complex recruiter dashboards and form flows with v'),
    'Strong React and Next.js expertise with demonstrated ability to build complex recruiter dashboards and form flows…',
  )
  assert.equal(
    cleanAiTextForDisplay('No demonstrated experience with system design, data structures, or algorithms pr'),
    'No demonstrated experience with system design, data structures, or algorithms…',
  )
  assert.equal(cleanAiTextForDisplay('Below Threshold – Junior Profi'), 'Below Threshold – Junior…')
})


test('cleanAiTextForDisplay preserves valid availability and long prose without terminal punctuation', () => {
  assert.equal(cleanAiTextForDisplay('Open to relocate to London'), 'Open to relocate to London')
  assert.equal(cleanAiTextForDisplay('Currently based in Mumbai'), 'Currently based in Mumbai')
  assert.equal(cleanAiTextForDisplay('Available to join in July'), 'Available to join in July')
  assert.equal(
    cleanAiTextForDisplay('Experienced backend engineer with strong ownership across payments, authentication and observability for production systems'),
    'Experienced backend engineer with strong ownership across payments, authentication and observability for production systems',
  )
})

test('cleanAiTextForDisplay returns safe empty display for missing values', () => {
  assert.equal(cleanAiTextForDisplay(null), '')
  assert.equal(cleanAiTextForDisplay(undefined), '')
  assert.equal(cleanAiTextForDisplay('   '), '')
})

test('normalizeSortBy whitelists supported values', () => {
  assert.equal(normalizeSortBy('name'), 'name')
  assert.equal(normalizeSortBy('bad-value'), 'match_score')
})

test('buildResultsQueryParams serializes query state for share/export', () => {
  const params = buildResultsQueryParams({
    searchText: 'alice',
    selectedSkills: ['React', 'Node'],
    expRange: { min: '3', max: '8' },
    matchRange: { min: '70', max: '99' },
    sortBy: 'experience',
    page: 2,
    pageSize: 10,
  })

  assert.equal(params.get('search'), 'alice')
  assert.equal(params.get('skills'), 'React,Node')
  assert.equal(params.get('experienceMin'), '3')
  assert.equal(params.get('matchMax'), '99')
  assert.equal(params.get('page'), '2')
})

test('pagination clamps page and returns page metadata', () => {
  const { rows, pagination } = paginateCandidates([{ id: 1 }, { id: 2 }, { id: 3 }], 5, 2)
  assert.equal(rows.length, 1)
  assert.equal(pagination.page, 2)
  assert.equal(pagination.totalPages, 2)
})

test('normalizeNumericRange swaps inverted bounds', () => {
  const range = normalizeNumericRange({ min: '90', max: '20' })
  assert.deepEqual(range, { min: '20', max: '90' })
})

test('resolveCandidateResumeUuid only returns valid UUID values', () => {
  const resumeUuid = '8ac357c6-8872-4f0f-bf34-8ba8720faacd'
  assert.equal(resolveCandidateResumeUuid({ resumeId: resumeUuid }), resumeUuid)
  assert.equal(resolveCandidateResumeUuid({ id: 'parsed-1' }), null)
  assert.equal(resolveCandidateResumeUuid({ resume_id: '123' }), null)
})

test('resolveCandidateKey prefers stable candidate identity fields', () => {
  assert.equal(resolveCandidateKey({ candidateKey: 'key-1', id: 'id-1' }, 0), 'key-1')
  assert.equal(resolveCandidateKey({ resumeId: 'resume-2', id: 'id-2' }, 0), 'resume-2')
  assert.equal(resolveCandidateKey({ id: 'id-3' }, 0), 'id-3')
  assert.equal(resolveCandidateKey({ email: 'a@b.com' }, 0), 'a@b.com')
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 4), 'Alex-4')
})



test('resolveCandidateKey appends index when name is the only available identifier', () => {
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 0), 'Alex-0')
  assert.equal(resolveCandidateKey({ name: 'Alex' }, 1), 'Alex-1')
})
test('resolveCandidateKey uses index only as final fallback for mixed/partial payloads', () => {
  assert.equal(resolveCandidateKey({ id: '', resumeId: null, resume_id: undefined, email: '', name: 'Taylor' }, 2), 'Taylor-2')
  assert.equal(resolveCandidateKey({ id: '', resumeId: null, resume_id: undefined, email: '', name: '' }, 7), 'candidate-7')
  assert.equal(resolveCandidateKey({}, 9), 'candidate-9')
})

test('toDisplayText normalizes object/array candidate fields into safe renderable text', () => {
  assert.equal(toDisplayText({ text: 'Senior engineer' }), 'Senior engineer')
  assert.equal(toDisplayText({ value: 'Remote' }), 'Remote')
  assert.equal(toDisplayText({ nested: true }, 'No summary available'), 'No summary available')
  assert.equal(toDisplayText(['React', { text: 'Node.js' }, 7]), 'React, Node.js, 7')
})



test('formatCandidateFieldForDisplay renders structured education experience and projects without object placeholders', () => {
  assert.equal(formatCandidateFieldForDisplay({ degree: 'MBA', institution: 'IIM Bangalore', year: 2021 }, 'Not provided', 'education'), 'MBA, IIM Bangalore (2021)')
  assert.equal(formatCandidateFieldForDisplay({ title: 'Engineer', company: 'Acme', dates: '2020-2024', summary: 'Built APIs' }, 'Not provided', 'experience'), 'Engineer at Acme — 2020-2024: Built APIs')
  assert.equal(formatCandidateFieldForDisplay({ name: 'Portal', description: 'Hiring workflow', technologies: ['React', 'Node'] }, 'Not provided', 'projects'), 'Portal — Hiring workflow — Technologies: React, Node')
  assert.equal(formatCandidateFieldForDisplay('[object Object]', 'Not provided', 'education'), 'Not provided')
})

test('buildExpandedCandidateDrawerViewModel handles historical malformed object fields gracefully', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    education: ['[object Object]', { degree: 'MBA', institution: 'IIM Bangalore', year: 2021 }],
    experience: ['[object Object]', { title: 'Engineer', company: 'Acme', dates: '2020-2024' }],
    strengths: [{ label: 'Strong delivery record' }, '[object Object]'],
  })

  assert.equal(vm.educationLabel, 'MBA — IIM Bangalore (2021)')
  assert.deepEqual(vm.candidate.experience, ['Engineer at Acme — 2020-2024'])
  assert.deepEqual(vm.candidateStrengths, ['Strong delivery record'])
  assert.equal(vm.educationLabel.includes('[object Object]'), false)
  assert.equal(vm.candidate.experience.join(' ').includes('[object Object]'), false)
})

test('resolveEducationLabel supports legacy string and malformed payloads safely', () => {
  assert.equal(resolveEducationLabel('B.Tech, IIT Delhi'), 'B.Tech, IIT Delhi')
  assert.equal(resolveEducationLabel(null), 'Education details unavailable')
  assert.equal(resolveEducationLabel([{ unknown: true }]), 'Education details unavailable')
})

test('resolveEducationLabel formats structured objects and falls back on partial values', () => {
  assert.equal(resolveEducationLabel({ degree: 'MBA', school: 'IIM Bangalore', graduation_year: 2021 }), 'MBA — IIM Bangalore (2021)')
  assert.equal(resolveEducationLabel({ degree: 'M.Tech' }), 'M.Tech')
  assert.equal(resolveEducationLabel({ school: 'Stanford University' }), 'Stanford University')
})

test('resolveEducationLabel picks highest ranked degree from multiple records', () => {
  const education = [
    { degree: 'Diploma in IT', school: 'Polytechnic' },
    { degree: 'B.Tech', school: 'NIT Trichy', graduation_year: '2018' },
    { degree: 'MBA', school: 'IIM Ahmedabad', graduation_year: '2022' },
  ]

  assert.equal(resolveEducationLabel(education), 'MBA — IIM Ahmedabad (2022)')
})

test('resolveEducationLabel prefers more recent graduation year when degree rank ties', () => {
  const education = [
    { degree: 'MBA', school: 'School A', graduation_year: '2017' },
    { degree: 'MBA', school: 'School B', graduation_year: '2021' },
  ]

  assert.equal(resolveEducationLabel(education), 'MBA — School B (2021)')
})

test('toSafeScore constrains malformed or out-of-range values for chart rendering', () => {
  assert.equal(toSafeScore({ score: 90 }, 0), 0)
  assert.equal(toSafeScore('95'), 95)
  assert.equal(toSafeScore(999), 100)
  assert.equal(toSafeScore(-12), 0)
})

test('parseScorePercentage supports numeric, decimal, percent string, and legacy wrapped formats', () => {
  assert.equal(parseScorePercentage(86), 86)
  assert.equal(parseScorePercentage(0.86), 86)
  assert.equal(parseScorePercentage('86%'), 86)
  assert.equal(parseScorePercentage('(86%)'), 86)
})

test('resolveScoreBreakdownMetric reads modern and legacy score fields safely', () => {
  const breakdown = {
    skill_match_score: 0.9,
    experience_match_score: '84%',
    education_match_score: '(80%)',
  }

  assert.equal(resolveScoreBreakdownMetric(breakdown, ['skill_match_score']), 90)
  assert.equal(resolveScoreBreakdownMetric(breakdown, ['experience_match_score']), 84)
  assert.equal(resolveScoreBreakdownMetric(breakdown, ['education_match_score']), 80)
  assert.equal(resolveScoreBreakdownMetric(breakdown, ['location_match_score']), null)
})

test('buildScoreBreakdownRows includes rows when any valid scores exist and parses legacy formats', () => {
  const rows = buildScoreBreakdownRows({
    scoreBreakdown: {
      skills_match: '86%',
      experience: 0.73,
      education: '(65%)',
    },
  })

  assert.deepEqual(rows, [
    { label: 'Skill Match', value: 86 },
    { label: 'Experience', value: 73 },
    { label: 'Education', value: 65 },
  ])
})


test('buildScoreBreakdownRows supports snake_case breakdown payload fields', () => {
  const rows = buildScoreBreakdownRows({
    match_score: {
      breakdown: {
        skills_match: 88,
        experience: '74%',
        education: 0.61,
      },
    },
  })

  assert.deepEqual(rows, [
    { label: 'Skill Match', value: 88 },
    { label: 'Experience', value: 74 },
    { label: 'Education', value: 61 },
  ])
})

test('buildScoreBreakdownRows only includes Role Alignment when real numeric field exists', () => {
  const withoutRoleAlignment = buildScoreBreakdownRows({
    fit_assessment: { skill_match_score: 81 },
    scoreBreakdown: { methodologies: 92 },
  })
  assert.deepEqual(withoutRoleAlignment, [{ label: 'Skill Match', value: 81 }])

  const withRoleAlignment = buildScoreBreakdownRows({
    fit_assessment: { role_alignment: '77%' },
  })
  assert.deepEqual(withRoleAlignment, [{ label: 'Role Alignment', value: 77 }])
})

test('hasRenderableCandidates allows mixed-validity arrays when at least one candidate is valid', () => {
  const mixedCandidates = [
    null,
    normalizeCandidateForResults(undefined, 0),
    normalizeCandidateForResults({ id: 'c-1', name: 'Valid User', skills: null }, 1),
  ]

  assert.equal(hasRenderableCandidates(mixedCandidates), true)
})

test('normalizeCandidateForResults defaults malformed skills to empty string', () => {
  const normalized = normalizeCandidateForResults({ id: 'c-2', skills: { primary: 'React' } }, 0)
  assert.equal(normalized.skills, '')
  assert.equal(normalized._isRenderable, true)
})

test('hasRenderableCandidates returns false when no valid candidate objects exist', () => {
  assert.equal(hasRenderableCandidates([]), false)
  assert.equal(hasRenderableCandidates([null, undefined]), false)
})


test('buildCandidateRenderContract returns stable display fields for legacy payload candidates', () => {
  const [legacyCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.legacyPayload
  const contract = buildCandidateRenderContract(legacyCandidate)

  assert.deepEqual(contract, {
    name: 'Alex Rivera',
    location: 'Austin, TX',
    yearsExperience: '6 yrs exp',
    score: 88,
    scoreTenPoint: '8.8',
    scoreTier: 'strong',
    topSkills: ['React', 'Node.js', 'TypeScript'],
  })
})

test('resolveActiveCandidateScore supports multiple backend score field variants', () => {
  assert.equal(resolveActiveCandidateScore({ matchScore: { score: 92 } }), 92)
  assert.equal(resolveActiveCandidateScore({ matchScore: 87 }), 87)
  assert.equal(resolveActiveCandidateScore({ score: 78 }), 78)
  assert.equal(resolveActiveCandidateScore({ profile_score: 71 }), 71)
  assert.equal(resolveActiveCandidateScore({ scoreBreakdown: { overall: 66 } }), 66)
  assert.equal(resolveActiveCandidateScore({ score: 'not-a-number' }), null)
})

test('no-diff gate: buildCandidateRenderContract score-related fields are identical for legacy and modern payload variants', () => {
  const [legacyCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.legacyPayload
  const [modernCandidate] = CANDIDATE_RESULTS_PAYLOAD_FIXTURES.modernPayload

  const legacyContract = buildCandidateRenderContract(legacyCandidate)
  const modernContract = buildCandidateRenderContract(modernCandidate)

  assert.deepEqual(
    {
      score: legacyContract.score,
      scoreTenPoint: legacyContract.scoreTenPoint,
      scoreTier: legacyContract.scoreTier,
      yearsExperience: legacyContract.yearsExperience,
      topSkills: legacyContract.topSkills,
    },
    {
      score: modernContract.score,
      scoreTenPoint: modernContract.scoreTenPoint,
      scoreTier: modernContract.scoreTier,
      yearsExperience: modernContract.yearsExperience,
      topSkills: modernContract.topSkills,
    },
  )
})


test('sanitizeExpandedCandidate preserves numeric matchScore for score resolution compatibility', () => {
  const sanitized = sanitizeExpandedCandidate({
    matchScore: 87,
  })

  assert.equal(sanitized.matchScore, 87)
  assert.equal(resolveActiveCandidateScore(sanitized), 87)
})

test('sanitizeExpandedCandidate strictly defaults arrays, nested objects, and display fields', () => {
  const sanitized = sanitizeExpandedCandidate({
    name: { first: 'Sam' },
    summary: 123,
    skills: { primary: 'React' },
    top_skills: [null, ' React '],
    fit_assessment: { missing: 'TypeScript', reason: ['good'] },
    scoreBreakdown: new Map([['overall', 82]]),
    experience: [{ title: 'Engineer' }, null],
  })

  assert.equal(sanitized.name, 'Candidate')
  assert.equal(sanitized.summary, '123')
  assert.deepEqual(sanitized.skills, [])
  assert.deepEqual(sanitized.top_skills, ['React'])
  assert.deepEqual(sanitized.fit_assessment.missing, [])
  assert.equal(sanitized.fit_assessment.reason, 'good')
  assert.deepEqual(sanitized.scoreBreakdown, {})
  assert.deepEqual(sanitized.experience, ['Engineer'])
})

test('buildExpandedCandidateDrawerViewModel normalizes malformed candidate shapes safely', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    name: { first: 'Bad' },
    summary: { nested: { nope: true } },
    strengths: null,
    considerations: [{ reason: 'x' }],
    matchedSkills: null,
    missingSkills: null,
    fit_assessment: { missing: { wrong: true } },
    experience: [{ title: { wrong: true } }],
    education: [{ degree: 'M.Tech' }, { school: 'Unknown Institute' }],
  })

  assert.equal(vm.isUnavailable, false)
  assert.equal(vm.candidateName, 'Candidate')
  assert.equal(vm.educationLabel, 'M.Tech')
  assert.equal(Array.isArray(vm.matchedSkills), true)
  assert.equal(Array.isArray(vm.missingSkills), true)
  assert.equal(Array.isArray(vm.candidateConsiderations), true)
})

test('buildExpandedCandidateDrawerViewModel returns compact unavailable state on unexpected throw', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const circular = {}
  circular.self = circular
  Object.defineProperty(circular, 'name', { get() { throw new Error('boom') } })

  const vm = buildExpandedCandidateDrawerViewModel(circular)
  assert.equal(vm.isUnavailable, true)
  assert.equal(vm.summaryText, 'Candidate details unavailable')
  assert.equal(vm.unavailableMessage, 'Candidate details unavailable')
})


test('buildExpandedCandidateDrawerViewModel derives high confidence from numeric confidenceScores.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: 0.9 },
  })

  assert.equal(vm.confidenceLabel, 'High confidence')
})

test('buildExpandedCandidateDrawerViewModel derives moderate confidence from numeric confidence.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidence: { fit_assessment: 0.75 },
  })

  assert.equal(vm.confidenceLabel, 'Moderate confidence')
})

test('buildExpandedCandidateDrawerViewModel derives low confidence from numeric confidenceScores.fit_assessment', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: 0.45 },
  })

  assert.equal(vm.confidenceLabel, 'Low confidence')
})

test('buildExpandedCandidateDrawerViewModel exposes recommendation, skill gaps, and all skills from existing candidate data', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendation: 'Proceed to interview panel.',
    top_skills: ['React'],
    skills: ['Node.js'],
    matchedSkills: ['TypeScript'],
    mustHaveSkills: ['System Design'],
    missingSkills: ['GraphQL'],
    fit_assessment: { missing: ['Leadership communication'] },
  })

  assert.equal(vm.recommendationText, 'Proceed to interview panel.')
  assert.deepEqual(vm.missingSkills, ['System Design', 'GraphQL', 'Leadership communication'])
  assert.deepEqual(vm.allSkills, ['React', 'Node.js', 'TypeScript', 'System Design'])
})

test('buildExpandedCandidateDrawerViewModel hides recommendation when identical to AI reasoning', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const duplicate = 'Strong fit because the candidate matches the role requirements and has relevant experience.'
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: duplicate,
    reasoningFull: duplicate,
  })

  assert.equal(vm.reasoningText, duplicate)
  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
})

test('buildExpandedCandidateDrawerViewModel hides recommendation when it is a duplicative reasoning substring', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: 'Candidate has strong paid social, analytics, and lifecycle marketing experience.',
    reasoningFull: 'Candidate has strong paid social, analytics, and lifecycle marketing experience, with clear alignment to the growth marketing role.',
  })

  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
  assert.match(vm.reasoningText, /clear alignment/)
})

test('buildExpandedCandidateDrawerViewModel hides near-identical recommendation with small wording changes', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: 'Strong fit because the candidate has SQL, AWS, stakeholder management, and data platform experience.',
    reasoningFull: 'Strong fit due to candidate having SQL, AWS, stakeholder management, and data platform experiences.',
  })

  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
})

test('buildExpandedCandidateDrawerViewModel hides Siddharth-style duplicate recommendation while preserving AI reasoning', async () => {
  const { buildExpandedCandidateDrawerViewModel, isClearlyDuplicativeDisplayText } = await import('./candidateResultsState.js')
  const duplicate = 'Siddharth has 6.6 years of B2B SaaS marketing experience and strong sales collaboration skills, meeting the experience requirement. However, his background is heavily events and partnerships-focused, not growth and demand generation. He lacks hands-on paid acquisition (Google Ads, LinkedIn Ads, Meta Ads), funnel optimization, copywriting, and multi-channel campaign execution — all core to this role. Location mismatch (Kolkata vs. Mumbai) is an additional constraint.'
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: duplicate,
    matchScore: { reason: duplicate },
  })

  assert.equal(isClearlyDuplicativeDisplayText(duplicate, duplicate), true)
  assert.equal(vm.reasoningText, duplicate)
  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
})

test('buildExpandedCandidateDrawerViewModel hides recommendation duplicated against displayed matchScore reason even with different fit rationale', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const duplicate = 'Siddharth has 6.6 years of B2B SaaS marketing experience and strong sales collaboration skills, meeting the experience requirement. However, his background is heavily events and partnerships-focused, not growth and demand generation. He lacks hands-on paid acquisition (Google Ads, LinkedIn Ads, Meta Ads), funnel optimization, copywriting, and multi-channel campaign execution — all core to this role. Location mismatch (Kolkata vs. Mumbai) is an additional constraint.'
  const longerRationale = `${duplicate} Interview should also validate budget ownership, recent campaign metrics, and relocation feasibility before proceeding.`
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: duplicate,
    matchScore: { reason: duplicate },
    fit_assessment: { rationale: longerRationale },
  })

  assert.equal(vm.reasoningText, duplicate)
  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
})

test('buildExpandedCandidateDrawerViewModel shows meaningful distinct recommended action', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: 'Shortlist for interview; confirm relocation and Meta Ads exposure.',
    reasoningFull: 'The candidate scored highly due to strong B2B growth marketing experience, lifecycle analytics, and recent paid acquisition ownership.',
  })

  assert.equal(vm.hasRecommendedAction, true)
  assert.equal(vm.recommendationText, 'Shortlist for interview; confirm relocation and Meta Ads exposure.')
})

test('buildExpandedCandidateDrawerViewModel shows recommendation when it contains reasoning plus meaningful action text', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: 'Strong B2B growth marketing experience, lifecycle analytics, and paid acquisition ownership. Shortlist for interview and confirm relocation plus Meta Ads exposure.',
    reasoningFull: 'Strong B2B growth marketing experience, lifecycle analytics, and paid acquisition ownership.',
  })

  assert.equal(vm.hasRecommendedAction, true)
  assert.equal(vm.recommendationText, 'Strong B2B growth marketing experience, lifecycle analytics, and paid acquisition ownership. Shortlist for interview and confirm relocation plus Meta Ads exposure.')
})

test('buildExpandedCandidateDrawerViewModel preserves short appended action guidance despite high token overlap', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    reasoningFull: 'Strong B2B growth marketing experience, HubSpot, GA4, and sales collaboration.',
    recommendationFull: 'Strong B2B growth marketing experience, HubSpot, GA4, and sales collaboration. Shortlist for interview.',
  })

  assert.equal(vm.hasRecommendedAction, true)
  assert.equal(vm.recommendationText, 'Strong B2B growth marketing experience, HubSpot, GA4, and sales collaboration. Shortlist for interview.')
})

test('buildExpandedCandidateDrawerViewModel keeps AI reasoning when recommendation is missing', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    reasoningFull: 'Candidate aligns with the role due to Python, data modeling, and team leadership experience.',
  })

  assert.equal(vm.reasoningText, 'Candidate aligns with the role due to Python, data modeling, and team leadership experience.')
  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
})

test('buildExpandedCandidateDrawerViewModel preserves older recommendation-only analyses', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendation: 'Proceed to recruiter screen and verify compensation expectations.',
  })

  assert.equal(vm.reasoningText, 'Reasoning unavailable for this profile.')
  assert.equal(vm.hasRecommendedAction, true)
  assert.equal(vm.recommendationText, 'Proceed to recruiter screen and verify compensation expectations.')
})

test('buildExpandedCandidateDrawerViewModel handles malformed recommendation and reasoning values safely', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendationFull: { label: null, value: null },
    reasoningFull: { nested: { value: 'not displayable' } },
  })

  assert.equal(vm.hasRecommendedAction, false)
  assert.equal(vm.recommendationText, '')
  assert.equal(typeof vm.reasoningText, 'string')
})

test('buildExpandedCandidateDrawerViewModel preserves narrative text without appending synthetic ellipses', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    recommendation: 'Strong fit for SQL',
    strengths: ['Hands-on AWS'],
    considerations: ['Can relocate to NY'],
  })

  assert.equal(vm.recommendationText, 'Strong fit for SQL')
  assert.deepEqual(vm.candidateStrengths, ['Hands-on AWS'])
  assert.deepEqual(vm.candidateConsiderations, ['Can relocate to NY'])
})

test('buildExpandedCandidateDrawerViewModel preserves historical explicit textual confidence label', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
    fit_assessment: { confidence: 'Moderate confidence' },
    confidenceScores: { fit_assessment: 0.9 },
  })

  assert.equal(vm.confidenceLabel, 'Moderate confidence')
})


test('buildExpandedCandidateDrawerViewModel ignores null/blank numeric confidence placeholders', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')

  const withNull = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: null },
  })
  assert.equal(withNull.confidenceLabel, '')

  const withBlankString = buildExpandedCandidateDrawerViewModel({
    score: 82,
    confidenceScores: { fit_assessment: '' },
  })
  assert.equal(withBlankString.confidenceLabel, '')
})
test('buildExpandedCandidateDrawerViewModel safely handles missing confidence payloads', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    score: 82,
  })

  assert.equal(vm.confidenceLabel, '')
})


test('resolveCandidateYears supports legacy and modern field variants', () => {
  assert.equal(resolveCandidateYears({ years_experience: 6 }), 6)
  assert.equal(resolveCandidateYears({ yearsExperience: 7 }), 7)
  assert.equal(resolveCandidateYears({ experience_years: 5 }), 5)
  assert.equal(resolveCandidateYears({ experience: '3.5 years' }), 3.5)
})

test('resolveFilterableSkills supports all supported candidate skill shapes', () => {
  assert.deepEqual(resolveFilterableSkills({ top_skills: ['React', ' Node.js '] }), ['React', 'Node.js'])
  assert.deepEqual(resolveFilterableSkills({ skills_flat: ['SQL', 'Python'] }), ['SQL', 'Python'])
  assert.deepEqual(resolveFilterableSkills({ skills: ['AWS', 'Docker'] }), ['AWS', 'Docker'])
  assert.deepEqual(resolveFilterableSkills({ skills: 'Go, Rust' }), ['Go', 'Rust'])

  const structured = resolveFilterableSkills({
    skills_structured: {
      tools_and_platforms: ['Tableau'],
      methodologies: ['Agile'],
      domain_expertise: ['FinTech'],
      soft_skills: ['Communication'],
      frameworks: ['React'],
    },
  })
  assert.deepEqual(structured, ['Tableau', 'Agile', 'FinTech', 'Communication', 'React'])

  const rootBuckets = resolveFilterableSkills({
    technical_skills: ['Python', ' python '],
    frameworks: ['Vue'],
    bi_tools: 'Power BI, Tableau',
  })
  assert.deepEqual(rootBuckets, ['Python', 'Vue', 'Power BI', 'Tableau'])
})

test('normalizeSortBy canonicalizes to match_score', () => {
  assert.equal(normalizeSortBy('match_score'), 'match_score')
  assert.equal(normalizeSortBy('score'), 'match_score')
})

test('sortCandidatesForResults preserves selected sort order (name, experience, best match)', () => {
  const rows = [
    { name: 'Zed', years_experience: 2, matchScore: { score: 99 } },
    { name: 'Amy', years_experience: 8, matchScore: { score: 80 } },
    { name: 'Bob', years_experience: 5, matchScore: { score: 92 } },
  ]

  assert.deepEqual(sortCandidatesForResults(rows, 'name').map((c) => c.name), ['Amy', 'Bob', 'Zed'])
  assert.deepEqual(sortCandidatesForResults(rows, 'experience').map((c) => c.name), ['Amy', 'Bob', 'Zed'])
  assert.deepEqual(sortCandidatesForResults(rows, 'match_score').map((c) => c.name), ['Zed', 'Bob', 'Amy'])
})

test('buildExpandedCandidateDrawerViewModel shows original resume filename with extension or safe historical fallback', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  assert.equal(buildExpandedCandidateDrawerViewModel({ filename: 'resume.pdf' }).resumeFileLabel, 'resume.pdf')
  assert.equal(buildExpandedCandidateDrawerViewModel({ filename: 'resume', fileExtension: 'docx' }).resumeFileLabel, 'resume.docx')
  assert.equal(buildExpandedCandidateDrawerViewModel({ filename: 'resume', originalMimeType: 'application/pdf' }).resumeFileLabel, 'resume')
})

test('sortCandidatesForResults ranks only completed/renderable candidates supplied to results', () => {
  const completedCandidates = [
    normalizeCandidateForResults({ id: 'resume-pdf', name: 'PDF', score: 70, filename: 'resume.pdf' }, 0),
    normalizeCandidateForResults({ id: 'resume-docx', name: 'DOCX', score: 90, filename: 'resume.docx' }, 1),
  ]

  const sorted = sortCandidatesForResults(completedCandidates, 'match_score')
  assert.deepEqual(sorted.map((candidate) => candidate.filename), ['resume.docx', 'resume.pdf'])
})

test('buildExpandedCandidateDrawerViewModel prefers fuller fit assessment fields over compact result fields', async () => {
  const { buildExpandedCandidateDrawerViewModel } = await import('./candidateResultsState.js')
  const vm = buildExpandedCandidateDrawerViewModel({
    matchedSkills: ['TypeScript backend services with event'],
    missingSkills: ['Kubernetes production'],
    considerations: ['Cloud breadth needs follow'],
    fit_assessment: {
      matched_requirements: ['TypeScript backend services with event-driven architecture and queue ownership.'],
      missing_requirements: ['Kubernetes production operations experience is not clearly evidenced.'],
      risks_or_gaps: ['Cloud breadth needs follow-up, especially multi-region deployment ownership.'],
    },
  })

  assert.deepEqual(vm.matchedSkills, ['TypeScript backend services with event-driven architecture and queue ownership.'])
  assert.deepEqual(vm.missingSkills, ['Kubernetes production operations experience is not clearly evidenced.'])
  assert.deepEqual(vm.candidateConsiderations, ['Cloud breadth needs follow-up, especially multi-region deployment ownership.'])
})
