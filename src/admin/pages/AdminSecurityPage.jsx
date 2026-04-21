import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { navigateAdmin } from '../config/adminNavigation'
import { adminFetchJson } from '../utils/adminErrorState'

export default function AdminSecurityPage() {
  const [settings, setSettings] = useState(null)
  const [tokenUsageRows, setTokenUsageRows] = useState([])
  const [form, setForm] = useState({
    activeProvider: 'anthropic',
    providers: {
      anthropic: { primary: { apiKey: '', model: '' }, fallback: { apiKey: '', model: '' } },
      openai: { primary: { apiKey: '', model: '' }, fallback: { apiKey: '', model: '' } },
    },
  })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const hydrateFormFromSettings = useCallback((nextSettings) => {
    const settingsProviders = nextSettings?.providers || {}
    return {
      activeProvider: nextSettings?.activeProvider || 'anthropic',
      providers: {
        anthropic: {
          primary: {
            apiKey: '',
            model: settingsProviders?.anthropic?.primary?.model || settingsProviders?.anthropic?.defaultModel || '',
          },
          fallback: {
            apiKey: '',
            model: settingsProviders?.anthropic?.fallback?.model || settingsProviders?.anthropic?.defaultModel || '',
          },
        },
        openai: {
          primary: {
            apiKey: '',
            model: settingsProviders?.openai?.primary?.model || settingsProviders?.openai?.defaultModel || '',
          },
          fallback: {
            apiKey: '',
            model: settingsProviders?.openai?.fallback?.model || settingsProviders?.openai?.defaultModel || '',
          },
        },
      },
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsPayload, analyticsPayload] = await Promise.all([
        adminFetchJson(`${API_BASE}/admin/ai-settings`),
        adminFetchJson(`${API_BASE}/admin/analytics/token-usage`),
      ])
      setSettings(settingsPayload)
      setForm(hydrateFormFromSettings(settingsPayload))
      setTokenUsageRows(Array.isArray(analyticsPayload?.tokenUsageUploads) ? analyticsPayload.tokenUsageUploads : [])
    } finally {
      setLoading(false)
    }
  }, [hydrateFormFromSettings])

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
      setForm(hydrateFormFromSettings(payload.settings || null))
      setMessage('AI settings saved.')
    } catch (error) {
      setMessage(error?.payload?.error || 'Unable to save AI settings.')
    } finally {
      setSaving(false)
    }
  }, [form, hydrateFormFromSettings])

  if (loading) {
    return <div className="admin-page"><section className="ui-card p-4">Loading AI settings…</section></div>
  }

  return (
    <div className="admin-page">
      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Resume AI provider keys</h2>
        <p className="mt-1 text-sm text-admin-body">Set active provider plus primary/fallback API keys and models for both Anthropic and OpenAI.</p>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={save}>
          <label className="text-sm text-admin-body">Active provider
            <select className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.activeProvider} onChange={(e) => setForm((c) => ({ ...c, activeProvider: e.target.value }))}>
              <option value="anthropic">anthropic</option>
              <option value="openai" disabled>openai (coming soon)</option>
            </select>
          </label>
          <div />
          {['anthropic', 'openai'].map((provider) => (
            <div className="md:col-span-2 grid gap-3 md:grid-cols-2" key={provider}>
              <p className="md:col-span-2 text-sm font-semibold text-admin-strong capitalize">{provider}</p>
              <label className="text-sm text-admin-body">{provider} primary API key
                <input className="mt-1 w-full rounded border border-admin px-2 py-2" type="password" value={form.providers[provider].primary.apiKey} onChange={(e) => setForm((c) => ({ ...c, providers: { ...c.providers, [provider]: { ...c.providers[provider], primary: { ...c.providers[provider].primary, apiKey: e.target.value } } } }))} placeholder={settings?.providers?.[provider]?.primary?.maskedApiKey || ''} />
              </label>
              <label className="text-sm text-admin-body">{provider} fallback API key
                <input className="mt-1 w-full rounded border border-admin px-2 py-2" type="password" value={form.providers[provider].fallback.apiKey} onChange={(e) => setForm((c) => ({ ...c, providers: { ...c.providers, [provider]: { ...c.providers[provider], fallback: { ...c.providers[provider].fallback, apiKey: e.target.value } } } }))} placeholder={settings?.providers?.[provider]?.fallback?.maskedApiKey || ''} />
              </label>
              <label className="text-sm text-admin-body">{provider} primary model
                <input className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.providers[provider].primary.model} onChange={(e) => setForm((c) => ({ ...c, providers: { ...c.providers, [provider]: { ...c.providers[provider], primary: { ...c.providers[provider].primary, model: e.target.value } } } }))} placeholder={settings?.providers?.[provider]?.primary?.model || settings?.providers?.[provider]?.defaultModel || ''} />
              </label>
              <label className="text-sm text-admin-body">{provider} fallback model
                <input className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.providers[provider].fallback.model} onChange={(e) => setForm((c) => ({ ...c, providers: { ...c.providers, [provider]: { ...c.providers[provider], fallback: { ...c.providers[provider].fallback, model: e.target.value } } } }))} placeholder={settings?.providers?.[provider]?.fallback?.model || settings?.providers?.[provider]?.defaultModel || ''} />
              </label>
            </div>
          ))}
          <div className="md:col-span-2 flex items-center gap-2">
            <button type="submit" className="ui-btn" disabled={saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
            {message ? <span className="text-xs text-admin-muted">{message}</span> : null}
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
