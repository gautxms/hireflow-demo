import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { navigateAdmin } from '../config/adminNavigation'
import { adminFetchJson } from '../utils/adminErrorState'

export default function AdminSecurityPage() {
  const [settings, setSettings] = useState(null)
  const [tokenUsageRows, setTokenUsageRows] = useState([])
  const [form, setForm] = useState({
    primaryApiKey: '',
    fallbackApiKey: '',
    primaryModel: '',
    fallbackModel: '',
  })
  const [systemPrompt, setSystemPrompt] = useState('')
  const [promptMeta, setPromptMeta] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsPayload, analyticsPayload, promptPayload] = await Promise.all([
        adminFetchJson(`${API_BASE}/admin/ai-settings`),
        adminFetchJson(`${API_BASE}/admin/analytics/token-usage`),
        adminFetchJson(`${API_BASE}/admin/system-prompt`),
      ])
      setSettings(settingsPayload)
      setTokenUsageRows(Array.isArray(analyticsPayload?.tokenUsageUploads) ? analyticsPayload.tokenUsageUploads : [])
      setSystemPrompt(String(promptPayload?.systemPrompt || ''))
      setPromptMeta({
        promptVersion: Number(promptPayload?.promptVersion || 1),
        updatedAt: promptPayload?.updatedAt || null,
        maxLength: Number(promptPayload?.maxLength || 12000),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const tokenUsageByKey = useMemo(() => {
    return tokenUsageRows.reduce((acc, row) => {
      const provider = String(row?.provider || '')
      const key = provider.includes('fallback') ? 'fallback' : 'primary'
      const existing = acc[key] || { totalTokens: 0, totalEstimatedCostUsd: 0, runs: 0 }
      existing.totalTokens += Number(row?.totalTokens || 0)
      existing.totalEstimatedCostUsd += Number(row?.estimatedCostUsd || 0)
      existing.runs += 1
      acc[key] = existing
      return acc
    }, {})
  }, [tokenUsageRows])

  const save = useCallback(async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/ai-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setSettings(payload.settings || null)
      setForm((current) => ({ ...current, primaryApiKey: '', fallbackApiKey: '' }))
      setMessage('AI settings saved.')
    } catch (error) {
      setMessage(error?.payload?.error || 'Unable to save AI settings.')
    } finally {
      setSaving(false)
    }
  }, [form])


  const saveSystemPrompt = useCallback(async (event) => {
    event.preventDefault()
    setSavingPrompt(true)
    setMessage('')
    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/system-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt }),
      })
      setSystemPrompt(String(payload?.systemPrompt || systemPrompt))
      setPromptMeta({
        promptVersion: Number(payload?.promptVersion || 1),
        updatedAt: payload?.updatedAt || null,
        maxLength: Number(payload?.maxLength || 12000),
      })
      setMessage(`System prompt saved (v${Number(payload?.promptVersion || 1)}).`)
    } catch (error) {
      setMessage(error?.payload?.error || 'Unable to save system prompt.')
    } finally {
      setSavingPrompt(false)
    }
  }, [systemPrompt])

  if (loading) {
    return <div className="admin-page"><section className="ui-card p-4">Loading AI settings…</section></div>
  }

  return (
    <div className="admin-page">
      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Resume AI provider keys</h2>
        <p className="mt-1 text-sm text-admin-body">Set primary and fallback AI API keys for resume analysis. Parsing now runs as AI-only; fallback key is used if the primary request fails.</p>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={save}>
          <label className="text-sm text-admin-body">Primary API key
            <input className="mt-1 w-full rounded border border-admin px-2 py-2" type="password" value={form.primaryApiKey} onChange={(e) => setForm((c) => ({ ...c, primaryApiKey: e.target.value }))} placeholder={settings?.primary?.maskedApiKey || 'sk-ant-...'} />
          </label>
          <label className="text-sm text-admin-body">Fallback API key
            <input className="mt-1 w-full rounded border border-admin px-2 py-2" type="password" value={form.fallbackApiKey} onChange={(e) => setForm((c) => ({ ...c, fallbackApiKey: e.target.value }))} placeholder={settings?.fallback?.maskedApiKey || 'sk-ant-...'} />
          </label>
          <label className="text-sm text-admin-body">Primary model
            <input className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.primaryModel} onChange={(e) => setForm((c) => ({ ...c, primaryModel: e.target.value }))} placeholder={settings?.primary?.model || settings?.defaultModel || ''} />
          </label>
          <label className="text-sm text-admin-body">Fallback model
            <input className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.fallbackModel} onChange={(e) => setForm((c) => ({ ...c, fallbackModel: e.target.value }))} placeholder={settings?.fallback?.model || settings?.defaultModel || ''} />
          </label>
          <div className="md:col-span-2 flex items-center gap-2">
            <button type="submit" className="ui-btn" disabled={saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
            {message ? <span className="text-xs text-admin-muted">{message}</span> : null}
          </div>
        </form>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Common system prompt</h2>
        <p className="mt-1 text-sm text-admin-body">This prompt is shared across AI providers so Claude/OpenAI runs use the same parsing instructions.</p>
        <form className="mt-4 grid gap-3" onSubmit={saveSystemPrompt}>
          <label className="text-sm text-admin-body">System prompt
            <textarea
              className="mt-1 min-h-56 w-full rounded border border-admin px-2 py-2"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              maxLength={promptMeta?.maxLength || 12000}
            />
          </label>
          <div className="flex items-center justify-between gap-3 text-xs text-admin-muted">
            <span>
              Version: <strong>{Number(promptMeta?.promptVersion || 1)}</strong>
              {promptMeta?.updatedAt ? ` • Updated ${new Date(promptMeta.updatedAt).toLocaleString()}` : ' • Using default prompt'}
            </span>
            <span>{systemPrompt.length}/{promptMeta?.maxLength || 12000}</span>
          </div>
          <div>
            <button type="submit" className="ui-btn" disabled={savingPrompt}>{savingPrompt ? 'Saving prompt…' : 'Save system prompt'}</button>
          </div>
        </form>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Token usage by key</h2>
        <p className="mt-1 text-sm text-admin-body">Track token and estimated cost consumption separately for primary and fallback keys.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded border border-admin p-3">
            <p className="text-admin-muted">Primary key</p>
            <p className="mt-1">Runs: <strong>{Number(tokenUsageByKey.primary?.runs || 0)}</strong></p>
            <p>Tokens: <strong>{Number(tokenUsageByKey.primary?.totalTokens || 0).toLocaleString()}</strong></p>
            <p>Est. cost: <strong>${Number(tokenUsageByKey.primary?.totalEstimatedCostUsd || 0).toFixed(4)}</strong></p>
          </div>
          <div className="rounded border border-admin p-3">
            <p className="text-admin-muted">Fallback key</p>
            <p className="mt-1">Runs: <strong>{Number(tokenUsageByKey.fallback?.runs || 0)}</strong></p>
            <p>Tokens: <strong>{Number(tokenUsageByKey.fallback?.totalTokens || 0).toLocaleString()}</strong></p>
            <p>Est. cost: <strong>${Number(tokenUsageByKey.fallback?.totalEstimatedCostUsd || 0).toFixed(4)}</strong></p>
          </div>
        </div>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Session controls</h2>
        <p className="mt-1 text-sm text-admin-body">Manage admin authentication settings and quickly access the sign-in controls.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="ui-btn" onClick={() => navigateAdmin('/admin/login')}>
            Open admin sign-in
          </button>
          <button type="button" className="ui-btn" onClick={() => navigateAdmin('/admin/setup-2fa')}>
            Open 2FA setup wizard
          </button>
        </div>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Security checklist</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-admin-body">
          <li>Require 2FA for every admin account.</li>
          <li>Rotate backup codes and store them offline.</li>
          <li>Review suspicious access weekly in Logs.</li>
          <li>Revoke old sessions after staffing changes.</li>
        </ul>
      </section>
    </div>
  )
}
