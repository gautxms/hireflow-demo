# HireFlow Full SEO Audit

**Site:** https://hireflow.dev  
**Audit date:** 2026-08-01  
**Fresh crawl timestamp:** 2026-08-01T07:51:48Z  
**Business type:** B2B SaaS / AI-assisted recruiting software  
**Scope:** All 15 canonical URLs in `sitemap.xml`, selected utility routes, host/path variants, public assets, search-result samples, and the prior 2026-07-30 baseline  
**Overall SEO Health Score:** **64/100 — needs work**

## Executive summary

HireFlow has made a large technical and content improvement since the July 30 baseline. All 15 sitemap URLs return 200, expose substantive server-rendered content, include one H1, unique titles and descriptions, self-referential canonicals, `index, follow`, Open Graph/Twitter metadata, and roughly 20 crawlable links. Raw visible content increased from 316 to 8,176 words across the site, and raw link occurrences increased from 1 to 300. The previously broken social image now returns 200, and trailing-slash normalization is fixed.

There are no confirmed critical indexing blockers on the canonical marketing pages. The strongest remaining risks are duplicate crawl surfaces (`www`, `/login`, `/signup`), weak first-hand proof and entity authority for a sensitive AI-hiring category, generic sitewide schema, absent product media, avoidable frontend/caching overhead, and missing security headers. Core Web Vitals remain unverified because PageSpeed Insights returned 429 and no browser/Lighthouse runtime was available.

## Weighted scorecard

| Category | Weight | Score | Weighted points | Assessment |
|---|---:|---:|---:|---|
| Technical SEO | 22% | 78 | 17.16 | Good foundation; duplication and headers remain |
| Content quality | 23% | 55 | 12.65 | Substantial, but proof and expertise are weak |
| On-page SEO | 20% | 73 | 14.60 | Strong metadata; targeting and hierarchy need refinement |
| Schema / structured data | 10% | 55 | 5.50 | Valid foundation, no page-specific entities |
| Performance | 10% | 70* | 7.00 | Provisional; payload/caching risks confirmed |
| AI search readiness | 10% | 54 | 5.40 | Accessible and structured, not yet authoritative/citable |
| Images | 5% | 43 | 2.15 | Social card fixed; product media absent |
| **Overall** | **100%** |  | **64.46 → 64** | **Needs work** |

\* Performance is an evidence-weighted audit score, not Lighthouse or CWV. No valid LCP, INP, CLS, or Lighthouse score was obtained.

Separate diagnostic scores: E-E-A-T **41/100**, AI citation readiness **38/100**, `/ai-resume-screening` SXO alignment **43/100**. Off-page/backlink health is **insufficient data** and is not numerically scored. Visual rendering is unscored because screenshots were unavailable.

## Top high-priority findings

1. **Crawlable auth-shell duplicates.** `/login` returns homepage title/H1, `index, follow`, and homepage canonical. `/signup` also returns `index, follow` with the homepage canonical. Both are linked sitewide. Serve purpose-built initial HTML or `noindex, follow`; do not rely on client-side metadata replacement.
2. **`www` is not consolidated.** `https://www.hireflow.dev/` returns 200 with duplicate homepage content instead of a permanent redirect to the apex domain.
3. **Product proof and authority are weak.** No named founders, recruiting/AI experts, case studies, testimonials, customer logos, external citations, evaluation methodology, or verifiable outcome evidence appears in the audited pages.
4. **Schema is generic.** Every page repeats the same valid `Organization` + `WebSite` graph. Pricing lacks `SoftwareApplication`/`WebApplication` and truthful `Offer` markup; solution pages lack page-specific `WebPage`/`Service` context.
5. **No product media.** The raw crawl contains zero `<img>`, `<picture>`, video, iframe, or table elements. There are no screenshots, workflow diagrams, sample scorecards, or anonymized candidate reports.
6. **Performance and security hardening remain.** Hashed assets revalidate on every visit, Paddle loads synchronously on every page, brand PNGs are oversized, and key security headers are absent.

## Top quick wins

1. Enforce one-hop `www` → apex redirects for every path.
2. Add initial-HTML `noindex, follow` to `/login` and `/signup` and verify private/utility routes.
3. Apply `public, max-age=31536000, immutable` to fingerprinted JS, CSS, and fonts.
4. Load Paddle only on pricing/checkout or after user intent.
5. Compress/resize the 752 KB icon and 900 KB logo; retain the working 1200×630 OG card.
6. Improve homepage title/H1 targeting and link homepage feature sections to their dedicated solution pages.
7. Add page-specific schema and validate it before rollout.

## Crawl inventory

| Route | Status | Body words | Links | H1 | Schema |
|---|---:|---:|---:|---:|---|
| `/` | 200 | 1,130 | 20 | 1 | Organization, WebSite |
| `/about` | 200 | 520 | 20 | 1 | Organization, WebSite |
| `/ai-disclosure` | 200 | 269 | 20 | 1 | Organization, WebSite |
| `/ai-resume-screening` | 200 | 731 | 20 | 1 | Organization, WebSite |
| `/automated-candidate-shortlisting` | 200 | 651 | 20 | 1 | Organization, WebSite |
| `/bulk-resume-analysis` | 200 | 698 | 20 | 1 | Organization, WebSite |
| `/contact` | 200 | 287 | 20 | 1 | Organization, WebSite |
| `/cookie-policy` | 200 | 298 | 20 | 1 | Organization, WebSite |
| `/help` | 200 | 347 | 20 | 1 | Organization, WebSite |
| `/pricing` | 200 | 796 | 20 | 1 | Organization, WebSite |
| `/privacy` | 200 | 498 | 20 | 1 | Organization, WebSite |
| `/refund-policy` | 200 | 149 | 20 | 1 | Organization, WebSite |
| `/resume-scoring-ai` | 200 | 658 | 20 | 1 | Organization, WebSite |
| `/terms` | 200 | 663 | 20 | 1 | Organization, WebSite |
| `/trust` | 200 | 481 | 20 | 1 | Organization, WebSite |

All titles and descriptions are unique. No missing/multiple H1s, missing canonicals, missing descriptions, noindexed sitemap pages, or non-200 sitemap entries were found.

## Technical SEO

### Strengths

- `robots.txt` returns 200, permits crawling, and declares the sitemap.
- `sitemap.xml` returns 200 as XML and contains exactly the 15 canonical marketing/legal pages.
- HTTP and tested trailing-slash variants use 308 redirects.
- A deliberately unknown URL returns a genuine 404.
- HTTPS and HSTS (`max-age=63072000`) are enabled.
- Core content and navigation are present in raw HTML; SEO no longer depends on JavaScript rendering.
- All checked internal destinations return 200.

### Issues

- **High:** `www` returns 200 instead of redirecting to apex. Canonical markup helps, but a redirect is a stronger consolidation signal.
- **High:** `/login` and `/signup` are sitewide links with indexable homepage-shell HTML. Audit all auth, dashboard, billing, admin, and account routes for initial status, robots, title, canonical, and body behavior.
- **Medium:** missing `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and framing protection.
- **Low:** sitemap has no `<lastmod>`. This is valid; add only accurate per-page dates derived from substantive changes.
- **Low:** AI crawler access is implicit through `User-agent: *`. Document whether search and training crawlers should be treated differently.

## Content quality, E-E-A-T, and SXO

### Strengths

- Homepage, pricing, solution, trust, and policy content is now server-visible and materially deeper.
- The homepage explains workflow, audiences, benefits, responsible use, and five FAQs.
- Pricing transparently states $99 monthly, $999 annual, a 7-day trial, and up to 800 analyses per month.
- Trust, privacy, terms, and AI disclosure clearly emphasize human review, limitations, customer responsibility, and early-access status.
- Commercial solution page types align with current product/hybrid search intent.
- Readability is generally good; commercial pages average roughly 17–19 words per sentence.

### Issues

- **High:** broad performance/outcome language is unsupported by primary sources, case studies, named customers, methodology, or baseline data.
- **High:** no named leadership, authors, reviewers, recruiting experts, security owner, or AI-governance owner is visible.
- **High:** no product screenshots, sample output, evaluation rubric, scoring example, supported file formats, batch constraints, integrations, exports, or technical specifications.
- **Medium:** the four solution pages share the same section pattern and roughly 75 exact five-word shingles per pair. They are not duplicates, but the templated footprint weakens differentiation.
- **Medium:** `/resume-scoring-ai` has recruiter/job-seeker intent ambiguity. Explicitly position it as employer/recruiter software.
- **Medium:** About says the product is preparing for launch/early access while pricing presents active paid plans. Clarify current availability, onboarding, and roadmap boundaries.
- **Medium:** homepage metadata mentions “interviews,” but audited public content focuses on resume screening, ranking, and shortlisting.
- **Medium:** Help is a short overview rather than deep, indexable documentation.

### Content priorities

1. Publish annotated product screenshots and an anonymized candidate-analysis example.
2. Publish scoring methodology, inputs/outputs, human review, limitations, bias testing/monitoring, retention, and model/provider boundaries.
3. Add two verified case studies with named participants, baselines, method, and results.
4. Add leadership/expert bios and accountable owners for recruiting, security, and responsible AI.
5. Differentiate each solution page with unique jobs-to-be-done, specifications, workflows, objections, examples, and FAQs.
6. Build an expert-led cluster around screening methodology, bulk workflow, responsible AI/bias, ATS comparisons, and implementation guidance.

## On-page SEO and internal linking

### Strengths

- Unique title and meta description on every canonical page.
- One H1 per page; solution titles are strong at 52–58 characters.
- Clean, descriptive URLs and self-canonicals.
- Standard navigation/footer links make every key marketing and policy page discoverable.

### Issues

- Homepage title `HireFlow – AI Hiring Platform` and H1 `Hire Smarter. Faster.` underuse the core category phrase “AI resume screening software.”
- About, pricing, contact, and help titles are descriptive but only 14–20 characters.
- Homepage feature sections do not provide strong contextual links to dedicated solution pages.
- Solution-page related cards use repetitive, long anchor text.
- Help/contact FAQ outlines skip heading levels; footer labels use H3s and add noise to every page outline.

## Structured data

All 15 pages have parse-valid JSON-LD using stable `Organization` and `WebSite` IDs. The logo is an absolute, working image URL and `WebSite.publisher` correctly references the organization.

Recommended connected graph:

- Homepage: `Organization`, `WebSite`, `WebPage`, and a truthful `WebApplication`/`SoftwareApplication` entity.
- Pricing: application entity with visible, accurate `Offer` data for monthly and annual plans.
- Solution pages: `WebPage` plus `Service` or application-feature context through `mainEntity`/`about`.
- About/contact: `AboutPage` and `ContactPage` linked to the organization.
- Trust/legal: `WebPage` with accurate `dateModified` where visible and maintained.
- Optional `BreadcrumbList` only where breadcrumbs are present or intentionally implemented.

Do not fabricate reviews, ratings, awards, customers, certifications, or entity identifiers. Do not add FAQ markup merely because FAQs exist; Google currently limits FAQ rich-result eligibility primarily to authoritative government and health sites.

## Performance and Core Web Vitals

Confirmed point-in-time transfer evidence:

| Resource | Compressed transfer | Raw size / header size | Browser cache policy |
|---|---:|---:|---|
| Homepage HTML | ~6.0 KB | 20.6 KB | `max-age=0, must-revalidate` |
| Main JS | ~122 KB | 398 KB | `max-age=0, must-revalidate` |
| Main CSS | ~15.8 KB | 87.3 KB | `max-age=0, must-revalidate` |
| OG image | 129.7 KB | 129.7 KB | `max-age=0, must-revalidate` |
| App icon | 751.8 KB | 751.8 KB | `max-age=0, must-revalidate` |
| Organization logo | 900.4 KB | 900.4 KB | `max-age=0, must-revalidate` |

Positive: Vercel edge cache hits were observed, Brotli is enabled for tested JS/CSS, fonts use WOFF2 and `font-display: swap`, and core copy is prerendered.

Risks: browser revalidation for hashed assets, synchronous sitewide Paddle, a shared application/marketing bundle, oversized brand PNGs, and unverified rendered mobile behavior.

PageSpeed Insights returned 429 `RESOURCE_EXHAUSTED`; no valid LCP, INP, CLS, Lighthouse score, or CrUX field result is claimed. Measure mobile and desktop before treating performance as pass/fail. Current good field targets remain LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1 at the 75th percentile.

## Images and social sharing

- `/og-default.png` is fixed: 200, PNG, 1200×630, about 130 KB.
- The same social card is used on all routes.
- No `og:image:alt`, `twitter:image:alt`, image dimensions, or type metadata is declared.
- Organization logo is 1254×1254 and about 900 KB; app icon is 1024×1024 and about 752 KB.
- No content images or product media exist in raw HTML. This is not an alt-text failure; it is a product-proof and multimodal-content gap.

Add route-specific social cards for pricing and core solution/trust pages. Add optimized screenshots/diagrams with descriptive alt text, width/height, responsive sources, modern formats, and reserved aspect ratios.

## AI search / GEO readiness

Strengths: raw content is accessible without JavaScript; crawler access is allowed; headings, short paragraphs, lists, FAQs, Trust, and AI Disclosure provide a sound structural base.

Gaps:

- `/llms.txt` returns 404.
- No explicit search-vs-training crawler policy or machine-readable AI licensing signal was found.
- No authors, citations, case studies, original research, named methodology, or externally verifiable claims.
- No product media or tables.
- Solution pages use promotional/generic headings rather than question-led, extractable answer sections.
- Public search samples are dominated by unrelated “HireFlow” products, creating substantial entity ambiguity.
- The latest checked Common Crawl index returned no capture for the domain; this is not proof of zero backlinks.

Create `llms.txt` only as a navigation aid after linked resources are authoritative and maintained. More important: make passages attributable, evidence-led, self-contained, dated, and supported by real product evidence.

## Off-page authority

Backlink health is not scored. No Moz, DataForSEO, Bing Webmaster, GSC, or other authoritative backlink dataset was available. The Common Crawl absence cannot establish zero backlinks, referring domains, toxicity, or anchor distribution. Do not create a disavow file from this evidence.

Immediate measurement work:

1. Connect Google Search Console and Bing Webmaster Tools.
2. Connect Moz/DataForSEO or another backlink provider.
3. Capture referring domains, followed/nofollow ratio, top anchors, top linked pages, authority distribution, new/lost velocity, and competitor gaps as a baseline.
4. Strengthen entity consistency as “HireFlow.dev” across official profiles and ensure they link to the canonical domain.

## Drift since 2026-07-30

| Signal | Baseline | Current | Result |
|---|---:|---:|---|
| Raw visible words, 15 pages | 316 | 8,176 | Fixed / +25.9× |
| Raw link occurrences | 1 | 300 | Fixed |
| Pages with substantive initial HTML | 0/15 | 15/15 | Fixed |
| Broken OG image | 404 | 200 | Fixed |
| Tested trailing slash | 200 duplicate | 308 | Fixed |
| `www` duplicate | 200 | 200 | Unresolved |
| Page-specific schema | Missing | Missing | Unresolved |
| Security headers | Missing | Missing | Unresolved |
| Product images/media | Missing | Missing | Unresolved |

The old hard-coded placeholder fragments do not appear anywhere in the fresh saved HTML.

## Priority register

| Priority | Issue | Impact | Target |
|---|---|---|---|
| High | `/login` and `/signup` expose indexable homepage-shell HTML | Duplicate crawling/indexation | 24–48 hours |
| High | `www` returns 200 instead of redirecting | Canonical consolidation | 24–48 hours |
| High | No named expertise, case studies, or evidence | Trust, conversion, quality | 2–4 weeks |
| High | No product screenshots/examples/specifications | Conversion, E-E-A-T, GEO | 1–2 weeks |
| High | Generic schema only | Entity/page understanding | 1–2 weeks |
| Medium | Hashed assets revalidate; Paddle sitewide | Repeat performance, CWV risk | 1 week |
| Medium | Missing security headers | Product trust/security | 1–2 weeks |
| Medium | Templated solution pages | Differentiation, intent coverage | 2–4 weeks |
| Medium | Weak homepage category targeting | Relevance | 1 week |
| Medium | Oversized icon/logo assets | Transfer/performance | 1 week |
| Medium | Brand/entity ambiguity | Branded discovery and authority | Ongoing |
| Low | `llms.txt` absent | Optional AI discovery aid | After evidence content |
| Low | No accurate sitemap `lastmod` | Recrawl signaling | Next content release |

## Measurement and verification

After fixes:

1. Re-crawl raw HTML and verify metadata, canonicals, robots, H1s, schema, links, and status codes.
2. Test `www`, HTTP, trailing slash, auth, private, and unknown URL behavior with redirect chains recorded.
3. Validate schema with Schema.org Validator and Google Rich Results Test where eligible.
4. Run mobile/desktop Lighthouse and obtain CrUX p75 LCP, INP, and CLS.
5. Inspect homepage, pricing, and four solution URLs in Search Console.
6. Submit/verify the sitemap in GSC and Bing.
7. Track impressions, clicks, CTR, indexed pages, non-brand queries, demo starts, trial starts, and organic-assisted revenue.

## Limitations

- The crawl was seeded from the sitemap and covered 15 public canonical routes, plus selected utility/variant checks.
- No authenticated application workflow was tested.
- Browser/screenshots were unavailable, so actual mobile rendering, contrast, fold visibility, touch targets, and CLS were not visually assessed.
- PageSpeed Insights returned 429; CWV/Lighthouse remain unverified.
- No GSC, GA4, server logs, DataForSEO, Moz, Bing Webmaster, or authoritative backlink provider was connected.
- Search samples are directional and not a location/device-controlled Google rank export.
- Common Crawl absence is not evidence of zero links or zero indexation.

## Evidence

- Fresh crawl: `C:/Users/admin/hireflow-seo-audit/crawl-data/crawl.json`
- Fresh raw HTML: `C:/Users/admin/hireflow-seo-audit/crawl-data/*.html`
- Preserved July crawl: `C:/Users/admin/hireflow-seo-audit/crawl-data-2026-07-30/`
- Baseline report: `C:/Users/admin/hireflow-seo-audit/FULL-AUDIT-REPORT.md`
- Google redirect guidance: https://developers.google.com/search/docs/crawling-indexing/301-redirects
- Google canonical guidance: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google SoftwareApplication schema: https://developers.google.com/search/docs/appearance/structured-data/software-app
- Google static rendering/hydration guidance: https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering
- Web Vitals measurement guidance: https://web.dev/articles/vitals

