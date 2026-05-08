import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboardSource = readFileSync(new URL('./NewDashboard.jsx', import.meta.url), 'utf8')
const dashboardStyles = readFileSync(new URL('./NewDashboard.css', import.meta.url), 'utf8')

test('dashboard trend sections expose keyboard focus and aria labeling contracts', () => {
  assert.match(dashboardSource, /role="region" aria-labelledby="dashboard-analyses-trend-title"/)
  assert.match(dashboardSource, /id="dashboard-analyses-trend-title" className="new-dashboard__trend-title">Analyses trend/) 
  assert.match(dashboardSource, /role="img" tabIndex=\{0\} aria-label="Analyses trend chart"/)
  assert.match(dashboardSource, /aria-label=\{`\$\{bar\.label\}: \$\{bar\.value\}`\}/)

  assert.match(dashboardSource, /role="region" aria-labelledby="dashboard-average-score-trend-title"/)
  assert.match(dashboardSource, /id="dashboard-average-score-trend-title" className="new-dashboard__trend-title">Average score trend/)
  assert.match(dashboardSource, /role="img" tabIndex=\{0\} aria-label="Average score trend chart"/)
  assert.match(dashboardSource, /aria-label=\{`\$\{bar\.label\}: \$\{bar\.value\.toFixed\(2\)\}`\}/)
})

test('dashboard styles preserve focus visibility and mobile button ergonomics', () => {
  assert.match(dashboardStyles, /\.new-dashboard__select:focus-visible,\n\.new-dashboard__chart:focus-visible,\n\.new-dashboard__trend-card:focus-within/)
  assert.match(dashboardStyles, /@media \(max-width: 768px\) \{[\s\S]*\.new-dashboard__button \{\n    width: 100%;/)
})
