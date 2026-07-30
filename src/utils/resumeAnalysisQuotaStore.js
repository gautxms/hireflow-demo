export const QUOTA_REVALIDATION_FALLBACK_MS = 5 * 60 * 1000
export const QUOTA_TRANSITION_SAFETY_MS = 1000

const IDLE_STATE = Object.freeze({ status: 'idle', quota: null })

export function getResumeQuotaRevalidationDelay({
  quota,
  now = Date.now(),
  fallbackMs = QUOTA_REVALIDATION_FALLBACK_MS,
}) {
  const transitionAt = Date.parse(quota?.nextRevalidationAt || '')
  if (!Number.isFinite(transitionAt) || transitionAt <= now) return fallbackMs
  return Math.min(transitionAt - now + QUOTA_TRANSITION_SAFETY_MS, fallbackMs)
}

export function createResumeAnalysisQuotaStore({
  loadQuota,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  isVisible = () => true,
  fallbackMs = QUOTA_REVALIDATION_FALLBACK_MS,
} = {}) {
  let state = IDLE_STATE
  let timerId = null
  let inFlight = null
  const listeners = new Set()

  const emit = () => listeners.forEach((listener) => listener())
  const clearScheduledRefresh = () => {
    if (timerId === null) return
    clearTimer(timerId)
    timerId = null
  }
  const schedule = () => {
    clearScheduledRefresh()
    if (listeners.size === 0 || !isVisible() || state.status !== 'success') return
    const delay = getResumeQuotaRevalidationDelay({ quota: state.quota, now: now(), fallbackMs })
    timerId = setTimer(() => {
      timerId = null
      refresh()
    }, delay)
  }
  const update = (nextState) => {
    state = nextState
    emit()
    schedule()
  }
  const refresh = async () => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(() => loadQuota())
      .then((quota) => {
        update({ status: 'success', quota })
        return quota
      })
      .catch(() => {
        clearScheduledRefresh()
        state = { status: 'unavailable', quota: state.quota }
        emit()
        if (listeners.size > 0 && isVisible()) {
          timerId = setTimer(() => {
            timerId = null
            refresh()
          }, fallbackMs)
        }
        return null
      })
      .finally(() => { inFlight = null })
    return inFlight
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => IDLE_STATE,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        clearScheduledRefresh()
        state = { status: 'loading', quota: state.quota }
        emit()
        refresh()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) clearScheduledRefresh()
      }
    },
    refresh,
    handleVisibilityChange() {
      if (!isVisible()) {
        clearScheduledRefresh()
        return
      }
      refresh()
    },
    hasScheduledRefresh: () => timerId !== null,
    subscriberCount: () => listeners.size,
  }
}
