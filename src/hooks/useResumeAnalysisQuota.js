import { useCallback, useEffect, useSyncExternalStore } from 'react'
import API_BASE from '../config/api'
import { normalizeResumeAnalysisQuota } from '../utils/resumeAnalysisQuota.js'
import { createResumeAnalysisQuotaStore } from '../utils/resumeAnalysisQuotaStore.js'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const IDLE_STATE = Object.freeze({ status: 'idle', quota: null })

async function loadResumeAnalysisQuota() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (!token) throw new Error('Authentication required')
  const response = await fetch(`${API_BASE}/usage/resume-analysis`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Unable to load resume allowance')
  const quota = normalizeResumeAnalysisQuota(payload)
  if (!quota) throw new Error('Resume allowance response is incomplete')
  return quota
}

const quotaStore = createResumeAnalysisQuotaStore({
  loadQuota: loadResumeAnalysisQuota,
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
})

let browserConsumerCount = 0
const handleBrowserRefresh = () => quotaStore.refresh()
const handleVisibilityChange = () => quotaStore.handleVisibilityChange()

function retainBrowserRevalidation() {
  browserConsumerCount += 1
  if (browserConsumerCount !== 1 || typeof window === 'undefined') return
  window.addEventListener('focus', handleBrowserRefresh)
  window.addEventListener('online', handleBrowserRefresh)
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function releaseBrowserRevalidation() {
  browserConsumerCount = Math.max(browserConsumerCount - 1, 0)
  if (browserConsumerCount !== 0 || typeof window === 'undefined') return
  window.removeEventListener('focus', handleBrowserRefresh)
  window.removeEventListener('online', handleBrowserRefresh)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

export default function useResumeAnalysisQuota({ enabled = true } = {}) {
  const subscribe = useCallback((listener) => (
    enabled ? quotaStore.subscribe(listener) : () => {}
  ), [enabled])
  const state = useSyncExternalStore(
    subscribe,
    enabled ? quotaStore.getSnapshot : () => IDLE_STATE,
    quotaStore.getServerSnapshot,
  )

  useEffect(() => {
    if (!enabled) return undefined
    retainBrowserRevalidation()
    return releaseBrowserRevalidation
  }, [enabled])

  return { ...state, refresh: quotaStore.refresh }
}
