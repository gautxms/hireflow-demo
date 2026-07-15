import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ReportsPage.jsx', import.meta.url), 'utf8')

test('reports page loads and displays owner-scoped saved definitions', () => {
  assert.match(source, /fetch\(`\$\{API_BASE\}\/reports`/)
  assert.match(source, /setItems\(Array\.isArray\(payload\.items\) \? payload\.items : \[\]\)/)
  assert.match(source, /item\.columns\.join\(', '\)/)
  assert.match(source, /item\.scheduleEnabled \? 'Enabled' : 'Disabled'/)
})

test('read-only reports mode suppresses create, schedule, and delete mutations', () => {
  assert.match(source, /export default function ReportsPage\(\{ isReadOnly = false \}\)/)
  assert.match(source, /async function createReport[\s\S]*if \(isReadOnly\) return/)
  assert.match(source, /async function toggleSchedule[\s\S]*if \(isReadOnly\) return/)
  assert.match(source, /async function deleteReport[\s\S]*if \(isReadOnly\) return/)
  assert.match(source, /\{!isReadOnly \? <form onSubmit=\{createReport\}/)
  assert.match(source, /\{!isReadOnly \? <th>Actions<\/th> : null\}/)
  assert.match(source, /\{!isReadOnly \? <td>[\s\S]*toggleSchedule\(item\)[\s\S]*deleteReport\(item\.id\)/)
  assert.doesNotMatch(source, /Read-only access:/)
})
