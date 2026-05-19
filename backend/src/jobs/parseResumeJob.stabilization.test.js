import test from 'node:test'
import assert from 'node:assert/strict'

import { isFailurePlaceholderCandidate, shouldFailBeforeAi, shouldTriggerPlaceholderRetry } from './parseResumeJob.js'
import { placeholderTemplateCandidateFixture } from '../utils/__fixtures__/promptBehaviorFixtures.js'

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

test('placeholder retry triggers once only for substantial extracted text', () => {
  const placeholder = {
    id: 'c-1',
    name: 'Parsing Failed',
    score: 0,
    reasoning: 'Unable to extract enough text for reliable resume analysis.',
    pros: [],
    cons: ['No reliable resume content available'],
  }
  assert.equal(shouldTriggerPlaceholderRetry({ candidates: [placeholder], extractedTextLength: 1200 }), true)
  assert.equal(shouldTriggerPlaceholderRetry({ candidates: [placeholder], extractedTextLength: 800 }), false)
  assert.equal(shouldTriggerPlaceholderRetry({ candidates: [], extractedTextLength: 1500 }), false)
})


test('placeholder retry guardrail also triggers from validation-level placeholder signals', () => {
  assert.equal(shouldTriggerPlaceholderRetry({ candidates: [placeholderTemplateCandidateFixture], extractedTextLength: 26519 }), true)
})
