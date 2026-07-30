# HireFlow Structured Data, GEO, and Visual/Mobile Specialist Audit

**Site:** https://hireflow.dev  
**Evidence date:** 2026-07-30  
**Shared crawl:** `C:\Users\admin\hireflow-seo-audit\crawl-data\crawl.json` and 15 saved HTML responses  
**Additional live checks:** `robots.txt`, `llms.txt`, RSL endpoints, referenced assets, front-end CSS, and the linked LinkedIn profile

## Executive summary

HireFlow has a valid baseline: all 15 crawled pages return server-visible content, include parseable JSON-LD, and expose one H1. The site-wide `Organization` and `WebSite` entities use stable `@id` values, and `robots.txt` allows all crawlers.

The baseline is not yet competitive for rich results or AI citation. The same generic schema graph is repeated on every page without page-specific entities, the declared logo and social image return 404, and the product and pricing pages omit `WebApplication`/`Offer` markup. GEO readiness is constrained much more severely by content: 13 of 15 source responses contain only 12–20 words, the pricing page contains 35 words, and the homepage contains 74. There are no self-contained answer passages, attributed claims, authored resources, source-visible images, video embeds, or comparison tables.

Rendered visual/mobile quality could not be audited because browser automation and screenshots were unavailable. Source-level signals are directionally positive—viewport metadata, responsive CSS, and 44px minimum-size declarations exist—but these do not prove above-the-fold visibility, absence of horizontal overflow, readable font sizes, or adequate touch targets in the rendered interface.

## Category scores

| Category | Score | Confidence | Interpretation |
|---|---:|---|---|
| Structured data | **46/100** | High | Valid site entities, but broken image references and almost no page/product/commercial schema coverage |
| AI search / GEO readiness | **30/100** | High for on-site factors; medium for off-site visibility | Crawlable, but far too little citable content or authority evidence |
| Visual/mobile rendered experience | **N/A** | Not evaluated | Browser and screenshot evidence unavailable |
| Source-code mobile readiness indicator | **55/100 provisional** | Medium | Responsive implementation signals exist; this is not a visual UX score |

No combined specialist score is calculated because substituting a guessed rendered-visual score would misrepresent the evidence.

## 1. Structured data audit

### Confirmed detection and validation

| Test | Result | Status |
|---|---|---|
| JSON-LD present | One JSON-LD block on each of 15 pages | Pass |
| JSON syntax | All 15 blocks parse successfully | Pass |
| Format | JSON-LD in initial HTML | Pass |
| Types found | `Organization`, `WebSite` | Pass, but limited |
| `@context` | `https://schema.org` | Pass |
| Stable entity IDs | `https://hireflow.dev/#organization` and `#website` | Pass |
| Absolute URLs | Used in inspected schema | Pass |
| Microdata | None detected | Informational |
| RDFa | None detected | Informational |
| Deprecated types | None detected | Pass |
| Page-specific schema | None across the 15-page crawl | Fail |
| Declared logo URL | `https://hireflow.dev/og-default.png` returns **404** | Fail |

All 15 pages use the same graph:

- `Organization`: `name`, `alternateName`, `url`, `logo`, `description`, and one LinkedIn `sameAs`.
- `WebSite`: `name`, `url`, `publisher`, and the same LinkedIn `sameAs`.

The graph is structurally valid, but its broken `logo` undermines entity integrity. The same missing file is also used for `og:image` and `twitter:image` on every crawled page, so this is both a structured-data and social-preview defect.

### Missing schema opportunities

| Page or template | Recommended entity | Why |
|---|---|---|
| Homepage/product graph | `WebApplication` linked to the `Organization` | HireFlow is presented as a browser-based recruiting platform; expose category, feature list, URL, and truthful offers |
| `/pricing` | `WebApplication` + `Offer` entries | Source HTML states `$99/month`, `$999/year`, a 7-day trial, and up to 800 analyses/month; these can be represented when terms are accurate and kept current |
| Every indexable page | `WebPage` linked with `isPartOf` and `about`/`mainEntity` where applicable | Distinguishes each page from the repeated site-level graph |
| `/contact` | `ContactPage`; add verified `contactPoint` to `Organization` | Improves page/entity meaning and support discoverability |
| Navigational templates | `BreadcrumbList`, only if breadcrumbs exist visibly | Adds machine-readable hierarchy; markup must mirror visible navigation |
| Future authored resources | `Article`/`BlogPosting` + `Person` | Appropriate only after publishing substantial, dated, attributed content |

Do not add fabricated ratings, reviews, awards, customer counts, or performance claims. Do not add `FAQPage` for expected Google rich results: HireFlow is a commercial site and FAQ rich results are restricted to government and healthcare authority sites. Plain-language FAQ content can still help users and AI passage retrieval without FAQ schema.

### Structured-data recommendations

1. **Restore or replace `https://hireflow.dev/og-default.png` immediately.** Use a crawlable, stable, absolute image URL and confirm a 200 response. Prefer a dedicated logo asset for `Organization.logo` and a separate 1200×630 social image for Open Graph.
2. **Create a linked homepage graph** containing `Organization`, `WebSite`, `WebPage`, and `WebApplication`. Reuse stable `@id` values rather than duplicating disconnected entities.
3. **Add truthful `Offer` nodes on `/pricing`.** Include `price`, `priceCurrency`, billing period/description, URL, and availability only when those values match the visible plan.
4. **Emit page-specific `WebPage`/`ContactPage` nodes in initial HTML.** Keep the global organization graph, but do not let it be the only meaning exposed on every route.
5. **Expand verified entity details.** Add a real logo, verified support/contact details, legal name if different, and additional official `sameAs` profiles only after those profiles exist.
6. Validate the deployed graph with Schema.org Validator and Google Rich Results Test after implementation. Automated local JSON parsing confirms syntax, not Google eligibility.

## 2. AI search / GEO readiness

### Weighted readiness assessment

| GEO factor | Points | Evidence |
|---|---:|---|
| Passage-level citability | **3/25** | No 134–167-word self-contained answer blocks; nearly all routes are extremely thin |
| Structural readability | **5/20** | Homepage has H1/H2/H3 structure; the other 14 pages expose only one H1 in source |
| Multi-modal content | **1/15** | No images, video, iframe, chart, or table in the saved initial HTML; declared social image is missing |
| Authority and brand signals | **7/20** | Trust and AI disclosure routes and a verified LinkedIn profile exist, but content is minimal and has no authors, dates, sources, credentials, or original research |
| Technical accessibility | **14/20** | Core content and JSON-LD are server-visible; robots broadly allows crawlers; `llms.txt` and RSL are absent |
| **Total** | **30/100** | Low readiness |

### AI crawler access

Live `https://hireflow.dev/robots.txt` returned:

```text
User-agent: *
Allow: /
Sitemap: https://hireflow.dev/sitemap.xml
```

**Confirmed:** GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, CCBot, anthropic-ai, Bytespider, and cohere-ai are not specifically blocked and inherit the wildcard allow rule.

This is positive for AI search discovery. It also means training-oriented crawlers such as CCBot are allowed. Whether to block training crawlers while retaining search/indexing crawlers is a business and licensing choice, not an automatic SEO fix.

### `llms.txt` and licensing status

| Endpoint | Live result | Interpretation |
|---|---:|---|
| `/llms.txt` | 404 | Missing |
| `/.well-known/rsl` | 404 | No RSL file detected at this checked endpoint |
| `/rsl.txt` | 404 | No RSL file detected at this checked endpoint |

`llms.txt` is an emerging discovery aid, not a substitute for crawlable pages or a guaranteed ranking signal. Implement it after substantive pages exist. Suggested initial structure:

```text
# HireFlow
> AI-assisted resume screening and candidate-ranking software for recruiter-led hiring decisions.

## Product
- [AI Resume Screening](https://hireflow.dev/ai-resume-screening): How HireFlow evaluates resumes against role requirements.
- [Automated Candidate Shortlisting](https://hireflow.dev/automated-candidate-shortlisting): Structured ranking and reviewer rationale.
- [Bulk Resume Analysis](https://hireflow.dev/bulk-resume-analysis): Batch resume analysis for high-volume hiring.
- [Resume Scoring AI](https://hireflow.dev/resume-scoring-ai): Role-aware scoring and human review.
- [Pricing](https://hireflow.dev/pricing): Current plans, trial terms, and usage limits.

## Trust and governance
- [Trust and Responsible AI](https://hireflow.dev/trust): Safeguards, limitations, and recruiter responsibilities.
- [AI Disclosure](https://hireflow.dev/ai-disclosure): How AI supports rather than replaces hiring decisions.
- [Privacy](https://hireflow.dev/privacy): Data processing and deletion information.

## Company
- [About](https://hireflow.dev/about): Company and product purpose.
- [Contact](https://hireflow.dev/contact): Product, sales, support, and privacy contact.
```

Only include summaries and claims supported by the linked pages. RSL can be considered if HireFlow wants machine-readable AI-use licensing terms; its absence is informational, not a conventional organic-search defect.

### Server-side delivery and citability

The site uses a Vite/React JavaScript bundle, but the saved responses include an H1 and basic page copy before JavaScript runs. This is better than an empty client-only shell. The reliably server-visible content is nevertheless insufficient:

- Homepage: **74 words**, with H1, H2, and three H3 headings.
- Pricing: **35 words**.
- Thirteen pages: **12–20 words** each.
- Fourteen of 15 pages have only an H1 in the source response.
- No saved page includes an optimal-length, self-contained answer passage.
- No saved page includes an attributed statistic, external citation, named expert, publication date, or last-updated date.

AI crawlers that do not execute the JavaScript bundle can reliably retrieve only this minimal source content. Any richer hydrated content is unverified and should not be relied on for AI discovery.

### Brand/entity signals

**Confirmed:**

- The schema links to `https://www.linkedin.com/company/hireflow-dev/`.
- That URL returned 200 and describes HireFlow as AI resume screening and candidate-ranking software.
- The LinkedIn metadata reported **3 followers** at audit time.
- Exact-domain searches surfaced the official site, but the broader brand name is shared by multiple unrelated recruiting/career products on other domains.

**Not found in sampled web searches (not proof of absence):**

- A HireFlow.dev-specific Wikipedia or Wikidata entity.
- HireFlow.dev-specific Reddit discussion.
- HireFlow.dev-specific YouTube content.
- Independent reviews or authoritative editorial mentions tied clearly to this domain.

The crowded “HireFlow” name creates entity-disambiguation risk. AI systems may conflate `hireflow.dev` with unrelated companies unless the site and official profiles consistently use the domain, legal/company identity, product description, logo, and linked social entities.

### Platform readiness

| Platform | Score | Main constraint |
|---|---:|---|
| Google AI Overviews | **33/100** | Crawlable pages, but thin content and weak traditional ranking/citation assets |
| ChatGPT search | **28/100** | Minimal entity footprint, no citable resources, and brand-name ambiguity |
| Perplexity | **25/100** | No sampled community validation or third-party sources and very little extractable detail |

These are readiness estimates based on observable signals, not measured citation share. No platform prompt-tracking dataset or authenticated AI visibility tool was available.

### Highest-impact GEO changes

1. **Turn each product page into a complete answer resource.** Start with a direct 40–60-word answer, then add workflow, inputs/outputs, reviewer controls, limitations, use cases, and a comparison table. Break core explanations into self-contained 134–167-word passages.
2. **Publish evidence, not generic claims.** Add documented methodology, evaluation criteria, anonymized test results, security/data-flow details, and clearly sourced recruiting research. Attribute every statistic to a primary source.
3. **Build trust-page depth.** On `/trust` and `/ai-disclosure`, explain human oversight, prohibited uses, bias testing, data retention, model/provider boundaries, appeal/review processes, and known limitations. Date and version these disclosures.
4. **Create authored expert resources.** Add named authors/reviewers, credentials, publication and update dates, bios, and links to official profiles. Useful topics include AI screening governance, structured shortlisting, and evaluating resume-ranking systems.
5. **Strengthen entity consistency and third-party corroboration.** Use the same `HireFlow.dev` identity and logo on the website and official profiles; earn legitimate mentions through expert commentary, research, product demonstrations, and customer evidence. Do not manufacture Reddit posts, reviews, or Wikipedia coverage.
6. **Add useful multimodal evidence.** Product screenshots, captioned workflow diagrams, a transcript-backed demo, and comparison tables can improve comprehension and provide extractable context.
7. **Publish `/llms.txt` after the content expansion.** Keep it concise and current; do not treat it as a shortcut around weak pages.

## 3. Visual and mobile evidence

### Confirmed source-level signals

- All crawled pages include `width=device-width, initial-scale=1.0`.
- The production CSS returned 200 and contains 24 `@media` rules and multiple `max-width` breakpoints.
- The CSS includes `min-height: 44px` and `min-width: 44px` declarations somewhere in the stylesheet.
- The homepage initial HTML contains a semantic `<main>`, visible text H1, product description, primary pricing link, secondary demo button, and feature headings.
- The homepage hero CSS includes viewport-relative sizing and responsive variants.
- All 15 saved HTML responses contain one H1.
- The initial HTML parser found no `<img>`, `<video>`, or `<iframe>` elements on any crawled page.
- The globally declared social image returns 404.

### Unverified because rendering was unavailable

- Whether the H1 and primary CTA are actually above the fold at desktop and mobile viewports.
- Whether the very large `clamp()` hero typography wraps or clips on narrow screens.
- Whether any route has horizontal scrolling.
- Which interactive controls receive the 44px minimum sizing rules in the rendered DOM.
- Actual smallest font sizes, contrast, focus states, or tap-target spacing.
- Cookie banners, checkout UI, navigation, modal behavior, hydration shifts, and cumulative layout movement.
- Whether client-side rendering adds images, video, navigation, or substantial content after hydration.
- Whether the “Watch demo” control opens accessible media and has a transcript.

### Visual/mobile recommendations

1. Restore the missing social image and use route-specific 1200×630 preview images for priority landing pages.
2. Run screenshots at a minimum of 360×800, 390×844, 768×1024, 1440×900, and 1920×1080.
3. At each viewport, verify H1/CTA visibility, no horizontal overflow, body text of at least 16px, touch targets of at least 44×44px, keyboard focus, and adequate contrast.
4. Test the hero’s 58–120px responsive headline specifically at 320–390px widths for clipping and excessive above-the-fold displacement.
5. Confirm the pricing CTA and “Watch demo” button remain visible, operable, and correctly labeled without JavaScript failure.
6. Add meaningful product visuals with dimensions or aspect ratios reserved to avoid layout shift. Use descriptive alt text for informative images and empty alt text for decorative elements.
7. Rerun the visual specialist with an actual browser before treating the mobile experience as passed.

## Prioritized issue register

| Priority | Status | Issue | Why it matters | Recommended action |
|---|---|---|---|---|
| P0 | Confirmed | Declared organization logo and all-page social image return 404 | Invalid entity image and broken social previews | Deploy valid logo/social assets and update schema/meta references |
| P0 | Confirmed | 13/15 pages have only 12–20 source words; no page exceeds 74 | Little information for ranking, passage retrieval, or citation | Build substantive, structured, evidence-backed page content |
| P1 | Confirmed | Same generic schema repeated on all pages | Product, offer, contact, and page meaning are not represented | Add linked `WebApplication`, `Offer`, `WebPage`, and `ContactPage` nodes |
| P1 | Confirmed | No citable evidence, sources, authors, or update dates | Weak authority and extraction signals | Publish attributed expert content, methodology, and original evidence |
| P1 | Confirmed | `/llms.txt` missing | Missed optional AI discovery aid | Add a curated file after content expansion |
| P1 | Confirmed | Brand-name collision and very small verified external footprint | AI systems may conflate unrelated HireFlow entities | Standardize HireFlow.dev identity and earn legitimate corroborating mentions |
| P1 | Confirmed in initial HTML | No source-visible image, video, table, or chart | Weak comprehension and multimodal citation support | Add useful product media, tables, captions, and transcripts |
| P1 | Unverified | Rendered mobile/visual behavior not tested | Significant UX defects could remain undetected | Run browser screenshots and interaction checks |
| P2 | Confirmed | RSL endpoints absent | No machine-readable AI-use licensing terms | Evaluate RSL based on business licensing policy |
| P2 | Confirmed | CCBot and other training crawlers are allowed | May conflict with content-use policy | Separate search-crawler access from training-crawler policy if desired |

## Evidence limitations

- Browser automation and screenshot capture were unavailable; no rendered visual result is claimed.
- Search-result sampling is not exhaustive and cannot prove that an off-site mention does not exist.
- Schema syntax was parsed locally and field URLs were spot-checked, but Google and Schema.org hosted validators were not run.
- AI platform scores are readiness estimates, not live citation-frequency measurements.
- Saved crawl HTML is the authoritative evidence for initial server responses. Client-hydrated UI may contain more material, but that material was not assumed to be available to non-JavaScript AI crawlers.

