# HireFlow ChatGPT plugin setup

HireFlow exposes a Streamable HTTP MCP server at `https://hireflow.dev/mcp`. The server uses OAuth 2.1 authorization code flow with PKCE and scopes every tool call to the connected HireFlow account.

## Tools

- `get_current_profile` returns a stable, opaque profile ID for multi-account labeling.
- `list_jobs` finds active and draft jobs in the connected account.
- `get_resume_quota` returns the current resume-analysis allowance without changing it.
- `get_analysis_status` returns owner-scoped processing progress without candidate data.
- `get_analysis_results` returns owner-scoped HireFlow scores and detailed candidate analysis without rescoring resumes.
- `preview_job_description` accepts one ChatGPT file parameter containing a PDF or DOCX. It extracts fields and returns a signed preview token, but does not create a job.
- `create_job_from_preview` creates at most one job for a preview. ChatGPT's native action approval is the confirmation.
- `create_resume_analysis` accepts 1-20 PDF, DOC, DOCX, or TXT resumes and starts one analysis. ChatGPT's native action approval is the confirmation.

For job creation, preview the file, show the fields and warnings, and then offer the native-approved create action. For resume analysis, resolve an ambiguous job with `list_jobs`, create the analysis once, poll `get_analysis_status`, and retrieve the completed HireFlow output with `get_analysis_results`. ChatGPT must not independently analyse, score, or rank the resumes when HireFlow creation or result retrieval is unavailable.

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
5. Connect a paid, email-verified HireFlow test account. Verify the eight tools above are visible.
6. Upload a representative PDF and DOCX job description, review the extracted fields, approve creation, and verify exactly one account-owned job is created for each preview.
7. Attach representative resume files, start an analysis, poll it to completion, and verify `get_analysis_results` returns the same scores and detailed findings shown by the HireFlow web analysis page.

Access tokens last one hour. Refresh tokens rotate on every use and last 30 days. Only token hashes are stored. Job creation remains protected by the same active-subscription and account-isolation rules as the HireFlow web UI.
