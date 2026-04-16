import { useCallback } from 'react'
import API_BASE from '../../config/api'

export default function useAdminUxTracking() {
  const emitAdminEvent = useCallback(async ({ eventType, route = window.location.pathname, metadata = {} }) => {
    try {
      await fetch(`${API_BASE}/admin/ux/events`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, route, metadata }),
      })
    } catch {
      // UX telemetry should never break admin workflows.
    }
  }, [])

  const submitPageFeedback = useCallback(async ({ isUseful, comment = '', route = window.location.pathname }) => {
    const response = await fetch(`${API_BASE}/admin/ux/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isUseful, comment, route }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Unable to submit admin page feedback')
    }

    return response.json().catch(() => ({}))
  }, [])

  return { emitAdminEvent, submitPageFeedback }
}
