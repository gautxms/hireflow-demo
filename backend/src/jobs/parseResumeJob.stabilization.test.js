import test from 'node:test'
import assert from 'node:assert/strict'

import { isFailurePlaceholderCandidate, shouldFailBeforeAi } from './parseResumeJob.js'

test('pre-AI short-circuit only when extracted text is not usable length', () => {
  assert.equal(shouldFailBeforeAi({ hasUsableExtractedText: true }), false)
  assert.equal(shouldFailBeforeAi({ hasUsableExtractedText: false }), true)
})

test('post-AI failure narrative/placeholder candidates remain rejected', () => {
  const placeholder = {
    id: 'c-1',
    name: 'Parsing Failed',
    score: 0,
    reasoning: 'Unable to extract enough text for reliable resume analysis.',
    pros: [],
    cons: ['No reliable resume content available'],
  }

  assert.equal(isFailurePlaceholderCandidate(placeholder), true)
})
