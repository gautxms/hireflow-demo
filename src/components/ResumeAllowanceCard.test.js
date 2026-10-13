import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('ResumeAllowanceCard distinguishes active, exhausted, trial and blocked accounts', async (t) => {
  const vite = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: 'custom',
  })
  t.after(() => vite.close())
  const { default: ResumeAllowanceCard } = await vite.ssrLoadModule('/src/components/ResumeAllowanceCard.jsx')
  const render = (quota) => renderToStaticMarkup(createElement(ResumeAllowanceCard, { status: 'success', quota }))
  const base = {
    limit: 100, used: 2, available: 98, percentageUsed: 2,
    periodEnd: '2026-11-08T00:00:00Z', periodKind: 'monthly',
    canCreateAnalysis: true, accessBlocked: false, warningLevel: 'none',
  }

  const active = render(base)
  assert.match(active, /98 of 100 available/)
  assert.match(active, /role="progressbar"/)
  assert.match(active, /Resets on 8 November 2026/)

  const reached = render({ ...base, used: 100, available: 0, percentageUsed: 100, canCreateAnalysis: false, warningLevel: 'exceeded' })
  assert.match(reached, /0 of 100 available/)
  assert.match(reached, /limit has been reached/)
  assert.match(reached, /Resets on 8 November 2026/)

  const trial = render({ ...base, limit: 10, used: 1, available: 9, periodKind: 'trial' })
  assert.match(trial, /9 of 10 available/)
  assert.match(trial, /Trial ends on 8 November 2026/)
  assert.doesNotMatch(trial, /Resets on/)

  const blocked = render({
    ...base, limit: 0, used: 100, available: 0, periodEnd: null,
    canCreateAnalysis: false, accessBlocked: true, accessReason: 'cancelled',
  })
  assert.match(blocked, /Not available/)
  assert.match(blocked, /Your subscription is cancelled/)
  assert.doesNotMatch(blocked, /of 10 available|of 100 available|role="progressbar"|Resets on|Trial ends on|limit has been reached/)

  const paymentFailed = render({ ...base, available: 0, canCreateAnalysis: false, accessBlocked: true, accessReason: 'past_due' })
  assert.match(paymentFailed, /Update your payment method/)
  assert.doesNotMatch(paymentFailed, /role="progressbar"|Resets on|limit has been reached/)
})
