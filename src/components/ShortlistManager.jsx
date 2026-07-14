import { useMemo, useState } from 'react'
import { Plus, Search, RefreshCw, Briefcase, CalendarDays, Trash2, FileText } from 'lucide-react'
import {
  getShortlistJobLabel,
  hasShortlistLinkedJob,
  formatShortlistCandidateScore,
  getRatingValue,
  getShortlistAnalysisHref,
} from './shortlistState'
import './ShortlistManager.css'

const PAGE_SIZE = 15

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return date.toLocaleDateString()
}


function getCandidateSnapshot(candidate) {
  return candidate?.candidate_snapshot && typeof candidate.candidate_snapshot === 'object' ? candidate.candidate_snapshot : {}
}

function getCandidateDisplayName(candidate) {
  const snapshot = getCandidateSnapshot(candidate)
  return String(snapshot.name || candidate?.name || candidate?.filename || candidate?.resume_id || '').trim() || 'Unnamed candidate'
}

function getCandidateFileLabel(candidate) {
  const snapshot = getCandidateSnapshot(candidate)
  return String(candidate?.filename || snapshot.resumeName || snapshot.filename || candidate?.resume_id || '').trim()
}

function getRankingNote(candidate, displayName) {
  const note = String(candidate?.notes || '').trim()
  if (!note.toLowerCase().startsWith('added from ranking:')) return ''

  const noteName = note.replace(/^added from ranking:\s*/i, '').trim()
  if (!noteName || noteName.toLowerCase() === 'unknown candidate') return ''
  if (displayName && noteName.toLowerCase() === displayName.toLowerCase()) return ''
  return `Added from ranking: ${noteName}`
}

function getCandidateDescription(candidate, displayName) {
  const note = String(candidate?.notes || '').trim()
  if (!note) return ''
  if (note.toLowerCase().startsWith('added from ranking:')) return getRankingNote(candidate, displayName)
  return note
}

function isAddedThisWeek(value) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  const weekAgo = new Date(now)
  weekAgo.setDate(now.getDate() - 7)
  return date >= weekAgo && date <= now
}

export default function ShortlistManager(props) {
  const {
    shortlists,
    selectedShortlistId,
    shortlistDetails,
    currentSort,
    onSelectShortlist,
    onCreateShortlist,
    onChangeSort,
    onRetry,
    onRemoveCandidate,
    loadingList,
    loadingDetails,
    error,
    jobDescriptions = [],
    readOnly = false,
  } = props

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [createError, setCreateError] = useState('')
  const [jobFilter, setJobFilter] = useState('all')
  const [createJobDescriptionId, setCreateJobDescriptionId] = useState('')

  const selectedShortlist = useMemo(() => shortlists.find((item) => item.id === selectedShortlistId) || null, [shortlists, selectedShortlistId])

  const resetFilters = () => {
    setCurrentPage(1)
    setQuery('')
    setJobFilter('all')
  }

  const shortlistJobOptions = useMemo(() => {
    const map = new Map()
    let hasGeneralOnly = false
    ;(Array.isArray(jobDescriptions) ? jobDescriptions : []).forEach((job) => {
      const value = String(job?.id || '').trim()
      const label = String(job?.title || job?.name || '').trim() || (value ? `Job ${value}` : '')
      if (value && label) map.set(value, { value, label })
    })

    shortlists.forEach((list) => {
      if (hasShortlistLinkedJob(list)) {
        const label = getShortlistJobLabel(list)
        const value = String(list.job_description_id || label).trim()
        map.set(value, { value, label })
      } else {
        hasGeneralOnly = true
      }
    })

    const options = [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
    if (hasGeneralOnly) {
      options.push({ value: 'general', label: 'General / no linked job' })
    }
    return options
  }, [jobDescriptions, shortlists])

  const createJobOptions = useMemo(() => {
    return (Array.isArray(jobDescriptions) ? jobDescriptions : [])
      .map((job) => {
        const id = String(job?.id || '').trim()
        const label = String(job?.title || job?.name || '').trim() || (id ? `Job ${id}` : '')
        return id && label ? { id, label } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [jobDescriptions])

  const visibleShortlists = useMemo(() => {
    const q = query.trim().toLowerCase()
    return shortlists.filter((list) => {
      const jobLabel = getShortlistJobLabel(list)
      const jobFilterValue = hasShortlistLinkedJob(list) ? String(list.job_description_id || jobLabel).trim() : 'general'
      const shortlistMatch = !q || `${list.name || ''} ${list.description || ''} ${jobLabel}`.toLowerCase().includes(q)
      const jobMatch = jobFilter === 'all' || jobFilterValue === jobFilter
      return shortlistMatch && jobMatch
    })
  }, [jobFilter, query, shortlists])

  const selectedShortlistIsVisible = Boolean(selectedShortlist && visibleShortlists.some((list) => list.id === selectedShortlist.id))
  const allCandidates = useMemo(() => (selectedShortlistIsVisible ? shortlistDetails?.candidates || [] : []), [selectedShortlistIsVisible, shortlistDetails?.candidates])

  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allCandidates
    return allCandidates.filter((candidate) => `${getCandidateDisplayName(candidate)} ${getCandidateFileLabel(candidate)} ${candidate.resume_id || ''} ${candidate.notes || ''}`.toLowerCase().includes(q))
  }, [allCandidates, query])

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE))
  const paginatedCandidates = filteredCandidates.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const hasShortlists = shortlists.length > 0
  const hasSelectedShortlist = selectedShortlistIsVisible

  const stats = {
    totalShortlists: shortlists.length,
    selectedCandidates: allCandidates.length,
    addedThisWeek: allCandidates.filter((candidate) => isAddedThisWeek(candidate.added_at)).length,
    ratedCount: allCandidates.filter((candidate) => getRatingValue(candidate)).length,
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    if (readOnly) return
    if (!name.trim()) return
    setCreateError('')
    try {
      await onCreateShortlist({ name: name.trim(), description: description.trim(), jobDescriptionId: createJobDescriptionId || null })
      setName('')
      setDescription('')
      setCreateJobDescriptionId('')
      setShowCreateForm(false)
    } catch (createActionError) {
      setCreateError(createActionError?.message || 'Unable to create shortlist.')
    }
  }

  const showNoMatches = hasSelectedShortlist && !loadingDetails && allCandidates.length > 0 && filteredCandidates.length === 0

  return (
    <section className="shortlist-manager" aria-label="Shortlists page">
      <header className="shortlist-manager__page-header">
        <div className="shortlist-manager__heading-copy">
          <h1>Shortlists</h1>
          <p>{readOnly ? 'Review historical shortlists and candidate context.' : 'Review and manage shortlisted candidates with clear job context.'}</p>
        </div>
        {!readOnly ? <button type="button" className="shortlist-manager__create-button" onClick={() => setShowCreateForm((value) => !value)} aria-expanded={showCreateForm}>
          <Plus size={18} strokeWidth={1.5} aria-hidden="true" />
          Create shortlist
        </button> : null}
      </header>

      {readOnly ? <p className="shortlist-manager__muted-text">Read-only access: historical shortlists remain available, but creating or changing shortlists requires an active subscription.</p> : null}

      {!readOnly && showCreateForm ? <section className="shortlist-manager__filters-card" aria-label="Create shortlist">
        <form onSubmit={handleCreate} className="shortlist-manager__create-form">
          <label className="shortlist-manager__filter-label">Shortlist name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter shortlist name" className="shortlist-manager__input" /></label>
          <label className="shortlist-manager__filter-label">Description<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Role, stage, or hiring notes" className="shortlist-manager__input" /></label>
          <label className="shortlist-manager__filter-label">Job<select value={createJobDescriptionId} onChange={(e) => setCreateJobDescriptionId(e.target.value)} className="shortlist-manager__select"><option value="">General / no linked job</option>{createJobOptions.map((job) => <option key={job.id} value={job.id}>{job.label}</option>)}</select></label>
          <button type="submit" disabled={loadingList || loadingDetails} className="shortlist-manager__button shortlist-manager__button--accent">Save shortlist</button>
        </form>
        {createError ? <p className="shortlist-manager__inline-error" role="alert">Couldn’t create shortlist. {createError} Try again.</p> : null}
      </section> : null}

      <section className="shortlist-manager__filters-card shortlist-manager__filters-toolbar" aria-label="Filters and actions">
        <div className="shortlist-manager__filter-grid">
          <label className="shortlist-manager__filter-label">Search
            <div className="shortlist-manager__input-wrap"><Search size={18} strokeWidth={1.5} aria-hidden="true" /><input className="shortlist-manager__input shortlist-manager__input--with-icon" value={query} onChange={(e) => { setCurrentPage(1); setQuery(e.target.value) }} placeholder="Search shortlists or candidates" /></div>
          </label>
          <label className="shortlist-manager__filter-label">Job
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className="shortlist-manager__select"><option value="all">All jobs</option>{shortlistJobOptions.map((job) => <option key={job.value} value={job.value}>{job.label}</option>)}</select>
          </label>
          <label className="shortlist-manager__filter-label">Sort
            <select value={currentSort} onChange={(e) => onChangeSort(e.target.value)} className="shortlist-manager__select"><option value="rating_desc">Score (High to Low)</option><option value="rating_asc">Score (Low to High)</option><option value="added_desc">Recently Added</option><option value="added_asc">Oldest Added</option></select>
          </label>
        </div>
        <div className="shortlist-manager__filter-actions">
          <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral shortlist-manager__clear-filters" onClick={resetFilters}>Clear filters</button>
        </div>
      </section>

      <section className="shortlist-manager__stats" aria-label="Shortlist stats">
        <article className="shortlist-manager__stat-card"><h3>Total shortlists</h3><p>{stats.totalShortlists}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Candidates in selected shortlist</h3><p>{stats.selectedCandidates}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Added this week</h3><p>{stats.addedThisWeek}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Rated candidates</h3><p>{stats.ratedCount}</p></article>
      </section>

      <section className="shortlist-manager__list-card" aria-label="Paginated shortlist list and cards">
        {error ? <div className="shortlist-manager__alert" role="alert"><p>{error}. Please retry. If this continues, contact support.</p><button type="button" onClick={onRetry} className="shortlist-manager__button shortlist-manager__button--accent"><RefreshCw size={18} strokeWidth={1.5} aria-hidden="true" />Retry</button></div> : null}

        {loadingList ? <div className="shortlist-manager__skeleton-list" role="status" aria-live="polite" aria-label="Loading shortlists"><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /></div> : null}

        {!loadingList && !hasShortlists ? <div className="shortlist-manager__empty"><p>No shortlists yet.</p><p className="shortlist-manager__muted-text">{readOnly ? 'No historical shortlists are available.' : 'Create your first shortlist to start reviewing candidates.'}</p>{!readOnly ? <button type="button" className="shortlist-manager__button shortlist-manager__button--accent" onClick={() => setShowCreateForm(true)}>Create shortlist</button> : null}</div> : null}

        {!loadingList && hasShortlists ? <div className="shortlist-manager__content-grid">
          <aside className="shortlist-manager__shortlist-rail" aria-label="Shortlist selector">
            {visibleShortlists.map((list) => <button key={list.id} type="button" onClick={() => onSelectShortlist(list.id)} className={`shortlist-manager__shortlist-item ${list.id === selectedShortlistId ? 'is-selected' : ''}`}>
              <span className="shortlist-manager__shortlist-name">{list.name}</span>
              <span className="shortlist-manager__shortlist-meta"><Briefcase size={16} strokeWidth={1.5} aria-hidden="true" />{getShortlistJobLabel(list)}</span>
              <span className="shortlist-manager__shortlist-meta">{list.candidate_count || 0} candidate(s)</span>
            </button>)}
            {visibleShortlists.length === 0 ? <div className="shortlist-manager__empty shortlist-manager__empty--compact"><p>No shortlists match current filters.</p><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button></div> : null}
          </aside>

          <div>
            {hasSelectedShortlist && <div className="shortlist-manager__panel-header"><div className="shortlist-manager__panel-title-row"><h3>{selectedShortlist.name}</h3><p className="shortlist-manager__panel-job"><Briefcase size={18} strokeWidth={1.5} aria-hidden="true" />{getShortlistJobLabel(selectedShortlist)}</p><p className="shortlist-manager__panel-count" role="status" aria-live="polite">{allCandidates.length} candidate(s)</p></div>{selectedShortlist.description ? <p className="shortlist-manager__muted-text shortlist-manager__panel-description">{selectedShortlist.description}</p> : null}</div>}
            {hasSelectedShortlist && loadingDetails ? <div className="shortlist-manager__skeleton-list" role="status" aria-label="Loading shortlist details"><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /></div> : null}
            {hasSelectedShortlist && !loadingDetails && paginatedCandidates.length > 0 ? <div className="shortlist-manager__candidate-list">{paginatedCandidates.map((candidate) => {
              const scoreDisplay = formatShortlistCandidateScore(candidate)
              const candidateName = getCandidateDisplayName(candidate)
              const fileLabel = getCandidateFileLabel(candidate)
              const shouldShowFileLabel = fileLabel && fileLabel.toLowerCase() !== candidateName.toLowerCase()
              const candidateDescription = getCandidateDescription(candidate, candidateName)
              const analysisHref = getShortlistAnalysisHref(candidate)
              const canLinkScore = analysisHref && scoreDisplay.tone !== 'muted'
              const scoreClassName = `shortlist-manager__chip shortlist-manager__chip--score ${canLinkScore ? 'shortlist-manager__chip--link' : ''} ${scoreDisplay.tone === 'muted' ? 'shortlist-manager__chip--muted' : ''}`
              const scoreChip = canLinkScore
                ? <a className={scoreClassName} href={analysisHref} aria-label={`View analysis that produced ${scoreDisplay.label} for ${candidateName}`}>{scoreDisplay.label}</a>
                : <span className={scoreClassName}>{scoreDisplay.label}</span>
              return <article key={candidate.id || candidate.resume_id} className="shortlist-manager__candidate-card"><div><h4 className="shortlist-manager__candidate-name">{analysisHref ? <a className="shortlist-manager__candidate-link" href={analysisHref} aria-label={`View analysis results for ${candidateName}`}>{candidateName}</a> : candidateName}</h4>{shouldShowFileLabel ? <p className="shortlist-manager__candidate-file"><FileText size={14} strokeWidth={1.5} aria-hidden="true" />{fileLabel}</p> : null}{candidateDescription ? <p className="shortlist-manager__candidate-notes">{candidateDescription}</p> : null}<div className="shortlist-manager__chip-list">{scoreChip}<span className="shortlist-manager__chip"><CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" />Added {formatDate(candidate.added_at)}</span></div></div>{!readOnly ? <div className="shortlist-manager__candidate-actions"><button type="button" onClick={async () => {
                const confirmed = window.confirm(`Remove ${candidateName} from this shortlist?`)
                if (!confirmed) return
                await onRemoveCandidate(candidate.resume_id)
              }} className="shortlist-manager__button shortlist-manager__button--danger shortlist-manager__icon-button" aria-label={`Remove ${candidateName} from shortlist`}><Trash2 size={16} strokeWidth={1.5} aria-hidden="true" /></button></div> : null}</article>
            })}</div> : null}
            {hasSelectedShortlist && !loadingDetails && allCandidates.length === 0 ? <div className="shortlist-manager__empty"><p>No candidates in this shortlist yet.</p><p className="shortlist-manager__muted-text">{readOnly ? 'This historical shortlist has no candidates.' : 'Add candidates from the Candidates directory to continue reviewing.'}</p><a className="shortlist-manager__button shortlist-manager__button--accent shortlist-manager__link-button" href="/candidates">View Candidates</a></div> : null}
            {hasSelectedShortlist && !loadingDetails && filteredCandidates.length > PAGE_SIZE ? <nav className="shortlist-manager__pagination" aria-label="Candidate pagination"><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Previous</button><span aria-live="polite">Page {currentPage} of {totalPages}</span><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</button></nav> : null}
            {showNoMatches ? <div className="shortlist-manager__empty"><p>No candidates match your current filters.</p><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button></div> : null}
          </div>
        </div> : null}
      </section>
    </section>
  )
}
