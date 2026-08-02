# HireFlow SEO Action Plan

**Based on:** Full audit dated 2026-08-01  
**Current score:** 64/100  
**Primary objective:** Convert the new crawlable foundation into trustworthy, differentiated, measurable organic acquisition.

## Phase 1 — protect index quality (24–48 hours)

### 1. Fix utility/auth route metadata

**Owner:** Engineering  
**Effort:** Small–medium  
**Priority:** High

- Serve `/login` and `/signup` with `noindex, follow` in initial HTML, or use purpose-built indexable pages if organic acquisition is intentional.
- Audit every auth/dashboard/billing/admin/account route for initial status, robots, title, canonical, H1, and body.
- Keep private/utility routes out of the sitemap.
- Ensure unknown private descendants do not return indexable homepage content.

**Done when:** raw HTML for every utility/private route has the intended status and robots directive; none is an indexable homepage duplicate.

### 2. Enforce `www` → apex redirects

**Owner:** Engineering / Vercel  
**Effort:** Small  
**Priority:** High

- Apply a one-hop 308/301 from `https://www.hireflow.dev/{path}` to `https://hireflow.dev/{path}`.
- Retain current HTTP→HTTPS and slashless normalization.

**Done when:** homepage and representative nested `www` URLs resolve to apex in one permanent hop.

### 3. Preserve new prerendering quality gates

**Owner:** Engineering / CI  
**Effort:** Small  
**Priority:** High

- Keep route-level build checks for minimum visible content, one H1, canonical, robots, unique metadata, hydration marker, and crawlable navigation.
- Add regression assertions that the legacy placeholder fragments never reappear.
- Add build checks for all sitemap routes and prevent protected routes from entering static generation.

**Done when:** deployment fails automatically on thin or placeholder public HTML.

## Phase 2 — performance and trust hardening (week 1)

### 4. Fix browser caching

**Owner:** Engineering / Vercel  
**Effort:** Small  
**Priority:** Medium

- Fingerprinted JS, CSS, and fonts: `Cache-Control: public, max-age=31536000, immutable`.
- HTML: retain short/revalidated caching.
- Version stable brand images or set intentional longer TTLs.

**Done when:** hashed assets return immutable one-year caching while HTML remains safely revalidated.

### 5. Remove sitewide Paddle blocking

**Owner:** Frontend  
**Effort:** Medium  
**Priority:** Medium

- Load Paddle only on pricing/checkout or after explicit user intent/idle time.
- Verify checkout still initializes reliably.
- Split marketing hydration from authenticated application code and audit unused JS/CSS.

**Done when:** non-commerce routes no longer download/execute Paddle during initial load and checkout tests pass.

### 6. Optimize brand assets

**Owner:** Design / Frontend  
**Effort:** Small  
**Priority:** Medium

- Replace the 752 KB 1024×1024 app icon with properly sized favicon/apple-touch variants.
- Compress/resize the 900 KB 1254×1254 organization logo.
- Keep the working 1200×630 OG image; add `og:image:alt`, width, height, type, and Twitter image alt.

**Done when:** icon/logo transfer is materially reduced and all social image metadata validates.

### 7. Add security headers

**Owner:** Engineering / Security  
**Effort:** Medium  
**Priority:** Medium

- Add a tested CSP compatible with Paddle and application dependencies.
- Add `X-Content-Type-Options: nosniff`.
- Add an intentional `Referrer-Policy`.
- Add restrictive `Permissions-Policy` and framing protection.
- Add `includeSubDomains` to HSTS only after every subdomain is HTTPS-ready.

**Done when:** headers are present on public and application routes without breaking checkout/auth.

## Phase 3 — product proof and content differentiation (weeks 1–4)

### 8. Publish product evidence

**Owner:** Product Marketing / Design  
**Effort:** Medium  
**Priority:** High

- Add 3–5 annotated screenshots covering upload, scoring, reasoning, ranking, and shortlist review.
- Publish an anonymized candidate-analysis example and scoring breakdown.
- State supported file formats, batch limits, processing expectations, exports, integrations, and plan constraints.
- Add an accessible demo/video with transcript.

**Done when:** buyers can inspect real inputs, outputs, mechanics, limits, and safeguards without creating an account.

### 9. Establish visible expertise and accountability

**Owner:** Leadership / Legal / Marketing  
**Effort:** Medium  
**Priority:** High

- Add named founders/leaders and relevant credentials.
- Name accountable owners/reviewers for recruiting methodology, security, and responsible AI.
- Publish scoring methodology, human oversight, uncertainty, bias evaluation/monitoring, retention/deletion, and model/provider boundaries.
- Resolve early-access vs paid-plan positioning.

**Done when:** important product/trust claims have accountable people, dates, methods, and limitations.

### 10. Produce verifiable case studies

**Owner:** Customer Success / Marketing  
**Effort:** Large  
**Priority:** High

- Publish at least two consented case studies with named company/person, baseline, cohort, timeframe, method, and measured results.
- Substantiate or soften generalized outcome claims until evidence exists.
- Do not fabricate customers, ratings, certifications, or benchmark results.

**Done when:** quantified claims link to transparent evidence and customer approval.

### 11. Differentiate the four solution pages

**Owner:** SEO / Product Marketing  
**Effort:** Medium  
**Priority:** Medium

- `/ai-resume-screening`: category overview, safeguards, criteria, product proof.
- `/bulk-resume-analysis`: formats, throughput, batch limits, exports, workflow.
- `/resume-scoring-ai`: recruiter/employer positioning, rubric, explanations, calibration.
- `/automated-candidate-shortlisting`: shortlist workflow, human decisions, collaboration, handoff.
- Replace generic repeated sections and card copy with page-specific objections, examples, FAQs, and contextual links.

**Done when:** every page has a distinct job, unique proof, and query-specific specifications.

### 12. Improve homepage and link architecture

**Owner:** SEO / Frontend  
**Effort:** Small  
**Priority:** Medium

- Test a category-explicit title such as `AI Resume Screening Software for Recruiters | HireFlow`.
- Make the H1 or immediate subheading explicitly name AI resume screening.
- Remove the “interviews” claim unless supported by a current public capability.
- Link homepage feature sections contextually to the four solution pages.
- Replace footer H3s with non-heading semantics and repair skipped FAQ heading levels.

**Done when:** homepage category intent is unmistakable and solution routes receive contextual internal links.

## Phase 4 — structured data and AI visibility (weeks 2–4)

### 13. Deploy a connected page-specific schema graph

**Owner:** SEO / Engineering  
**Effort:** Medium  
**Priority:** High

- Add `WebPage` identity per route.
- Add truthful `WebApplication`/`SoftwareApplication` plus visible monthly/annual `Offer` data.
- Add page-specific `Service`/feature context to solution pages.
- Add `AboutPage`, `ContactPage`, and accurate `dateModified` where maintained.
- Enrich Organization only with verifiable legal/contact/founder/profile data.

**Done when:** JSON-LD validates, matches visible content, uses stable IDs, and passes appropriate rich-result tests.

### 14. Build evidence-led expert content

**Owner:** SEO / Subject-matter experts  
**Effort:** Large  
**Priority:** Medium

Initial cluster:

1. AI resume-screening methodology and evaluation criteria.
2. Bulk-screening implementation guide.
3. Responsible AI, bias, compliance, and human oversight.
4. ATS vs AI screening comparison.
5. Candidate data lifecycle, security, and retention.

Every resource should have a named author/reviewer, dates, primary sources, diagrams/examples, and contextual links to product pages.

### 15. Add AI discovery controls intentionally

**Owner:** SEO / Legal  
**Effort:** Small  
**Priority:** Low

- Decide policies separately for search/answer crawlers and model-training crawlers.
- Add explicit robots groups only after legal/product agreement.
- Add `/llms.txt` as a maintained navigation file after evidence resources exist.
- Consider machine-readable licensing/RSL if it reflects policy.

## Phase 5 — measurement and authority (ongoing)

### 16. Establish measurement baselines

**Owner:** SEO / Analytics  
**Effort:** Medium  
**Priority:** High

- Connect Google Search Console, Bing Webmaster Tools, GA4, and a backlink provider.
- Submit and monitor the sitemap.
- Inspect homepage, pricing, and four solution routes.
- Capture indexed state, impressions, clicks, CTR, non-brand queries, demo/trial conversion, referring domains, anchors, and top linked pages.

### 17. Measure CWV properly

**Owner:** Frontend / Analytics  
**Effort:** Medium  
**Priority:** High

- Run mobile/desktop Lighthouse after caching/script changes.
- Obtain CrUX/Search Console field data when eligible.
- Add RUM via `web-vitals` if traffic is too low for stable CrUX.
- Prioritize LCP >2.5s, INP >200ms, or CLS >0.1 at p75.

### 18. Build entity and editorial authority

**Owner:** PR / Partnerships / Content  
**Effort:** Ongoing  
**Priority:** Medium

- Use consistent `HireFlow.dev` naming, logo, legal identity, and canonical URL across official profiles.
- Ensure official profiles link back to the site.
- Earn relevant HR/recruiting links through original research, transparent benchmarks, case studies, integrations, expert commentary, and legitimate software directories.
- Avoid manufactured reviews, low-quality guest posts, spam directories, and disavow actions without reliable link evidence.

## 30-day success criteria

- `www` and utility-route indexation fixed.
- Fingerprinted assets cached immutably; Paddle removed from irrelevant routes.
- Security headers deployed and tested.
- Homepage category targeting and contextual links improved.
- Product screenshots/example output published.
- Page-specific schema validated.
- GSC/Bing/GA4 connected and Lighthouse/CWV baseline captured.
- At least one named methodology/expertise page and one evidence-backed case study in production or approved for publication.

