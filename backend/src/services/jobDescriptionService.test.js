import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createJobDescription,
  JobDescriptionValidationError,
  normalizeJobDescriptionDraft,
} from './jobDescriptionService.js'

test('normalizes the existing multipart job-description contract without changing its defaults', () => {
  const draft = normalizeJobDescriptionDraft({
    title: '  Senior Backend Engineer  ',
    description: 'Full role text',
    requirements: 'Node.js required',
    responsibilities: 'Build APIs',
    skills: '[" Node.js ", "PostgreSQL", ""]',
    experienceYears: '4.6',
    experienceMin: 'not-a-number',
    experienceMax: '6',
    location: '',
    salaryMin: '100000',
    salaryMax: '',
    salaryCurrency: ' inr ',
    department: ' Engineering ',
    employmentType: 'remote',
    additionalInfo: '',
    priority: '3.6',
    archivedReason: '',
    sourceType: 'file',
    version: '',
    status: 'unexpected',
  }, { fileUrl: '/api/job-descriptions/files/role.pdf' })

  assert.deepEqual(draft, {
    title: 'Senior Backend Engineer',
    description: 'Full role text',
    requirements: 'Node.js required',
    responsibilities: 'Build APIs',
    skills: ['Node.js', 'PostgreSQL'],
    experienceYears: 5,
    experienceMin: null,
    experienceMax: 6,
    location: null,
    salaryMin: 100000,
    salaryMax: null,
    salaryCurrency: 'INR',
    department: 'Engineering',
    employmentType: 'remote',
    additionalInfo: null,
    priority: 4,
    archivedReason: null,
    sourceType: 'file',
    version: 1,
    fileUrl: '/api/job-descriptions/files/role.pdf',
    status: 'active',
  })
})

test('supports comma-separated skills and the current minimal-create defaults', () => {
  const draft = normalizeJobDescriptionDraft({ title: 'Designer', skills: 'Figma, Research, ' })

  assert.deepEqual(draft.skills, ['Figma', 'Research'])
  assert.equal(draft.salaryCurrency, 'USD')
  assert.equal(draft.department, '')
  assert.equal(draft.employmentType, 'unspecified')
  assert.equal(draft.sourceType, 'manual')
  assert.equal(draft.priority, 0)
  assert.equal(draft.version, 1)
  assert.equal(draft.status, 'active')
  assert.equal(draft.fileUrl, null)
})

test('rejects a blank title with a stable validation error', () => {
  assert.throws(
    () => normalizeJobDescriptionDraft({ title: '   ' }),
    (error) => error instanceof JobDescriptionValidationError
      && error.code === 'JOB_TITLE_REQUIRED'
      && error.status === 400
      && error.message === 'title is required',
  )
})

test('creates a job using only normalized values and returns the inserted row', async () => {
  const inserted = { id: 'job-123', title: 'Product Manager', status: 'draft' }
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params })
      return { rows: [inserted] }
    },
  }

  const result = await createJobDescription({
    db,
    userId: 42,
    input: {
      title: ' Product Manager ',
      skills: [' Roadmaps ', '', 'Discovery'],
      experienceMin: '3',
      status: 'draft',
    },
    fileUrl: '/api/job-descriptions/files/product-manager.pdf',
  })

  assert.equal(result, inserted)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /INSERT INTO job_descriptions/)
  assert.match(calls[0].sql, /RETURNING \*/)
  assert.deepEqual(calls[0].params, [
    42,
    'Product Manager',
    null,
    null,
    null,
    JSON.stringify(['Roadmaps', 'Discovery']),
    null,
    3,
    null,
    null,
    null,
    null,
    'USD',
    '',
    'unspecified',
    null,
    0,
    null,
    'manual',
    1,
    '/api/job-descriptions/files/product-manager.pdf',
    'draft',
  ])
})

test('fails before querying when the canonical draft is invalid', async () => {
  let queried = false
  await assert.rejects(
    createJobDescription({
      db: { async query() { queried = true } },
      userId: 42,
      input: { title: '' },
    }),
    (error) => error instanceof JobDescriptionValidationError,
  )
  assert.equal(queried, false)
})
