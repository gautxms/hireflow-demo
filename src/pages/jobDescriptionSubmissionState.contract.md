# Job Description Submission State Contract

This document defines the UI-facing contract for `shouldResetAfterSave`.

## Function

`shouldResetAfterSave({ isEditing, payload })`

## Inputs

- `isEditing` (`boolean`): true when editing an existing item.
- `payload` (`object | null | undefined`): save response payload.

## Output

Returns `boolean`.

## Rule

Reset state **only** when both are true:

1. `isEditing === false`
2. `payload?.item?.id` is truthy

Equivalent expression:

`!isEditing && Boolean(payload?.item?.id)`

## UI expectations

- Create flow: reset form/input state after successful save with a valid `item.id`.
- Edit flow: do not reset automatically after save.
- Failed/incomplete save payloads: do not reset.
