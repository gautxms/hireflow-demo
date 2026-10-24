import express, { Router } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  exchangeAuthorizationCode,
  getMcpOAuthConfig,
  issueAuthorizationCode,
  McpOAuthError,
  rotateRefreshToken,
  validateAuthorizationRequest,
} from '../services/mcpOAuthService.js'

const router = Router()
const CONSENT_TOKEN_TTL = '10m'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function noStore(res) {
  res.set('Cache-Control', 'no-store')
  res.set('Pragma', 'no-cache')
  res.set('X-Robots-Tag', 'noindex, noarchive')
}

function appendAuthorizationResponse(redirectUri, values) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  }
  return url.toString()
}

async function loadAuthenticatedWebUser(req) {
  const token = req.cookies?.token
  if (!token || !process.env.JWT_SECRET) return null

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (!decoded?.userId) return null
    const result = await pool.query(
      `SELECT id, email, company, email_verified, deleted_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.userId],
    )
    const user = result.rows[0]
    return user && !user.deleted_at && user.email_verified === true ? user : null
  } catch {
    return null
  }
}

function signConsentToken(userId, request) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for OAuth consent')
  return jwt.sign({ type: 'mcp_oauth_consent', userId, request }, process.env.JWT_SECRET, {
    expiresIn: CONSENT_TOKEN_TTL,
    audience: 'hireflow-mcp-oauth-consent',
    issuer: getMcpOAuthConfig().issuer,
  })
}

function verifyConsentToken(token, userId) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for OAuth consent')
  const payload = jwt.verify(token, process.env.JWT_SECRET, {
    audience: 'hireflow-mcp-oauth-consent',
    issuer: getMcpOAuthConfig().issuer,
  })
  if (payload?.type !== 'mcp_oauth_consent' || String(payload?.userId) !== String(userId)) {
    throw new McpOAuthError('invalid_request', 'The consent request is invalid or expired.', 400)
  }
  return payload.request
}

function renderConsentPage({ user, request, consentToken }) {
  const scopeLabels = request.scopes.map((scope) => ({
    'mcp:profile': 'Identify the connected HireFlow profile',
    'jobs:write': 'Upload job descriptions and create jobs after confirmation',
  })[scope] || scope)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect HireFlow</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #08111f; color: #eef4ff; }
    main { width: min(92vw, 560px); padding: 32px; box-sizing: border-box; border: 1px solid #243957; border-radius: 18px; background: #101d30; box-shadow: 0 24px 80px #0008; }
    h1 { margin: 0 0 8px; font-size: 28px; } p { color: #b8c7dc; line-height: 1.55; }
    ul { padding-left: 22px; line-height: 1.65; } .account { padding: 12px 14px; border-radius: 10px; background: #0a1525; }
    form { display: flex; gap: 12px; margin-top: 24px; } button { flex: 1; border: 0; border-radius: 10px; padding: 12px 16px; font-weight: 700; cursor: pointer; }
    .approve { background: #68e3b5; color: #062119; } .deny { background: #263750; color: #eef4ff; }
  </style>
</head>
<body><main>
  <h1>Connect HireFlow to ChatGPT</h1>
  <p class="account">Signed in as <strong>${escapeHtml(user.email)}</strong>${user.company ? ` · ${escapeHtml(user.company)}` : ''}</p>
  <p>ChatGPT is requesting permission to:</p>
  <ul>${scopeLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>
  <p>Job creation always requires a preview and a separate confirmation.</p>
  <form method="post" action="/oauth/authorize">
    <input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}">
    <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
    <button class="approve" type="submit" name="decision" value="approve">Connect</button>
  </form>
</main></body></html>`
}

router.get('/.well-known/oauth-protected-resource', (_req, res) => {
  noStore(res)
  return res.json(buildProtectedResourceMetadata())
})

router.get('/.well-known/oauth-authorization-server', (_req, res) => {
  noStore(res)
  return res.json(buildAuthorizationServerMetadata())
})

router.get('/oauth/authorize', async (req, res) => {
  noStore(res)
  let request
  try {
    request = validateAuthorizationRequest(req.query)
  } catch (error) {
    const status = error instanceof McpOAuthError ? error.status : 500
    const config = getMcpOAuthConfig()
    const clientId = String(req.query?.client_id || '')
    const redirectUri = String(req.query?.redirect_uri || '')
    if (config.clients.get(clientId)?.has(redirectUri)) {
      return res.redirect(302, appendAuthorizationResponse(redirectUri, {
        error: error instanceof McpOAuthError ? error.code : 'server_error',
        error_description: error instanceof McpOAuthError ? error.message : 'OAuth is temporarily unavailable.',
        state: String(req.query?.state || ''),
        iss: config.issuer,
      }))
    }
    return res.status(status).type('text/plain').send(error instanceof McpOAuthError ? error.message : 'OAuth is temporarily unavailable.')
  }

  const user = await loadAuthenticatedWebUser(req)
  if (!user) {
    const returnTo = `${req.path}?${new URLSearchParams(req.query).toString()}`
    return res.redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`)
  }

  try {
    const consentToken = signConsentToken(user.id, request)
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    return res.status(200).type('html').send(renderConsentPage({ user, request, consentToken }))
  } catch (error) {
    console.error('[MCP OAuth] Failed to prepare consent:', { name: error?.name })
    return res.status(500).type('text/plain').send('OAuth is temporarily unavailable.')
  }
})

router.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
  noStore(res)
  const user = await loadAuthenticatedWebUser(req)
  if (!user) return res.status(401).type('text/plain').send('Your HireFlow session expired. Start the connection again.')

  let request
  try {
    request = verifyConsentToken(String(req.body?.consent_token || ''), user.id)
    request = validateAuthorizationRequest({
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      response_type: request.responseType,
      resource: request.resource,
      code_challenge: request.codeChallenge,
      code_challenge_method: request.codeChallengeMethod,
      state: request.state,
      scope: request.scopes.join(' '),
    })
  } catch (error) {
    return res.status(error instanceof McpOAuthError ? error.status : 400)
      .type('text/plain').send('The consent request is invalid or expired. Start the connection again.')
  }

  const issuer = getMcpOAuthConfig().issuer
  if (req.body?.decision !== 'approve') {
    return res.redirect(302, appendAuthorizationResponse(request.redirectUri, {
      error: 'access_denied',
      error_description: 'The user declined access.',
      state: request.state,
      iss: issuer,
    }))
  }

  try {
    const { code } = await issueAuthorizationCode({ db: pool, userId: user.id, request })
    return res.redirect(302, appendAuthorizationResponse(request.redirectUri, {
      code,
      state: request.state,
      iss: issuer,
    }))
  } catch (error) {
    console.error('[MCP OAuth] Failed to issue authorization code:', { name: error?.name, code: error?.code })
    return res.redirect(302, appendAuthorizationResponse(request.redirectUri, {
      error: 'server_error',
      error_description: 'HireFlow could not complete authorization.',
      state: request.state,
      iss: issuer,
    }))
  }
})

router.post('/oauth/token', express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
  noStore(res)
  if (req.headers.authorization) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'This public client must use token endpoint authentication method none.' })
  }

  try {
    let result
    if (req.body?.grant_type === 'authorization_code') {
      result = await exchangeAuthorizationCode({ db: pool, input: req.body })
    } else if (req.body?.grant_type === 'refresh_token') {
      result = await rotateRefreshToken({ db: pool, input: req.body })
    } else {
      throw new McpOAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.', 400)
    }
    return res.json(result)
  } catch (error) {
    const oauthError = error instanceof McpOAuthError
      ? error
      : new McpOAuthError('server_error', 'The token request could not be completed.', 500)
    if (!(error instanceof McpOAuthError)) {
      console.error('[MCP OAuth] Token endpoint failure:', { name: error?.name, code: error?.code })
    }
    return res.status(oauthError.status).json({ error: oauthError.code, error_description: oauthError.message })
  }
})

export default router
