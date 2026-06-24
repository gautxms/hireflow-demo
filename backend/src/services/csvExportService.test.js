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


test('buildCandidatesCsv exports structured skills objects without object stringification', () => {
  const csv = buildCandidatesCsv([
    {
      name: 'Structured Skills Candidate',
      email: 'structured@example.com',
      score: 77,
      summary: 'Safe summary',
      skills: {
        tools_and_platforms: ['React'],
        methodologies: ['Agile'],
        domain_expertise: ['Healthcare'],
        soft_skills: ['Communication'],
        ignored_nested: { label: 'Do not stringify me' },
      },
      strengths: [],
    },
  ])

  assert.equal(
    getFirstCandidateRow(csv),
    'Structured Skills Candidate,structured@example.com,77,Safe summary,React; Agile; Healthcare; Communication,',
  )
  assert.equal(csv.includes('[object Object]'), false)
})

test('buildCandidatesCsv neutralizes formulas after structured list flattening', () => {
  const csv = buildCandidatesCsv([
    {
      name: 'Structured Formula Candidate',
      email: 'formula@example.com',
      score: 77,
      summary: 'Safe summary',
      skills: {
        tools_and_platforms: ['=IMPORTXML("https://evil.example")', 'React'],
        methodologies: [],
        domain_expertise: [],
        soft_skills: [],
      },
      strengths: [],
    },
  ])

  assert.equal(
    getFirstCandidateRow(csv),
    `Structured Formula Candidate,formula@example.com,77,Safe summary,"'=IMPORTXML(""https://evil.example""); React",`,
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
