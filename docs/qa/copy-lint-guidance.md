# Copy Lint Guidance for New UI Strings

Use this lightweight lint checklist whenever a PR adds or updates UI copy in public or admin routes.

## Required checks

- Sentence case for CTAs, labels, helper text, alerts, and empty states.
- Canonical verbs from `docs/MICROCOPY_STYLE_GUIDE.md`.
- Ellipsis character (`…`) for loading/in-progress text.
- Action-oriented error phrasing (`Unable to + action`) when applicable.
- No competing labels for the same action within the same flow.

## Quick reviewer commands

```bash
rg -n "Login|Back to Login|Save Changes|Create JD|\.\.\." src
```

Use matches as a first-pass signal for common variants that should be normalized.

## PR expectation

Include a “Microcopy QA” note in the PR with:
- routes/components reviewed
- normalized labels/messages
- any intentionally deferred copy updates
