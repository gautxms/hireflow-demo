import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveDirectoryScoreDisplay } from './candidateScoreDisplay.js'

test('formats JD-fit directory score metadata as match score out of 10', () => {
  assert.deepEqual(resolveDirectoryScoreDisplay({
    scoreDisplay: '8.7',
    scoreRaw: 87,
    scoreContext: 'jd_fit',
  }), {
    value: '8.7',
    label: 'Match',
    text: '8.7/10',
    isPending: false,
    context: 'jd_fit',
  })
})

test('formats profile-only directory score metadata without implying match', () => {
  const display = resolveDirectoryScoreDisplay({
    scoreDisplay: '7.8',
    scoreRaw: 78,
    scoreContext: 'profile_only',
  })

  assert.equal(display.text, '7.8/10')
  assert.equal(display.label, 'Profile')
})

test('derives legacy directory score display from raw score metadata', () => {
  const display = resolveDirectoryScoreDisplay({
    scoreRaw: 82,
    scoreContext: 'legacy',
  })

  assert.equal(display.text, '8.2/10')
  assert.equal(display.label, 'Legacy')
})

test('falls back to legacy profileScore as profile score display', () => {
  const display = resolveDirectoryScoreDisplay({ profileScore: 78 })

  assert.equal(display.text, '7.8/10')
  assert.equal(display.label, 'Profile')
})

test('returns a safe pending state for invalid or missing scores', () => {
  assert.deepEqual(resolveDirectoryScoreDisplay({ scoreDisplay: 'nope', scoreRaw: Number.NaN, profileScore: null }), {
    value: null,
    label: 'Pending',
    text: 'Score pending',
    isPending: true,
    context: 'missing',
  })
})
