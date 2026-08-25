let requestProcessing = null

export function registerPaddleWebhookProcessingRequest(handler) {
  requestProcessing = typeof handler === 'function' ? handler : null
}

export function requestPaddleWebhookProcessing() {
  if (!requestProcessing) return false
  requestProcessing()
  return true
}
