import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCandidatesCsv, escapeCsvValue } from './csvExportService.js'

function getFirstCandidateRow(csv) {
  return csv.split('\n')[1]
}

test('buildCandidatesCsv keeps headers and normal text unchanged', () => {
  const csv = buildCandidatesCsv([
    {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      score: 98,
      summary: 'Strong engineering leader',
      skills: ['JavaScript', 'Node.js'],
      strengths: ['Mentoring', 'Architecture'],
    },
  ])

  assert.equal(csv.split('\n')[0], 'name,email,score,summary,skills,strengths')
  assert.equal(
    getFirstCandidateRow(csv),
    'Ada Lovelace,ada@example.com,98,Strong engineering leader,JavaScript; Node.js,Mentoring; Architecture',
  )
})

test('escapeCsvValue still escapes commas, quotes, and newlines', () => {
  assert.equal(escapeCsvValue('Hello, world'), '"Hello, world"')
  assert.equal(escapeCsvValue('Said "hello"'), '"Said ""hello"""')
  assert.equal(escapeCsvValue('Line one\nLine two'), '"Line one\nLine two"')
})

test('escapeCsvValue neutralizes spreadsheet formula prefixes in string cells', () => {
  assert.equal(escapeCsvValue('=HYPERLINK("https://evil.example","click")'), '"\'=HYPERLINK(""https://evil.example"",""click"")"')
  assert.equal(escapeCsvValue('+cmd'), "'+cmd")
  assert.equal(escapeCsvValue('-10+20'), "'-10+20")
  assert.equal(escapeCsvValue('@SUM(1,2)'), '"\'@SUM(1,2)"')
  assert.equal(escapeCsvValue('\t=SUM(1,2)'), '"\'\t=SUM(1,2)"')
  assert.equal(escapeCsvValue('\r=SUM(1,2)'), '"\'\r=SUM(1,2)"')
  assert.equal(escapeCsvValue('  =SUM(1,2)'), '"\'  =SUM(1,2)"')
})

test('buildCandidatesCsv protects joined array fields', () => {
  const csv = buildCandidatesCsv([
    {
      name: 'Normal Name',
      email: 'candidate@example.com',
      score: 82,
      summary: 'Safe summary',
      skills: ['=IMPORTXML("https://evil.example")', 'React'],
      strengths: ['@SUM(1,2)', 'Teamwork'],
    },
  ])

  assert.equal(
    getFirstCandidateRow(csv),
    'Normal Name,candidate@example.com,82,Safe summary,"\'=IMPORTXML(""https://evil.example""); React","\'@SUM(1,2); Teamwork"',
  )
})

test('buildCandidatesCsv keeps numeric score exported as a number while neutralizing string fields that start with dash', () => {
  const csv = buildCandidatesCsv([
    {
      name: '-Candidate',
      email: 'candidate@example.com',
      score: 91,
      summary: '-10+20',
      skills: [],
      strengths: [],
    },
  ])

  assert.equal(getFirstCandidateRow(csv), "'-Candidate,candidate@example.com,91,'-10+20,,")
})
