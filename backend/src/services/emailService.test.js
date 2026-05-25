import test from 'node:test'
import assert from 'node:assert/strict'

const ORIGINAL_ENV = { ...process.env }

async function loadService() {
  return import(`./emailService.js?${Date.now()}_${Math.random()}`)
}

function resetEnv(overrides = {}) {
  process.env = { ...ORIGINAL_ENV, ...overrides }
}

test('SES provider is selected explicitly', async () => {
  resetEnv({ EMAIL_PROVIDER: 'ses' })
  const mod = await loadService()
  assert.equal(mod.__emailServiceTestUtils.getConfiguredProvider(), 'ses')
})

test('SendGrid is not selected when EMAIL_PROVIDER=ses', async () => {
  resetEnv({ EMAIL_PROVIDER: 'ses', SENDGRID_API_KEY: 'SG.fake' })
  const mod = await loadService()
  assert.equal(mod.__emailServiceTestUtils.getConfiguredProvider(), 'ses')
})

test('SMTP provider is selected explicitly', async () => {
  resetEnv({ EMAIL_PROVIDER: 'smtp' })
  const mod = await loadService()
  assert.equal(mod.__emailServiceTestUtils.getConfiguredProvider(), 'smtp')
})

test('missing SES config returns controlled failure', async () => {
  resetEnv({ EMAIL_PROVIDER: 'ses', AWS_SES_REGION: '', AWS_SES_ACCESS_KEY_ID: '', AWS_SES_SECRET_ACCESS_KEY: '' })
  const mod = await loadService()
  const ok = await mod.sendTemplateEmail({
    to: 'user@example.com',
    subject: 'Test',
    templateName: 'welcome',
    text: 'Test',
    values: { to: 'user@example.com' },
  })
  assert.equal(ok, false)
})

test('recipient domain safe logging helper only returns domain', async () => {
  resetEnv()
  const mod = await loadService()
  assert.equal(mod.__emailServiceTestUtils.getRecipientDomain('person@sub.example.com'), 'sub.example.com')
})
