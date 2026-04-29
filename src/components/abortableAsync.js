export function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timeout)
      reject(new DOMException('Polling aborted', 'AbortError'))
    }

    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export function shouldSkipStateUpdate({ mounted, signal }) {
  return !mounted || Boolean(signal?.aborted)
}
