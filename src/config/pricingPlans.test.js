import test from 'node:test'
import assert from 'node:assert/strict'
import { PRICING_TIERS, CHECKOUT_PLAN_DETAILS, getCheckoutPlanFromSearch, getPlanDisplayLabel } from './pricingPlans.js'
import { TIERED_PLAN_CATALOG } from '../../backend/src/config/planCatalog.js'

test('each published offer sends the exact supported checkout plan with its backend price and allowance', () => {
  assert.equal(PRICING_TIERS.length, 3)

  for (const tier of PRICING_TIERS) {
    for (const [billing, code, amount] of [
      ['monthly', tier.monthlyCode, tier.monthlyAmount],
      ['annual', tier.annualCode, tier.annualAmount],
    ]) {
      const backend = TIERED_PLAN_CATALOG[`${tier.id}_${billing}`]
      assert.equal(backend.amountCents, amount * 100)
      assert.equal(backend.monthlyResumeAnalysisLimit, tier.monthlyLimit)
      assert.equal(getCheckoutPlanFromSearch(`?plan=${code}`), code)
      assert.equal(CHECKOUT_PLAN_DETAILS[code].monthlyLimit, tier.monthlyLimit)
      assert.equal(getPlanDisplayLabel(code), `${tier.name} ${billing === 'annual' ? 'Annual' : 'Monthly'}`)
    }
  }
})

test('missing and unknown checkout plan links never fall through to Pro monthly', () => {
  for (const search of ['', '?plan=bogus', '?plan=__proto__', '?plan=pro_monthly']) {
    assert.equal(getCheckoutPlanFromSearch(search), null)
  }
  assert.equal(getCheckoutPlanFromSearch('?plan=test-monthly&testKey=sandbox'), 'test-monthly')
  assert.equal(getPlanDisplayLabel('pro_monthly'), 'Pro Monthly')
})
