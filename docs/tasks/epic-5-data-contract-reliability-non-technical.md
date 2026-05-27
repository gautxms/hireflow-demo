# Epic 5 — Data contract and reliability (non-technical requirements)

## Purpose
Define a cross-surface, deterministic outcome and error communication contract for shortlist bulk operations so users can reliably understand what happened, what to do next, and what can be retried.

---

## Task 5.1 — Define shortlist event outcomes

### Outcome
Deterministic statuses for bulk operations.

### Canonical outcome model (required for all entry points)

All shortlist bulk operations MUST emit one standardized outcome bucket per candidate record:

1. **added**
   - Candidate was newly added to the destination shortlist in this request.

2. **updated/already-present**
   - Candidate was already associated with the shortlist OR an idempotent update occurred with no net-new membership.
   - This bucket confirms non-failure completion and prevents duplicate mental models.

3. **invalid/missing**
   - Input item could not be processed because required references were invalid or missing (for example: candidate id not found, shortlist id not found, malformed row payload).

4. **failed**
   - Valid input could not be completed due to runtime, dependency, or permission constraints.

### Determinism rules

1. **Exactly one terminal outcome bucket per input record**
   - Every input candidate row must map to one and only one of the four buckets.

2. **Stable classification priority**
   - If multiple issues are detected for one row, classify by precedence:
     1) invalid/missing
     2) failed
     3) updated/already-present
     4) added
   - This ensures cross-service consistency in ambiguous cases.

3. **Idempotency semantics**
   - Repeating the same add request must never create duplicates.
   - Replayed rows should resolve to **updated/already-present** when already associated.

4. **Batch summary requirement**
   - All responses must provide aggregate counts for all four buckets.
   - Recommended summary order in UI: `added`, `updated/already-present`, `invalid/missing`, `failed`.

### Same model across all entry points

The exact same four-bucket model must be used by all shortlist write entry points:

- Analysis Results bulk add
- Candidates Directory bulk add
- Shortlists page bulk add/manage flows
- Any future API/import endpoint that performs shortlist membership writes

No entry point may rename, collapse, or omit buckets in transport or UI copy.

### Acceptance criteria mapping (Task 5.1)

- Standardized outcome buckets defined:
  - added
  - updated/already-present
  - invalid/missing
  - failed
- One shared outcome model mandated for all entry points.

---

## Task 5.2 — Error taxonomy and user messaging

### Outcome
Users understand what happened and the next step.

### Error taxonomy (product-level)

#### 1) Permission error
- **Definition**: User lacks permission to read/write the target shortlist or candidate set.
- **Class**: Non-retriable by immediate end user action unless permissions change.

#### 2) Missing shortlist
- **Definition**: Selected shortlist no longer exists, is inaccessible, or was deleted/archived beyond allowed write scope.
- **Class**: Retriable after destination re-selection/creation.

#### 3) Stale selection
- **Definition**: One or more selected candidates are out of date relative to current data (removed, changed scope, or no longer eligible).
- **Class**: Retriable after refresh and re-selection.

#### 4) Partial failure
- **Definition**: Batch completed with mixed results across rows (some added/updated, some invalid/failed).
- **Class**: Retriable for failed/invalid subset only.

### Product copy (recommended defaults)

#### Permission errors
- **Inline/banner message**: `You don’t have permission to update this shortlist.`
- **Supporting copy**: `Ask a workspace admin for access, then try again.`
- **CTA**: `Retry` (secondary) + optional `Contact admin` link.

#### Missing shortlist
- **Inline/banner message**: `This shortlist is no longer available.`
- **Supporting copy**: `Select another shortlist or create a new one to continue.`
- **CTA**: `Choose shortlist` (primary), `Create shortlist` (secondary).

#### Stale selection
- **Inline/banner message**: `Your selection is out of date.`
- **Supporting copy**: `Refresh the list, review highlighted candidates, and submit again.`
- **CTA**: `Refresh` (primary), `Review selection` (secondary).

#### Partial failure
- **Inline/banner message**: `Some candidates could not be processed.`
- **Supporting copy**: `Added: {addedCount}. Already present: {updatedCount}. Invalid: {invalidCount}. Failed: {failedCount}.`
- **CTA**: `Retry failed items` (primary), `Download error list` (secondary, optional).

### Retry guidance by error class

1. **Permission error**
   - Do not auto-retry.
   - User action: request permission change.
   - System action: preserve attempted selection for post-permission retry when feasible.

2. **Missing shortlist**
   - Allow immediate retry after user chooses/creates a valid destination.
   - Keep candidate selection intact during destination recovery flow.

3. **Stale selection**
   - Force data refresh before retry.
   - Retry only with still-valid rows; route invalid rows to invalid/missing bucket.

4. **Partial failure**
   - Provide one-click retry scoped to failed/invalid rows only.
   - Avoid resubmitting rows already in added or updated/already-present buckets.

### Acceptance criteria mapping (Task 5.2)

- Product copy is defined for:
  - permission errors
  - missing shortlist
  - stale selection
  - partial failure
- Retry guidance exists for each error class.

---

## Cross-surface implementation guardrails (non-technical)

1. **Message consistency over channel**
   - Modal, toast, inline banner, and API-driven summary must convey the same classification semantics.

2. **Actionable next step always visible**
   - Every non-success state must include a clear next action (retry, refresh, reselect, request access).

3. **No silent drops**
   - If any row is invalid/missing or failed, user must be told counts and offered scoped retry/review.

4. **Accessibility and clarity**
   - Use plain language, avoid backend jargon, and keep summary lines scannable for high-volume bulk actions.
