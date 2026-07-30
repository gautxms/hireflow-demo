# HireFlow Technical SEO, Sitemap, Performance, and Image Audit

**Site:** https://hireflow.dev  
**Audit date:** 2026-07-30  
**Evidence base:** shared crawl captured 2026-07-30 at 10:13 UTC (15 sitemap URLs and saved raw HTML), plus read-only live HTTP/header/asset checks.

## Executive assessment

### Scores

| Area | Score | Status | Confidence |
|---|---:|---|---|
| Technical SEO | **58/100** | Needs work | High for HTTP/raw HTML; limited for browser rendering |
| XML sitemap | **82/100** | Good with one material quality issue | High |
| Performance | **64/100 provisional** | Mixed | Medium-low; no Lighthouse/CrUX |
| Image SEO | **35/100** | Poor | High for raw HTML and social assets |

The fundamentals are partly sound: HTTPS is enforced from HTTP, all 15 submitted canonical URLs returned 200, `robots.txt` allows crawling and references a valid sitemap, every crawled page has a title, description, index/follow directive, canonical, viewport, language, and one H1, and important page content exists in initial HTML.

The largest technical risks are:

1. **All 15 pages advertise a nonexistent `https://hireflow.dev/og-default.png`.** It returns 404 and is used by Open Graph, Twitter Cards, and `Organization.logo`.
2. **Duplicate URL variants remain directly crawlable at 200:** `https://www.hireflow.dev/` and `https://hireflow.dev/about/`. Canonicals point to the preferred apex/no-trailing-slash forms, but server redirects are absent.
3. **Raw-HTML discoverability is extremely weak:** 14/15 pages contain zero internal links; the homepage exposes only `/pricing`. A rendered React navigation may exist, but it was not established by the saved crawl. Search discovery therefore depends heavily on the sitemap and potentially JavaScript.
4. **Hashed static assets are not given long-lived immutable caching.** The main JS and CSS both use `Cache-Control: public, max-age=0, must-revalidate`.
5. **No field or lab CWV result could be obtained.** PageSpeed Insights returned HTTP 429 for both mobile and desktop. LCP, INP, CLS, and Lighthouse scores are therefore unverified and must not be inferred.

## Technical SEO category breakdown

| Category | Score | Status | Confirmed evidence |
|---|---:|---|---|
| Crawlability | 62 | Warn | Valid permissive robots and sitemap; raw HTML has only one internal link across homepage and none on 14 pages |
| Indexability | 58 | Warn | 15/15 indexable and canonicalized; www and trailing-slash duplicates return 200; all 15 raw pages have fewer than 100 words |
| Security | 55 | Warn | HTTPS redirect and HSTS present; CSP, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy absent |
| URL structure | 63 | Warn | Clean descriptive canonical URLs; inconsistent duplicate variants are not redirected |
| Mobile | 72 | Warn | Viewport on 15/15 pages and no raw-HTML images; touch targets, font sizing, overflow, and responsive rendering unverified |
| Core Web Vitals | 45 | Unverified | PSI quota-blocked; only network heuristics available |
| Structured data | 50 | Warn | `Organization` + `WebSite` in 15/15 raw pages, but referenced logo is 404 and markup is generic on every route |
| JavaScript rendering | 64 | Warn | Primary H1/body copy and SEO tags are server/prerendered; richer navigation/content may depend on a 394,224-byte raw React bundle |
| IndexNow | 20 | Unverified | No IndexNow key or submission implementation established by available evidence |

## Prioritized technical issues

### Critical / immediate

#### 1. Broken Open Graph, Twitter, and schema logo asset on every page

- **Affected:** 15/15 sitemap URLs.
- **Broken URL:** `https://hireflow.dev/og-default.png` returned **404**.
- Each saved page references it as `og:image`, `twitter:image`, and `Organization.logo`: **45 meta/schema references total**.
- Impact: broken social previews, reduced click-through when URLs are shared, and invalid/incomplete organization logo markup.

**Fix:** publish a crawlable 1200×630 social image at that exact URL (with an appropriate content type, dimensions, and cache policy), or update all 45 references to a working absolute image URL. For `Organization.logo`, ideally use a dedicated square brand logo rather than the social card. Test both URLs unauthenticated and validate with social debuggers and schema tooling.

### High priority

#### 2. Redirect duplicate host and trailing-slash variants

- `https://www.hireflow.dev/` returned **200**, duplicating `https://hireflow.dev/`.
- `https://hireflow.dev/about/` returned **200**, duplicating `https://hireflow.dev/about`.
- Their raw canonicals consolidate to the preferred apex/no-slash forms, which is helpful but only a hint.
- `http://hireflow.dev/` correctly returns **308** to HTTPS.

**Fix:** add one-hop 308/301 redirects from all `www` URLs to apex and choose a sitewide trailing-slash policy. Redirect the nonpreferred form for every route. Keep sitemap, canonicals, navigation, and hreflang (if added later) on the same preferred form.

#### 3. Put crawlable site navigation and contextual links into prerendered HTML

- **14/15 pages have zero `<a>` links in saved raw HTML.**
- The homepage contains only one internal link: `https://hireflow.dev/pricing`.
- Consequently, `/about`, `/contact`, `/help`, `/trust`, all three feature landing pages, and all policy pages are not discoverable from the crawled raw HTML.
- A JavaScript-rendered navigation/footer may appear after React executes; this is **unverified**, not counted as confirmed absence in the rendered page.

**Fix:** prerender a global header/footer with normal `<a href>` links and add contextual links among closely related commercial pages. Ensure every indexable page is reachable in at most three clicks without requiring interaction or JavaScript. Use the sitemap as a supplement, not the only discovery path.

#### 4. Strengthen thin prerendered route content

- **15/15 raw pages have fewer than 100 words; 12/15 have fewer than 20.**
- Examples: `/contact` 12 words; `/help` 13; `/privacy` 14; `/ai-resume-screening` 16; `/bulk-resume-analysis` 17.
- The primary heading and short paragraph are available without JS, so this is not a blank-shell failure. However, Google may see very little unique content before rendering, and non-rendering crawlers will see only this thin version.

**Fix:** prerender the complete useful route content and supporting internal links, especially on the three commercial landing pages. Confirm parity between raw HTML and the browser-rendered DOM for titles, canonical, robots, H1, core copy, schema, and links.

### Medium priority

#### 5. Add missing security headers

The homepage and crawled pages provide `Strict-Transport-Security: max-age=63072000`, but the crawl/live headers did not contain:

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options` was not present in the live homepage header response either.

**Fix:** start with a tested CSP (preferably report-only before enforcement), `X-Content-Type-Options: nosniff`, an appropriate `Referrer-Policy` such as `strict-origin-when-cross-origin`, a least-privilege `Permissions-Policy`, and either CSP `frame-ancestors` or `X-Frame-Options`. Preserve required Paddle resources in the CSP allowlist.

#### 6. Give content-hashed JS/CSS immutable caching

- `/assets/index-D2uILywq.js`: 394,224 bytes raw, 121,000 bytes transferred with gzip.
- `/assets/index-DIh-PWq6.css`: 87,309 bytes raw, 15,794 bytes transferred with gzip.
- Both return `Cache-Control: public, max-age=0, must-revalidate`, despite content hashes in their filenames.

**Fix:** serve fingerprinted assets with `Cache-Control: public, max-age=31536000, immutable`. Keep HTML short-lived/revalidated so deployments can point to new hashes. Brotli may improve transfer beyond gzip where supported.

#### 7. Use page-appropriate structured data and repair the shared entity asset

- All 15 raw pages contain only the same `Organization` and `WebSite` types.
- The `Organization.logo` resolves to 404.
- There is no confirmed route-specific structured data in initial HTML.

**Fix:** first repair the logo. Then add only accurate, eligible types by page (for example, `SoftwareApplication` on a substantive product page, `FAQPage` only where visible FAQs meet Google requirements, and breadcrumbs when a visible breadcrumb hierarchy exists). Do not create markup unsupported by visible content.

### Low priority / governance

#### 8. Define an AI crawler policy in `robots.txt`

Current file:

```text
User-agent: *
Allow: /
Sitemap: https://hireflow.dev/sitemap.xml
```

This permits standard search crawlers and AI crawlers. That is not inherently a defect. Document whether HireFlow wants AI training/search crawling allowed, and add crawler-specific rules only after making that product/legal choice. Avoid accidentally blocking Googlebot or real-time citation crawlers.

#### 9. Evaluate IndexNow

No IndexNow implementation was confirmed. It is optional and does not affect Google. For faster discovery on Bing and other supporting engines, add a valid key and submit created/updated/deleted canonical URLs through a deployment hook. This is lower priority than fixing internal links and duplicates.

## Sitemap audit

### Confirmed validation results

| Check | Result |
|---|---|
| Location | `https://hireflow.dev/sitemap.xml` |
| HTTP / content type | 200, `application/xml` |
| Referenced in robots.txt | Yes |
| XML validity | Parsed successfully |
| URL count | 15 (well below 50,000) |
| Unique `<loc>` values | 15/15 |
| HTTPS only | 15/15 |
| Submitted URLs returning 200 | 15/15 |
| Noindex URLs included | 0/15 |
| Canonical mismatch within submitted set | 0/15 after normalizing the homepage slash |
| Redirected submitted URLs | 0/15 |
| Deprecated `<priority>` / `<changefreq>` | Not present |
| `<lastmod>` | Present on 15/15; every value is `2026-07-28` |

### Sitemap issue

All 15 URLs share the same `lastmod` date. This is valid XML, but it is useful only if every page actually changed materially that day. If generated from deployment time rather than content modification time, Google may learn to distrust it.

**Fix:** generate `lastmod` from each page's last substantive content update; omit it when the date cannot be maintained accurately. A sitemap index is unnecessary at this scale.

### Crawl-versus-sitemap coverage

The shared crawl was seeded from the sitemap and contains exactly the same 15 canonical URLs. Therefore it confirms sitemap URL health but **cannot prove** that the sitemap contains every indexable URL on the site. The near-absence of raw internal links prevents an independent site-graph comparison. Export routes from the application/build system or run a browser-rendered crawl to identify any orphan URL missing from the sitemap.

## Performance audit

### Provisional score: 64/100

No Lighthouse or field-data score is claimed. Both mobile and desktop PageSpeed Insights API calls returned **429 Too Many Requests**. Consequently:

- **LCP:** unverified
- **INP:** unverified
- **CLS:** unverified
- **Mobile/desktop Lighthouse performance:** unverified
- **CrUX 75th-percentile field data:** unavailable in this run

### Confirmed network observations (single-point, non-lab measurements)

| Resource | Status | Compressed transfer | TTFB | Cache |
|---|---:|---:|---:|---|
| Homepage HTML | 200 | 1,533 B | 61.8 ms | `max-age=0, must-revalidate` |
| Main JS | 200 | 121,000 B gzip | 81.1 ms | `max-age=0, must-revalidate` |
| Main CSS | 200 | 15,794 B gzip | 67.9 ms | `max-age=0, must-revalidate` |
| Paddle JS | 200 | 15,336 B compressed | 75.8 ms | third-party |

These four requests total approximately **153.7 KB transferred** in this one network check, excluding fonts and runtime-initiated requests. The main HTML was served from a Vercel cache hit during header checks. These timings are connectivity observations, **not** a substitute for browser loading or CWV.

### Performance positives

- HTML is very small and contains the primary text content.
- JS and CSS are gzip-compressed.
- Main JS is a module script, which does not block HTML parsing like a classic synchronous script.
- Asset filenames are fingerprinted.
- No raw-HTML `<img>` elements can delay LCP, though CSS/DOM visuals after JavaScript still require browser verification.

### Performance risks and fixes

1. **Revalidation on hashed assets:** implement one-year immutable caching.
2. **Main JS size:** 394 KB raw / 121 KB gzip is material for a small marketing site. Split pricing/checkout/application code away from public marketing routes and measure unused JavaScript.
3. **Paddle loaded globally:** a synchronous Paddle script appears in the `<head>` of every saved route. Load it only where checkout is needed or after user intent, while preserving correct payment flow behavior.
4. **Fonts:** CSS references six Syne WOFF2 files (Latin and Latin-ext, weights 600/700/800). Verify that only needed subsets/weights preload or load, apply `font-display: swap`, and consider variable/subset consolidation.
5. **Re-test:** run mobile and desktop Lighthouse plus CrUX/PSI after fixes. Use field p75 thresholds of LCP ≤2.5 s, INP ≤200 ms, and CLS ≤0.1. Do not use TBT as though it were INP.

## Image SEO audit

### Confirmed raw-HTML inventory

| Metric | Count | Status |
|---|---:|---|
| Crawled HTML pages | 15 | — |
| `<img>` elements | 0 | No content-image optimization surface in raw HTML |
| `<picture>` elements | 0 | No responsive image markup |
| Missing alt attributes | 0 confirmed | Not applicable because no raw `<img>` exists |
| Images missing dimensions | 0 confirmed | Not applicable |
| Lazy-loaded images | 0 | Not applicable |
| Broken shared social/schema image | 1 asset / 15 affected pages | Fail |
| `vite.svg` favicon references | 15 | Warn; placeholder branding |

The CSS contained font URLs but no confirmed CSS background-image URL. Browser-created images after React execution were not inspected, so **rendered image counts, alt text, dimensions, lazy loading, and LCP image behavior remain unverified**.

### Image priorities

1. Publish/fix the broken social image and a dedicated organization logo.
2. Replace the generic `/vite.svg` favicon with branded favicon assets and a web app manifest where appropriate.
3. If product screenshots, team imagery, or diagrams are added, use descriptive filenames and alt text, explicit width/height (or reserved aspect ratio), AVIF/WebP with a fallback, responsive `srcset`/`sizes`, and lazy loading only below the fold.
4. Do not lazy-load the LCP/hero image. If an image becomes LCP, make it discoverable in initial HTML and consider `fetchpriority="high"` after measurement.
5. Consider an image sitemap only if valuable images are added and are difficult for crawlers to discover; it is unnecessary for the current raw-HTML inventory.

## Exact affected URL sets

### Broken OG/Twitter/schema image (15)

`/`, `/about`, `/ai-disclosure`, `/ai-resume-screening`, `/automated-candidate-shortlisting`, `/bulk-resume-analysis`, `/contact`, `/cookie-policy`, `/help`, `/pricing`, `/privacy`, `/refund-policy`, `/resume-scoring-ai`, `/terms`, `/trust`.

### Zero raw internal links (14)

`/about`, `/ai-disclosure`, `/ai-resume-screening`, `/automated-candidate-shortlisting`, `/bulk-resume-analysis`, `/contact`, `/cookie-policy`, `/help`, `/pricing`, `/privacy`, `/refund-policy`, `/resume-scoring-ai`, `/terms`, `/trust`.

### Confirmed duplicate 200 variants (examples tested)

- `https://www.hireflow.dev/`
- `https://hireflow.dev/about/`

The test sampled one trailing-slash route; apply a sitewide redirect rule and verify every route rather than assuming only `/about/` is affected.

## Verification plan after implementation

1. Request the broken/fixed image URLs directly and validate 200 status, correct content type, dimensions, and cache headers.
2. Crawl apex/www, HTTP/HTTPS, and slash/no-slash variants; require one-hop redirects to a single canonical form.
3. Run both a raw-HTML crawler and a browser-rendered crawler. Compare titles, canonicals, robots, schema, H1/body copy, and link graphs.
4. Confirm every canonical page is reachable in three clicks and the sitemap contains only canonical 200/indexable URLs.
5. Run PSI/Lighthouse mobile and desktop, record LCP/CLS and lab TBT, and use CrUX for p75 LCP/INP/CLS when available.
6. Validate all structured data after the logo repair.

## Limitations

- The shared crawl contains only sitemap-seeded pages, so it is not an exhaustive independent discovery crawl.
- No authenticated application area was tested.
- Browser-rendered DOM, mobile layout, touch targets, horizontal overflow, console errors, and runtime-created assets were not available in the evidence set.
- PageSpeed Insights was quota-blocked with 429; no Lighthouse/CrUX/CWV values were fabricated.
- Search Console index status, crawl statistics, manual actions, server logs, and IndexNow submission history were unavailable.
- Header/timing checks are point-in-time observations from one network location and are not user-experience measurements.

