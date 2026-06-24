/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

import resultsExportRouter from './resultsExport.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/results/export', resultsExportRouter)
  return app
}

function authHeader(userId) {
  return { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}` }
}

async function postCsvExport({ body, headers } = {}) {
  const app = buildApp()
  const server = app.listen(0)
  const port = server.address().port

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/results/export/csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { response, text }
  } finally {
    server.close()
  }
}

test('POST /api/results/export/csv neutralizes candidate-controlled formula cells and preserves attachment headers', async () => {
  process.env.JWT_SECRET = 'test-secret'

  const { response, text } = await postCsvExport({
    headers: authHeader(42),
    body: {
      candidates: [
        {
          name: '=HYPERLINK("https://evil.example","click")',
          email: 'candidate@example.com',
          score: 88,
          summary: '@SUM(1,2)',
          skills: ['React'],
          strengths: ['Delivery'],
        },
      ],
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="candidate-results-\d+\.csv"$/)
  assert.equal(text.split('\n')[0], 'name,email,score,summary,skills,strengths')
  assert.equal(
    text.split('\n')[1],
    '"\'=HYPERLINK(""https://evil.example"",""click"")",candidate@example.com,88,"\'@SUM(1,2)",React,Delivery',
  )
})
