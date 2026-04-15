import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'

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

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'include' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load admin analytics')
  }
  return payload
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

      const payload = await fetchJson(`${API_BASE}/admin/analytics?${params.toString()}`)

      setAnalytics({
        filters: payload.filters,
        kpis: payload.kpis || {},
        conversionFunnel: payload.conversionFunnel || {},
        parsingTrend: payload.parsingTrend || [],
        planBreakdown: payload.planBreakdown || [],
        revenueTrend: payload.revenueTrend || [],
        userGrowth: payload.userGrowth || [],
        retentionCohorts: payload.retentionCohorts || [],
        generatedAt: payload.generatedAt,
      })
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
    window.open(`${API_BASE}/admin/analytics?${params.toString()}`, '_blank', 'noopener,noreferrer')
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
