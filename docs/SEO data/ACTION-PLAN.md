# HireFlow SEO Action Plan

**Starting health score:** 43/100  
**Primary objective:** Make every commercial and trust page fully understandable, discoverable, trustworthy, and actionable without depending on client-side rendering.

## Phase 1 — Stabilize discovery and entity assets (0–48 hours)

| Action | Priority | Owner | Effort | Definition of done |
|---|---|---|---:|---|
| Publish working organization logo and 1200×630 OG image | High | Design + engineering | 2–4h | Both URLs return 200 with correct image content type; schema/meta updated |
| Replace `/vite.svg` favicon | Medium | Design + engineering | 1–2h | Branded favicon set and manifest deployed |
| Redirect all `www` URLs to apex | High | Engineering | 1–2h | One-hop 301/308 to `https://hireflow.dev/...` |
| Enforce no-trailing-slash policy | High | Engineering | 2–4h | Every tested slash variant redirects once to canonical |
| Correct sitemap `lastmod` generation | Medium | Engineering | 2–4h | Dates reflect substantive per-page updates or are omitted |

## Phase 2 — Fix rendering and internal discovery (week 1)

| Action | Priority | Owner | Effort | Definition of done |
|---|---|---|---:|---|
| Static-pre-render or SSR full public pages | High | Engineering | 2–5d | Core copy, headings, CTAs, links, and schema appear in raw HTML |
| Pre-render header and footer navigation | High | Engineering | 1–2d | Every important page reachable via normal `<a href>` links |
| Add contextual internal links | High | SEO + content | 1d | Commercial, pricing, trust, disclosure, and help pages interlinked |
| Split marketing/application/checkout bundles | Medium | Engineering | 1–3d | Marketing pages do not ship unnecessary app/checkout code |
| Load Paddle only when needed | Medium | Engineering | 0.5–1d | No parser-blocking Paddle request on unrelated pages |
| Cache hashed assets immutably | Medium | Engineering | 1–2h | One-year immutable cache for fingerprinted JS/CSS/fonts |
| Add tested security headers | Medium | Engineering/security | 1–2d | CSP, nosniff, referrer, permissions, and frame policy deployed |

## Phase 3 — Build pages that satisfy commercial intent (weeks 2–4)

### Homepage

- Use a category-explicit H1.
- Explain the product, target teams, workflow, and differentiator above the fold.
- Link to all four feature pages, pricing, trust, and a real demo destination.
- Add product screenshots, a concise workflow, responsible-AI summary, proof, FAQ, and two-stage CTAs.

### `/ai-resume-screening`

- Own the category-level query.
- Explain inputs, screening workflow, ranked output, human review, safeguards, and integrations.
- Add a redacted sample result and an indexable demo/transcript.

### `/bulk-resume-analysis`

- Focus on high-volume workflows, supported file types, job-based grouping, batch limits, exports, and operational outcomes.
- Show a batch review screen or annotated diagram.

### `/resume-scoring-ai`

- Explain scoring criteria, weighting/configuration, uncertainty, limitations, and why a reviewer can override or question a result.
- Include methodology and evaluation evidence.

### `/automated-candidate-shortlisting`

- Focus on shortlist creation, review collaboration, explainable rationale, handoff to hiring managers, and ATS/export compatibility.

### Trust and policy routes

- Expand `/trust`, `/ai-disclosure`, `/privacy`, `/terms`, `/refund-policy`, and `/contact`.
- Include effective dates, revision history, accountable contact information, human oversight, prohibited uses, retention/deletion, subprocessors/model providers, bias evaluation, incident response, and customer responsibilities.
- Separate current controls from planned capabilities.

## Phase 4 — Structured data and AI-readiness (weeks 2–4)

| Action | Priority | Effort | Definition of done |
|---|---|---:|---|
| Add connected `WebPage` nodes | Medium | 0.5–1d | Each route has a unique entity linked to the site graph |
| Add `WebApplication` product entity | Medium | 0.5–1d | Visible product details and truthful structured fields match |
| Add `Offer` nodes on pricing | Medium | 0.5d | Price, currency, URL, and terms match the visible plans |
| Add `ContactPage` and verified contact details | Medium | 0.5d | Contact schema matches the page and organization |
| Validate deployed markup | Medium | 2–4h | No critical Schema.org or Rich Results errors |
| Publish `/llms.txt` | Low | 1–2h | File points only to substantive, canonical pages |

## Phase 5 — Authority and content growth (months 2–3)

- Publish 4–6 expert resources around AI screening governance, structured evaluation, scoring methodology, candidate review, and high-volume recruiting.
- Add named authors/reviewers with relevant credentials and official profiles.
- Produce at least two evidence-led case studies with sample size, baseline, period, outcome, and limitations.
- Publish an evaluation or benchmark methodology that others can cite.
- Build legitimate partnerships and integrations; earn mentions from HR/recruiting communities, software directories, and subject-matter publications.
- Use `HireFlow.dev` consistently to reduce confusion with unrelated “HireFlow” brands.

## Internal-link blueprint

| Source | Required links |
|---|---|
| Homepage | All 4 feature pages, pricing, trust, AI disclosure, demo |
| Feature pages | Pricing, trust, disclosure, demo, 1–2 adjacent feature pages |
| Pricing | Feature matrix, trial/refund terms, privacy, contact |
| Trust | AI disclosure, privacy, terms, contact, methodology |
| AI disclosure | Trust, privacy, scoring methodology, contact |
| Help | Relevant feature guides, privacy, contact |

Use descriptive anchor text. Avoid relying on click handlers or buttons when the action is navigation.

## Verification checklist

- [ ] Logo and social images return 200.
- [ ] `www`, HTTP, and slash variants redirect once to canonical URLs.
- [ ] Full core content appears with JavaScript disabled.
- [ ] Every important page is reachable in three clicks.
- [ ] Raw and rendered canonicals, robots, titles, H1s, schema, and links match.
- [ ] Sitemap includes only canonical 200/indexable URLs.
- [ ] Rich Results Test and Schema.org Validator pass.
- [ ] Mobile Lighthouse and desktop Lighthouse recorded.
- [ ] CrUX p75 monitored for LCP ≤2.5s, INP ≤200ms, CLS ≤0.1.
- [ ] Google Search Console sitemap submitted.
- [ ] Homepage plus four commercial URLs inspected and requested for indexing.
- [ ] Organic demo/trial events tracked in analytics.

## KPI targets for the next 90 days

Establish baselines before setting absolute growth promises. Track:

- Valid indexed commercial pages.
- Non-brand impressions and clicks by target intent.
- CTR by landing page and query.
- Crawl requests and rendered/indexed parity.
- Organic demo starts, pricing visits, trial starts, and assisted revenue.
- Referring domains and authoritative mentions.
- CWV pass rate at the 75th percentile.
- AI citation/mention share for a fixed monthly prompt set.

## Recommended implementation sequence

1. Broken assets and redirects.
2. SSR/static pre-rendering and navigation.
3. Commercial and trust content.
4. Internal links and page-specific schema.
5. Performance/security hardening.
6. Search Console verification and reindexing.
7. Evidence-led authority building.

