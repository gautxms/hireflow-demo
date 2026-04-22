import { useCallback, useEffect, useMemo, useState } from 'react'
import API_BASE from '../../config/api'
import { navigateAdmin } from '../config/adminNavigation'
import { adminFetchJson } from '../utils/adminErrorState'
import {
  getSystemPromptSaveErrorMessage,
  SYSTEM_PROMPT_SAVE_PATH,
  SYSTEM_PROMPT_TEXTAREA_CLASS,
} from './adminSystemPromptConfig'

const PROVIDERS = ['anthropic', 'openai']
const KEY_LABELS = ['primary', 'fallback']
const MAX_SYSTEM_PROMPT_LENGTH = 12000

function buildEmptyForm() {
  return {
    activeProvider: 'anthropic',
    governance: {
      aiEnabled: true,
      workflowToggles: {
        resumeAnalysisEnabled: true,
      },
    },
    providers: {
      anthropic: { primary: { apiKey: '', model: '' }, fallback: { apiKey: '', model: '' } },
      openai: { primary: { apiKey: '', model: '' }, fallback: { apiKey: '', model: '' } },
    },
  }
}

function getWarningKey(warning = {}) {
  return `${warning?.provider || ''}:${warning?.keyLabel || ''}:${warning?.model || ''}`
}

function getConnectionTestMetaKey(provider, keyLabel, model) {
  return `${provider}:${keyLabel}:${String(model || '').trim()}`
}

function getModelStatusBadge(warnings = []) {
  if (warnings.some((warning) => warning?.validationTier === 'provider_rejected' || warning?.reason === 'provider_rejected')) {
    return { label: 'Rejected by provider', className: 'bg-admin-danger/10 text-admin-danger border-admin-danger/30' }
  }
  if (warnings.some((warning) => warning?.validationTier === 'valid_unlisted' || warning?.validationTier === 'invalid_format' || warning?.reason === 'invalid_format')) {
    return { label: 'Unlisted', className: 'bg-admin-warning/10 text-admin-warning border-admin-warning/30' }
  }
  return { label: 'Known', className: 'bg-admin-muted/10 text-admin-muted border-admin/60' }
}

function getModelWarningMessage(warning = {}) {
  if (warning?.validationTier === 'invalid_format' || warning?.reason === 'invalid_format') {
    return `Model "${warning.model}" has an invalid format.`
  }
  if (warning?.validationTier === 'provider_rejected' || warning?.reason === 'provider_rejected') {
    return `Model "${warning.model}" was rejected by the provider during runtime validation.`
  }
  if (warning?.validationTier === 'valid_unlisted') {
    return `Model "${warning.model}" is unlisted in the registry but may still be valid.`
  }
  return `Model "${warning.model}" is known in the registry (${warning?.detail || 'status: active'}).`
}

export default function AdminSecurityPage() {
  const [settings, setSettings] = useState(null)
  const [promptSettings, setPromptSettings] = useState(null)
  const [tokenUsageRows, setTokenUsageRows] = useState([])
  const [loadSectionErrors, setLoadSectionErrors] = useState({
    aiSettings: '',
    tokenUsage: '',
    systemPrompt: '',
  })
  const [form, setForm] = useState(buildEmptyForm)
  const [modelWarnings, setModelWarnings] = useState([])
  const [message, setMessage] = useState('')
  const [promptMessage, setPromptMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [syncingProvider, setSyncingProvider] = useState('')
  const [systemPromptInput, setSystemPromptInput] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [connectionStatusByField, setConnectionStatusByField] = useState({})
  const [lastSuccessfulTestsByModel, setLastSuccessfulTestsByModel] = useState({})
  const hydrateFormFromSettings = useCallback((nextSettings) => {
    const settingsProviders = nextSettings?.providers || {}
    return {
      activeProvider: nextSettings?.activeProvider || 'anthropic',
      governance: {
        aiEnabled: nextSettings?.governance?.aiEnabled !== false,
        workflowToggles: {
          resumeAnalysisEnabled: nextSettings?.governance?.workflowToggles?.resumeAnalysisEnabled !== false,
        },
      },
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
    const [settingsResult, analyticsResult, promptResult] = await Promise.allSettled([
      adminFetchJson(`${API_BASE}/admin/ai-settings`),
      adminFetchJson(`${API_BASE}/admin/analytics/token-usage`),
      adminFetchJson(`${API_BASE}${SYSTEM_PROMPT_SAVE_PATH}`),
    ])

    const nextErrors = {
      aiSettings: '',
      tokenUsage: '',
      systemPrompt: '',
    }

    if (settingsResult.status === 'fulfilled') {
      const settingsPayload = settingsResult.value
      setSettings(settingsPayload)
      setForm(hydrateFormFromSettings(settingsPayload))
      setModelWarnings(Array.isArray(settingsPayload?.modelWarnings) ? settingsPayload.modelWarnings : [])
      setConnectionStatusByField({})
      setLastSuccessfulTestsByModel(settingsPayload?.metadata?.connectionTestsByModel || {})
    } else {
      nextErrors.aiSettings = 'Couldn’t load AI settings. Showing last known configuration.'
    }

    if (analyticsResult.status === 'fulfilled') {
      const analyticsPayload = analyticsResult.value
      setTokenUsageRows(Array.isArray(analyticsPayload?.tokenUsageUploads) ? analyticsPayload.tokenUsageUploads : [])
    } else {
      nextErrors.tokenUsage = 'Couldn’t load token analytics. Showing last known usage values.'
    }

    if (promptResult.status === 'fulfilled') {
      const promptPayload = promptResult.value
      setPromptSettings(promptPayload)
      setSystemPromptInput(promptPayload?.systemPrompt || '')
    } else {
      nextErrors.systemPrompt = 'Couldn’t load prompt, using default fallback.'
    }

    setLoadSectionErrors(nextErrors)
    setLoading(false)
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

  const warningsByField = useMemo(() => {
    const byKey = {}
    for (const warning of modelWarnings) {
      const key = getWarningKey(warning)
      if (!byKey[key]) byKey[key] = []
      byKey[key].push(warning)
    }
    return byKey
  }, [modelWarnings])

  const updateField = useCallback((provider, keyLabel, field, value) => {
    setForm((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          ...current.providers[provider],
          [keyLabel]: {
            ...current.providers[provider][keyLabel],
            [field]: value,
          },
        },
      },
    }))

    setConnectionStatusByField((current) => {
      const next = { ...current }
      delete next[`${provider}:${keyLabel}`]
      return next
    })
  }, [])

  const validateForm = useCallback(() => {
    if (!PROVIDERS.includes(form.activeProvider)) {
      return 'Active provider must be anthropic or openai.'
    }

    for (const provider of PROVIDERS) {
      for (const keyLabel of KEY_LABELS) {
        const model = String(form?.providers?.[provider]?.[keyLabel]?.model || '').trim()
        if (!model) {
          return `${provider} ${keyLabel} model is required.`
        }
      }
    }

    return ''
  }, [form])

  const governanceChecklist = useMemo(() => {
    const activeProviderConfigured = settings?.providers?.[form.activeProvider]
    const hasPrimaryKey = Boolean(activeProviderConfigured?.primary?.configured)
    const hasFallbackKey = Boolean(activeProviderConfigured?.fallback?.configured)

    return [
      {
        label: 'Global AI analysis enabled',
        ok: form?.governance?.aiEnabled !== false,
      },
      {
        label: 'Resume analysis workflow enabled',
        ok: form?.governance?.workflowToggles?.resumeAnalysisEnabled !== false,
      },
      {
        label: 'Active provider has primary key',
        ok: hasPrimaryKey,
      },
      {
        label: 'Fallback key is configured',
        ok: hasFallbackKey,
      },
      {
        label: 'System prompt is versioned',
        ok: Number(promptSettings?.promptVersion || 0) > 0,
      },
    ]
  }, [form.activeProvider, form?.governance?.aiEnabled, form?.governance?.workflowToggles?.resumeAnalysisEnabled, promptSettings?.promptVersion, settings?.providers])

  const save = useCallback(async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const validationError = validateForm()
    if (validationError) {
      setFieldError(validationError)
      setSaving(false)
      return
    }

    setFieldError('')
    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/ai-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          providerValidationResults: Object.entries(connectionStatusByField).map(([fieldKey, status]) => {
            const [provider, keyLabel] = String(fieldKey || '').split(':')
            const model = String(form?.providers?.[provider]?.[keyLabel]?.model || '').trim()
            return {
              provider,
              keyLabel,
              model,
              state: status?.state || 'unknown',
              error: status?.providerError || null,
              testedAt: status?.testedAt || null,
              successfulAt: status?.successfulAt || null,
            }
          }),
          metadata: {
            ...(settings?.metadata || {}),
            connectionTestsByModel: {
              ...(settings?.metadata?.connectionTestsByModel || {}),
              ...lastSuccessfulTestsByModel,
            },
          },
        }),
      })
      setSettings(payload.settings || null)
      setForm(hydrateFormFromSettings(payload.settings || null))
      setModelWarnings(Array.isArray(payload?.modelWarnings) ? payload.modelWarnings : [])
      setLastSuccessfulTestsByModel(payload?.settings?.metadata?.connectionTestsByModel || {})
      setMessage('AI settings saved.')
      setConnectionStatusByField({})
    } catch (error) {
      setMessage(error?.payload?.error || 'Unable to save AI settings.')
    } finally {
      setSaving(false)
    }
  }, [connectionStatusByField, form, hydrateFormFromSettings, lastSuccessfulTestsByModel, settings?.metadata, validateForm])

  const saveSystemPrompt = useCallback(async (event) => {
    event.preventDefault()
    setSavingPrompt(true)
    setPromptMessage('')
    try {
      const payload = await adminFetchJson(`${API_BASE}${SYSTEM_PROMPT_SAVE_PATH}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: systemPromptInput }),
      })
      setPromptSettings(payload?.prompt || null)
      setSystemPromptInput(payload?.prompt?.systemPrompt || '')
      setPromptMessage('System prompt saved.')
    } catch (error) {
      setPromptMessage(getSystemPromptSaveErrorMessage(error))
    } finally {
      setSavingPrompt(false)
    }
  }, [systemPromptInput])

  const testConnection = useCallback(async (provider, keyLabel) => {
    const model = String(form?.providers?.[provider]?.[keyLabel]?.model || '').trim()
    const apiKey = String(form?.providers?.[provider]?.[keyLabel]?.apiKey || '').trim()
    const key = `${provider}:${keyLabel}`

    if (!model) {
      setConnectionStatusByField((current) => ({
        ...current,
        [key]: { state: 'error', message: 'Model is required before running a connection test.' },
      }))
      return
    }

    setConnectionStatusByField((current) => ({
      ...current,
      [key]: { state: 'loading', message: 'Testing connection…' },
    }))

    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/ai-settings/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, keyLabel, model, apiKey }),
      })
      setConnectionStatusByField((current) => ({
        ...current,
        [key]: {
          state: 'success',
          message: payload?.message || 'Connection successful.',
          testedAt: payload?.testedAt || new Date().toISOString(),
          successfulAt: payload?.successfulAt || new Date().toISOString(),
        },
      }))
      const successfulAt = payload?.successfulAt || new Date().toISOString()
      setLastSuccessfulTestsByModel((current) => ({
        ...current,
        [getConnectionTestMetaKey(provider, keyLabel, model)]: successfulAt,
      }))
    } catch (error) {
      const details = error?.payload?.error?.message || error?.payload?.error || error?.payload?.message || 'Connection test failed.'
      setConnectionStatusByField((current) => ({
        ...current,
        [key]: {
          state: 'error',
          message: String(details),
          providerError: error?.payload?.error && typeof error.payload.error === 'object' ? error.payload.error : null,
        },
      }))
    }
  }, [form])

  const refreshProviderModels = useCallback(async (provider) => {
    setMessage('')
    setSyncingProvider(provider)
    try {
      const payload = await adminFetchJson(`${API_BASE}/admin/ai-settings/sync-models?provider=${provider}`, {
        method: 'POST',
      })
      setSettings(payload?.settings || null)
      setForm(hydrateFormFromSettings(payload?.settings || null))
      setModelWarnings(Array.isArray(payload?.modelWarnings) ? payload.modelWarnings : [])
      setMessage(`Refreshed ${provider} models (${Number(payload?.discovered || 0)} discovered).`)
    } catch (error) {
      const details = error?.payload?.error || 'Model sync unavailable. Manual model entry remains available.'
      setMessage(String(details))
    } finally {
      setSyncingProvider('')
    }
  }, [hydrateFormFromSettings])

  if (loading) {
    return <div className="admin-page"><section className="ui-card p-4">Loading AI settings…</section></div>
  }

  return (
    <div className="admin-page">
      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Resume AI provider keys</h2>
        <p className="mt-1 text-sm text-admin-body">Set active provider plus primary/fallback API keys and models for Anthropic and OpenAI.</p>
        {loadSectionErrors.aiSettings ? (
          <p className="mt-2 text-xs text-admin-warning">{loadSectionErrors.aiSettings}</p>
        ) : null}
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={save}>
          <label className="text-sm text-admin-body">Active provider
            <select className="mt-1 w-full rounded border border-admin px-2 py-2" value={form.activeProvider} onChange={(e) => setForm((c) => ({ ...c, activeProvider: e.target.value }))}>
              {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <div />
          {PROVIDERS.map((provider) => (
            <div className="md:col-span-2 grid gap-3" key={provider}>
              <p className="text-sm font-semibold text-admin-strong capitalize">{provider}</p>
              <div>
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => refreshProviderModels(provider)}
                  disabled={syncingProvider === provider}
                >
                  {syncingProvider === provider ? 'Refreshing…' : 'Refresh models'}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {KEY_LABELS.map((keyLabel) => {
                  const model = form.providers?.[provider]?.[keyLabel]?.model || ''
                  const warningKey = getWarningKey({ provider, keyLabel, model })
                  const warnings = warningsByField[warningKey] || []
                  const statusBadge = getModelStatusBadge(warnings)
                  const connectionStatus = connectionStatusByField[`${provider}:${keyLabel}`]
                  const lastSuccessfulTestAt = lastSuccessfulTestsByModel[getConnectionTestMetaKey(provider, keyLabel, model)]
                  const providerModelRegistry = Array.isArray(settings?.providers?.[provider]?.modelRegistry)
                    ? settings.providers[provider].modelRegistry
                    : []
                  const modelSuggestions = providerModelRegistry
                    .filter((row) => ['active', 'experimental', 'untested'].includes(String(row?.status || '').trim().toLowerCase() || 'active'))
                    .map((row) => String(row?.modelId || '').trim())
                    .filter(Boolean)
                  return (
                    <div className="rounded border border-admin p-3" key={`${provider}:${keyLabel}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-admin-muted">{keyLabel}</p>
                      <label className="mt-2 block text-sm text-admin-body">{provider} {keyLabel} API key
                        <input className="mt-1 w-full rounded border border-admin px-2 py-2" type="password" value={form.providers[provider][keyLabel].apiKey} onChange={(e) => updateField(provider, keyLabel, 'apiKey', e.target.value)} placeholder={settings?.providers?.[provider]?.[keyLabel]?.maskedApiKey || ''} />
                      </label>
                      <label className="mt-2 block text-sm text-admin-body">{provider} {keyLabel} model
                        <input
                          className="mt-1 w-full rounded border border-admin px-2 py-2"
                          value={model}
                          onChange={(e) => updateField(provider, keyLabel, 'model', e.target.value)}
                          placeholder={settings?.providers?.[provider]?.[keyLabel]?.model || settings?.providers?.[provider]?.defaultModel || ''}
                          list={`${provider}-${keyLabel}-models`}
                        />
                      </label>
                      <datalist id={`${provider}-${keyLabel}-models`}>
                        {modelSuggestions.map((modelId) => <option key={modelId} value={modelId} />)}
                      </datalist>
                      <p className="mt-1 text-xs text-admin-muted">Use exact provider model ID; new models are allowed.</p>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className={`inline-flex rounded border px-2 py-1 font-semibold ${statusBadge.className}`}>
                          {statusBadge.label}
                        </span>
                        {lastSuccessfulTestAt ? (
                          <span className="text-admin-muted">
                            Last successful test: {new Date(lastSuccessfulTestAt).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-admin-muted">Last successful test: Not recorded</span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" className="ui-btn" onClick={() => testConnection(provider, keyLabel)} disabled={connectionStatus?.state === 'loading'}>
                          {connectionStatus?.state === 'loading' ? 'Testing…' : 'Test connection'}
                        </button>
                        {connectionStatus?.message ? (
                          <span className={`text-xs ${connectionStatus.state === 'error' ? 'text-admin-danger' : 'text-admin-muted'}`}>
                            {connectionStatus.message}
                          </span>
                        ) : null}
                      </div>
                      {warnings.length > 0 ? (
                        <ul className="mt-2 list-disc pl-5 text-xs text-admin-warning">
                          {warnings.map((warning, index) => (
                            <li key={`${warning.source}-${index}`}>
                              {getModelWarningMessage(warning)}
                              {Array.isArray(warning?.remediationSteps) && warning.remediationSteps.length > 0
                                ? ` Next: ${warning.remediationSteps.join(' ')}`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="md:col-span-2 flex items-center gap-2">
            <button type="submit" className="ui-btn" disabled={saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
            {fieldError ? <span className="text-xs text-admin-danger">{fieldError}</span> : null}
            {!fieldError && message ? <span className="text-xs text-admin-muted">{message}</span> : null}
          </div>
        </form>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">AI governance controls</h2>
        <p className="mt-1 text-sm text-admin-body">Toggle global/workflow AI usage and review readiness posture.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded border border-admin p-3 text-sm text-admin-body">
            <input
              type="checkbox"
              checked={form?.governance?.aiEnabled !== false}
              onChange={(event) => setForm((current) => ({
                ...current,
                governance: {
                  ...current.governance,
                  aiEnabled: event.target.checked,
                },
              }))}
            />
            Global AI analysis enabled
          </label>
          <label className="flex items-center gap-2 rounded border border-admin p-3 text-sm text-admin-body">
            <input
              type="checkbox"
              checked={form?.governance?.workflowToggles?.resumeAnalysisEnabled !== false}
              onChange={(event) => setForm((current) => ({
                ...current,
                governance: {
                  ...current.governance,
                  workflowToggles: {
                    ...current.governance.workflowToggles,
                    resumeAnalysisEnabled: event.target.checked,
                  },
                },
              }))}
            />
            Resume analysis workflow enabled
          </label>
        </div>
        <div className="mt-4 rounded border border-admin p-3">
          <p className="text-sm font-semibold text-admin-strong">Security & operations checklist</p>
          <ul className="mt-2 space-y-1 text-sm">
            {governanceChecklist.map((item) => (
              <li key={item.label} className={item.ok ? 'text-admin-muted' : 'text-admin-danger'}>
                {item.ok ? '✅' : '⚠️'} {item.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Resume analysis system prompt</h2>
        <p className="mt-1 text-sm text-admin-body">Manage the shared system prompt used at runtime for provider-agnostic resume parsing.</p>
        {loadSectionErrors.systemPrompt ? (
          <p className="mt-2 text-xs text-admin-warning">{loadSectionErrors.systemPrompt}</p>
        ) : null}
        <form className="mt-4 grid w-full min-w-0 gap-3" onSubmit={saveSystemPrompt}>
          <label className="text-sm text-admin-body" htmlFor="systemPromptInput">System prompt</label>
          <p className="text-xs text-admin-muted">Use this prompt to control extraction + JD matching behavior.</p>
          <textarea
            id="systemPromptInput"
            className={SYSTEM_PROMPT_TEXTAREA_CLASS}
            rows={12}
            value={systemPromptInput}
            onChange={(e) => setSystemPromptInput(e.target.value)}
            placeholder="Enter the system prompt used by resume parsing."
          />
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-admin px-1 py-1 text-xs text-admin-muted">
            Version: <strong>{Number(promptSettings?.promptVersion || 1)}</strong>
            {' · '}
            Last updated: <strong>{promptSettings?.updatedAt ? new Date(promptSettings.updatedAt).toLocaleString() : 'Not updated yet'}</strong>
            {' · '}
            Characters: <strong>{systemPromptInput.length.toLocaleString()}</strong> / <strong>{MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()}</strong>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="ui-btn" disabled={savingPrompt}>{savingPrompt ? 'Saving…' : 'Save system prompt'}</button>
            {promptMessage ? <span className="text-xs text-admin-muted">{promptMessage}</span> : null}
          </div>
        </form>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-admin-strong">Token usage by key</h2>
        <p className="mt-1 text-sm text-admin-body">Track token and estimated cost consumption separately for primary and fallback keys.</p>
        {loadSectionErrors.tokenUsage ? (
          <p className="mt-2 text-xs text-admin-warning">{loadSectionErrors.tokenUsage}</p>
        ) : null}
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
