import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Plus, X } from 'lucide-react'
import API_BASE from '../config/api'
import { buildShortlistSummary, getShortlistBulkErrorMessage } from './shortlistState'
import '../styles/add-to-shortlist-modal.css'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const SHORTLIST_SESSION_KEY = 'hireflow_last_selected_shortlist'

export default function AddToShortlistModal({ isOpen, onClose, candidates = [], jobContext = null, onCompleted }) {
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
  const canConfirm = Boolean(selectedShortlistId) && !isSubmitting

  const headers = () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
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
      const response = await fetch(`${API_BASE}/shortlists/${selectedShortlistId}/candidates/batch`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ resumeIds: candidates.map((c) => String(c.resumeId || c.resume_id || c.id || '')).filter(Boolean) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getShortlistBulkErrorMessage(payload) || 'Unable to add candidates. Please retry.')
      const next = payload?.summary || {}
      setSummary({ text: buildShortlistSummary(next, 'add'), failed: Number(next.failed || 0) > 0 })
      sessionStorage.setItem(SHORTLIST_SESSION_KEY, selectedShortlistId)
      onCompleted?.(payload, selectedShortlistId)
    } catch (e) { setError(e.message || 'Unable to add candidates. Please retry.') } finally { setIsSubmitting(false) }
  }

  return <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="atsm-title" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="ui-modal__dialog atsm" ref={dialogRef}>
      <header className="atsm__header"><h2 id="atsm-title">Add to shortlist</h2><button ref={closeRef} className="hf-btn hf-btn--secondary atsm__icon" type="button" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={1.5} /></button></header>
      <p className="atsm__meta">{candidates.length} candidate(s) selected{jobContext?.jobTitle ? ` • Job: ${jobContext.jobTitle}` : ''}</p>
      {error ? <p className="atsm__error" role="alert"><AlertTriangle size={18} strokeWidth={1.5} />{error}</p> : null}
      {summary ? <p className={`atsm__summary ${summary.failed ? 'is-warn' : 'is-ok'}`} role="status"><CheckCircle2 size={18} strokeWidth={1.5} />{summary.text}</p> : null}
      <label className="atsm__label">Destination shortlist<select className="atsm__input" value={selectedShortlistId} onChange={(e) => setSelectedShortlistId(e.target.value)}><option value="">Select shortlist</option>{shortlists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="atsm__inline"><input className="atsm__input" value={newShortlistName} onChange={(e) => setNewShortlistName(e.target.value)} placeholder="Create new shortlist" /><button type="button" className="hf-btn hf-btn--secondary" onClick={createInlineShortlist} disabled={isSubmitting || !newShortlistName.trim()}><Plus size={18} strokeWidth={1.5} />Create</button></div>
      <p className="atsm__meta">Selected destination: {selectedShortlist?.name || 'None'}</p>
      <footer className="atsm__actions"><button type="button" className="hf-btn hf-btn--secondary" onClick={onClose}>Cancel</button><button type="button" className="hf-btn hf-btn--primary" onClick={confirmAdd} disabled={!canConfirm || isLoading}>{isSubmitting ? 'Adding…' : 'Confirm add'}</button></footer>
    </div>
  </div>
}
