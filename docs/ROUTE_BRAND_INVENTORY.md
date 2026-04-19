# Route Inventory + Brand Guideline Audit

Last updated: 2026-04-19  
Source inputs: `src/App.jsx`, route/page modules under `src/pages` + `src/components` used by routing, and all files in `src/admin/pages`.

## Priority Legend
- **P0 (high-traffic first):** Landing, Pricing, Checkout, Account, Admin Dashboard/Login/Users/Payments/Logs
- **P1:** core authenticated/product flows
- **P2:** legal/info/edge/admin detail flows

## User Route Inventory & Violations

| Priority | Route | Module | Color palette mismatch | Typography mismatch | Component / radius / shadow mismatch | Spacing / layout mismatch | Light-mode fragments |
|---|---|---|---|---|---|---|---|
| P0 | `/` | `src/components/LandingPage.jsx` | ⚠️ mixed accent shades in hotspots | ⚠️ inconsistent heading utility usage | ⚠️ mixed button/card treatments | ⚠️ mixed section padding scales | ⚠️ a few light utility fragments remain |
| P0 | `/pricing` | `src/pages/Pricing.jsx` | ✅ tokenized in this pass | ✅ uses tokenized font vars/classes | ✅ card/button styles moved to tokenized classes | ⚠️ scale emphasis still custom | ✅ removed light fragment styles in updated component |
| P0 | `/checkout` | `src/pages/Checkout.jsx` | ❌ hardcoded `#CCFF00`, `#a3a3a3`, and neutral grays | ⚠️ ad-hoc inline sizes/weights | ❌ many inline borders/radius/shadows | ❌ mostly inline layout primitives | ❌ explicit light-ish fragments and non-token surfaces |
| P0 | `/account` | `src/pages/AccountPage.jsx` | ❌ hardcoded hex usage in loading/error shells and content blocks | ⚠️ mixed defaults vs token text hierarchy | ❌ inline card/button styling patterns | ❌ inline spacing/grid throughout | ⚠️ isolated light-like fragments |
| P1 | `/billing` | `src/pages/BillingPage.jsx` | ⚠️ mostly token based; some ad-hoc values | ⚠️ mixed heading/body consistency | ❌ heavy inline panel/table styles | ❌ inline layout and spacing | ⚠️ modal overlay/card uses mixed conventions |
| P1 | `/billing/success` | `src/pages/BillingSuccess.jsx` | (not deeply audited in this pass) | - | - | - | - |
| P1 | `/billing/cancel` | `src/pages/BillingCancel.jsx` | (not deeply audited in this pass) | - | - | - | - |
| P1 | `/account/payment-method` | `src/pages/UpdatePaymentMethodPage.jsx` | (not deeply audited in this pass) | - | - | - | - |
| P1 | `/job-descriptions` | `src/pages/JobDescriptionPage.jsx` | ⚠️ mixed token + inline patterns via child forms | ⚠️ mixed text scales | ❌ inline form card/input styles in related components | ❌ inline layout in related components | ⚠️ small light utility traces |
| P1 | `/results/:shareToken` | `src/components/CandidateResults.jsx` | ⚠️ mixed historical colors | ⚠️ varies by section | ⚠️ mixed chip/card patterns | ⚠️ mixed spacing rules | ⚠️ traces |
| P2 | `/about` | `src/components/AboutPage.jsx` | ❌ many mixed/legacy values | ⚠️ many inline type rules | ❌ inline radius/shadow usage wide | ❌ extensive inline spacing/layout | ⚠️ mixed surfaces |
| P2 | `/contact` (stateful) | `src/components/ContactPage.jsx` | not fully audited | - | - | - | - |
| P2 | `/terms` | `src/pages/Terms.jsx` | ⚠️ mostly token colors | ⚠️ many inline typography declarations | ⚠️ inline panel styles | ⚠️ inline spacing | ✅ dark mode consistent |
| P2 | `/privacy` | `src/components/PrivacyPage.jsx` | not fully audited | - | - | - | - |
| P2 | `/refund-policy` | `src/pages/RefundPolicy.jsx` | not fully audited | - | - | - | - |
| P2 | `/verify-email/success` | `src/App.jsx` route state fragment | ✅ tokenized in this pass | ✅ standardized title/message classes | ✅ tokenized card/action styles | ✅ standardized state layout class | ✅ removed light-mode card/background |

## Admin Route Inventory & Violations

| Priority | Route | Module | Color palette mismatch | Typography mismatch | Component / radius / shadow mismatch | Spacing / layout mismatch | Light-mode fragments |
|---|---|---|---|---|---|---|---|
| P0 | `/admin`, `/admin/overview` | `src/admin/pages/AdminDashboard.jsx` | ⚠️ mostly admin tokens + slate utility mix | ⚠️ mixed utilities + custom headings | ⚠️ mixed primitives and utility cards | ⚠️ mixed spacing scales | ⚠️ slate/light utility fragments in cards |
| P0 | `/admin/login` | `src/admin/pages/AdminLoginPage.jsx` | ⚠️ uses admin tokens with some non-brand utility tones | ⚠️ minor inconsistencies | ⚠️ mixed form control treatments | ⚠️ mostly acceptable, some ad-hoc gaps | ⚠️ utility classes include lighter grays |
| P0 | `/admin/users` | `src/admin/pages/AdminUsersPage.jsx` | ⚠️ mostly tokenized tables, some utility residuals | ✅ mostly consistent | ✅ largely uses table primitives | ✅ mostly consistent | ⚠️ detail panels still use light utility surfaces |
| P0 | `/admin/billing` (payments + subscriptions) | `src/admin/pages/AdminPaymentsPage.jsx`, `src/admin/pages/AdminSubscriptionsPage.jsx` | ❌ `text-slate-900` and `border-slate-100` in refund history block | ⚠️ mixed heading classes | ⚠️ one-off list/card styling mixed with primitives | ⚠️ mixed spacing utilities | ❌ explicit light utility fragments |
| P0 | `/admin/logs` | `src/admin/pages/AdminLogsPage.jsx` | ⚠️ mostly tokenized, residual inline bar width only | ✅ mostly consistent | ⚠️ bar chart fill inline width only | ✅ mostly consistent | ⚠️ stack trace preview uses light utility background |
| P1 | `/admin/health` | `src/admin/pages/AdminHealthPage.jsx` | mostly aligned | mostly aligned | mostly aligned | mostly aligned | minor utility residuals |
| P1 | `/admin/analytics` | `src/admin/pages/AdminAnalyticsPage.jsx` | mixed token/utility | mixed | mixed | mixed | some light utility usage |
| P1 | `/admin/security` | `src/admin/pages/AdminSecurityPage.jsx` | mostly aligned | mostly aligned | mostly aligned | mostly aligned | minor residuals |
| P2 | `/admin/uploads` | `src/admin/pages/AdminUploadsPage.jsx` | mixed | mixed | mixed | mixed | mixed |
| P2 | `/admin/uploads/:uploadId` | `src/admin/pages/AdminUploadDetailsPage.jsx` | mixed | mixed | mixed | mixed | mixed |
| P2 | `/admin/users/:userId` | `src/admin/pages/AdminUserDetailsPage.jsx` | mixed | mixed | mixed | mixed | mixed |
| P2 | `/admin/setup-2fa`, `/admin/setup` | `src/admin/pages/AdminSetup2FA.jsx` | mixed | mixed | mixed | mixed | mixed |

## Inline-style Replacement Progress (this pass)

1. **Completed now**
   - Replaced inline route-state styles in `src/App.jsx` with tokenized class-driven styles in `src/styles/app-route-states.css`.
   - Replaced inline pricing page/card styles in `src/pages/Pricing.jsx` with tokenized class-driven styles in `src/styles/pricing.css`.
2. **Queued next (highest impact)**
   - `src/pages/Checkout.jsx`
   - `src/pages/AccountPage.jsx`
   - `src/admin/pages/AdminPaymentsPage.jsx` (light utility fragments in refund list)
   - `src/components/LandingPage.jsx`

