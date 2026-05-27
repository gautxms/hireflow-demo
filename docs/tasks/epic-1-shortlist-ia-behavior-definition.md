# Epic 1 — Shortlist IA and behavior definition (PM/UX)

## Purpose
Define a single, canonical behavior model for shortlist actions across Analysis Results, Candidates Directory, and the Shortlists page so users always understand **where** candidates are being added and **what happened** after submission.

---

## Task 1.1 — Define canonical shortlist user journeys

### Outcome
A source-of-truth journey map that covers the complete shortlist flow across:

1. **Analysis Results → Add to shortlist**
2. **Candidates Directory → Add/remove shortlist**
3. **Shortlists page → review/manage/export**

### Canonical journey map

#### Entry point A: Analysis Results → Add to shortlist
1. User selects one or more candidates in Analysis Results.
2. User clicks **Add to shortlist**.
3. System opens destination selector modal/panel before submit.
4. User chooses an existing shortlist or creates a new one inline.
5. User confirms submit.
6. System returns result summary:
   - Added successfully
   - Already present
   - Failed (if any)
7. UI refreshes candidate shortlist badges/status.

#### Entry point B: Candidates Directory → Add/remove shortlist
1. User opens candidate row/card actions.
2. User selects **Add to shortlist** or **Remove from shortlist**.
3. For add:
   - Destination selector is shown pre-submit.
   - User selects/creates shortlist, then confirms.
4. For remove:
   - If candidate belongs to multiple shortlists, user chooses target shortlist to remove from.
5. System returns result summary and updates row/card state.

#### Entry point C: Shortlists page → review/manage/export
1. User lands on Shortlists page.
2. User can switch shortlist context (if multiple exist).
3. User reviews members, removes candidates, or bulk-manages items.
4. User exports shortlist members.
5. System confirms completion and reports partial export/manage failures when applicable.

### Required edge-case journeys

#### No shortlist exists
- Add action must block direct submit and require explicit destination creation/selection.
- Inline **Create shortlist** appears in add flow.

#### Multiple shortlists exist
- Add action requires explicit destination shortlist selection.
- Last selected shortlist may be preselected (session scoped), but user must see it before confirm.

#### Candidate already added
- Submit is idempotent.
- Result message indicates “already in shortlist” and does not duplicate record.

#### Partial failures
- In batch actions, success/failure is reported per candidate.
- Summary message format: `X added, Y already added, Z failed`.
- Retry path is offered for failed rows only.

### Acceptance criteria mapping (Task 1.1)
- Journey map explicitly includes:
  - no shortlist exists
  - multiple shortlists
  - already added
  - partial failures
- Destination shortlist rule is defined and visible before submit.

---

## Task 1.2 — Decide destination selection policy

### Outcome
No ambiguity about destination shortlist in any add flow.

### Policy decision (recommended)

1. **No silent destination**
   - If no shortlist is selected in the current context, system must require explicit shortlist selection before allowing submit.

2. **Inline create support**
   - Add flow must provide **Create shortlist** inline without forcing navigation away from current context.

3. **Session memory with visibility**
   - Persist **last selected shortlist** for the active session only.
   - Display a visible indicator (e.g., “Destination: <Shortlist Name>”) in the add UI before confirm.

4. **Confirmation requirement**
   - Confirmation step must show destination shortlist name every time prior to write action.

### Acceptance criteria mapping (Task 1.2)
- No candidate can be added to an unknown/implicit shortlist.
- User always sees destination shortlist name at confirmation.

---

## Task 1.3 — Define shortlist lifecycle states

### Outcome
Clear product-state rules for shortlist lifecycle operations.

### Lifecycle model

#### State: Active
- Visible in standard shortlist selectors/dropdowns.
- Eligible destination for add actions.
- Manageable (rename, archive, delete).

#### State: Archived
- Hidden from default add-destination dropdowns.
- Visible in shortlist management views with archived filter/section.
- Can be unarchived to become active again.
- Export and read access remain available unless explicitly restricted by permissions.

### Allowed operations and rules

1. **Create**
   - New shortlists are created in **Active** state by default.
   - Name must be validated (non-empty, unique per user/workspace scope).

2. **Rename**
   - Allowed for both Active and Archived shortlists.
   - Renamed shortlist keeps identity/history.

3. **Archive**
   - Allowed from Active state.
   - Archived shortlist is excluded from default add dropdowns.
   - Existing candidate associations are preserved.

4. **Unarchive**
   - Allowed from Archived state.
   - Returns shortlist to Active and destination eligibility.

5. **Delete**
   - Allowed via explicit destructive confirmation.
   - Must define behavior for contained candidates (recommended: remove shortlist association only; do not delete candidates).
   - Deleted shortlist is not recoverable unless product introduces soft-delete.

### Acceptance criteria mapping (Task 1.3)
- Create, rename, archive, unarchive, delete rules are explicitly defined.
- Archived shortlist behavior: excluded from default add dropdown, still accessible in management.

---

## Cross-surface behavior contract (single source of truth)

The following contract applies consistently to Analysis Results, Candidates Directory, and Shortlists page:

1. Add actions always resolve an explicit destination shortlist before submit.
2. Destination name is visible in pre-submit UI and confirmation state.
3. Batch operations return granular result summaries (success/already/failure).
4. Archived shortlists are never default add targets.
5. Management surface always allows access to archived shortlists.

## Suggested UX copy primitives

- Destination label: **Destination shortlist**
- Empty-state prompt: **No shortlist yet — create one to continue**
- Batch success summary: **Added {successCount}. Already in shortlist: {duplicateCount}. Failed: {failCount}.**
- Archive helper text: **Archived shortlists are hidden from quick add but remain available in management.**
