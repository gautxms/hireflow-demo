import { useEffect, useState } from 'react'
import API_BASE from '../config/api'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function parseColumnsInput(value) {
  return String(value || '')
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
}

export default function ReportsPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', columnsText: '', scheduleEnabled: false })

  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  async function loadReports() {
    if (!token) {
      setError('Authentication required.')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError('')

      const response = await fetch(`${API_BASE}/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load report definitions')
      }

      setItems(Array.isArray(payload.items) ? payload.items : [])
    } catch (loadError) {
      setError(loadError.message || 'Unable to load report definitions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReports()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createReport(event) {
    event.preventDefault()

    if (!form.name.trim()) {
      setError('Report name is required.')
      return
    }

    try {
      setSaving(true)
      setError('')

      const response = await fetch(`${API_BASE}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          filters: {},
          columns: parseColumnsInput(form.columnsText),
          scheduleEnabled: form.scheduleEnabled,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create report definition')
      }

      setForm({ name: '', columnsText: '', scheduleEnabled: false })
      await loadReports()
    } catch (createError) {
      setError(createError.message || 'Unable to create report definition')
    } finally {
      setSaving(false)
    }
  }

  async function toggleSchedule(item) {
    try {
      const response = await fetch(`${API_BASE}/reports/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: item.name,
          filters: item.filters || {},
          columns: Array.isArray(item.columns) ? item.columns : [],
          scheduleEnabled: !item.scheduleEnabled,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update report definition')
      }

      setItems((previous) => previous.map((current) => (current.id === item.id ? payload.item : current)))
    } catch (updateError) {
      setError(updateError.message || 'Unable to update report definition')
    }
  }

  async function deleteReport(id) {
    try {
      const response = await fetch(`${API_BASE}/reports/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to delete report definition')
      }

      setItems((previous) => previous.filter((item) => item.id !== id))
    } catch (deleteError) {
      setError(deleteError.message || 'Unable to delete report definition')
    }
  }

  return (
    <main className="route-state">
      <section className="route-state-card">
        <h1>Reports</h1>
        <p>Define reusable report configurations. Background generation is not enabled yet.</p>

        <form onSubmit={createReport} className="reports-page__form">
          <label htmlFor="report-name">Name</label>
          <input id="report-name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />

          <label htmlFor="report-columns">Columns (comma-separated)</label>
          <input
            id="report-columns"
            value={form.columnsText}
            onChange={(event) => setForm((prev) => ({ ...prev, columnsText: event.target.value }))}
            placeholder="candidateName, score, status"
          />

          <label htmlFor="report-schedule">
            <input
              id="report-schedule"
              type="checkbox"
              checked={form.scheduleEnabled}
              onChange={(event) => setForm((prev) => ({ ...prev, scheduleEnabled: event.target.checked }))}
            />
            Enable schedule (off by default)
          </label>

          <button type="submit" className="hf-btn hf-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create report definition'}</button>
        </form>

        {loading && <p>Loading report definitions…</p>}
        {!loading && error && <p role="alert">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p>No report definitions yet.</p>
        )}

        {!loading && items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Columns</th>
                <th>Schedule</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{Array.isArray(item.columns) && item.columns.length > 0 ? item.columns.join(', ') : '—'}</td>
                  <td>{item.scheduleEnabled ? 'Enabled' : 'Disabled'}</td>
                  <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}</td>
                  <td>
                    <button type="button" onClick={() => toggleSchedule(item)} className="hf-btn hf-btn--secondary">
                      {item.scheduleEnabled ? 'Disable schedule' : 'Enable schedule'}
                    </button>{' '}
                    <button type="button" onClick={() => deleteReport(item.id)} className="hf-btn hf-btn--destructive">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
