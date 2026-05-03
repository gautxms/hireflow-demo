# MODERNIZATION_PLAN

[LandingPage] — /
File: src/components/LandingPage.jsx
Overall: ❌
DimensionStatusIssue
Layout⚠️Sections are clear but spacing density varies between hero/features/proof blocks.
Typography❌Uses display styling beyond hero and inconsistent heading scale.
Components⚠️Card/button patterns partly match, but mixed legacy styles remain.
Icons❌Emoji icons are used in feature cards instead of lucide-react.
Color⚠️Mix of tokenized colors and hardcoded values in page stylesheet.
Spacing⚠️Inconsistent vertical rhythm between sections and cards.
UX✅Core CTA flow is clear (signup/demo) and discoverable.
Polish⚠️No explicit loading/error/empty states for dynamic sections.
Tasks:
- [x] TASK-LANDING-01: Replace emoji feature icons in src/components/LandingPage.jsx with lucide-react icons (size=18, strokeWidth=1.5) and align icon wrappers to constitution icon tokens.
- [x] TASK-LANDING-02: Normalize heading hierarchy so Syne 800 is used only for hero H1; move all other headings to DM Sans with constitution scale.
- [x] TASK-LANDING-03: Remove hardcoded color literals from src/styles/landing.css and map to shared CSS variables.
Effort: Medium (30–90 min)
Priority: P1 Critical

[Pricing] — /pricing
File: src/pages/Pricing.jsx
Overall: ⚠️
DimensionStatusIssue
Layout✅Logical top-down plan comparison and CTA structure.
Typography⚠️Mostly consistent, but some marketing headings diverge from canonical scale.
Components⚠️Pricing cards/buttons are close but need full pattern parity.
Icons✅No obvious non-lucide icon regressions in page component.
Color⚠️Some direct color usage in pricing styles instead of variables.
Spacing⚠️Card gutters and section spacing vary across breakpoints.
UX✅Plan selection and upgrade intent are clear.
Polish⚠️State handling for failed billing/checkout transitions is light.
Tasks:
- [x] TASK-PRICING-01: Audit src/pages/Pricing.jsx + src/styles/pricing.css for hardcoded colors and convert to theme variables.
- [x] TASK-PRICING-02: Standardize pricing card paddings, border radii, and button styles to constitution card/button patterns.
Effort: Medium (30–90 min)
Priority: P2 High

[Auth Pages (Login/Signup/Forgot/Reset/Verify)] — /login, /signup, /forgot-password, /reset-password, /verify-email
File: src/components/LoginPage.jsx; src/components/SignupPage.jsx; src/pages/ForgotPasswordPage.jsx; src/pages/ResetPasswordPage.jsx; src/pages/VerifyEmailPage.jsx; src/pages/VerifyEmail.jsx
Overall: ⚠️
DimensionStatusIssue
Layout✅Forms are simple and linear.
Typography⚠️Auth shared styles are close but have small weight/size drift.
Components⚠️Input/button variants are not fully unified with constitution tokens.
Icons✅No emoji/custom SVG issues in core auth pages.
Color⚠️AuthPage.css includes several non-token border/text shades.
Spacing✅Reasonable form spacing and readability.
UX⚠️Error/help messaging consistency varies by page.
Polish⚠️Some pages feel minimally styled vs main marketing/app surfaces.
Tasks:
- TASK-AUTH-01: Consolidate auth form styles in src/components/AuthPage.css to exact typography, input, button, and color token standards.
- TASK-AUTH-02: Normalize validation, loading, and error copy placement across all auth page components.
Effort: Medium (30–90 min)
Priority: P2 High

[App Shell Pages (Dashboard/Analyses/Candidates/Reports/Account/Settings/Billing)] — /dashboard, /analyses, /analyses/:id, /candidates, /candidates/:id, /reports, /account, /settings, /billing
File: src/components/Dashboard.jsx; src/components/NewDashboard.jsx; src/pages/AnalysesPage.jsx; src/pages/AnalysisDetailPage.jsx; src/pages/CandidatesPage.jsx; src/pages/CandidateDetailPage.jsx; src/pages/ReportsPage.jsx; src/pages/AccountPage.jsx; src/pages/AccountSettingsPage.jsx; src/components/SettingsPage.jsx; src/pages/BillingPage.jsx
Overall: ⚠️
DimensionStatusIssue
Layout⚠️Overall shell is good, but legacy/new page internals use mixed spacing systems.
Typography⚠️Several KPI/stat headers and labels deviate from constitution weights/sizes.
Components⚠️Card styles differ between legacy dashboard, new dashboard, and reports/candidates pages.
Icons❌Custom inline SVG charts exist in dashboard pages; should migrate iconography usage patterns.
Color⚠️Frequent hardcoded hex values in component CSS and inline styles.
Spacing⚠️Intra-card spacing and section paddings are inconsistent.
UX✅Main workflows are understandable and navigable.
Polish⚠️Some states are polished; others appear utilitarian and uneven.
Tasks:
- TASK-APP-01: Unify card/button/input primitives across app pages by introducing shared utility classes/tokens and removing per-page drift.
- TASK-APP-02: Replace decorative inline SVG usages in src/components/NewDashboard.jsx with standardized chart/component primitives aligned with design system.
- TASK-APP-03: Audit all app page stylesheets for hardcoded hex/border values and replace with theme variables.
Effort: Large (90+ min)
Priority: P1 Critical

[Billing Flow Pages] — /checkout, /billing/success, /billing/cancel, /account/payment-method
File: src/pages/Checkout.jsx; src/pages/BillingSuccess.jsx; src/pages/BillingCancel.jsx; src/pages/UpdatePaymentMethodPage.jsx
Overall: ⚠️
DimensionStatusIssue
Layout✅Flow sequence and page purpose are clear.
Typography⚠️Shared checkout/billing text scales vary slightly.
Components⚠️Button and status callout styles are inconsistent across success/cancel/update states.
Icons✅No major icon-library violations observed.
Color⚠️Billing/checkout styles include repeated hardcoded success/warning shades.
Spacing⚠️Status cards and action areas have uneven vertical spacing.
UX⚠️Recovery paths are present but could be clearer and more prominent.
Polish⚠️Outcome pages feel less refined than primary app surfaces.
Tasks:
- TASK-BILLING-01: Create a shared billing-status layout component for success/cancel/update pages for consistent hierarchy and CTA placement.
- TASK-BILLING-02: Refactor src/styles/billing.css and src/styles/checkout.css to use semantic color variables for status states.
Effort: Medium (30–90 min)
Priority: P2 High

[Static Policy/Info Pages] — /terms, /refund-policy, /about, /help
File: src/pages/Terms.jsx; src/pages/RefundPolicy.jsx; src/components/AboutPage.jsx; src/components/HelpPage.jsx
Overall: ⚠️
DimensionStatusIssue
Layout✅Readable document-like structure.
Typography⚠️Long-form text scale/line-height and heading hierarchy are not fully normalized.
Components⚠️Minimal componentization; repeated section wrappers.
Icons✅No obvious icon regressions.
Color✅Mostly compliant dark surfaces and text contrast.
Spacing⚠️Paragraph/block spacing varies between pages.
UX✅Content discoverable and understandable.
Polish⚠️Looks functional but not systematized.
Tasks:
- TASK-STATIC-01: Introduce a shared “content document” layout wrapper for policy/info pages to unify spacing and typography.
- TASK-STATIC-02: Apply consistent heading and list styling using constitution typography tokens.
Effort: Small (< 30 min)
Priority: P3 Medium

[State Modules and Tests] — n/a (logic)
File: src/pages/checkoutState.js; src/pages/checkoutState.test.js; src/pages/jobDescriptionSubmissionState.js; src/pages/jobDescriptionSubmissionState.test.js
Overall: ✅
DimensionStatusIssue
Layout✅Not UI-rendered pages.
Typography✅Not applicable.
Components✅Not applicable.
Icons✅Not applicable.
Color✅Not applicable.
Spacing✅Not applicable.
UX✅State transitions are explicit and test-backed.
Polish✅Tests improve confidence in flow robustness.
Tasks:
- TASK-STATE-01: Keep state-machine contract docs adjacent to modules to ensure UI pages implement states consistently.
Effort: Small (< 30 min)
Priority: P4 Low

Summary
PageIssuesPriorityEffort
LandingPage3 major issuesP1Medium
App Shell Pages4 major issuesP1Large
Auth Pages3 issuesP2Medium
Pricing2 issuesP2Medium
Billing Flow Pages3 issuesP2Medium
Static Policy/Info Pages2 issuesP3Small
State Modules1 minor issueP4Small

Recommended execution order
1. LandingPage + App Shell Pages (P1): highest visual inconsistency and icon/compliance gaps.
2. Billing Flow + Auth + Pricing (P2): conversion-critical journeys with medium effort standardization.
3. Static Policy/Info Pages (P3): low risk consolidation after core flows.
4. State modules/tests docs (P4): maintenance cleanup.

Global fixes (apply across all pages at once)
- Create a single typography utility layer that enforces Syne-only hero H1 and DM Sans everywhere else.
- Replace remaining hardcoded color values with shared CSS variables from the global token set.
- Enforce icon contract: lucide-react only, size=18 and strokeWidth=1.5 via shared Icon wrapper.
- Unify card/button/input primitives into reusable classes/components consumed by both public and app pages.
