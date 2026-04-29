# Public Route Checklist

Use this checklist for every new public-facing route/page.

- [ ] Route renders inside `PublicPageLayout` (`src/components/public/PublicPageLayout.jsx`).
- [ ] Main content uses `public-page-main` and section blocks use `public-section`.
- [ ] No per-page top/bottom spacing that conflicts with shell spacing (avoid ad hoc page wrappers with custom vertical padding).
- [ ] `PublicFooter` is provided by the layout shell (do not mount per page).
- [ ] Optional back/utility controls are passed via the layout `header` slot.
