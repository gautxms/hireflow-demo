import crypto from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAuthorizationServerMetadata,
  buildOAuthConsentContentSecurityPolicy,
  buildMcpAuthChallenge,
  buildProtectedResourceMetadata,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  McpOAuthError,
  MCP_SCOPES,
  rotateRefreshToken,
  validateAuthorizationRequest,
  verifyMcpAccessToken,
} from './mcpOAuthService.js'

const productionEnv = { NODE_ENV: 'production', MCP_PUBLIC_ORIGIN: 'https://hireflow.dev' }
const clientId = 'https://chatgpt.com/oauth/client.json'
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'

function authorizationInput(overrides = {}) {
  const verifier = 'v'.repeat(64)
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    resource: 'https://hireflow.dev/mcp',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'opaque-state',
    scope: `${MCP_SCOPES.PROFILE} ${MCP_SCOPES.JOBS_WRITE}`,
    ...overrides,
  }
}

test('OAuth discovery advertises one canonical HTTPS resource and PKCE', () => {
  assert.deepEqual(buildProtectedResourceMetadata(productionEnv), {
    resource: 'https://hireflow.dev/mcp',
    authorization_servers: ['https://hireflow.dev'],
    scopes_supported: [MCP_SCOPES.PROFILE, MCP_SCOPES.JOBS_WRITE, MCP_SCOPES.ANALYSES_WRITE],
    resource_documentation: 'https://hireflow.dev',
  })
  const metadata = buildAuthorizationServerMetadata(productionEnv)
  assert.equal(metadata.issuer, 'https://hireflow.dev')
  assert.equal(metadata.authorization_response_iss_parameter_supported, true)
  assert.equal(metadata.client_id_metadata_document_supported, true)
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none'])
  assert.deepEqual(metadata.scopes_supported, [
    MCP_SCOPES.PROFILE,
    MCP_SCOPES.JOBS_WRITE,
    MCP_SCOPES.ANALYSES_WRITE,
  ])
})

test('authorization validation accepts ChatGPT CIMD and rejects audience substitution', () => {
  const request = validateAuthorizationRequest(authorizationInput(), productionEnv)
  assert.equal(request.clientId, clientId)
  assert.equal(request.resource, 'https://hireflow.dev/mcp')
  assert.deepEqual(request.scopes, [MCP_SCOPES.PROFILE, MCP_SCOPES.JOBS_WRITE])

  assert.throws(
    () => validateAuthorizationRequest(authorizationInput({ resource: 'https://evil.example/mcp' }), productionEnv),
    (error) => error instanceof McpOAuthError && error.code === 'invalid_target',
  )
})

test('OAuth consent CSP allows only the registered callback origin', () => {
  const request = validateAuthorizationRequest(authorizationInput(), productionEnv)
  const policy = buildOAuthConsentContentSecurityPolicy(request, productionEnv)

  assert.equal(
    policy,
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",
  )
  assert.doesNotMatch(policy, /\*/)

  assert.throws(
    () => buildOAuthConsentContentSecurityPolicy({
      ...request,
      redirectUri: 'https://evil.example/callback',
    }, productionEnv),
    (error) => error instanceof McpOAuthError && error.code === 'invalid_request',
  )
})

test('OAuth consent CSP derives the origin from an explicitly configured redirect', () => {
  const configuredEnv = {
    ...productionEnv,
    MCP_OAUTH_CLIENT_ID: 'hireflow-test-client',
    MCP_OAUTH_REDIRECT_URIS: 'https://client.example/oauth/callback',
  }
  const request = validateAuthorizationRequest(authorizationInput({
    client_id: 'hireflow-test-client',
    redirect_uri: 'https://client.example/oauth/callback',
  }), configuredEnv)
  const policy = buildOAuthConsentContentSecurityPolicy(request, configuredEnv)

  assert.match(policy, /form-action 'self' https:\/\/client\.example;/)
  assert.doesNotMatch(policy, /oauth\/callback/)
})

test('authorization codes are one-time hashed records exchanged with PKCE', async () => {
  let grant
  let issueSql = ''
  const verifier = 'v'.repeat(64)
  const request = validateAuthorizationRequest(authorizationInput(), productionEnv)
  const issueDb = {
    async query(sql, params) {
      issueSql = String(sql)
      grant = {
        code_hash: params[0],
        user_id: params[1],
        client_id: params[2],
        redirect_uri: params[3],
        scope: params[4],
        resource: params[5],
        code_challenge: params[6],
        code_challenge_method: params[7],
        expires_at: params[8],
        consumed_at: null,
      }
      return { rows: [] }
    },
  }
  const issued = await issueAuthorizationCode({ db: issueDb, userId: 42, request })
  assert.match(issued.code, /^hfac_/)
  assert.match(issueSql, /DELETE FROM mcp_oauth_authorization_codes/)
  assert.match(issueSql, /DELETE FROM mcp_oauth_tokens/)
  assert.notEqual(grant.code_hash, issued.code)
  assert.equal(grant.code_hash, crypto.createHash('sha256').update(issued.code).digest('hex'))

  const queries = []
  const client = {
    async query(sql, params = []) {
      queries.push(String(sql))
      if (String(sql).includes('SELECT * FROM mcp_oauth_authorization_codes')) {
        assert.equal(params[0], grant.code_hash)
        return { rows: [grant] }
      }
      return { rows: [] }
    },
    release() {},
  }
  const result = await exchangeAuthorizationCode({
    db: { async connect() { return client } },
    input: {
      code: issued.code,
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: 'https://hireflow.dev/mcp',
      code_verifier: verifier,
    },
    env: productionEnv,
  })

  assert.match(result.access_token, /^hfat_/)
  assert.match(result.refresh_token, /^hfrt_/)
  assert.equal(result.token_type, 'Bearer')
  assert.ok(queries.some((sql) => sql.includes('SET consumed_at = NOW()')))
  const tokenInsert = queries.find((sql) => sql.includes('INSERT INTO mcp_oauth_tokens'))
  assert.ok(tokenInsert)
  assert.doesNotMatch(tokenInsert, /access_token[,\s]/)
})

test('access-token verification enforces resource and scopes and returns stable profile identity', async () => {
  const now = new Date('2026-10-24T12:00:00Z')
  const db = {
    async query(sql, params) {
      assert.match(sql, /JOIN users account ON account\.id = token\.user_id/)
      assert.doesNotMatch(sql, /JOIN users user\b/)
      assert.equal(params[0], crypto.createHash('sha256').update('secret-token').digest('hex'))
      return { rows: [{
        token_id: 'token-id',
        user_id: 42,
        client_id: clientId,
        scope: [MCP_SCOPES.PROFILE, MCP_SCOPES.JOBS_WRITE],
        resource: 'https://hireflow.dev/mcp',
        access_expires_at: new Date(now.getTime() + 60_000),
        email: 'person@example.com',
        company: 'Acme',
        mcp_profile_id: '2d11fb3d-8f74-44b2-bcb2-9c7677931089',
        email_verified: true,
        deleted_at: null,
        subscription_status: 'active',
        cancellation_effective_at: null,
        current_period_end: null,
      }] }
    },
  }
  const auth = await verifyMcpAccessToken({
    db,
    token: 'secret-token',
    requiredScopes: [MCP_SCOPES.JOBS_WRITE],
    env: productionEnv,
    now,
  })
  assert.equal(auth.userId, 42)
  assert.equal(auth.user.profileId, '2d11fb3d-8f74-44b2-bcb2-9c7677931089')
  assert.equal(auth.resource, 'https://hireflow.dev/mcp')
})

test('refresh grants rotate the stored token pair and cannot add scopes', async () => {
  const now = new Date('2026-10-24T12:00:00Z')
  const refreshToken = 'hfrt_existing'
  const queries = []
  const client = {
    async query(sql) {
      queries.push(String(sql))
      if (String(sql).includes('SELECT * FROM mcp_oauth_tokens')) {
        return { rows: [{
          id: 'token-id',
          user_id: 42,
          client_id: clientId,
          scope: [MCP_SCOPES.PROFILE, MCP_SCOPES.JOBS_WRITE],
          resource: 'https://hireflow.dev/mcp',
          refresh_expires_at: new Date(now.getTime() + 60_000),
          revoked_at: null,
        }] }
      }
      return { rows: [] }
    },
    release() {},
  }
  const db = { async connect() { return client } }

  const rotated = await rotateRefreshToken({
    db,
    input: {
      refresh_token: refreshToken,
      client_id: clientId,
      resource: 'https://hireflow.dev/mcp',
      scope: MCP_SCOPES.JOBS_WRITE,
    },
    env: productionEnv,
    now,
  })
  assert.match(rotated.access_token, /^hfat_/)
  assert.match(rotated.refresh_token, /^hfrt_/)
  assert.equal(rotated.scope, MCP_SCOPES.JOBS_WRITE)
  assert.ok(queries.some((sql) => sql.includes('SET revoked_at = NOW()')))

  await assert.rejects(
    rotateRefreshToken({
      db,
      input: {
        refresh_token: refreshToken,
        client_id: clientId,
        resource: 'https://hireflow.dev/mcp',
        scope: `${MCP_SCOPES.JOBS_WRITE} admin:all`,
      },
      env: productionEnv,
      now,
    }),
    (error) => error instanceof McpOAuthError && error.code === 'invalid_grant',
  )
})

test('MCP auth challenge points to protected-resource metadata', () => {
  const challenge = buildMcpAuthChallenge({ env: productionEnv, scope: MCP_SCOPES.JOBS_WRITE })
  assert.match(challenge, /^Bearer /)
  assert.match(challenge, /resource_metadata="https:\/\/hireflow\.dev\/\.well-known\/oauth-protected-resource"/)
  assert.match(challenge, /scope="jobs:write"/)
})
