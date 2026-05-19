import test from 'node:test'
import assert from 'node:assert/strict'

import { isFailurePlaceholderCandidate, shouldFailBeforeAi, shouldTriggerPlaceholderRetry } from './parseResumeJob.js'

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


test('contradictory-state guard retries placeholder narrative when extracted text is substantial (no first-pass terminal parse_failed)', () => {
  const placeholderNarrativeCandidate = {
    id: 'c-1',
    name: 'Unknown Candidate',
    score: 0,
    reasoning: 'Unable to extract enough text for reliable resume analysis.',
    summary: 'Resume document could not be parsed. PDF content is compressed/encrypted or corrupted.',
    pros: [],
    cons: ['No reliable resume content available'],
  }

  assert.equal(isFailurePlaceholderCandidate(placeholderNarrativeCandidate), true)
  assert.equal(
    shouldTriggerPlaceholderRetry({
      candidates: [placeholderNarrativeCandidate],
      extractedTextLength: 1400,
    }),
    true,
  )
})
