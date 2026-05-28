import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Plus, X } from 'lucide-react'
import API_BASE from '../config/api'
import { buildShortlistSummary, getShortlistBulkErrorMessage } from './shortlistState'
import '../styles/add-to-shortlist-modal.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const SHORTLIST_SESSION_KEY = 'hireflow_last_selected_shortlist'


function resolveCandidateScore(candidate = {}) {
  const possible = [
    candidate?.matchScore?.score,
    candidate?.matchScore,
    candidate?.score,
    candidate?.profile_score,
    candidate?.scoreBreakdown?.overall,
    candidate?.overall_score,
    candidate?.overallScore,
    candidate?.total_score,
    candidate?.totalScore,
  ]
  for (const value of possible) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
  }
  return null
}

function buildCandidateSnapshot(candidate = {}, jobContext = null) {
  const score = resolveCandidateScore(candidate)
  return {
    name: candidate?.name || candidate?.filename || candidate?.resumeName || null,
    score,
    matchScore: score == null ? null : { score },
    recommendation: candidate?.recommendation || candidate?.match_status || null,
    source: 'analysis_results',
    sourceAnalysisId: candidate?.analysisId || candidate?.analysis_id || null,
    associatedJob: {
      id: jobContext?.jobDescriptionId || null,
      title: jobContext?.jobTitle || null,
    },
  }
}

export default function AddToShortlistModal({
  isOpen,
  onClose,
  candidates = [],
  jobContext = null,
  onCompleted,
  shortlistV2Enabled = true,
  addCandidateToShortlistLegacy = null,
}) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const [shortlists, setShortlists] = useState([])
  const [selectedShortlistId, setSelectedShortlistId] = useState('')
  const [newShortlistName, setNewShortlistName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)

  const selectedShortlist = useMemo(() => shortlists.find((item) => item.id === selectedShortlistId) || null, [shortlists, selectedShortlistId])
  const canConfirm = Boolean(selectedShortlistId) && !isSubmitting && !isLoading

  const headers = () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    ;(async () => {
      setIsLoading(true); setError(''); setSummary(null)
      try {
        const response = await fetch(`${API_BASE}/shortlists`, { headers: headers() })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Unable to load shortlists')
        const active = (Array.isArray(payload.shortlists) ? payload.shortlists : []).filter((item) => item.status !== 'archived')
        setShortlists(active)
        const remembered = sessionStorage.getItem(SHORTLIST_SESSION_KEY) || ''
        setSelectedShortlistId(active.some((item) => item.id === remembered) ? remembered : '')
      } catch (e) { setError(e.message || 'Unable to load shortlists. Please retry.') } finally { setIsLoading(false) }
    })()
  }, [isOpen])

  if (!isOpen) return null

  const createInlineShortlist = async () => {
    const name = newShortlistName.trim()
    if (!name) return
    setIsSubmitting(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/shortlists`, { method: 'POST', headers: headers(), body: JSON.stringify({ name, jobDescriptionId: jobContext?.jobDescriptionId || null }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to create shortlist. Please retry.')
      const created = payload.shortlist
      setShortlists((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setSelectedShortlistId(created.id)
      setNewShortlistName('')
    } catch (e) { setError(e.message || 'Unable to create shortlist. Please retry.') } finally { setIsSubmitting(false) }
  }

  const confirmAdd = async () => {
    if (!selectedShortlistId) return
    setIsSubmitting(true); setError(''); setSummary(null)
    try {
      if (!shortlistV2Enabled) {
        if (typeof addCandidateToShortlistLegacy !== 'function') {
          throw new Error('Unable to add candidates. Please retry.')
        }
        let added = 0
        let failed = 0
        for (const candidate of candidates) {
          // Preserve legacy single-candidate shortlist flow when v2 is disabled.
          const ok = await addCandidateToShortlistLegacy(candidate, selectedShortlistId)
          if (ok) added += 1
          else failed += 1
        }
        const legacyPayload = { summary: { added, failed, updated: 0, invalid: 0 } }
        setSummary({ text: buildShortlistSummary(legacyPayload.summary, 'add'), failed: failed > 0 })
        sessionStorage.setItem(SHORTLIST_SESSION_KEY, selectedShortlistId)
        onCompleted?.(legacyPayload, selectedShortlistId)
        return
      }

      const candidateSnapshotByResumeId = {}
      const sourceContextByResumeId = {}
      const resumeIds = candidates.map((c) => String(c.resumeId || c.resume_id || c.id || '')).filter(Boolean)
      candidates.forEach((candidate) => {
        const resumeId = String(candidate?.resumeId || candidate?.resume_id || candidate?.id || '').trim()
        if (!resumeId) return
        candidateSnapshotByResumeId[resumeId] = buildCandidateSnapshot(candidate, jobContext)
        sourceContextByResumeId[resumeId] = {
          source: 'analysis_results',
          analysisId: candidate?.analysisId || candidate?.analysis_id || null,
          score: resolveCandidateScore(candidate),
          matchStatus: candidate?.recommendation || candidate?.match_status || null,
          jobDescriptionId: jobContext?.jobDescriptionId || null,
          jobTitle: jobContext?.jobTitle || null,
        }
      })

      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ resumeIds, candidateSnapshotByResumeId, sourceContextByResumeId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getShortlistBulkErrorMessage(payload) || 'Unable to add candidates. Please retry.')
      const next = payload?.summary || {}
      setSummary({ text: buildShortlistSummary(next, 'add'), failed: Number(next.failed || 0) > 0 })
      sessionStorage.setItem(SHORTLIST_SESSION_KEY, selectedShortlistId)
      onCompleted?.(payload, selectedShortlistId)
    } catch (e) { setError(e.message || 'Unable to add candidates. Please retry.') } finally { setIsSubmitting(false) }
  }

  return <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="atsm-title" aria-describedby="atsm-selection-status" onMouseDown={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}>
    <div className="ui-modal__dialog atsm" ref={dialogRef}>
      <header className="atsm__header"><h2 id="atsm-title">Add to shortlist</h2><button ref={closeRef} className="hf-btn hf-btn--secondary atsm__icon" type="button" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.5} /></button></header>
      <p className="atsm__meta" id="atsm-selection-status" role="status" aria-live="polite">{candidates.length} candidate(s) selected</p>
      {jobContext?.jobTitle ? <p className="atsm__meta">Creating under: {jobContext.jobTitle}</p> : null}
      {error ? <p className="atsm__error" role="alert"><AlertTriangle size={18} strokeWidth={1.5} aria-hidden="true" />{error}</p> : null}
      {summary ? <p className={`atsm__summary ${summary.failed ? 'is-warn' : 'is-ok'}`} role="status" aria-live="polite"><CheckCircle2 size={18} strokeWidth={1.5} aria-hidden="true" />{summary.text}</p> : null}
      <label className="atsm__label" htmlFor="atsm-destination">Destination shortlist<select id="atsm-destination" className="atsm__input" value={selectedShortlistId} onChange={(e) => setSelectedShortlistId(e.target.value)}><option value="">Select shortlist</option>{shortlists.map((s) => {
        const candidateCount = Number(s?.candidate_count || 0)
        const jobLabel = String(s?.job_label || '').trim() || 'General shortlist'
        return <option key={s.id} value={s.id}>{`${s.name} · ${candidateCount} candidate${candidateCount === 1 ? '' : 's'} · ${jobLabel}`}</option>
      })}</select></label>
      <div className="atsm__inline"><label className="atsm__sr-only" htmlFor="atsm-new-shortlist">New shortlist name</label><input id="atsm-new-shortlist" className="atsm__input" value={newShortlistName} onChange={(e) => setNewShortlistName(e.target.value)} placeholder="Create new shortlist" /><button type="button" className="hf-btn hf-btn--secondary" onClick={createInlineShortlist} disabled={isSubmitting || isLoading || !newShortlistName.trim()}><Plus size={18} strokeWidth={1.5} />Create</button></div>
      <p className="atsm__meta">Selected destination: {selectedShortlist?.name || 'None'}</p>
      <footer className="atsm__actions"><button type="button" className="hf-btn hf-btn--secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button><button type="button" className="hf-btn hf-btn--primary" onClick={confirmAdd} disabled={!canConfirm}>{isSubmitting ? 'Adding…' : 'Confirm add'}</button></footer>
    </div>
  </div>
}
