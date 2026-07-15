import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboardSource = readFileSync(new URL('./NewDashboard.jsx', import.meta.url), 'utf8')

test('read-only dashboard preserves historical filters and CSV export without duplicate access copy', () => {
  assert.match(dashboardSource, /export default function NewDashboard\(\)/)
  assert.doesNotMatch(dashboardSource, /Read-only access:/)
  assert.match(dashboardSource, /fetch\(`\$\{API_BASE\}\/profile\/dashboard\/kpis\?\$\{params\.toString\(\)\}`/)
  assert.match(dashboardSource, /new URLSearchParams\(\{ rangeDays, export: 'csv' \}\)/)
  assert.doesNotMatch(dashboardSource, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/)
})
