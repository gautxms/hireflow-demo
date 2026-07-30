# HireFlow Full SEO Audit

**Site:** https://hireflow.dev  
**Audit date:** 2026-07-30  
**Business type:** B2B SaaS / AI-assisted recruiting software  
**Crawl scope:** All 15 URLs in `sitemap.xml`  
**Overall SEO Health Score:** **43/100 — significant improvement required**

## Executive summary

HireFlow has a functional technical baseline: HTTPS is enforced from HTTP, `robots.txt` permits crawling, the XML sitemap is valid, all 15 submitted URLs return 200, and every audited page has a unique title, unique meta description, canonical, index/follow directive, `lang="en"`, viewport declaration, and one H1.

The site is not yet competitive for non-brand search. The initial HTML for the homepage contains only 74 words; every other page contains 12–35 words. Fourteen of 15 responses expose no internal links, so discovery of most pages depends on the sitemap and JavaScript rendering. The commercial pages have relevant keyword targets but almost no server-visible explanation, proof, workflow, safeguards, integrations, or conversion path. Trust and legal routes exist, but their initial HTML is too thin to substantiate the claims buyers need from hiring software.

There are no confirmed index-blocking defects or manual-action indicators. The principal risks are quality, rendering dependence, discoverability, entity trust, and canonical consolidation—not an outright crawl ban.

## Weighted scorecard

| Category | Weight | Score | Weighted points | Status |
|---|---:|---:|---:|---|
| Technical SEO | 22% | 58 | 12.76 | Needs work |
| Content quality | 23% | 20 | 4.60 | Poor |
| On-page SEO | 20% | 48 | 9.60 | Needs work |
| Schema / structured data | 10% | 46 | 4.60 | Needs work |
| Performance | 10% | 64* | 6.40 | Provisional |
| AI search readiness | 10% | 30 | 3.00 | Poor |
| Images | 5% | 35 | 1.75 | Poor |
| **Overall** | **100%** |  | **42.71 → 43** | **Significant improvement required** |

\* Performance is provisional because PageSpeed Insights returned HTTP 429 and a browser was unavailable. No Lighthouse, LCP, INP, CLS, or CrUX result is claimed.

## Top findings

### High priority

1. **Core content is too dependent on JavaScript.** All 15 pages expose fewer than 100 words in initial HTML; 13 contain only 12–20 words. Google can render JavaScript, but it has limitations, and other crawlers may not render it. Google recommends static rendering, server-side rendering, or hydration for public content rather than relying on a dynamic-rendering workaround ([Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering)).
2. **The raw internal-link graph is nearly absent.** Fourteen pages have zero initial-HTML links; the homepage links only to `/pricing`. A sitemap supports discovery but does not replace comprehensible site navigation. Google notes that important pages should be reachable through links from the homepage ([Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)).
3. **The shared social and entity image is broken.** `https://hireflow.dev/og-default.png` returns 404 but is referenced on all 15 pages as `og:image`, `twitter:image`, and `Organization.logo`—45 broken references.
4. **Duplicate URL variants return 200.** `https://www.hireflow.dev/` and the tested trailing-slash URL `https://hireflow.dev/about/` do not redirect to the preferred apex/no-slash versions. Canonicals help, but permanent redirects provide a stronger consolidation signal ([Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)).
5. **Trust and E-E-A-T evidence is weak for a high-scrutiny category.** The site exposes no named experts, product methodology, evaluation evidence, security detail, data-flow explanation, case study, customer proof, sources, or update dates in initial HTML.
6. **Commercial landing pages do not satisfy the query intent they target.** The four feature URLs have good keyword-aligned titles, but only 16–18 initial-HTML words each and no crawlable CTA or supporting link.

### Quick wins

1. Deploy a working square logo and 1200×630 social image; update schema and metadata.
2. Redirect `www` to apex and enforce one trailing-slash policy.
3. Pre-render the global header, footer, and contextual links as standard `<a href>` elements.
4. Serve hashed JS/CSS with `Cache-Control: public, max-age=31536000, immutable`.
5. Load Paddle only on pricing/checkout or after user intent instead of synchronously on every route.
6. Replace `/vite.svg` with branded favicon assets.
7. Add page-specific `WebPage`, `WebApplication`, `Offer`, and `ContactPage` nodes where visible content supports them.

## Crawl inventory

| URL | Status | Title chars | Description chars | H1 | Initial words | Initial links |
|---|---:|---:|---:|---:|---:|---:|
| `/` | 200 | 29 | 102 | 1 | 74 | 1 |
| `/about` | 200 | 14 | 116 | 1 | 19 | 0 |
| `/ai-disclosure` | 200 | 22 | 104 | 1 | 16 | 0 |
| `/ai-resume-screening` | 200 | 57 | 134 | 1 | 16 | 0 |
| `/automated-candidate-shortlisting` | 200 | 52 | 125 | 1 | 18 | 0 |
| `/bulk-resume-analysis` | 200 | 58 | 114 | 1 | 17 | 0 |
| `/contact` | 200 | 16 | 104 | 1 | 12 | 0 |
| `/cookie-policy` | 200 | 22 | 99 | 1 | 14 | 0 |
| `/help` | 200 | 20 | 97 | 1 | 13 | 0 |
| `/pricing` | 200 | 16 | 102 | 1 | 35 | 0 |
| `/privacy` | 200 | 23 | 113 | 1 | 14 | 0 |
| `/refund-policy` | 200 | 22 | 93 | 1 | 15 | 0 |
| `/resume-scoring-ai` | 200 | 57 | 107 | 1 | 18 | 0 |
| `/terms` | 200 | 25 | 98 | 1 | 15 | 0 |
| `/trust` | 200 | 33 | 154 | 1 | 20 | 0 |

All titles and descriptions are unique. All pages declare their expected canonical after normalizing the homepage slash. No duplicate title or meta description was found.

## Technical SEO

### Crawlability and indexability

What works:

- `robots.txt` returns 200, allows all crawlers, and declares the sitemap.
- `sitemap.xml` returns 200 as XML and lists 15 unique HTTPS URLs.
- All 15 sitemap URLs return 200 and declare `index, follow`.
- HTTP redirects permanently to HTTPS.
- Unknown URLs return a genuine 404 rather than a soft 404.
- Canonicals are present in initial HTML.

Issues:

- The sitemap-seeded crawl cannot prove complete site coverage because the raw site graph reveals only `/pricing`.
- `www` and trailing-slash variants return 200, creating duplicate crawl surfaces.
- Complete route content and navigation appear to depend on a 394 KB raw React bundle.
- No Search Console URL Inspection or server-log evidence was available, so actual Google index state is unverified.

Actions:

- Static-pre-render or SSR the complete public page body, navigation, footer, schema, and CTAs.
- Add one-hop redirects for every noncanonical host/path variant.
- Verify rendered HTML in Search Console URL Inspection after deployment.
- Make every commercial and trust page reachable within three clicks from the homepage.

### Security and headers

Positive:

- HSTS is enabled: `max-age=63072000`.

Missing on audited HTML responses:

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options` or CSP `frame-ancestors`

These headers are primarily security and trust controls, not direct ranking boosts. Add them carefully, especially around Paddle dependencies.

## XML sitemap

**Score: 82/100**

The sitemap is valid, small, unique, canonical, HTTPS-only, and referenced in robots.txt. All submitted URLs returned 200.

All 15 entries use the same `lastmod` date (`2026-07-28`). This is valid only if every page changed materially on that date. Generate `lastmod` from each page’s substantive content update or omit it. Deployment timestamps should not masquerade as content modification dates.

## Content quality and E-E-A-T

**Content: 20/100**  
**E-E-A-T: 28/100**

Positive signals:

- Responsible wording such as “AI-assisted,” “recruiter review,” and “decision support.”
- Dedicated trust, AI disclosure, privacy, terms, refund, help, contact, and pricing routes.
- Transparent initial pricing: $99/month, $999/year, 7-day trial, and up to 800 analyses/month.

Gaps:

- No source-visible case studies, screenshots, sample scorecards, worked examples, or quantified outcomes.
- No named leadership, author, reviewer, recruiting expert, security owner, or AI-governance owner.
- No explanation of scoring criteria, uncertainty, bias evaluation, model/provider boundaries, candidate review, retention, deletion, subprocessors, or incident handling.
- No citations, dates, revision histories, or methodology.
- Trust and legal pages contain only one brief sentence in initial HTML.

Recommended content model for each commercial page:

1. Direct definition and value proposition.
2. Problem and user scenario.
3. Inputs, workflow, and outputs.
4. Screenshots or annotated sample results.
5. Human oversight, fairness, privacy, and limitations.
6. Integrations and exports.
7. Evidence or case study with methodology.
8. Buyer objections and concise answers.
9. Contextual links to pricing, trust, disclosure, and adjacent features.
10. Demo and trial CTAs.

Aim for complete intent coverage, not a mechanical word count. A planning range of roughly 700–1,200 purposeful words is reasonable for the primary SaaS landing pages.

## On-page SEO and search experience

**On-page: 48/100**  
**SXO gap score: 31/100** (separate from the weighted health score)

What works:

- The four commercial page titles closely match distinct query themes.
- Commercial titles are 52–58 characters; descriptions are 107–134 characters.
- One H1 per page and a valid homepage heading hierarchy.
- Clean, descriptive URLs.

Issues:

- Homepage title targets “AI Hiring Platform,” while the H1 “Hire Smarter. Faster.” does not name the product category.
- The homepage description claims “interviews,” but the initial page does not substantiate or link to an interview capability.
- `/pricing`, `/about`, and other brand-page titles are very short.
- The four feature pages can cannibalize one another unless each has a distinct job:

| URL | Primary intent | Page job |
|---|---|---|
| `/ai-resume-screening` | AI resume screening software | Category and solution overview |
| `/bulk-resume-analysis` | Bulk resume screening | High-volume batch workflow |
| `/resume-scoring-ai` | AI resume scoring | Methodology, criteria, and explanations |
| `/automated-candidate-shortlisting` | Candidate shortlisting software | Ranked shortlist and review workflow |

Recommendation:

- Use a category-explicit homepage H1, such as “AI-assisted resume screening for faster, consistent shortlists,” if that reflects the actual product.
- Keep titles unique, concise, and descriptive; Google recommends a descriptive title on every page ([title guidance](https://developers.google.com/search/docs/advanced/appearance/good-titles-snippets)).
- Make body copy strong enough to generate query-specific snippets; Google primarily creates snippets from page content and may use the meta description when it is more accurate ([snippet guidance](https://developers.google.com/search/docs/appearance/snippet)).

## Structured data

**Score: 46/100**

Confirmed:

- All 15 pages contain valid JSON-LD syntax in initial HTML.
- Stable `Organization` and `WebSite` IDs are used.
- No deprecated types were found.

Issues:

- `Organization.logo` points to a 404.
- The same generic graph is repeated on every page.
- No page-specific `WebPage` entity.
- No `WebApplication`/`SoftwareApplication` product representation.
- `/pricing` has no `Offer` nodes.
- `/contact` has no `ContactPage` or verified `contactPoint`.

Add a connected graph only where visible content supports it. Google supports `SoftwareApplication` markup, but rich-result eligibility requires the documented properties and truthful visible information ([Google software app schema](https://developers.google.com/search/docs/appearance/structured-data/software-app)). The organization logo must be crawlable and indexable; Google recommends at least 112×112 pixels ([Google Organization schema](https://developers.google.com/search/docs/appearance/structured-data/organization)).

Do not fabricate reviews, ratings, awards, usage counts, or customers.

## Performance and Core Web Vitals

**Provisional score: 64/100**

Confirmed point-in-time transfers:

| Resource | Compressed transfer | Observed TTFB | Cache policy |
|---|---:|---:|---|
| Homepage HTML | 1.5 KB | ~89 ms | `max-age=0, must-revalidate` |
| Main JS | 121 KB | ~139 ms | `max-age=0, must-revalidate` |
| Main CSS | 15.8 KB | ~64 ms | `max-age=0, must-revalidate` |
| Paddle JS | 15.3 KB | ~128 ms | Third-party, 4-hour cache |

Risks:

- Hashed JS/CSS still revalidate on every visit.
- A classic synchronous Paddle script is loaded in the head of every public route.
- The public marketing experience shares a material React bundle.
- Six Syne font files are referenced.

Actions:

- Use one-year immutable caching for fingerprinted assets.
- Split marketing, application, pricing, and checkout code.
- Load Paddle on the pricing/checkout path or after a clear user action.
- Consolidate font weights/subsets and use `font-display: swap`.
- Measure mobile and desktop after fixes.

Current good field thresholds are LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1 at the 75th percentile ([web.dev Core Web Vitals](https://web.dev/articles/vitals)). No current HireFlow CWV values were available, so these are targets, not observed results.

## Images and social sharing

**Score: 35/100**

- No `<img>`, `<picture>`, video, or iframe appears in the initial HTML.
- The only globally declared social/schema image returns 404.
- `/vite.svg` is used as the favicon, indicating placeholder branding.
- Browser-created images after hydration were not inspectable.

Actions:

- Use separate working assets for a square organization logo and 1200×630 social preview.
- Add route-specific OG images for major landing pages.
- Replace the Vite favicon.
- For product screenshots and diagrams, include explicit dimensions, modern formats, responsive sources, descriptive alt text, and reserved aspect ratios.
- Do not lazy-load a measured LCP image.

## AI search / GEO readiness

**Score: 30/100**

Positive:

- `robots.txt` allows major search and AI crawlers through the wildcard rule.
- Titles, H1s, and basic copy are available without JavaScript.
- The site has Trust and AI Disclosure routes.

Gaps:

- `/llms.txt` returns 404.
- No self-contained answer passages, defined methodology, sourced claims, comparison tables, original research, named authors, or update dates.
- No useful multimodal content in initial HTML.
- The “HireFlow” name is shared by several unrelated recruiting/career products, increasing entity ambiguity.
- Sampled exact-title searches did not surface the four new feature URLs; only the homepage surfaced in the sampled site/brand searches. This is directional, not an authoritative index-coverage test.
- The current July 2026 Common Crawl exact-domain lookup returned no capture; no Moz, Bing Webmaster, DataForSEO, GSC, or GA4 connection was available.

Create `/llms.txt` only after the linked content is substantial. It is an emerging discovery aid, not a ranking shortcut. More important: publish citable, attributable, updated, and evidence-backed pages.

## Off-page authority

A complete backlink count, anchor distribution, spam score, and competitor link gap could not be measured without a connected backlink provider or verified webmaster account.

Observable signals are early-stage:

- The site links its Organization entity to an official LinkedIn company profile.
- The sampled search footprint is dominated by the homepage.
- Multiple unrelated products use “HireFlow,” so consistent `HireFlow.dev` naming, logo, legal identity, and official profiles are important.

Recommended authority work:

- Publish research or benchmarks with transparent methodology.
- Earn mentions through recruiting/HR expert commentary, product demonstrations, customer case studies, integrations, and relevant software directories.
- Avoid manufactured reviews, community posts, or low-quality directory campaigns.

## Priority register

| Priority | Issue | Affected | Impact | Target |
|---|---|---|---|---|
| High | Thin initial HTML / rendering dependence | 15/15 pages | Ranking, citation, non-JS discovery | 1–2 weeks |
| High | Near-zero raw internal-link graph | 14/15 pages | Discovery, hierarchy, crawl flow | 1 week |
| High | Broken OG/Twitter/logo asset | 15 pages / 45 refs | Social CTR, entity integrity | 48 hours |
| High | `www` and slash duplicates return 200 | Tested variants | Signal consolidation, crawl efficiency | 48 hours |
| High | Trust/E-E-A-T evidence absent | Sitewide | Buyer confidence and quality | 2–4 weeks |
| High | Commercial pages fail intent depth | 4 pages | Non-brand ranking and conversion | 2–4 weeks |
| Medium | Generic schema only | 15 pages | Entity/page understanding | 1–2 weeks |
| Medium | Hashed assets revalidate | JS/CSS | Repeat-load performance | 1 week |
| Medium | Paddle loads on every page | Sitewide | Rendering/performance | 1 week |
| Medium | Security headers missing | Sitewide | Security and trust | 1–2 weeks |
| Medium | `lastmod` identical on all URLs | Sitemap | Sitemap quality | Next release |
| Medium | Brand/entity ambiguity | Off-site | Knowledge graph and AI attribution | Ongoing |
| Low | `llms.txt` missing | Sitewide | Optional AI discovery | After content |
| Low | RSL/AI licensing policy absent | Sitewide | Governance choice | Backlog |

## Measurement and verification

After implementation:

1. Crawl raw HTML and a rendered browser DOM; compare content, links, metadata, canonicals, robots, and schema.
2. Require one-hop redirects for HTTP/HTTPS, `www`/apex, and slash/no-slash variants.
3. Confirm all canonical pages are reachable within three clicks.
4. Run Rich Results Test and Schema.org Validator.
5. Run mobile/desktop Lighthouse and collect CrUX p75 LCP, INP, and CLS.
6. Submit the sitemap in Google Search Console and Bing Webmaster Tools.
7. Inspect the homepage and four commercial URLs in Search Console.
8. Track impressions, clicks, CTR, indexed-page count, non-brand queries, demo starts, trial starts, and organic-assisted revenue.

## Limitations

- Firecrawl and the connected browser were unavailable.
- The crawl was seeded from the sitemap, so it validates submitted URLs but cannot independently prove complete route coverage.
- Saved initial HTML is definitive; post-hydration content and navigation may be richer but were not assumed.
- PageSpeed Insights returned 429; CWV and Lighthouse remain unverified.
- No GSC, GA4, server logs, backlink provider, keyword-volume provider, or location-controlled Google SERP was connected.
- No authenticated application workflow was tested.
- Search samples support directional index/SERP observations, not authoritative ranking positions.

## Evidence artifacts

- `crawl-data/crawl.json` — page-level inventory and URL checks
- `crawl-data/*.html` — saved initial HTML for all sitemap URLs
- `SPECIALIST-TECHNICAL.md`
- `SPECIALIST-CONTENT-SXO.md`
- `SPECIALIST-SCHEMA-GEO-VISUAL.md`

