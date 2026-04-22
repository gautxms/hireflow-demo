import jwt from 'jsonwebtoken'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { getRateLimitStats } from '../middleware/rateLimiter.js'
import { createPasswordResetToken, generateResetToken } from '../services/resetTokenService.js'
import { sendPasswordResetEmail } from '../utils/mailer.js'
import { createAdminSession, listAdminSessions, revokeOtherAdminSessions, setAdminCookie } from '../middleware/adminAuth.js'
import {
  getAdminAiProviderSettings,
  KEY_LABELS,
  SUPPORTED_PROVIDERS,
  getActiveAiProviderCredentials,
  upsertAdminAiProviderKeys,
  validateAiProviderModelConfiguration,
} from '../services/aiProviderConfigService.js'
import {
  getAdminSystemPrompt,
  upsertAdminSystemPrompt,
  validateSystemPromptInput,
} from '../services/adminSystemPromptService.js'

const router = Router()
const RUNTIME_SUPPORTED_ACTIVE_PROVIDERS = [...SUPPORTED_PROVIDERS]
const CONNECTION_TEST_TIMEOUT_MS = 15000

function normalizeProviderError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  const message = String(error?.message || 'Unknown provider error')
  const lower = message.toLowerCase()
  const normalizedCode = status === 401 || lower.includes('authentication') || lower.includes('invalid api key')
    ? 'auth_error'
    : status === 404 || lower.includes('model not found') || lower.includes('not found')
      ? 'invalid_model'
      : status === 429 || lower.includes('rate limit')
        ? 'rate_limit'
        : lower.includes('timeout')
          ? 'timeout'
          : 'unknown'

  return {
    code: normalizedCode,
    status: Number.isFinite(status) && status > 0 ? status : null,
    message,
  }
}

async function runProviderConnectionTest({ provider, apiKey, model }) {
  const baseHeaders = {
    'Content-Type': 'application/json',
  }
  const headers = provider === 'anthropic'
    ? {
        ...baseHeaders,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    : {
        ...baseHeaders,
        Authorization: `Bearer ${apiKey}`,
      }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS)

  try {
    const requestBody = provider === 'anthropic'
      ? {
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Respond with: ok' }],
        }
      : {
          model,
          max_output_tokens: 8,
          input: 'Respond with: ok',
        }

    const response = await fetch(
      provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      throw {
        status: response.status,
        message: body?.error?.message || body?.message || `HTTP ${response.status}`,
      }
    }

    return { ok: true }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, error: { code: 'timeout', status: null, message: 'Connection test timed out.' } }
    }
    return { ok: false, error: normalizeProviderError(error) }
  } finally {
    clearTimeout(timeout)
  }
}

function getMonthStart(inputDate) {
  const date = inputDate ? new Date(inputDate) : new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null
}

function getFrontendOrigin() {
  return process.env.FRONTEND_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173'
}

function collectProviderConfigChanges(updateFlags = {}) {
  const keyRotations = []
  const modelChanges = []
  const providers = updateFlags?.providers && typeof updateFlags.providers === 'object' ? updateFlags.providers : {}

  for (const [provider, providerFlags] of Object.entries(providers)) {
    if (providerFlags?.primaryKeyUpdated) keyRotations.push(`${provider}:primary`)
    if (providerFlags?.fallbackKeyUpdated) keyRotations.push(`${provider}:fallback`)
    if (providerFlags?.primaryModelUpdated) modelChanges.push(`${provider}:primary`)
    if (providerFlags?.fallbackModelUpdated) modelChanges.push(`${provider}:fallback`)
  }

  return { keyRotations, modelChanges }
}

function buildResetUrl(token) {
  const url = new URL('/reset-password', getFrontendOrigin())
  url.searchParams.set('token', token)
  return url.toString()
}

async function ensureAdminUserColumns() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  `)
}

async function recordAdminAction({ adminId, actionType, targetId, details = {}, ipAddress = null }) {
  if (!adminId || !actionType) return

  await pool.query(
    `INSERT INTO admin_actions (admin_id, action_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [adminId, actionType, targetId || null, JSON.stringify(details || {}), ipAddress],
  )
}


function normalizeInquiryRow(row) {
  return {
    id: row.id,
    inquiry_type: row.inquiry_type,
    status: row.status,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    subject: row.subject,
    message: row.message,
    metadata: row.metadata || {},
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    reviewed_at: toIso(row.reviewed_at),
    reviewed_by: row.reviewed_by || null,
  }
}

router.get('/ai-settings', async (_req, res) => {
  try {
    const [settings, modelValidation] = await Promise.all([
      getAdminAiProviderSettings(),
      validateAiProviderModelConfiguration(),
    ])
    return res.json({
      ...settings,
      modelWarnings: Array.isArray(modelValidation?.warnings) ? modelValidation.warnings : [],
      allowedModelsByProvider: modelValidation?.allowedModelsByProvider || {},
    })
  } catch (error) {
    console.error('[Admin ai-settings] get failed:', error)
    return res.status(500).json({ error: 'Unable to load AI settings' })
  }
})

router.post('/ai-settings/test-connection', async (req, res) => {
  const provider = String(req.body?.provider || '').trim().toLowerCase()
  const keyLabel = String(req.body?.keyLabel || 'primary').trim().toLowerCase()
  const model = String(req.body?.model || '').trim()
  const directApiKey = String(req.body?.apiKey || '').trim()

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}` })
  }
  if (!KEY_LABELS.includes(keyLabel)) {
    return res.status(400).json({ error: `keyLabel must be one of: ${KEY_LABELS.join(', ')}` })
  }
  if (!model) {
    return res.status(400).json({ error: 'model is required.' })
  }

  try {
    const credentials = await getActiveAiProviderCredentials()
    const persistedApiKey = credentials?.providers?.[provider]?.[keyLabel]?.apiKey || ''
    const apiKey = directApiKey || persistedApiKey
    if (!apiKey) {
      return res.status(400).json({ error: `No API key configured for ${provider} ${keyLabel}.` })
    }

    const testResult = await runProviderConnectionTest({ provider, apiKey, model })
    if (!testResult.ok) {
      return res.status(400).json({
        ok: false,
        provider,
        keyLabel,
        model,
        ...testResult,
      })
    }

    return res.json({
      ok: true,
      provider,
      keyLabel,
      model,
      message: 'Connection successful.',
    })
  } catch (error) {
    console.error('[Admin ai-settings] connection test failed:', error)
    return res.status(500).json({ error: 'Unable to test provider connection.' })
  }
})

router.put('/ai-settings', async (req, res) => {
  const activeProvider = String(req.body?.activeProvider || req.body?.provider || 'anthropic').trim().toLowerCase()
  const providers = req.body?.providers

  try {
    const existingSettings = await getAdminAiProviderSettings()
    const hasConfiguredKey = SUPPORTED_PROVIDERS.some((provider) => {
      const config = existingSettings?.providers?.[provider]
      return Boolean(config?.primary?.configured || config?.fallback?.configured)
    })

    const payload = providers && typeof providers === 'object'
      ? req.body
      : {
          activeProvider,
          providers: {
            anthropic: {
              primary: {
                apiKey: req.body?.primaryApiKey,
                model: req.body?.primaryModel,
              },
              fallback: {
                apiKey: req.body?.fallbackApiKey,
                model: req.body?.fallbackModel,
              },
            },
          },
        }

    const normalizedActiveProvider = String(payload?.activeProvider || 'anthropic').trim().toLowerCase()
    if (!SUPPORTED_PROVIDERS.includes(normalizedActiveProvider)) {
      return res.status(400).json({ error: `activeProvider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}` })
    }
    if (!RUNTIME_SUPPORTED_ACTIVE_PROVIDERS.includes(normalizedActiveProvider)) {
      return res.status(400).json({
        error: `activeProvider=${normalizedActiveProvider} is not available yet. Currently supported: ${RUNTIME_SUPPORTED_ACTIVE_PROVIDERS.join(', ')}`,
      })
    }

    const governance = payload?.governance && typeof payload.governance === 'object'
      ? payload.governance
      : existingSettings?.governance || {}

    const incomingProviders = payload?.providers
    if (!incomingProviders || typeof incomingProviders !== 'object') {
      return res.status(400).json({ error: 'providers object is required.' })
    }

    const invalidProviderKeys = Object.keys(incomingProviders).filter((provider) => !SUPPORTED_PROVIDERS.includes(provider))
    if (invalidProviderKeys.length > 0) {
      return res.status(400).json({ error: `Unsupported provider(s): ${invalidProviderKeys.join(', ')}` })
    }

    let hasIncomingKey = false
    for (const provider of Object.keys(incomingProviders)) {
      const providerPayload = incomingProviders[provider]
      if (!providerPayload || typeof providerPayload !== 'object') {
        return res.status(400).json({ error: `providers.${provider} must be an object.` })
      }

      for (const keyLabel of KEY_LABELS) {
        const entry = providerPayload[keyLabel]
        if (!entry || typeof entry !== 'object') continue

        const apiKey = String(entry.apiKey || '').trim()
        const hasModelField = Object.prototype.hasOwnProperty.call(entry, 'model')
        const model = String(entry.model || '').trim()
        if (apiKey) hasIncomingKey = true
        if (!apiKey && (!hasModelField || !model)) {
          continue
        }

        if (hasModelField && !model) {
          return res.status(400).json({ error: `providers.${provider}.${keyLabel}.model cannot be empty when provided.` })
        }
      }
    }

    if (!hasConfiguredKey && !hasIncomingKey) {
      return res.status(400).json({ error: 'At least one API key (primary or fallback) is required.' })
    }

    const updateFlags = await upsertAdminAiProviderKeys({
      payload: {
        ...payload,
        governance,
      },
      adminId: req.admin?.id || null,
    })

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'admin_ai_settings_updated',
      details: {
        ...updateFlags,
        activeProvider: normalizedActiveProvider,
      },
      ipAddress: req.admin?.ipAddress || null,
    })

    const providerConfigChanges = collectProviderConfigChanges(updateFlags)
    if (updateFlags.activeProviderUpdated) {
      await recordAdminAction({
        adminId: req.admin?.id,
        actionType: 'admin_ai_provider_switched',
        details: { activeProvider: normalizedActiveProvider },
        ipAddress: req.admin?.ipAddress || null,
      })
    }

    if (providerConfigChanges.keyRotations.length > 0) {
      await recordAdminAction({
        adminId: req.admin?.id,
        actionType: 'admin_ai_key_rotated',
        details: { keys: providerConfigChanges.keyRotations },
        ipAddress: req.admin?.ipAddress || null,
      })
    }

    if (providerConfigChanges.modelChanges.length > 0) {
      await recordAdminAction({
        adminId: req.admin?.id,
        actionType: 'admin_ai_model_changed',
        details: { models: providerConfigChanges.modelChanges },
        ipAddress: req.admin?.ipAddress || null,
      })
    }

    if (updateFlags.governanceUpdated) {
      await recordAdminAction({
        adminId: req.admin?.id,
        actionType: 'admin_ai_governance_updated',
        details: {
          aiEnabled: !updateFlags.aiEnabledUpdated ? existingSettings?.governance?.aiEnabled : governance?.aiEnabled,
          resumeAnalysisEnabled: !updateFlags.workflowTogglesUpdated
            ? existingSettings?.governance?.workflowToggles?.resumeAnalysisEnabled
            : governance?.workflowToggles?.resumeAnalysisEnabled,
        },
        ipAddress: req.admin?.ipAddress || null,
      })
    }

    const settings = await getAdminAiProviderSettings()
    const modelValidation = await validateAiProviderModelConfiguration()
    const warnings = Array.isArray(modelValidation?.warnings) ? modelValidation.warnings : []

    return res.json({
      ok: true,
      settings,
      modelWarnings: warnings,
      warning: warnings.length > 0 ? 'One or more configured models are not in the allowed Anthropic model list.' : null,
      ...updateFlags,
    })
  } catch (error) {
    console.error('[Admin ai-settings] update failed:', error)
    return res.status(500).json({ error: 'Unable to update AI settings' })
  }
})

router.get('/system-prompt', async (_req, res) => {
  try {
    const prompt = await getAdminSystemPrompt()
    return res.json(prompt)
  } catch (error) {
    console.error('[Admin system-prompt] get failed:', error)
    return res.status(500).json({ error: 'Unable to load system prompt' })
  }
})

router.put('/system-prompt', async (req, res) => {
  try {
    const systemPrompt = validateSystemPromptInput(req.body?.systemPrompt)
    const prompt = await upsertAdminSystemPrompt({
      systemPrompt,
      adminId: req.admin?.id || null,
    })

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'admin_system_prompt_updated',
      details: {
        promptVersion: prompt.promptVersion,
        promptLength: prompt.systemPrompt.length,
      },
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({ ok: true, prompt })
  } catch (error) {
    if (/systemPrompt/i.test(String(error?.message || ''))) {
      return res.status(400).json({ error: error.message })
    }
    console.error('[Admin system-prompt] update failed:', error)
    return res.status(500).json({ error: 'Unable to update system prompt' })
  }
})

router.get('/inquiries', async (req, res) => {
  const search = String(req.query.search || '').trim()
  const typeFilter = String(req.query.type || 'all').toLowerCase()
  const statusFilter = String(req.query.status || 'all').toLowerCase()
  const fromDate = String(req.query.from || '').trim()
  const toDate = String(req.query.to || '').trim()

  const where = []
  const params = []

  if (typeFilter !== 'all') {
    params.push(typeFilter)
    where.push(`inquiry_type = $${params.length}`)
  }

  if (statusFilter !== 'all') {
    params.push(statusFilter)
    where.push(`status = $${params.length}`)
  }

  if (search) {
    params.push(`%${search}%`)
    where.push(`(
      email ILIKE $${params.length}
      OR name ILIKE $${params.length}
      OR COALESCE(company, '') ILIKE $${params.length}
      OR COALESCE(subject, '') ILIKE $${params.length}
    )`)
  }

  if (fromDate) {
    params.push(fromDate)
    where.push(`created_at >= $${params.length}::timestamp`)
  }

  if (toDate) {
    params.push(toDate)
    where.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const result = await pool.query(
      `SELECT id, inquiry_type, status, name, email, company, phone, subject, message, metadata, created_at, updated_at, reviewed_at, reviewed_by
       FROM inquiries
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 500`,
      params,
    )

    return res.json({ inquiries: result.rows.map(normalizeInquiryRow) })
  } catch (error) {
    console.error('[Admin inquiries] list failed:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/inquiries/:id', async (req, res) => {
  const { id } = req.params
  const status = String(req.body?.status || '').trim().toLowerCase()

  if (!['new', 'reviewed'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required.' })
  }

  try {
    const result = await pool.query(
      `UPDATE inquiries
       SET status = $2,
           reviewed_at = CASE WHEN $2 = 'reviewed' THEN NOW() ELSE NULL END,
           reviewed_by = CASE WHEN $2 = 'reviewed' THEN $3 ELSE NULL END
       WHERE id::text = $1
       RETURNING id, inquiry_type, status, name, email, company, phone, subject, message, metadata, created_at, updated_at, reviewed_at, reviewed_by`,
      [id, status, req.admin?.id || null],
    )

    const inquiry = result.rows[0]
    if (!inquiry) {
      return res.status(404).json({ error: 'Inquiry not found' })
    }

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'inquiry_status_updated',
      targetId: String(id),
      details: { status },
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({ ok: true, inquiry: normalizeInquiryRow(inquiry) })
  } catch (error) {
    console.error('[Admin inquiries] update failed:', error)
    return res.status(500).json({ error: 'Unable to update inquiry' })
  }
})

router.get('/users', async (req, res) => {
  const search = String(req.query.search || '').trim()

  try {
    await ensureAdminUserColumns()

    const params = [search ? `%${search}%` : '']
    const result = await pool.query(
      `SELECT u.id,
              u.email,
              u.company,
              u.phone,
              u.subscription_status,
              u.paddle_subscription_id,
              u.created_at,
              u.deleted_at,
              COALESCE(u.is_blocked, u.blocked, false) AS is_blocked
       FROM users u
       WHERE ($1 = '' OR u.email ILIKE $1 OR COALESCE(u.company, '') ILIKE $1)
       ORDER BY u.created_at DESC`,
      params,
    )

    return res.json({
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        company: row.company,
        phone: row.phone,
        subscription_status: row.subscription_status,
        created_at: toIso(row.created_at),
        deleted_at: toIso(row.deleted_at),
        is_blocked: Boolean(row.is_blocked),
        status: row.deleted_at ? 'inactive' : (row.is_blocked ? 'blocked' : 'active'),
      })),
    })
  } catch (error) {
    console.error('[Admin users] list failed:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/users/:id', async (req, res) => {
  const { id } = req.params

  try {
    await ensureAdminUserColumns()

    const userResult = await pool.query(
      `SELECT u.id,
              u.email,
              u.company,
              u.phone,
              u.subscription_status,
              u.created_at,
              u.deleted_at,
              COALESCE(u.is_blocked, u.blocked, false) AS is_blocked
       FROM users u
       WHERE u.id::text = $1
       LIMIT 1`,
      [id],
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const auditResult = await pool.query(
      `SELECT id, admin_id, action_type, details, created_at
       FROM admin_actions
       WHERE target_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id],
    )

    return res.json({
      user: {
        ...user,
        created_at: toIso(user.created_at),
        deleted_at: toIso(user.deleted_at),
        is_blocked: Boolean(user.is_blocked),
      },
      auditTrail: auditResult.rows.map((row) => ({
        id: row.id,
        action: row.action_type,
        actor: row.admin_id,
        details: row.details || {},
        created_at: toIso(row.created_at),
      })),
    })
  } catch (error) {
    console.error('[Admin users] detail failed:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/users/:id', async (req, res) => {
  const { id } = req.params
  const { action, reason, company, phone, email, is_blocked: isBlockedInput, resetPassword } = req.body || {}

  try {
    await ensureAdminUserColumns()

    const userResult = await pool.query(
      'SELECT id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked FROM users WHERE id::text = $1 LIMIT 1',
      [id],
    )
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const shouldBlock = action === 'block' || isBlockedInput === true
    const shouldUnblock = action === 'unblock' || isBlockedInput === false
    const shouldReset = action === 'reset_password' || resetPassword === true
    const shouldEdit = action === 'edit' || company !== undefined || phone !== undefined || email !== undefined

    let nextUser = { ...user }
    let auditAction = 'user_updated'
    let auditDetails = {}

    if (shouldBlock || shouldUnblock) {
      const nextBlocked = shouldBlock ? true : false
      const updateResult = await pool.query(
        `UPDATE users
         SET blocked = $2,
             is_blocked = $2
         WHERE id::text = $1
         RETURNING id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked`,
        [id, nextBlocked],
      )
      nextUser = updateResult.rows[0]
      auditAction = nextBlocked ? 'user_blocked' : 'user_unblocked'
      auditDetails = { reason: reason || null }
    }

    if (shouldEdit) {
      const updateResult = await pool.query(
        `UPDATE users
         SET email = COALESCE($2, email),
             company = COALESCE($3, company),
             phone = COALESCE($4, phone)
         WHERE id::text = $1
         RETURNING id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked`,
        [id, email || null, company || null, phone || null],
      )
      nextUser = updateResult.rows[0]
      auditAction = 'user_profile_updated'
      auditDetails = { email: email || undefined, company: company || undefined, phone: phone || undefined }
    }

    if (shouldReset) {
      const token = generateResetToken()
      await createPasswordResetToken(user.id, token)
      await sendPasswordResetEmail({
        to: user.email,
        firstName: user.email.split('@')[0],
        resetUrl: buildResetUrl(token),
      })
      auditAction = 'user_password_reset_sent'
      auditDetails = { via: 'admin' }
    }

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: auditAction,
      targetId: String(id),
      details: auditDetails,
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({
      ok: true,
      user: {
        id: nextUser.id,
        email: nextUser.email,
        company: nextUser.company,
        phone: nextUser.phone,
        is_blocked: Boolean(nextUser.is_blocked),
      },
      audit: {
        action: auditAction,
        actor: req.admin?.id || 'admin',
        details: auditDetails,
        created_at: new Date().toISOString(),
      },
      message: shouldReset ? 'Password reset email sent' : 'User updated',
    })
  } catch (error) {
    console.error('[Admin users] update failed:', error)
    return res.status(500).json({ error: 'Unable to update user' })
  }
})

router.post('/users/:id/block', async (req, res) => {
  const { id } = req.params
  const { reason } = req.body || {}

  try {
    await ensureAdminUserColumns()
    const result = await pool.query(
      `UPDATE users
       SET blocked = true,
           is_blocked = true
       WHERE id::text = $1
       RETURNING id, email, company, phone, COALESCE(is_blocked, blocked, false) AS is_blocked`,
      [id],
    )

    const user = result.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'user_blocked',
      targetId: String(id),
      details: { reason: reason || null },
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        company: user.company,
        phone: user.phone,
        is_blocked: Boolean(user.is_blocked),
      },
      audit: {
        action: 'user_blocked',
        actor: req.admin?.id || 'admin',
        details: { reason: reason || null },
        created_at: new Date().toISOString(),
      },
      message: 'User blocked',
    })
  } catch (error) {
    console.error('[Admin users] block failed:', error)
    return res.status(500).json({ error: 'Unable to block user' })
  }
})

router.post('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params

  try {
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id::text = $1 LIMIT 1',
      [id],
    )
    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const token = generateResetToken()
    await createPasswordResetToken(user.id, token)
    await sendPasswordResetEmail({
      to: user.email,
      firstName: user.email.split('@')[0],
      resetUrl: buildResetUrl(token),
    })

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'user_password_reset_sent',
      targetId: String(id),
      details: { via: 'admin' },
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({
      ok: true,
      message: 'Password reset email sent',
      audit: {
        action: 'user_password_reset_sent',
        actor: req.admin?.id || 'admin',
        details: { via: 'admin' },
        created_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[Admin users] reset password failed:', error)
    return res.status(500).json({ error: 'Unable to send password reset' })
  }
})

router.post('/users/:id/impersonate', async (req, res) => {
  const { id } = req.params
  const expiresInMinutes = Math.max(1, Math.min(60, Number(req.body?.expiresInMinutes || 15)))

  try {
    const userResult = await pool.query(
      'SELECT id, email, company, phone, subscription_status, created_at, deleted_at FROM users WHERE id::text = $1 LIMIT 1',
      [id],
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const impersonationToken = jwt.sign(
      {
        userId: user.id,
        user,
        impersonatedByAdminId: req.admin?.id || null,
        impersonation: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: `${expiresInMinutes}m` },
    )

    await recordAdminAction({
      adminId: req.admin?.id,
      actionType: 'impersonation_token_created',
      targetId: String(id),
      details: { expiresInMinutes },
      ipAddress: req.admin?.ipAddress || null,
    })

    return res.json({
      ok: true,
      impersonationToken,
      expiresInMinutes,
      user: {
        id: user.id,
        email: user.email,
      },
      audit: {
        action: 'impersonation_token_created',
        actor: req.admin?.id || 'admin',
        details: { expiresInMinutes },
      },
    })
  } catch (error) {
    console.error('[Admin users] impersonation failed:', error)
    return res.status(500).json({ error: 'Failed to impersonate user' })
  }
})

router.get('/rate-limit-stats', (_req, res) => {
  return res.json(getRateLimitStats())
})

router.post('/usage-overrides', async (req, res) => {
  const { userId, monthStart, uploadLimit, resetUsage = false, note = null } = req.body || {}

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' })
  }

  const normalizedMonthStart = getMonthStart(monthStart)

  try {
    const result = await pool.query(
      `INSERT INTO usage_overrides (user_id, month_start, upload_limit, reset_usage, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, month_start)
       DO UPDATE SET upload_limit = EXCLUDED.upload_limit,
                     reset_usage = EXCLUDED.reset_usage,
                     note = EXCLUDED.note,
                     updated_at = NOW()
       RETURNING id, user_id, month_start, upload_limit, reset_usage, note, updated_at`,
      [userId, normalizedMonthStart, uploadLimit, resetUsage, note],
    )

    return res.status(200).json({
      ok: true,
      message: 'Usage override saved. resetUsage=true will reset counted usage for the selected month.',
      override: result.rows[0],
    })
  } catch (error) {
    console.error('[Admin] Failed to upsert usage override:', error)
    return res.status(500).json({ error: 'Unable to save usage override' })
  }
})

async function listAdminActions(req, res) {
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '100'), 10) || 100))
  const adminId = req.query.adminId ? String(req.query.adminId) : null
  const actionType = req.query.actionType ? String(req.query.actionType) : null

  const params = [limit]
  const where = []

  if (adminId) {
    params.push(adminId)
    where.push(`admin_id::text = $${params.length}`)
  }

  if (actionType) {
    params.push(actionType)
    where.push(`action_type = $${params.length}`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const result = await pool.query(
      `SELECT id, admin_id, action_type, target_id, details, ip_address, created_at
       FROM admin_actions
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    )

    const actions = result.rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id,
      actionType: row.action_type,
      targetId: row.target_id,
      details: row.details || {},
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }))

    return res.json({
      actions,
      items: actions,
    })
  } catch (error) {
    console.error('[Admin] Failed to query admin actions:', error)
    return res.status(500).json({ error: 'Unable to query admin actions' })
  }
}


router.get('/sessions', async (req, res) => {
  const sessions = await listAdminSessions(req.admin.id, req.admin.sessionId)
  return res.json({ sessions })
})

router.post('/sessions/refresh', async (req, res) => {
  const refreshed = await createAdminSession({
    adminId: req.admin.id,
    email: req.admin.email,
    ipAddress: req.admin.loginIp || req.admin.ipAddress,
    sessionId: req.admin.sessionId,
  })

  setAdminCookie(res, refreshed.token)
  res.setHeader('X-Admin-Session-Expires-At', refreshed.expiresAt)

  return res.status(200).json({
    ok: true,
    sessionTimeoutSeconds: refreshed.expiresInSeconds,
    sessionExpiresAt: refreshed.expiresAt,
  })
})

router.post('/sessions/logout-others', async (req, res) => {
  const revokedCount = await revokeOtherAdminSessions(req.admin.id, req.admin.sessionId)

  try {
    await pool.query(
      `INSERT INTO admin_actions (admin_id, action_type, details, ip_address)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [req.admin.id, 'admin_logout_other_sessions', JSON.stringify({ revokedCount }), req.admin.ipAddress],
    )
  } catch (error) {
    console.error('[Admin sessions] failed to log logout-other-sessions:', error)
  }

  return res.status(200).json({ ok: true, revokedCount })
})

router.get('/actions', listAdminActions)
router.get('/audit-trail', listAdminActions)

router.delete('/usage-overrides/:userId', async (req, res) => {
  const { userId } = req.params
  const monthStart = getMonthStart(req.query.monthStart)

  try {
    const result = await pool.query(
      `DELETE FROM usage_overrides
       WHERE user_id = $1 AND month_start = $2
       RETURNING id`,
      [userId, monthStart],
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'No override found for user/month' })
    }

    return res.status(200).json({ ok: true, message: 'Usage override removed' })
  } catch (error) {
    console.error('[Admin] Failed to clear usage override:', error)
    return res.status(500).json({ error: 'Unable to clear usage override' })
  }
})

export default router
