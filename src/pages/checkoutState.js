export function resolveCheckoutCloseState({ isActiveSubscription, verificationFailed }) {
  if (isActiveSubscription) {
    return {
      nextStatus: 'success',
      shouldShowRetry: false,
      message: 'Payment received! Your subscription is now active.',
    }
  }

  if (verificationFailed) {
    return {
      nextStatus: 'retry',
      shouldShowRetry: true,
      message: 'Could not verify payment after closing checkout. Please retry checkout.',
    }
  }

  return {
    nextStatus: 'cancelled',
    shouldShowRetry: true,
    message: 'Checkout closed before payment completed. You can retry checkout from this page.',
  }
}
