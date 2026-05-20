import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toCandidateResultsPayload } from './analysisDetailPayload.js'

const analysisDetailSource = readFileSync(new URL('./AnalysisDetailPage.jsx', import.meta.url), 'utf8')
const candidateResultsSource = readFileSync(new URL('../components/CandidateResults.jsx', import.meta.url), 'utf8')

function withWarnSpy(fn) {
  const originalWarn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  try {
    fn(calls)
  } finally {
    console.warn = originalWarn
  }
}

test('toCandidateResultsPayload keeps valid candidates and drops malformed entries without invalidating payload', () => {
  withWarnSpy((warnCalls) => {
    const payload = toCandidateResultsPayload({
      id: 'analysis-1',
      status: 'complete',
      candidates: [
        { id: 'valid-1', name: 'Valid Candidate', matchScore: 74, scoreBreakdown: { overall: 74 } },
        null,
        'bad',
        { id: 'valid-2', name: 'Another', matchScore: '91.2', assessment: null },
        { id: 'missing-nested', name: 42, scoreBreakdown: null, assessment: 'oops' },
        7,
        { id: 'invalid-score', name: 'Clamped', matchScore: Infinity, score: -10 },
      ],
    })

    assert.equal(payload.candidates.length, 4)
    assert.equal(payload.hasPartiallyInvalidPayload, true)
    assert.equal(payload.hasInvalidPayload, false)
    assert.equal(payload.droppedCount, 3)

    assert.equal(payload.candidates[0].id, 'valid-1')
    assert.equal(payload.candidates[1].matchScore.score, 91.2)
    assert.equal(payload.candidates[2].name, '42')
    assert.equal(payload.candidates[2].scoreBreakdown.overall, 0)
    assert.equal(payload.candidates[3].matchScore.score, 0)
    assert.equal(payload.candidates[3].score, 0)

    assert.equal(warnCalls.length, 1)
    assert.equal(warnCalls[0][0], '[AnalysisDetailPage] Candidate normalization adjusted records.')
    assert.deepEqual(warnCalls[0][1], {
      fixedFieldCount: 0,
      fixedSkillsStructuredFieldCount: 0,
      droppedCount: 3,
      inputCount: 7,
      outputCount: 4,
      analysisId: 'analysis-1',
    })
  })
})

test('toCandidateResultsPayload handles all-invalid candidates gracefully', () => {
  withWarnSpy((warnCalls) => {
    const payload = toCandidateResultsPayload({
      id: 'analysis-2',
      status: 'complete',
      candidates: [null, undefined, 1, 'oops', false],
    })

    assert.equal(payload.candidates.length, 0)
    assert.equal(payload.hasInvalidPayload, true)
    assert.equal(payload.hasPartiallyInvalidPayload, false)
    assert.equal(payload.inputCount, 5)
    assert.equal(payload.outputCount, 0)
    assert.equal(payload.droppedCount, 5)
    assert.equal(warnCalls.length, 1)
  })
})

test('toCandidateResultsPayload can normalize nested item result candidates from terminal analysis responses', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-3',
    liveStatus: 'complete',
    items: [
      {
        resumeId: 'resume-1',
        filename: 'resume-1.pdf',
        result: JSON.stringify({
          status: 'complete',
          candidates: [{ id: 'c-1', name: 'Nested Candidate', matchScore: 88 }, null],
        }),
      },
    ],
  })

  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].id, 'c-1')
  assert.equal(payload.candidates[0].resumeId, 'resume-1')
  assert.equal(payload.candidates[0].filename, 'resume-1.pdf')
  assert.equal(payload.hasPartiallyInvalidPayload, false)
  assert.equal(payload.hasInvalidPayload, false)
})


test('toCandidateResultsPayload derives score from profile_score when score is absent', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-profile-score',
    candidates: [
      {
        id: 'profile-only',
        name: 'Profile Score Candidate',
        profile_score: 52,
      },
    ],
  })

  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].score, 52)
  assert.equal(payload.candidates[0].matchScore.score, 52)
  assert.equal(typeof payload.candidates[0].matchScore.reason, 'string')
  assert.equal(payload.candidates[0].scoreBreakdown.overall, 52)
})

test('toCandidateResultsPayload normalizes legacy numeric matchScore and missing optionals without dropping candidate', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-regression-legacy-score',
    candidates: [{ id: 'legacy-1', name: 'Legacy User', matchScore: 67 }],
  })

  assert.equal(payload.hasInvalidPayload, false)
  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].matchScore.score, 67)
  assert.equal(typeof payload.candidates[0].matchScore.reason, 'string')
})

test('e2e: analysis detail terminal response with one malformed candidate still renders results and non-prod debug banner', () => {
  const analysisResponse = {
    id: 'analysis-e2e-partial',
    status: 'complete',
    summary: { total: 2, complete: 2, failed: 0, processing: 0, pending: 0 },
    candidates: [
      { id: 'valid-1', name: 'Valid One', matchScore: 80, scoreBreakdown: { overall: 80 } },
      null,
      { id: 'valid-2', name: 'Valid Two', matchScore: 90, scoreBreakdown: { overall: 90 } },
    ],
  }

  const normalized = toCandidateResultsPayload(analysisResponse)
  assert.equal(normalized.hasInvalidPayload, false)
  assert.equal(normalized.hasPartiallyInvalidPayload, true)
  assert.equal(normalized.candidates.length, 2)
  assert.equal(normalized.candidates[0].name, 'Valid One')
  assert.equal(normalized.candidates[1].name, 'Valid Two')

  assert.match(analysisDetailSource, /CandidateResults/)
  assert.match(analysisDetailSource, /candidateResultsPayload\.candidates\.length > 0/)
  assert.match(analysisDetailSource, /Candidate payload validation issues\./)
  assert.match(analysisDetailSource, /issueCount: issues\.length/)
  assert.doesNotMatch(analysisDetailSource, /<ResultsErrorBoundary[^]*We could not render these results/s)
  assert.match(analysisDetailSource, /isNonProductionBuild && candidateResultsPayload\.droppedCount > 0/)
})

test('e2e: analysis detail terminal response with fully malformed candidates resolves to graceful invalid/empty state', () => {
  const analysisResponse = {
    id: 'analysis-e2e-invalid',
    status: 'complete',
    summary: { total: 3, complete: 3, failed: 0, processing: 0, pending: 0 },
    candidates: [null, undefined, false],
  }

  const normalized = toCandidateResultsPayload(analysisResponse)
  assert.equal(normalized.hasInvalidPayload, true)
  assert.equal(normalized.hasPartiallyInvalidPayload, false)
  assert.equal(normalized.candidates.length, 0)

  assert.match(analysisDetailSource, /candidateResultsPayload\.candidates\.length > 0/)
  assert.match(analysisDetailSource, /This analysis is still processing\. Results will be available when processing completes\./)
})


test('toCandidateResultsPayload normalizes nested skills_structured fields to safe arrays', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-4',
    candidates: [{
      id: 'skills-1',
      name: 'Skills Candidate',
      skills_structured: {
        tools_and_platforms: 'React, Node.js,  PostgreSQL ',
        methodologies: ['Agile', 'Scrum'],
        domain_expertise: 'FinTech, B2B SaaS',
        soft_skills: null,
      },
    }],
  })

  assert.deepEqual(payload.candidates[0].skills_structured, {
    tools_and_platforms: ['React', 'Node.js', 'PostgreSQL'],
    methodologies: ['Agile', 'Scrum'],
    domain_expertise: ['FinTech', 'B2B SaaS'],
    soft_skills: [],
  })
  assert.deepEqual(payload.normalizationDiagnostics, {
    fixedFieldCount: 3,
    fixedSkillsStructuredFieldCount: 3,
  })
})

test('e2e: malformed nested skills_structured variants do not trigger boundary fallback and still render candidates', () => {
  const analysisResponse = {
    id: 'analysis-e2e-skills-structured-malformed',
    status: 'complete',
    candidates: [
      {
        id: 'skills-valid',
        name: 'Valid Skills',
        skills_structured: {
          tools_and_platforms: ['React', 'TypeScript'],
          methodologies: ['Agile'],
          domain_expertise: ['SaaS'],
          soft_skills: ['Communication'],
        },
      },
      {
        id: 'skills-string',
        name: 'String Tools',
        skills_structured: {
          tools_and_platforms: 'React,Node.js',
        },
      },
      {
        id: 'skills-null',
        name: 'Null Tools',
        skills_structured: {
          tools_and_platforms: null,
        },
      },
      {
        id: 'skills-object',
        name: 'Object Tools',
        skills_structured: {
          tools_and_platforms: { primary: 'React' },
        },
      },
    ],
  }

  const normalized = toCandidateResultsPayload(analysisResponse)
  assert.equal(normalized.candidates.length, 4)
  assert.equal(normalized.hasInvalidPayload, false)
  assert.equal(normalized.hasPartiallyInvalidPayload, false)

  assert.deepEqual(normalized.candidates[0].skills_structured.tools_and_platforms, ['React', 'TypeScript'])
  assert.deepEqual(normalized.candidates[1].skills_structured.tools_and_platforms, ['React', 'Node.js'])
  assert.deepEqual(normalized.candidates[2].skills_structured.tools_and_platforms, [])
  assert.deepEqual(normalized.candidates[3].skills_structured.tools_and_platforms, [])
  assert.equal(normalized.normalizationDiagnostics.fixedSkillsStructuredFieldCount, 3)

  assert.match(analysisDetailSource, /candidateResultsPayload\.candidates\.length > 0/)
  assert.doesNotMatch(analysisDetailSource, /<ResultsErrorBoundary[^]*We could not render these results/s)
})

test('toCandidateResultsPayload prefers backend normalizedCandidates when parse result payload is malformed', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-5',
    liveStatus: 'complete',
    items: [
      {
        id: 'item-1',
        resumeId: 'resume-1',
        filename: 'resume-1.pdf',
        result: '{"broken":',
        normalizedCandidates: [
          { id: 'n-1', name: 'Recovered Candidate', matchScore: 86 },
        ],
      },
    ],
  })

  assert.equal(payload.candidates.length, 1)
  assert.equal(payload.candidates[0].id, 'n-1')
  assert.equal(payload.candidates[0].name, 'Recovered Candidate')
  assert.equal(payload.candidates[0].resumeId, 'resume-1')
  assert.equal(payload.candidates[0].filename, 'resume-1.pdf')
})

test('toCandidateResultsPayload normalizes completed /api/analyses/:id payload with two complete items', () => {
  const payload = toCandidateResultsPayload({
    id: 'cb12a09b-55c8-4ab1-9ba1-95db1adeda75',
    status: 'complete',
    liveStatus: 'complete',
    summary: { total: 2, complete: 2, failed: 0, processing: 0, pending: 0 },
    items: [
      {
        id: 'item-1',
        resumeId: 'resume-a',
        filename: 'candidate-a.pdf',
        result: JSON.stringify({ candidates: [{ id: 'c-a', name: 'Candidate A', matchScore: { score: 82 } }] }),
      },
      {
        id: 'item-2',
        resumeId: 'resume-b',
        filename: 'candidate-b.pdf',
        result: JSON.stringify({ candidates: [{ id: 'c-b', name: 'Candidate B', scoreBreakdown: { overall: 76 } }] }),
      },
    ],
  })

  assert.equal(payload.candidates.length, 2)
  assert.equal(payload.hasInvalidPayload, false)
  assert.equal(payload.hasPartiallyInvalidPayload, false)
  assert.equal(payload.candidates[0].name, 'Candidate A')
  assert.equal(payload.candidates[1].name, 'Candidate B')
})

test('toCandidateResultsPayload preserves top skill and experience fallback source fields', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-fallback-sources',
    candidates: [
      {
        id: 'fallback-1',
        name: 'Fallback Candidate',
        top_skills: ['GraphQL'],
        skills_structured: { tools_and_platforms: 'React,Node.js' },
        skills: 'TypeScript,SQL',
        experience: '7 years across product engineering',
      },
    ],
  })

  assert.equal(payload.candidates.length, 1)
  assert.deepEqual(payload.candidates[0].top_skills, ['GraphQL'])
  assert.deepEqual(payload.candidates[0].skills_structured.tools_and_platforms, ['React', 'Node.js'])
  assert.equal(payload.candidates[0].skills, 'TypeScript,SQL')
  assert.equal(payload.candidates[0].experience, '7 years across product engineering')
})

test('toCandidateResultsPayload maps analysis name into title fields and keeps job description as subtitle metadata only', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-name-priority',
    name: 'Business Analyst (4–6 Years Experience)',
    jobDescriptionTitle: 'JD: Business Analyst role',
    candidates: [{ id: 'c-1', name: 'Candidate 1', matchScore: 77 }],
  })

  assert.equal(payload.parseMeta.analysisName, 'Business Analyst (4–6 Years Experience)')
  assert.equal(payload.parseMeta.analysisTitle, 'Business Analyst (4–6 Years Experience)')
  assert.equal(payload.parseMeta.jobDescriptionTitle, 'JD: Business Analyst role')
})

test('toCandidateResultsPayload does not promote job description title to analysis title fallback', () => {
  const payload = toCandidateResultsPayload({
    id: 'analysis-no-name',
    jobDescriptionTitle: 'JD: Data Analyst',
    candidates: [{ id: 'c-1', name: 'Candidate 1', matchScore: 77 }],
  })

  assert.equal(payload.parseMeta.analysisName, '')
  assert.equal(payload.parseMeta.analysisTitle, '')
  assert.equal(payload.parseMeta.jobDescriptionTitle, 'JD: Data Analyst')
})




test('e2e: analysis detail fixture with profile_score, fit assessment, and skills renders stable candidate payload for detail expansion flow', () => {
  const analysisResponse = {
    id: 'analysis-e2e-profile-score-details',
    status: 'complete',
    liveStatus: 'complete',
    summary: { total: 1, complete: 1, failed: 0, processing: 0, pending: 0 },
    candidates: [
      {
        id: 'profile-score-1',
        name: 'Jordan Backend',
        profile_score: 52,
        fit_assessment: {
          verdict: 'Possible match',
          confidence: 'Medium',
          reason: 'Candidate aligns with core backend requirements and some preferred skills.',
          missing: ['AWS Lambda'],
        },
        skills: 'Node.js, PostgreSQL, REST APIs',
        skills_structured: {
          tools_and_platforms: ['Node.js', 'PostgreSQL'],
          methodologies: ['TDD'],
          domain_expertise: ['B2B SaaS'],
          soft_skills: ['Communication'],
        },
      },
    ],
  }

  const normalized = toCandidateResultsPayload(analysisResponse)

  assert.equal(normalized.hasInvalidPayload, false)
  assert.equal(normalized.candidates.length, 1)
  assert.equal(normalized.candidates[0].score, 52)
  assert.equal(normalized.candidates[0].matchScore.score, 52)
  assert.equal((normalized.candidates[0].matchScore.score / 10).toFixed(1), '5.2')
  assert.equal(normalized.candidates[0].fit_assessment.reason, 'Candidate aligns with core backend requirements and some preferred skills.')
  assert.ok(normalized.candidates[0].skills_structured.tools_and_platforms.includes('Node.js'))

  assert.match(analysisDetailSource, /candidateResultsPayload\.candidates\.length > 0/)
  assert.doesNotMatch(analysisDetailSource, /<ResultsErrorBoundary[^]*We could not render these results/s)
  assert.match(analysisDetailSource, /<CandidateResults/)
  assert.match(candidateResultsSource, /Expand details/)
})

test('e2e: analysis detail fixture with legacy numeric matchScore keeps list score and detail interactions stable', () => {
  const analysisResponse = {
    id: 'analysis-e2e-legacy-matchscore',
    status: 'complete',
    summary: { total: 1, complete: 1, failed: 0, processing: 0, pending: 0 },
    candidates: [
      {
        id: 'legacy-score-1',
        name: 'Legacy Candidate',
        matchScore: 52,
        fit_assessment: { reason: 'Legacy payload still has enough fit signals.' },
      },
    ],
  }

  const normalized = toCandidateResultsPayload(analysisResponse)

  assert.equal(normalized.hasInvalidPayload, false)
  assert.equal(normalized.candidates.length, 1)
  assert.equal(normalized.candidates[0].matchScore.score, 52)
  assert.equal((normalized.candidates[0].matchScore.score / 10).toFixed(1), '5.2')
  assert.equal(typeof normalized.candidates[0].matchScore.reason, 'string')

  assert.match(candidateResultsSource, /Collapse details/)
  assert.match(candidateResultsSource, /View full profile/)
})
test('analysis detail page defines page title fallback priority matrix and shell callback propagation', () => {
  assert.match(analysisDetailSource, /function deriveAnalysisPageTitle\(analysis, analysisId\)/)
  assert.match(analysisDetailSource, /analysis\?\.name/)
  assert.doesNotMatch(analysisDetailSource, /analysis\?\.jobDescriptionTitle/)
  assert.doesNotMatch(analysisDetailSource, /analysis\?\.jobDescription\?\.title/)
  assert.match(analysisDetailSource, /analysis\?\.batchName/)
  assert.match(analysisDetailSource, /shortenAnalysisId\(analysis\?\.id \|\| analysisId\)/)
  assert.match(analysisDetailSource, /onPageTitleChange\(pageTitle\)/)
})

test('analysis detail page back affordance consistently routes to analyses index with explicit label', () => {
  assert.match(analysisDetailSource, /← Back to Analyses/)
  assert.match(analysisDetailSource, /window\.location\.assign\('\/analyses'\)/)
})
