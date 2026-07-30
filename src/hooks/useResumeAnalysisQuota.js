import { useCallback, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react'
import API_BASE from '../config/api'
import { normalizeResumeAnalysisQuota } from '../utils/resumeAnalysisQuota.js'
import { createResumeAnalysisQuotaStore } from '../utils/resumeAnalysisQuotaStore.js'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const QUOTA_IDENTITY_CHANGE_EVENT = 'hireflow:quota-identity-change'
const IDLE_STATE = Object.freeze({ status: 'idle', quota: null })
const quotaRecords = new Map()

function readStoredAuthToken() {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(TOKEN_STORAGE_KEY) || '')
}

async function loadResumeAnalysisQuota(token) {
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

function notifyQuotaIdentityChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(QUOTA_IDENTITY_CHANGE_EVENT))
  }
}

function getQuotaRecord(token) {
  const existing = quotaRecords.get(token)
  if (existing) return existing

  const record = {
    consumers: 0,
    handlers: null,
    store: createResumeAnalysisQuotaStore({
      loadQuota: () => loadResumeAnalysisQuota(token),
      isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    }),
  }
  quotaRecords.set(token, record)
  return record
}

function retainBrowserRevalidation(token, record) {
  record.consumers += 1
  if (record.consumers !== 1 || typeof window === 'undefined') return

  const refreshIfCurrent = () => {
    if (readStoredAuthToken() !== token) {
      notifyQuotaIdentityChange()
      return
    }
    record.store.refresh()
  }
  const handleVisibilityChange = () => {
    if (readStoredAuthToken() !== token) {
      notifyQuotaIdentityChange()
      return
    }
    record.store.handleVisibilityChange()
  }

  record.handlers = { refreshIfCurrent, handleVisibilityChange }
  window.addEventListener('focus', refreshIfCurrent)
  window.addEventListener('online', refreshIfCurrent)
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function releaseBrowserRevalidation(token, record) {
  record.consumers = Math.max(record.consumers - 1, 0)
  if (record.consumers !== 0) return

  if (record.handlers && typeof window !== 'undefined') {
    window.removeEventListener('focus', record.handlers.refreshIfCurrent)
    window.removeEventListener('online', record.handlers.refreshIfCurrent)
    document.removeEventListener('visibilitychange', record.handlers.handleVisibilityChange)
  }
  record.handlers = null
  if (quotaRecords.get(token) === record) quotaRecords.delete(token)
}

export default function useResumeAnalysisQuota({ enabled = true } = {}) {
  const [, refreshTokenIdentity] = useReducer((value) => value + 1, 0)
  const token = enabled ? readStoredAuthToken() : ''
  const record = useMemo(() => (token ? getQuotaRecord(token) : null), [token])
  const subscribe = useCallback((listener) => (
    record ? record.store.subscribe(listener) : () => {}
  ), [record])
  const state = useSyncExternalStore(
    subscribe,
    record ? record.store.getSnapshot : () => IDLE_STATE,
    record ? record.store.getServerSnapshot : () => IDLE_STATE,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleStorage = (event) => {
      if (event.key === TOKEN_STORAGE_KEY) refreshTokenIdentity()
    }
    const handleIdentityChange = () => refreshTokenIdentity()
    window.addEventListener('storage', handleStorage)
    window.addEventListener(QUOTA_IDENTITY_CHANGE_EVENT, handleIdentityChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(QUOTA_IDENTITY_CHANGE_EVENT, handleIdentityChange)
    }
  }, [])

  useEffect(() => {
    if (!record || !token) return undefined
    retainBrowserRevalidation(token, record)
    return () => releaseBrowserRevalidation(token, record)
  }, [record, token])

  return { ...state, refresh: record ? record.store.refresh : async () => null }
}
