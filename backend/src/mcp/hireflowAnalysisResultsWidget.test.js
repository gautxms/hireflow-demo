import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getHireFlowAnalysisResultsWidgetResource,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
  HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
  readHireFlowAnalysisResultsWidgetResource,
} from './hireflowAnalysisResultsWidget.js'

test('analysis results widget exposes a versioned MCP Apps resource', () => {
  assert.equal(HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI, 'ui://hireflow/analysis-results-v2.html')
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
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /detail-drawer/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /rc-score-denom', '\/10'/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /dd-score/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Matched requirements/)
  assert.match(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /Recommended action/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /\.innerHTML\s*=/)
  assert.doesNotMatch(HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML, /<script[^>]+src=/)

  const script = HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML.match(/<script type="module">([\s\S]+)<\/script>/)?.[1]
  assert.ok(script)
  assert.doesNotThrow(() => new Function(script))
})
