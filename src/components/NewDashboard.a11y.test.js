import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboardSource = readFileSync(new URL('./NewDashboard.jsx', import.meta.url), 'utf8')
const dashboardStyles = readFileSync(new URL('./NewDashboard.css', import.meta.url), 'utf8')

test('dashboard trend sections expose keyboard focus and aria labeling contracts', () => {
  assert.match(dashboardSource, /role="region" aria-labelledby="dashboard-analyses-trend-title"/)
  assert.match(dashboardSource, /id="dashboard-analyses-trend-title" className="new-dashboard__trend-title">[\s\S]*Analyses trend/) 
  assert.match(dashboardSource, /aria-label="Analyses trend bar chart with count axis and date ticks"/)
  assert.match(dashboardSource, /`\$\{bar\.label\}: \$\{bar\.value\} analyses`/)

  assert.match(dashboardSource, /role="region" aria-labelledby="dashboard-average-score-trend-title"/)
  assert.match(dashboardSource, /id="dashboard-average-score-trend-title" className="new-dashboard__trend-title">[\s\S]*Average score trend/)
  assert.match(dashboardSource, /aria-label="Average score trend line chart with score axis and date ticks"/)
  assert.match(dashboardSource, /`\$\{point\.label\}: \$\{formatScore\(point\.value\)\} score`/)
})

test('dashboard styles preserve focus visibility and mobile button ergonomics', () => {
  assert.match(dashboardStyles, /\.new-dashboard__select-trigger:focus-visible,\n\.new-dashboard__chart:focus-visible,\n\.new-dashboard__trend-card:focus-within/)
  assert.match(dashboardStyles, /\.new-dashboard__point:focus-visible,\n\.new-dashboard__bar-column:focus-visible/)
  assert.match(dashboardStyles, /@media \(max-width: 768px\) \{[\s\S]*\.new-dashboard__button \{\n {4}width: 100%;/)
})


test('dashboard trend cards expose summary and score empty state contracts', () => {
  assert.match(dashboardSource, /aria-label="Analyses trend summary"/)
  assert.match(dashboardSource, /Total analyses/)
  assert.match(dashboardSource, /Peak · \{analysesSummary\.peak\.label\}/)
  assert.match(dashboardSource, /Avg\/day/)
  assert.match(dashboardSource, /aria-label="Average score trend summary"/)
  assert.match(dashboardSource, /No completed score data is available for the selected filters\./)
  assert.match(dashboardSource, /scoreValues = useMemo\(\(\) => averageScoreTrend\.map\(\(item\) => parseFiniteNumber\(item\.value\)\)\.filter/)
})


test('dashboard filter controls use an accessible custom dark listbox instead of native selects', () => {
  assert.doesNotMatch(dashboardSource, /<select[\s>]/)
  assert.match(dashboardSource, /function DashboardFilterSelect/)
  assert.match(dashboardSource, /aria-haspopup="listbox"/)
  assert.match(dashboardSource, /role="listbox"/)
  assert.match(dashboardSource, /role="option"/)
  assert.match(dashboardSource, /ChevronDown/)
  assert.match(dashboardSource, /document\.addEventListener\('pointerdown', handlePointerDown\)/)
  assert.match(dashboardStyles, /\.new-dashboard__select-menu \{[\s\S]*background: var\(--dashboard-select-menu-bg\);/)
  assert.match(dashboardStyles, /\.new-dashboard__select-option--selected \{[\s\S]*background:/)
})
