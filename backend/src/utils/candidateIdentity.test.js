import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCandidateResumeUuid, resolveCanonicalCandidateIdentity } from './candidateIdentity.js'

test('resolveCandidateResumeUuid prefers UUID-compatible candidate fields', () => {
  const resumeId = '550e8400-e29b-41d4-a716-446655440000'
  assert.equal(resolveCandidateResumeUuid({ resumeId }), resumeId)
  assert.equal(resolveCandidateResumeUuid({ candidateId: resumeId }), resumeId)
  assert.equal(resolveCandidateResumeUuid({ id: 'parsed-1' }), null)
})

test('resolveCanonicalCandidateIdentity emits stable adapter identifiers', () => {
  const resumeId = '550e8400-e29b-41d4-a716-446655440000'
  const identity = resolveCanonicalCandidateIdentity({ id: 'parsed-1', resume_id: resumeId })

  assert.equal(identity.id, 'parsed-1')
  assert.equal(identity.candidateId, 'parsed-1')
  assert.equal(identity.resumeId, resumeId)
})
