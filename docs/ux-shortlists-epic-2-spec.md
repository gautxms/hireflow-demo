# Epic 2 — Shortlists UX Specification (DESIGN_CONSTITUTION Aligned)

## Scope
This specification defines the Shortlists page UX layout and interaction rules for Epic 2, aligned to the composition, state, control, accessibility, and typography requirements in `docs/DESIGN_CONSTITUTION.md`.

---

## Task 2.1 — Shortlists page layout spec

### Required composition order (exact)
Per constitution data-heavy page guidance, the Shortlists page wireframe must be composed in this strict order:

1. **Summary / header**
2. **Filters / actions**
3. **Stats**
4. **Paginated list/cards**

### Wireframe structure

#### A) Summary/Header (top card)
- Placement: first block in content column.
- Content:
  - Page title (`Shortlists`) and optional subtitle/context.
  - Primary CTA (`Create shortlist`) and secondary actions (`Import`, `Export`, if enabled).
  - Optional high-level status chip(s): e.g., “Active filters”, “Selection mode”.
- Visual language:
  - Reuse analysis/results header-card treatment (dark layered surface, subtle border, 10–12px radius).

#### B) Filters/Actions row (second block)
- Placement: immediately below summary header.
- Includes:
  - Search input.
  - Filter controls (owner, status, date, tags).
  - Sort control.
  - Bulk-action entry points (only when selection exists).
- Behavior:
  - Sticky on scroll for long lists when feasible.
  - Clear reset action: `Clear filters`.

#### C) Stats cards row (third block)
- Placement: below filters/actions.
- KPIs (example baseline):
  - Total shortlists.
  - Total candidates in selected shortlist.
  - Candidates added this week.
  - Decision-ready count.
- Visual language:
  - Reuse results stats card pattern.
  - Equal-height responsive cards.

#### D) Paginated list/cards (fourth block)
- Placement: final major section.
- Structure:
  - Card list or table-cards hybrid of shortlist entities.
  - Each card includes shortlist metadata and quick actions.
  - Optional expandable details for preview candidates.
- Pagination:
  - Keep stateful selection across page changes when possible.
  - Show page size, current range, and next/previous controls.

### Bulk toolbar/panel language
Bulk toolbars and panels must reuse results-page supporting card language:
- Same border-first dark surface treatment.
- Same radii (10–12px) and spacing rhythm.
- Same semantic action hierarchy (primary/secondary/destructive).
- Same icon system (Lucide) and icon sizing conventions.

**Acceptance mapping — Task 2.1**
- ✅ Wireframes follow exact 4-part sequence above.
- ✅ Bulk toolbar/panels match results-page card language.

---

## Task 2.2 — State design (loading/error/empty)

### Global principles
- Every data region must define explicit states: `loading`, `error`, `empty`, `ready`.
- Use alert semantics for critical status messaging.
- Preserve layout stability between states (avoid major content jumps).

### Loading states
1. **Shortlist list loading**
   - Show skeleton cards in paginated region.
   - Keep header/filters visible and disabled only where required.
2. **Shortlist detail loading**
   - Show inline skeleton rows/cards within selected shortlist panel/detail area.
   - Maintain selected shortlist context while detail fetch resolves.

### Error state (with actionable retry)
- Render in affected region plus concise alert copy.
- Required controls:
  - `Retry` button (primary action).
  - Optional `Back` or `Clear filters` depending on source of failure.
- Copy format:
  - Human-readable issue summary.
  - Action prompt: “Please retry. If this continues, contact support.”

### Empty states
1. **No shortlists**
   - Message: no shortlist objects exist yet.
   - Primary CTA: `Create shortlist`.
2. **Shortlist empty**
   - Message: selected shortlist has no candidates.
   - CTA: `Add candidates` (links to candidate/results workflow).
3. **Filters produce no results**
   - Message: filters excluded all records.
   - CTA: `Clear filters` and optional `Reset sort`.

**Acceptance mapping — Task 2.2**
- ✅ Loading state specified for shortlist list + shortlist detail.
- ✅ Error state includes explicit retry action.
- ✅ All three required empty-state variants defined.

---

## Task 2.3 — Control and accessibility spec

### Control semantics
- Use native `<button type="button">` or `<button type="submit">` for actions.
- Do not use non-button elements for click-only actions unless semantics are fully replicated.

### Interaction states
Each interactive control must define:
- **Default**
- **Hover**
- **Focus-visible** (keyboard-visible ring)
- **Active**
- **Disabled** (non-interactive, contrast-safe)

### Touch target guidance
- Minimum target: 44x44 px for tap-priority controls.
- Keep adequate spacing between adjacent icon/tap controls.

### Icon-label conventions
- Icon-only buttons must include a programmatic accessible label (`aria-label`).
- Decorative icons adjacent to visible text should be `aria-hidden="true"`.

### Accessibility checklist (attach to design review)
- [ ] All major actions use real `<button>` semantics.
- [ ] Tab order matches visual flow: header → filters → stats → list/cards → pagination.
- [ ] Focus-visible ring is present and high-contrast on all focusable controls.
- [ ] Disabled controls are announced and visually distinct.
- [ ] Icon-only controls include `aria-label` text.
- [ ] Region-level status and errors are exposed with alert/status semantics as appropriate.
- [ ] Keyboard trap is prevented in any slide-over/panel/dialog surfaces.
- [ ] Escape/close action documented for dismissible panels.

### Keyboard-only documented flows
1. **Create shortlist**
   - Navigate to `Create shortlist` button via Tab.
   - Press Enter/Space to open form.
   - Complete fields by keyboard; submit with Enter on primary action.
2. **Add candidates to shortlist**
   - Tab to candidate selection controls.
   - Toggle selection with Space/Enter.
   - Tab to `Add to shortlist`; activate with Enter/Space.
3. **Remove candidate from shortlist**
   - Focus shortlist candidate card action.
   - Activate `Remove` by Enter/Space.
   - Confirm (if confirmation step exists) via keyboard-only action.

**Acceptance mapping — Task 2.3**
- ✅ Accessibility checklist included.
- ✅ Keyboard-only flows documented for create/add/remove.

---

## Task 2.4 — Typography and visual token compliance

### Font system rules
- **Syne**: major headings only.
- **DM Sans**: dense controls, tables, metadata, forms, helper text, button labels.
- No one-off or ad hoc fonts in shortlist UI.

### Typography matrix (for design review)

| UI element | Font | Weight | Size (guideline) | Notes |
|---|---|---:|---:|---|
| Page title (`Shortlists`) | Syne | 700–800 | 28–36px | Major heading only |
| Section headings (`Filters`, `Stats`) | Syne | 700 | 20–24px | Optional depending on card design |
| KPI value numerals | Syne or existing KPI pattern | 700 | 24–32px | Match existing stats pattern |
| KPI labels | DM Sans | 500–600 | 12–14px | Dense metadata |
| Filter labels | DM Sans | 500 | 12–14px | Dense control text |
| Inputs/selects/button labels | DM Sans | 500–700 | 13–14px | Control readability |
| Shortlist card title (item-level) | DM Sans | 600–700 | 15–18px | Not a page-level heading |
| Card metadata, timestamps, tags | DM Sans | 400–500 | 12–13px | Dense metadata |
| Pagination text and controls | DM Sans | 500 | 12–14px | Consistent with data surfaces |
| Empty/error helper copy | DM Sans | 400–500 | 13–14px | Accessible body text |

### Visual token conformance
- Surface/background/border/accent choices must match established app dark tokens.
- Button and card tokens should align with constitutional component rules.

**Acceptance mapping — Task 2.4**
- ✅ Typography matrix included.
- ✅ Explicit ban on one-off font usage in shortlist controls/table metadata.

---

## Implementation handoff notes
- Treat this document as the UX gate for Shortlists v2 design review and engineering handoff.
- Any deviation requires documented exception with rationale and constitution cross-reference.
