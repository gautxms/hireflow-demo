# Checkout State Contract

This document defines the UI-facing contract for `resolveCheckoutCloseState`.

## Function

`resolveCheckoutCloseState({ isActiveSubscription, verificationFailed })`

## Inputs

- `isActiveSubscription` (`boolean`): whether the user now has an active subscription.
- `verificationFailed` (`boolean`): whether post-close payment verification failed.

## Output shape

Returns:

- `nextStatus` (`'success' | 'retry' | 'cancelled'`)
- `shouldShowRetry` (`boolean`)
- `message` (`string`)

## State mapping

1. If `isActiveSubscription === true`
   - `nextStatus: 'success'`
   - `shouldShowRetry: false`
2. Else if `verificationFailed === true`
   - `nextStatus: 'retry'`
   - `shouldShowRetry: true`
3. Else
   - `nextStatus: 'cancelled'`
   - `shouldShowRetry: true`

## UI expectations

- UI should branch on `nextStatus` only for status-specific visuals.
- Retry CTA visibility should come from `shouldShowRetry`.
- Status copy should default to `message` unless explicitly overridden.
