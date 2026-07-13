import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_KEYS, isFeatureEnabled } from './featureFlags.js'

test('subscription-gated feature flags consume resolved workspace access boolean', () => {
  for (const status of ['active', 'trialing', 'canceled', 'inactive']) {
    assert.equal(isFeatureEnabled(FEATURE_KEYS.analysesPages, { subscriptionStatus: status, workspaceAccess: true }), true)
  }

  for (const status of ['active', 'trialing', 'canceled', 'inactive']) {
    assert.equal(isFeatureEnabled(FEATURE_KEYS.analysesPages, { subscriptionStatus: status, workspaceAccess: false }), false)
  }
})
