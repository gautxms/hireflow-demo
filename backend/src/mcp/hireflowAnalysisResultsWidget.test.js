import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getHireFlowAnalysisResultsWidgetResource,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
  readHireFlowAnalysisResultsWidgetResource,
  resolveHireFlowAnalysisProgressCounts,
  resolveHireFlowAnalysisRankingStats,
} from './hireflowAnalysisResultsWidget.js'

test('analysis results widget normalizes creation and polling progress into one view model', () => {
  assert.deepEqual(resolveHireFlowAnalysisProgressCounts({
    queued: 2,
    failed: 1,
    files: [{ status: 'queued' }, { status: 'queued' }, { status: 'failed' }],
  }), {
    total: 3,
    complete: 0,
    failed: 1,
    processing: 0,
    queued: 2,
  })

  assert.deepEqual(resolveHireFlowAnalysisProgressCounts({
    counts: { total: 3, complete: 1, failed: 0, processing: 1, queued: 1 },
  }), {
    total: 3,
    complete: 1,
    failed: 0,
    processing: 1,
    queued: 1,
  })
})

test('analysis results widget matches HireFlow ranking summary calculations', () => {
  assert.deepEqual(resolveHireFlowAnalysisRankingStats({
    candidates: [
      { scoreOutOfTen: 8.2 },
      { scoreOutOfTen: 7.1 },
      { scoreOutOfTen: 5.5 },
    ],
  }), {
    analysed: 3,
    strongMatches: 1,
    averageScore: '6.9',
  })

  assert.deepEqual(resolveHireFlowAnalysisRankingStats({
    candidates: [{ score: 92 }, { scoreOutOfTen: '' }],
  }), {
    analysed: 2,
    strongMatches: 1,
    averageScore: '4.6',
  })

  assert.deepEqual(resolveHireFlowAnalysisRankingStats(), {
    analysed: 0,
    strongMatches: 0,
    averageScore: '0.0',
  })
})

test('analysis results widget exposes a versioned MCP Apps resource', () => {
  assert.equal(HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI, 'ui://hireflow/analysis-results-v4.html')
  assert.equal(HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE, 'text/html;profile=mcp-app')
  assert.deepEqual(getHireFlowAnalysisResultsWidgetResource(), {
    uri: HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
    name: 'HireFlow analysis results',
    title: 'HireFlow analysis results',
    description: 'Interactive HireFlow candidate scores and detailed analysis.',
    mimeType: HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
  })

  const resource = readHireFlowAnalysisResultsWidgetResource().contents[0]
  assert.equal(resource.uri, HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI)
  assert.equal(resource.mimeType, HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE)
  assert.deepEqual(resource._meta['openai/ui'].availableDisplayModes, ['inline', 'fullscreen'])
  assert.equal(resource._meta.ui.prefersBorder, true)
  assert.equal(resource._meta.ui.domain, 'https://hireflow.dev')
  assert.deepEqual(resource._meta.ui.csp.resourceDomains, ['https://hireflow.dev'])
  assert.deepEqual(resource._meta['openai/widgetCSP'].resource_domains, ['https://hireflow.dev'])
  assert.deepEqual(resource._meta['openai/widgetCSP'].redirect_domains, ['https://hireflow.dev'])
})

test('analysis results widget uses the MCP Apps bridge and safe DOM rendering', () => {
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /ui\/initialize/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /ui\/notifications\/initialized/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /ui\/notifications\/tool-result/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /tools\/call/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /render_analysis_results/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /get_analysis_status/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /setWidgetState/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /result-card/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /ranking-stats/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Strong matches/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Avg score \/10/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Syne Local/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Relevant skills unavailable for this analysis/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Collapse details/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /detail-drawer/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /rc-score-denom', '\/10'/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /dd-score/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Recommended action/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Key facts/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Matched skills/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Skill gaps/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /dd-breakdown-track/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /dd-resume-file/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /confidenceLabel/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /resolveProgressCounts/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /fileQueued/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /fileFailed/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /version: '4\.0\.0'/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /rc-bar/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /analysis-metrics/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /section\('Risks or gaps'/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /\.innerHTML\s*=/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /<script[^>]+src=/)

  const script = HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML.match(/<script type="module">([\s\S]+)<\/script>/)?.[1]
  assert.ok(script)
  assert.doesNotThrow(() => new Function(script))
})
