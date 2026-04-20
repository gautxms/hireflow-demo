# Iconography System

This document defines the shared icon contract for public and admin surfaces.

## Token contract

Icon tokens live in `src/styles/variables.css`.

- **Size tiers:** `--icon-size-xs|sm|md|lg|xl`
- **Stroke weights:** `--icon-stroke-thin|regular|bold`
- **Semantic colors:**
  - `--icon-color-default`
  - `--icon-color-muted`
  - `--icon-color-accent`
  - `--icon-color-info`
  - `--icon-color-success`
  - `--icon-color-warning`
  - `--icon-color-danger`

## Shared component contract

Use `Icon` from `src/components/Icon.jsx`.

```jsx
<Icon name="upload" size="sm" stroke="regular" tone="current" />
```

Props:

- `name` (**required**): icon glyph name from the shared registry
- `size`: `xs | sm | md | lg | xl`
- `stroke`: `thin | regular | bold`
- `tone`: `default | muted | accent | info | success | warning | danger | current`
- `label` (optional): accessible label. If omitted, icon is decorative.

## Do / Don’t

### ✅ Do

- Use `Icon` for all UI icons in public/admin product flows.
- Use `tone="current"` for icons inside text-colored controls (nav rows, buttons).
- Use semantic tones (`accent`, `success`, `warning`, etc.) for state communication.
- Keep icon sizing on token tiers (`sm`, `md`, `lg`, `xl`) instead of raw px values.

### ❌ Don’t

- Don’t use emoji as navigation, action, or status icons.
- Don’t hardcode icon stroke widths in component-level styles.
- Don’t assign random per-component icon sizes (`font-size: 27px`, inline styles, etc.).
- Don’t hardcode hex colors directly on icons when a semantic tone exists.
