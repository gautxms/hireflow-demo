# Dashboard/App-Shell Compliance Checklist (Task 0.1)

Purpose: convert the Design Constitution into a concrete, repeatable QA checklist for dashboard + authenticated app-shell work.

## How to use
- Mark each item Pass/Fail/N/A during PR QA.
- Fail if any required prop/token/rule is missing.
- Add screenshots or DOM/CSS evidence links for failures.

## A) Typography role mapping (Syne vs DM Sans)
- [ ] **Role mapping is correct:** Syne only for display-heading roles (hero/brand/heading roles), DM Sans for UI controls, labels, nav, button text, and metadata.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L21-L26, L35-L46.
- [ ] **No non-constitutional fonts:** no `Inter` (or other non-Syne/DM Sans) used in dashboard/app-shell scope.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L21, L334.
- [ ] **Button + sidebar/nav labels are DM Sans** with constitutional size/weight ranges.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L43-L46, L231-L253.

## B) Icon library + canonical props
- [ ] **Icon source:** all icons are from `lucide-react` only (no emoji/custom inline SVG/other icon libraries).
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L116-L124, L332-L333.
- [ ] **Canonical props:** Lucide icons use `size={18}` and `strokeWidth={1.5}` unless explicitly documented exception.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L120-L123.
- [ ] **Canonical mappings:** navigation/action icons match constitution mapping table (Dashboard→LayoutDashboard, Jobs→Briefcase, etc.).
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L126-L152.

## C) Sidebar active-state recipe
- [ ] **Width/state behavior:** expanded 216px, collapsed 52px; unpinned hover-expand and mouse-leave collapse behavior preserved.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L196-L199.
- [ ] **Pin persistence:** pin state stored in `localStorage` key `hf-sb-pinned`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L200.
- [ ] **Active visual recipe exactly applied:** `border-left: 2px solid #c8ff00`, `background: rgba(200,255,0,0.08)`, active icon `#c8ff00`, active label `#ffffff`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L201.

## D) Button variants (primary + ghost) with hover/focus
- [ ] **Primary button tokens:** lime bg, dark text, DM Sans, 14px, 700, padding 10x22, radius 8, no border.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L230-L243.
- [ ] **Primary interaction states:** hover `#b8ec00`, active scale `0.97`, focus-visible lime outline + 3px offset.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L244-L246.
- [ ] **Ghost button tokens:** transparent bg, muted text, DM Sans, 14px, padding 9x20, radius 8, border `#2a2a2a`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L248-L259.
- [ ] **Ghost hover state:** border `#444444` and text `#ffffff`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L260.

## E) Card tokens (surface/border/radius/padding)
- [ ] **Card base tokens:** surface `#111111`, border `#1e1e1e`, radius `12px`, padding `20px 24px`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L218-L224.
- [ ] **Card interaction states:** hover border `#2a2a2a`; active/selected border `rgba(200,255,0,0.3)`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L227-L228.

## F) App shell spacing and sizing
- [ ] **Page-type separation enforced:** app pages use app shell; public pages do not show sidebar/public footer mixing.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L160-L171, L337-L338.
- [ ] **App shell geometry:** sidebar 216px, header 52px, content area `flex:1` + `overflow-y:auto`, content padding `28px 32px`, footer 36px.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L173-L183.
- [ ] **Outer container layout:** `display:flex`, `height:100vh`, `width:100vw`, dark background, `overflow:hidden`.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L186-L193.
- [ ] **Sidebar positioning:** sticky sidebar model (`position: sticky; top: 0; height: 100vh`), not fixed.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L177-L179, L341.

## G) Hard “do-not” constraints (gates)
- [ ] No custom inline SVG icons.
- [ ] No emoji icons.
- [ ] No `Inter` font.
- [ ] No sidebar on public pages.
- [ ] No public footer inside authenticated app pages.
- [ ] No fixed-position sidebar.
- [ ] No light mode styles.
  - Constitution refs: `docs/DESIGN_CONSTITUTION.md` L332-L344.

## QA evidence template (per PR)
- Scope audited:
- Files reviewed:
- Failures found:
- Screenshot links:
- Follow-up tasks created:
