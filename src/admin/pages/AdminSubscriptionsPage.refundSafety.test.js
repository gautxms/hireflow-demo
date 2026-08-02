import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('admin subscription UI does not expose the disabled refund command', () => {
  const pageSource = readFileSync(new URL('./AdminSubscriptionsPage.jsx', import.meta.url), 'utf8')
  const tableSource = readFileSync(new URL('../components/SubscriptionsTable.jsx', import.meta.url), 'utf8')
  const headerSource = readFileSync(new URL('../components/AdminHeader.jsx', import.meta.url), 'utf8')
  const adminUiSource = `${pageSource}\n${tableSource}\n${headerSource}`

  assert.doesNotMatch(adminUiSource, /RefundModal|Open refund flow|Confirm refund|onRefund|r: refund/)
  assert.doesNotMatch(adminUiSource, /admin\/subscriptions\/.*\/refund/)
})

test('public product surfaces do not publish a refund policy route', () => {
  const manifestSource = readFileSync(new URL('../../config/publicRouteManifest.js', import.meta.url), 'utf8')
  const publicRouteSource = readFileSync(new URL('../../public/PublicRouteApp.jsx', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')
  const footerSource = readFileSync(new URL('../../components/PublicFooter.jsx', import.meta.url), 'utf8')
  const publicSources = `${manifestSource}\n${publicRouteSource}\n${appSource}\n${footerSource}`

  assert.doesNotMatch(publicSources, /\/refund-policy|RefundPolicy|refundPolicy/)
})
