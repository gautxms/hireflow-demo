import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSkillSignals } from './candidateScoreSkillsResolver.js'

test('resolveSkillSignals prefers explicit matched skill sources', () => {
  const result = resolveSkillSignals({
    matched_skills: ['React', 'TypeScript'],
    relevant_skills: ['Node.js'],
  })

  assert.equal(result.label, 'MATCHED SKILLS')
  assert.deepEqual(result.primarySkills, ['React', 'TypeScript'])
  assert.equal(result.source, 'explicit')
  assert.equal(result.confidence, 'high')
})

test('resolveSkillSignals infers relevant skills when explicit matched list is absent', () => {
  const result = resolveSkillSignals({
    top_skills: ['GraphQL', 'SQL'],
  })

  assert.equal(result.label, 'RELEVANT SKILLS')
  assert.deepEqual(result.primarySkills, ['GraphQL', 'SQL'])
  assert.equal(result.source, 'inferred')
  assert.equal(result.confidence, 'medium')
})

test('resolveSkillSignals handles empty skill payloads', () => {
  const result = resolveSkillSignals({})

  assert.equal(result.label, 'RELEVANT SKILLS')
  assert.deepEqual(result.primarySkills, [])
  assert.equal(result.source, 'none')
  assert.equal(result.confidence, 'low')
})
