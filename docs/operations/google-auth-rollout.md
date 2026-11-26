# Google sign-in rollout

Google authentication is implemented behind two independent flags. Merging the schema, backend, UI, and account settings PRs does not enable it. Keep both flags off until a Web application client is configured and the checks below pass.

## 1. Prepare Google Auth Platform

1. In a production Google Cloud project, configure Branding for **HireFlow**, including a support email, `https://hireflow.dev` as the home page, `https://hireflow.dev/privacy`, and `https://hireflow.dev/terms`. Verify ownership of `hireflow.dev` and check the project's audience and brand verification status before a public launch.
2. Create an OAuth 2.0 client of type **Web application**. Add `https://hireflow.dev` as an **Authorized JavaScript origin**. This implementation uses the Google Identity Services JavaScript popup callback and sends an ID token to HireFlow; it does not use a Google redirect endpoint or require a client secret.
3. Keep development or preview origins in a separate test project/client. For local Vite testing, authorize `http://localhost:5173` on that test client and use the same test client ID on the local backend and frontend. For a preview deployment, authorize its exact HTTPS origin and add that origin to the backend's `FRONTEND_ORIGIN` allowlist. Do not add temporary preview origins to the production client.
4. Do not request Google API scopes beyond the default authentication scopes. HireFlow only needs the verified ID token; the backend checks the Google subject, email, and verified-email claim.

Google setup reference: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

## 2. Configure and stage

| Location | Variable | Value |
| --- | --- | --- |
| Railway backend | `GOOGLE_CLIENT_ID` | Production Web client ID from Google Cloud |
| Railway backend | `GOOGLE_AUTH_ENABLED` | `true` after migration 058 and backend code are deployed |
| Railway backend | `FRONTEND_ORIGIN` | Include `https://hireflow.dev` (and only exact additional approved frontend origins) |
| Railway backend | `APP_ORIGIN` | `https://hireflow.dev` (retain the existing checkout configuration) |
| Vercel frontend build | `VITE_GOOGLE_CLIENT_ID` | The **same** production Web client ID |
| Vercel frontend build | `VITE_GOOGLE_AUTH_ENABLED` | `true` only when the backend gate and Google client are ready |

Do not replace the existing `JWT_SECRET`. `VITE_` variables are public build-time values; the Google client ID is not a secret. Changing them requires a new Vercel build/deployment. Do not put any Google client secret in Vite variables or in the repository.

Deploy the backend settings first. Once the production backend is healthy, `GET https://hireflow.dev/api/auth/google/csrf` should return JSON with `csrfToken`, a same-origin HttpOnly cookie, and `Cache-Control: no-store`. When disabled it returns 404. Then set the Vercel build variables and deploy the frontend. The browser must call `/api/auth/google` on the **HireFlow site origin**, even if ordinary API traffic uses a separate API host.

## 3. Smoke test before inviting users

Use test accounts and a fresh browser session. Do not paste Google credentials, session tokens, CSRF values, or continuation tokens into tickets or logs.

| Scenario | Expected result |
| --- | --- |
| Login and signup pages | Official Google button appears on both; email/password forms still work. |
| New Google email, cancel completion | No HireFlow account is created. |
| New Google email, submit without Terms consent | Account is not created; consent is required. |
| New Google email, accept Terms | Verified Google-only user is created once, signed in, and can open the workspace; account settings show Google sign-in. |
| Existing email/password user, wrong password | Linking is denied; original password login and account data still work. |
| Existing email/password user, correct password | Google identity links to the **same user ID**; jobs, analyses, results, subscription, and history remain accessible. Both sign-in methods work. |
| Linked Google account, subsequent sign-in | Existing user is signed in without another signup or link prompt. |
| Google-only user, password login | Password login is rejected; use Google. After the existing password-reset flow, a new password works. |
| Sign out and direct refresh | Session clears on sign out; a new Google sign-in restores the same account. |
| Popup blocked, script unavailable, invalid credential | Inline error or safe retry; no partial signup or account takeover. |
| Missing or incorrect CSRF/Origin on Google POST | Request is rejected; no account/session is created. |
| Admin or deletion-scheduled account | Google sign-in is denied. |

Inspect the browser Network panel for the same-origin `/api/auth/google` CSRF and credential requests. Successful responses must set the session cookie and return the established `{ token, user }` contract. Keep continuation tokens in component memory, not URLs. Confirm both desktop and mobile layouts and keyboard focus.

## 4. Monitor and roll back

Watch backend Google-auth errors, signup/login events tagged `source: auth.google`, failed requests, and user reports during the initial release. Do not log Google credentials or tokens. If sign-in fails broadly, disable `GOOGLE_AUTH_ENABLED` on Railway immediately; then set `VITE_GOOGLE_AUTH_ENABLED=false` on Vercel and redeploy to hide the button. Existing email/password login remains available for password-enabled accounts. Preserve `user_auth_identities` rows and the additive migration so linked users retain their data. Diagnose the client ID, authorized origin, backend Origin allowlist, `/api` rewrite, and cookie before re-enabling.
