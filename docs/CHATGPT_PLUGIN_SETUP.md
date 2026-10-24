# HireFlow ChatGPT plugin setup

HireFlow exposes a Streamable HTTP MCP server at `https://hireflow.dev/mcp`. The server uses OAuth 2.1 authorization code flow with PKCE and scopes every tool call to the connected HireFlow account.

## Tools

- `get_current_profile` returns a stable, opaque profile ID for multi-account labeling.
- `preview_job_description` accepts one ChatGPT file parameter containing a PDF or DOCX. It extracts fields and stores a pending source file, but does not create a job.
- `create_job_from_preview` requires the preview token, the final reviewed fields, and `confirmed: true`. It creates at most one job for a preview.

The required sequence is preview, show the fields and warnings to the user, receive explicit confirmation, then create.

## Production configuration

Railway should have the existing database, JWT, S3, and AI-provider settings plus:

```dotenv
MCP_PUBLIC_ORIGIN=https://hireflow.dev
```

ChatGPT's stable Client ID Metadata Document and redirect URI are supported without additional configuration. A manually registered public OAuth client can be added with:

```dotenv
MCP_OAUTH_CLIENT_ID=
MCP_OAUTH_REDIRECT_URIS=
```

`MCP_OAUTH_REDIRECT_URIS` is a comma-separated exact allowlist. Do not use wildcards. `MCP_FILE_DOWNLOAD_HOSTS` is also optional; leave it empty unless ChatGPT supplies temporary files from an additional reviewed HTTPS host.

The Vercel rewrites keep the MCP resource, discovery documents, and OAuth endpoints on the canonical `hireflow.dev` origin while forwarding them to Railway. OAuth-originated login requests deliberately use the same-origin `/api` rewrite so the authorization endpoint can read the HTTP-only session cookie.

## Deploy and connect

1. Deploy Railway first so migration `057-add-mcp-oauth` creates the stable profile IDs and hashed OAuth credential tables.
2. Deploy Vercel and confirm both discovery endpoints return `200`:
   - `https://hireflow.dev/.well-known/oauth-protected-resource`
   - `https://hireflow.dev/.well-known/oauth-authorization-server`
3. Confirm an unauthenticated `get_current_profile` tool call returns an MCP `mcp/www_authenticate` challenge.
4. In ChatGPT, add a custom MCP server using `https://hireflow.dev/mcp` and choose the advertised OAuth configuration.
5. Connect a paid, email-verified HireFlow test account. Upload a representative PDF and DOCX, review the extracted fields, confirm, and verify exactly one account-owned job is created for each preview.

Access tokens last one hour. Refresh tokens rotate on every use and last 30 days. Only token hashes are stored. Job creation remains protected by the same active-subscription and account-isolation rules as the HireFlow web UI.
