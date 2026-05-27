# Epic 6 — QA/UAT and rollout

## Purpose
Define release-readiness validation and phased rollout controls for shortlist flows so the feature can ship with measurable quality, consistency, and low operational risk.

---

## Task 6.1 — Scenario-based QA matrix

### Outcome
A complete, repeatable scenario matrix validating shortlist behavior across core and edge-case user journeys.

### Scope
The matrix covers these required scenarios:

1. first-time user no shortlist
2. add to selected shortlist
3. create-then-add
4. duplicate add
5. partial bulk failures
6. remove and refresh consistency
7. cross-page consistency (analysis vs candidates vs shortlists)

### Scenario matrix

| Scenario | Preconditions | Steps | Expected result | Pass criteria |
|---|---|---|---|---|
| First-time user, no shortlist | User has zero shortlists; candidate(s) selected in Analysis or Candidates | Click **Add to shortlist** | Add action requires shortlist creation/selection before submit | Submit is blocked until destination exists; no silent destination write |
| Add to selected shortlist | At least one active shortlist exists; candidate(s) selected | Open add flow, choose shortlist, confirm | Candidates added to explicitly selected destination | Success summary shown; candidate membership badges/labels update correctly |
| Create-then-add | No suitable shortlist exists for intent | In add flow, create shortlist inline, then confirm add | New shortlist created and used as destination in same flow | No context loss; destination label matches newly created shortlist |
| Duplicate add | Candidate already belongs to destination shortlist | Re-run add with same candidate + shortlist | Operation is idempotent | Candidate not duplicated; result reports already-present/updated bucket |
| Partial bulk failures | Mixed batch with valid + invalid/stale/inaccessible rows | Run bulk add | Mixed result summary with per-outcome counts | Added rows persist; failed/invalid rows reported and retry path available |
| Remove and refresh consistency | Candidate belongs to shortlist; remove action available | Remove candidate, then refresh/reload | Candidate no longer appears as member after refresh | UI state and backend state remain consistent post-refresh |
| Cross-page consistency | Same candidate visible in Analysis, Candidates, and Shortlists surfaces | Add/remove from one surface, navigate to others | Membership state remains consistent across all pages | No stale contradiction after standard refresh/navigation cycle |

### Execution guidance

- Run each scenario across all supported shortlist entry points when applicable.
- Record:
  - environment/build id
  - actor role/permissions
  - request trace id (if available)
  - observed outcome bucket counts
  - screenshots for any mismatch
- Use deterministic test fixtures for duplicate and partial-failure scenarios.

### Acceptance criteria mapping (Task 6.1)

- QA matrix includes all seven required scenarios.
- Each scenario has explicit preconditions, steps, expected result, and pass criteria.
- Cross-page consistency is validated between Analysis, Candidates, and Shortlists views.

---

## Task 6.2 — Design constitution compliance QA

### Outcome
A mandatory sign-off gate before release.

### Release gate rule

Feature rollout cannot proceed to the next phase unless all compliance categories below are marked **Pass** (or have a documented temporary exception approved by design + product owners).

### Compliance checklist

#### 1) Layout pattern order compliance
- Verify page/component composition follows approved layout sequence and hierarchy.
- Confirm no out-of-order module insertion in shortlist flows.

#### 2) State treatment compliance
- Validate loading, empty, success, partial-failure, and error states match canonical treatment patterns.
- Ensure state messaging is actionable and consistent with the product contract.

#### 3) Typography compliance
- Confirm text styles, weights, and semantic emphasis align with design typography tokens/guidelines.
- Validate helper text, summary text, and CTA text roles are visually consistent.

#### 4) Pagination parity compliance (where applicable)
- Ensure pagination behavior and controls are consistent across comparable list surfaces.
- Validate per-page, navigation controls, and position persistence parity where required.

### Sign-off artifact (required)

Produce a sign-off record containing:

- checklist status per category (Pass/Fail/Exception)
- evidence links (screenshots, QA runs, ticket references)
- approvers (Design, Product, QA owner)
- decision timestamp

### Acceptance criteria mapping (Task 6.2)

- A compliance checklist exists for all required categories.
- Release is blocked until sign-off is recorded.
- Exceptions require explicit approval and traceable evidence.

---

## Task 6.3 — Feature flag + phased release

### Outcome
Low-risk rollout through progressive exposure and KPI-based progression gates.

### Rollout plan

#### Phase 0 — Internal dogfood
- Audience: internal team only.
- Goal: catch integration/UX regressions before external exposure.
- Exit gate: no Sev-1/Sev-2 defects open; KPI baseline captured.

#### Phase 1 — 10% cohort
- Audience: 10% eligible user cohort via feature flag targeting.
- Goal: validate production behavior at low blast radius.
- Exit gate: KPI thresholds pass for defined observation window.

#### Phase 2 — 50% cohort
- Audience: 50% eligible user cohort.
- Goal: verify scaling behavior and sustained KPI stability.
- Exit gate: thresholds continue to pass with no negative trend alerts.

#### Phase 3 — 100% rollout
- Audience: all eligible users.
- Condition: proceed only after threshold pass in prior phases.
- Post-rollout: continue enhanced monitoring period before normalizing alert sensitivity.

### Monitoring KPIs

Track these primary KPIs by cohort phase:

1. shortlist add success rate
2. wrong-destination correction rate
3. shortlist page engagement
4. add-to-shortlist conversion from analysis results

### KPI governance recommendations

- Define explicit numeric thresholds and alert conditions before Phase 1.
- Use stable observation windows per phase (for example, minimum days and minimum event volume).
- Require product + engineering sign-off before each phase increase.
- Prepare rollback criteria and owner on-call rotation in advance.

### Acceptance criteria mapping (Task 6.3)

- Rollout sequence includes: internal dogfood → 10% → 50% → 100%.
- KPI monitoring includes all four required metrics.
- Phase advancement is gated by threshold pass.

---

## Epic 6 release-readiness checklist (consolidated)

- [ ] Task 6.1 QA matrix executed for all required scenarios.
- [ ] Task 6.2 design constitution compliance sign-off recorded.
- [ ] Task 6.3 feature-flag cohorts configured with thresholds and monitors.
- [ ] Rollback playbook validated and owner assigned.
- [ ] Go/No-Go decision documented with date/time and approvers.
