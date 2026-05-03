# RCA: Landing page appears blank for first-time visitors

## Incident summary
- **Symptom:** Visitors opening `https://hireflow.dev/` intermittently see global navigation and footer, but no main landing content.
- **Impact:** Top-of-funnel conversion risk (no hero, no CTA, no product messaging).
- **Observed state:** Shell UI renders, while route-specific content does not.

## What we analyzed
1. Public shell (`header` + `footer`) is rendered outside route-level lazy chunks in `App.jsx`.
2. Homepage content is route-level lazy loaded (`const LandingPage = lazy(() => import('./components/LandingPage'))`).
3. Route content is wrapped in `Suspense`, but there is no resilient recovery UX specifically for lazy chunk load failures (deploy/cache mismatch scenarios).
4. If the lazy import for `LandingPage` fails at runtime (e.g., old HTML referencing new chunk names), users can land in a state where shell appears but the page body does not recover automatically.

## Root cause
The homepage critical path depends on a lazy-loaded route chunk (`LandingPage`). This makes first paint of conversion-critical content vulnerable to client-side chunk load failures (commonly seen during/after deployments with stale cached HTML or JS). Because header/footer are not in the lazy boundary, users perceive a “partially loaded” page.

## Contributing factors
- No hard-fail fallback/retry path dedicated to landing route chunk load errors.
- No telemetry metric specifically tracking landing chunk-load failure rate.
- Homepage is conversion-critical but treated like a secondary lazy route.

## Corrective actions
### Immediate mitigation
- Add a chunk-load recovery path that detects dynamic import failure and triggers one safe reload (with guard to avoid infinite loops).
- Show a recovery state card if retry fails, with explicit “Reload page” and “Go to pricing” actions.

### Permanent fix (recommended)
- Move landing route from lazy import to eager import so homepage content ships in base bundle.
- Keep lazy loading for non-critical authenticated/admin routes.
- Add deployment-safe asset strategy:
  - immutable hashed assets,
  - short-lived HTML cache,
  - stale-while-revalidate tuning,
  - client bootstrap chunk mismatch detector with controlled refresh.

## Verification plan
- Automated browser test: open `/` with cold cache and assert hero headline + primary CTA visibility.
- Synthetic monitor: every 5 min from 3 regions, validate homepage hero text exists.
- Error telemetry alert: `ChunkLoadError` threshold for `/` route.

## Task: LANDING-RESILIENCY-001
**Title:** Make homepage rendering resilient to chunk/cache mismatch and remove lazy-loading from critical landing route.

**Owner:** Frontend Platform

**Priority:** P0

**Scope**
1. Eager-load `LandingPage` in `src/App.jsx`.
2. Add chunk-load recovery utility for dynamic imports used by other public routes.
3. Add user-facing recovery UI for route-load failures.
4. Add observability:
   - event: `public_route_chunk_load_failure`
   - dimensions: `route`, `build_id`, `user_agent`, `retry_attempted`.
5. Add E2E regression test for `/` rendering with simulated stale chunk reference.

**Acceptance criteria**
- Visiting `/` never depends on a dynamic import for first contentful CTA.
- With simulated stale asset reference, app performs at most one auto-refresh and recovers.
- If recovery fails, clear fallback UI appears with actionable next steps.
- Synthetic monitor and telemetry dashboards show 0 unresolved homepage blank states for 7 consecutive days post-release.

**Rollout plan**
- Canary to 10% traffic for 24 hours.
- Observe chunk-failure metric + conversion delta.
- Full rollout after no regressions.
