import crypto from 'node:crypto'
import { canUsePaidMutation } from '../utils/subscriptionAccess.js'

export const MCP_SCOPES = Object.freeze({
  PROFILE: 'mcp:profile',
  JOBS_WRITE: 'jobs:write',
})

const SUPPORTED_SCOPES = new Set(Object.values(MCP_SCOPES))
const CHATGPT_CIMD_CLIENT_ID = 'https://chatgpt.com/oauth/client.json'
const CHATGPT_STABLE_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export class McpOAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'McpOAuthError'
    this.code = code
    this.status = status
  }
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseScopes(value) {
  return [...new Set(String(value || '').trim().split(/\s+/).filter(Boolean))]
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`
}

function pkceS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function resolvePublicOrigin(env) {
  const fallback = env.NODE_ENV === 'production' ? 'https://hireflow.dev' : 'http://localhost:5173'
  const origin = stripTrailingSlash(env.MCP_PUBLIC_ORIGIN || env.FRONTEND_ORIGIN || fallback)
  let parsed

  try {
    parsed = new URL(origin)
  } catch {
    throw new Error('MCP_PUBLIC_ORIGIN must be an absolute URL')
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('MCP_PUBLIC_ORIGIN must contain only an origin')
  }
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('MCP_PUBLIC_ORIGIN must use HTTPS in production')
  }

  return stripTrailingSlash(parsed.origin)
}

export function getMcpOAuthConfig(env = process.env) {
  const issuer = resolvePublicOrigin(env)
  const configuredClientId = String(env.MCP_OAUTH_CLIENT_ID || '').trim()
  const configuredRedirectUris = splitList(env.MCP_OAUTH_REDIRECT_URIS)
  const clients = new Map([
    [CHATGPT_CIMD_CLIENT_ID, new Set([CHATGPT_STABLE_REDIRECT_URI])],
  ])

  if (configuredClientId) {
    clients.set(configuredClientId, new Set(configuredRedirectUris))
  }

  return {
    issuer,
    resource: `${issuer}/mcp`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    clients,
  }
}

export function buildProtectedResourceMetadata(env = process.env) {
  const config = getMcpOAuthConfig(env)
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    resource_documentation: config.issuer,
  }
}

export function buildAuthorizationServerMetadata(env = process.env) {
  const config = getMcpOAuthConfig(env)
  return {
    issuer: config.issuer,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...SUPPORTED_SCOPES],
  }
}

export function validateAuthorizationRequest(input, env = process.env) {
  const config = getMcpOAuthConfig(env)
  const clientId = String(input?.client_id || '').trim()
  const redirectUri = String(input?.redirect_uri || '').trim()
  const responseType = String(input?.response_type || '').trim()
  const resource = String(input?.resource || '').trim()
  const codeChallenge = String(input?.code_challenge || '').trim()
  const codeChallengeMethod = String(input?.code_challenge_method || '').trim()
  const state = String(input?.state || '').trim()
  const scopes = parseScopes(input?.scope)
  const redirectUris = config.clients.get(clientId)

  if (!redirectUris) throw new McpOAuthError('invalid_client', 'Unknown OAuth client.', 400)
  if (!redirectUris.has(redirectUri)) throw new McpOAuthError('invalid_request', 'redirect_uri is not registered.', 400)
  if (responseType !== 'code') throw new McpOAuthError('unsupported_response_type', 'Only the authorization code flow is supported.', 400)
  if (resource !== config.resource) throw new McpOAuthError('invalid_target', 'The requested resource is not supported.', 400)
  if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new McpOAuthError('invalid_request', 'PKCE with a valid S256 code challenge is required.', 400)
  }
  if (!state || state.length > 1024) throw new McpOAuthError('invalid_request', 'A valid state parameter is required.', 400)
  if (!scopes.length || scopes.some((scope) => !SUPPORTED_SCOPES.has(scope))) {
    throw new McpOAuthError('invalid_scope', 'One or more requested scopes are not supported.', 400)
  }

  return {
    clientId,
    redirectUri,
    responseType,
    resource,
    codeChallenge,
    codeChallengeMethod,
    state,
    scopes,
  }
}

export function buildOAuthConsentContentSecurityPolicy(request, env = process.env) {
  const config = getMcpOAuthConfig(env)
  const clientId = String(request?.clientId || '').trim()
  const redirectUri = String(request?.redirectUri || '').trim()
  const registeredRedirectUris = config.clients.get(clientId)

  if (!registeredRedirectUris?.has(redirectUri)) {
    throw new McpOAuthError('invalid_request', 'redirect_uri is not registered.', 400)
  }

  const redirectOrigin = new URL(redirectUri).origin
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${redirectOrigin}; base-uri 'none'; frame-ancestors 'none'`
}

export async function issueAuthorizationCode({ db, userId, request, now = new Date() }) {
  const code = randomToken('hfac')
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS)
  await db.query(
    `WITH deleted_codes AS (
       DELETE FROM mcp_oauth_authorization_codes
       WHERE expires_at < NOW() - INTERVAL '1 day'
     ), deleted_tokens AS (
       DELETE FROM mcp_oauth_tokens
       WHERE refresh_expires_at < NOW() - INTERVAL '7 days'
          OR revoked_at < NOW() - INTERVAL '7 days'
     )
     INSERT INTO mcp_oauth_authorization_codes (
       code_hash, user_id, client_id, redirect_uri, scope, resource,
       code_challenge, code_challenge_method, expires_at
     ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)`,
    [sha256(code), userId, request.clientId, request.redirectUri, request.scopes,
      request.resource, request.codeChallenge, request.codeChallengeMethod, expiresAt],
  )
  return { code, expiresAt }
}

function buildTokenResponse({ accessToken, refreshToken, scopes }) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  }
}

async function insertTokenPair(client, { userId, clientId, scopes, resource, now }) {
  const accessToken = randomToken('hfat')
  const refreshToken = randomToken('hfrt')
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS)
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS)

  await client.query(
    `INSERT INTO mcp_oauth_tokens (
       user_id, client_id, access_token_hash, refresh_token_hash, scope, resource,
       access_expires_at, refresh_expires_at
     ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)`,
    [userId, clientId, sha256(accessToken), sha256(refreshToken), scopes, resource,
      accessExpiresAt, refreshExpiresAt],
  )

  return buildTokenResponse({ accessToken, refreshToken, scopes })
}

export async function exchangeAuthorizationCode({ db, input, env = process.env, now = new Date() }) {
  const config = getMcpOAuthConfig(env)
  const code = String(input?.code || '')
  const clientId = String(input?.client_id || '').trim()
  const redirectUri = String(input?.redirect_uri || '').trim()
  const resource = String(input?.resource || '').trim()
  const verifier = String(input?.code_verifier || '')

  if (!code || !verifier || !config.clients.has(clientId) || resource !== config.resource) {
    throw new McpOAuthError('invalid_grant', 'The authorization grant is invalid.', 400)
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT * FROM mcp_oauth_authorization_codes
       WHERE code_hash = $1
       FOR UPDATE`,
      [sha256(code)],
    )
    const grant = result.rows[0]
    const invalid = !grant
      || grant.consumed_at
      || new Date(grant.expires_at) <= now
      || grant.client_id !== clientId
      || grant.redirect_uri !== redirectUri
      || grant.resource !== resource
      || grant.code_challenge_method !== 'S256'
      || !constantTimeEqual(pkceS256(verifier), grant.code_challenge)

    if (invalid) throw new McpOAuthError('invalid_grant', 'The authorization grant is invalid or expired.', 400)

    await client.query(
      `UPDATE mcp_oauth_authorization_codes
       SET consumed_at = NOW()
       WHERE code_hash = $1`,
      [sha256(code)],
    )
    const response = await insertTokenPair(client, {
      userId: grant.user_id,
      clientId,
      scopes: grant.scope,
      resource,
      now,
    })
    await client.query('COMMIT')
    return response
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function rotateRefreshToken({ db, input, env = process.env, now = new Date() }) {
  const config = getMcpOAuthConfig(env)
  const refreshToken = String(input?.refresh_token || '')
  const clientId = String(input?.client_id || '').trim()
  const resource = String(input?.resource || '').trim()
  const requestedScopes = input?.scope ? parseScopes(input.scope) : null

  if (!refreshToken || !config.clients.has(clientId) || resource !== config.resource) {
    throw new McpOAuthError('invalid_grant', 'The refresh token is invalid.', 400)
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT * FROM mcp_oauth_tokens
       WHERE refresh_token_hash = $1
       FOR UPDATE`,
      [sha256(refreshToken)],
    )
    const grant = result.rows[0]
    const originalScopes = Array.isArray(grant?.scope) ? grant.scope : []
    const scopes = requestedScopes || originalScopes
    const invalid = !grant
      || grant.revoked_at
      || new Date(grant.refresh_expires_at) <= now
      || grant.client_id !== clientId
      || grant.resource !== resource
      || scopes.some((scope) => !originalScopes.includes(scope))

    if (invalid) throw new McpOAuthError('invalid_grant', 'The refresh token is invalid or expired.', 400)

    await client.query(
      `UPDATE mcp_oauth_tokens
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [grant.id],
    )
    const response = await insertTokenPair(client, {
      userId: grant.user_id,
      clientId,
      scopes,
      resource,
      now,
    })
    await client.query('COMMIT')
    return response
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function verifyMcpAccessToken({ db, token, requiredScopes = [], env = process.env, now = new Date() }) {
  const config = getMcpOAuthConfig(env)
  if (!token) throw new McpOAuthError('invalid_token', 'No access token was provided.', 401)

  const result = await db.query(
    `SELECT token.id AS token_id, token.user_id, token.client_id, token.scope, token.resource,
            token.access_expires_at, account.email, account.company, account.mcp_profile_id,
            account.email_verified, account.deleted_at, account.subscription_status,
            account.cancellation_effective_at, account.current_period_end
     FROM mcp_oauth_tokens token
     JOIN users account ON account.id = token.user_id
     WHERE token.access_token_hash = $1
       AND token.revoked_at IS NULL
     LIMIT 1`,
    [sha256(token)],
  )
  const auth = result.rows[0]
  const scopes = Array.isArray(auth?.scope) ? auth.scope : []

  if (!auth || new Date(auth.access_expires_at) <= now || auth.resource !== config.resource
    || auth.deleted_at || auth.email_verified !== true) {
    throw new McpOAuthError('invalid_token', 'The access token is invalid or expired.', 401)
  }
  if (requiredScopes.some((scope) => !scopes.includes(scope))) {
    throw new McpOAuthError('insufficient_scope', 'The access token does not grant the required scope.', 403)
  }

  return {
    tokenId: auth.token_id,
    userId: auth.user_id,
    clientId: auth.client_id,
    scopes,
    resource: auth.resource,
    expiresAt: new Date(auth.access_expires_at),
    user: {
      id: auth.user_id,
      profileId: String(auth.mcp_profile_id),
      email: auth.email,
      company: auth.company,
      subscriptionStatus: auth.subscription_status,
      cancellationEffectiveAt: auth.cancellation_effective_at,
      currentPeriodEnd: auth.current_period_end,
    },
  }
}

export function assertMcpPaidMutationAccess(auth) {
  const user = {
    subscription_status: auth?.user?.subscriptionStatus,
    cancellation_effective_at: auth?.user?.cancellationEffectiveAt,
    current_period_end: auth?.user?.currentPeriodEnd,
  }
  if (!canUsePaidMutation(user)) {
    throw new McpOAuthError(
      'subscription_required',
      'An active HireFlow subscription is required to preview or create jobs.',
      403,
    )
  }
}

export function buildMcpAuthChallenge({ env = process.env, error = 'invalid_token', description = 'Connect your HireFlow account to continue.', scope } = {}) {
  const { protectedResourceMetadataUrl } = getMcpOAuthConfig(env)
  const fields = [
    `resource_metadata="${protectedResourceMetadataUrl}"`,
    `error="${error}"`,
    `error_description="${String(description).replace(/["\\]/g, '')}"`,
  ]
  if (scope) fields.push(`scope="${scope}"`)
  return `Bearer ${fields.join(', ')}`
}

export function readBearerToken(header) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(header || '').trim())
  return match?.[1] || ''
}
