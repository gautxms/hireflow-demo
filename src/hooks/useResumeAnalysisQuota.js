import { useCallback, useEffect, useState } from 'react'
import API_BASE from '../config/api'
import { normalizeResumeAnalysisQuota } from '../utils/resumeAnalysisQuota.js'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function useResumeAnalysisQuota({ enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', quota: null })

  const refresh = useCallback(async ({ signal } = {}) => {
    if (!enabled) return null
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      setState({ status: 'unavailable', quota: null })
      return null
    }
    try {
      const response = await fetch(`${API_BASE}/usage/resume-analysis`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load resume allowance')
      const quota = normalizeResumeAnalysisQuota(payload)
      if (!quota) throw new Error('Resume allowance response is incomplete')
      setState({ status: 'success', quota })
      return quota
    } catch (error) {
      if (error.name === 'AbortError') return null
      setState((current) => ({ status: 'unavailable', quota: current.quota }))
      return null
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    refresh({ signal: controller.signal })
    const handleFocus = () => refresh()
    window.addEventListener('focus', handleFocus)
    return () => {
      controller.abort()
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, refresh])

  return { ...state, refresh }
}
