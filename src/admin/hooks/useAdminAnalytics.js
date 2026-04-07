import { useCallback, useEffect, useMemo, useState } from 'react'

function toISODate(value) {
  return value.toISOString().slice(0, 10)
}

function getRangeDates(rangeKey) {
  const end = new Date()
  const start = new Date(end)

  if (rangeKey === '30d') start.setDate(end.getDate() - 29)
  else if (rangeKey === '1y') start.setFullYear(end.getFullYear() - 1)
  else start.setDate(end.getDate() - 89)

  return { startDate: toISODate(start), endDate: toISODate(end) }
}

export default function useAdminAnalytics() {
  const defaults = useMemo(() => getRangeDates('90d'), [])
  const [range, setRange] = useState('90d')
  const [filters, setFilters] = useState(defaults)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAnalytics = useCallback(async ({ silent = false, currentFilters = filters } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError('')

      const params = new URLSearchParams({
        startDate: currentFilters.startDate,
        endDate: currentFilters.endDate,
      })

      const response = await fetch(`/api/admin/analytics?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) {
        throw new Error('Failed to load admin analytics')
      }

      const payload = await response.json()
      setAnalytics(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown analytics error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadAnalytics({ currentFilters: filters })

    const intervalId = window.setInterval(() => {
      void loadAnalytics({ silent: true, currentFilters: filters })
    }, 5 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [filters, loadAnalytics])

  const applyPreset = (nextRange) => {
    setRange(nextRange)
    if (nextRange === 'custom') return
    setFilters(getRangeDates(nextRange))
  }

  const updateCustomDate = (field, value) => {
    setRange('custom')
    setFilters((current) => ({ ...current, [field]: value }))
  }

  const exportCsv = () => {
    const params = new URLSearchParams({ ...filters, export: 'csv' })
    window.open(`/api/admin/analytics?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  return {
    analytics,
    loading,
    error,
    filters,
    range,
    applyPreset,
    updateCustomDate,
    refresh: () => loadAnalytics({ currentFilters: filters }),
    exportCsv,
  }
}
