import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { adminFetchJson, getMappedError } from '../utils/adminErrorState'
import useAdminUxTracking from './useAdminUxTracking'

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
  const { emitAdminEvent } = useAdminUxTracking()
  const defaults = useMemo(() => getRangeDates('90d'), [])
  const [range, setRange] = useState('90d')
  const [filters, setFilters] = useState(defaults)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadAnalytics = useCallback(async ({ silent = false, currentFilters = filters } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError(null)

      const params = new URLSearchParams({ startDate: currentFilters.startDate, endDate: currentFilters.endDate })
      const payload = await adminFetchJson(`${API_BASE}/admin/analytics?${params.toString()}`, 'Failed to load admin analytics')

      setAnalytics({
        filters: payload.filters,
        kpis: payload.kpis || {},
        conversionFunnel: payload.conversionFunnel || {},
        parsingTrend: payload.parsingTrend || [],
        planBreakdown: payload.planBreakdown || [],
        revenueTrend: payload.revenueTrend || [],
        userGrowth: payload.userGrowth || [],
        retentionCohorts: payload.retentionCohorts || [],
        uxBlockers: payload.uxBlockers || [],
        uxWeeklyReport: payload.uxWeeklyReport || null,
        generatedAt: payload.generatedAt,
      })
    } catch (err) {
      void emitAdminEvent({
        eventType: 'admin_page_load_failed',
        route: '/admin/analytics',
        metadata: { reason: err?.message || 'unknown', source: 'analytics_load' },
      })
      setError(getMappedError(err, 'Analytics could not be loaded.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [emitAdminEvent, filters])

  useEffect(() => {
    void loadAnalytics({ currentFilters: filters })
    const intervalId = window.setInterval(() => {
      void loadAnalytics({ silent: true, currentFilters: filters })
    }, 5 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [filters, loadAnalytics])

  const applyPreset = (nextRange) => {
    setRange(nextRange)
    void emitAdminEvent({ eventType: 'admin_filter_used', route: '/admin/analytics', metadata: { control: 'preset_range', value: nextRange } })
    if (nextRange === 'custom') return
    setFilters(getRangeDates(nextRange))
  }

  const updateCustomDate = (field, value) => {
    setRange('custom')
    setFilters((current) => ({ ...current, [field]: value }))
    void emitAdminEvent({ eventType: 'admin_filter_used', route: '/admin/analytics', metadata: { control: field, value } })
  }

  const exportCsv = () => {
    const params = new URLSearchParams({ ...filters, export: 'csv' })
    void emitAdminEvent({ eventType: 'admin_export_clicked', route: '/admin/analytics', metadata: { exportType: 'csv', filters } })
    window.open(`${API_BASE}/admin/analytics?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  return { analytics, loading, error, filters, range, applyPreset, updateCustomDate, refresh: () => loadAnalytics({ currentFilters: filters }), exportCsv }
}
