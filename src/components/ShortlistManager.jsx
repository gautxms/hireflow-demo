import { useMemo, useState } from 'react'
import { Plus, Search, RefreshCw, Briefcase, CalendarDays, Star, Trash2 } from 'lucide-react'
import {
  filterShortlistCandidates,
  getDecisionStatus,
  getRatingValue,
  getShortlistJobLabel,
} from './shortlistState'
import './ShortlistManager.css'

const PAGE_SIZE = 15

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return date.toLocaleDateString()
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
  } = props

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [filters, setFilters] = useState({ decisionStatus: 'all' })
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [createError, setCreateError] = useState('')
  const [jobFilter, setJobFilter] = useState('all')

  const selectedShortlist = useMemo(() => shortlists.find((item) => item.id === selectedShortlistId) || null, [shortlists, selectedShortlistId])
  const allCandidates = useMemo(() => shortlistDetails?.candidates || [], [shortlistDetails?.candidates])

  const resetFilters = () => {
    setCurrentPage(1)
    setQuery('')
    setFilters({ decisionStatus: 'all' })
    setJobFilter('all')
  }

  const shortlistJobOptions = useMemo(() => {
    const map = new Map()
    shortlists.forEach((list) => {
      const label = getShortlistJobLabel(list)
      map.set(label, label)
    })
    return [...map.values()].sort((a, b) => a.localeCompare(b))
  }, [shortlists])

  const visibleShortlists = useMemo(() => {
    const q = query.trim().toLowerCase()
    return shortlists.filter((list) => {
      const jobLabel = getShortlistJobLabel(list)
      const shortlistMatch = !q || `${list.name || ''} ${list.description || ''} ${jobLabel}`.toLowerCase().includes(q)
      const jobMatch = jobFilter === 'all' || jobLabel === jobFilter
      return shortlistMatch && jobMatch
    })
  }, [jobFilter, query, shortlists])

  const filterOptions = useMemo(() => ({
    decisionStatuses: [...new Set(allCandidates.map((candidate) => getDecisionStatus(candidate)))].sort(),
  }), [allCandidates])

  const filteredCandidates = useMemo(() => {
    const byDecision = filterShortlistCandidates(allCandidates, filters)
    const q = query.trim().toLowerCase()
    if (!q) return byDecision
    return byDecision.filter((candidate) => `${candidate.filename || ''} ${candidate.resume_id || ''} ${candidate.notes || ''}`.toLowerCase().includes(q))
  }, [allCandidates, filters, query])

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE))
  const paginatedCandidates = filteredCandidates.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const hasShortlists = shortlists.length > 0
  const hasSelectedShortlist = Boolean(selectedShortlist)

  const stats = {
    totalShortlists: shortlists.length,
    selectedCandidates: allCandidates.length,
    addedThisWeek: allCandidates.filter((candidate) => isAddedThisWeek(candidate.added_at)).length,
    ratedCount: allCandidates.filter((candidate) => getRatingValue(candidate)).length,
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!name.trim()) return
    setCreateError('')
    try {
      await onCreateShortlist({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
      setShowCreateForm(false)
    } catch (createActionError) {
      setCreateError(createActionError?.message || 'Unable to create shortlist.')
    }
  }

  const showNoMatches = hasSelectedShortlist && !loadingDetails && allCandidates.length > 0 && filteredCandidates.length === 0

  return (
    <section className="shortlist-manager" aria-label="Shortlists page">
      <header className="shortlist-manager__header-card" aria-label="Shortlists summary">
        <div>
          <h2 className="shortlist-manager__page-title">Shortlists</h2>
          <p className="shortlist-manager__muted-text">Manage job-aligned candidate collections and hiring decisions.</p>
          {selectedShortlist ? <p className="shortlist-manager__context-copy">Selected: <strong>{selectedShortlist.name}</strong> · {getShortlistJobLabel(selectedShortlist)}</p> : null}
        </div>
        <button type="button" className="shortlist-manager__create-button" onClick={() => setShowCreateForm((value) => !value)} aria-expanded={showCreateForm}>
          <Plus size={18} strokeWidth={1.5} aria-hidden="true" />
          Create shortlist
        </button>
      </header>

      {showCreateForm ? <section className="shortlist-manager__filters-card" aria-label="Create shortlist">
        <form onSubmit={handleCreate} className="shortlist-manager__create-form">
          <label className="shortlist-manager__filter-label">Shortlist name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter shortlist name" className="shortlist-manager__input" /></label>
          <label className="shortlist-manager__filter-label">Description (optional)<input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Role, stage, or hiring notes" className="shortlist-manager__input" /></label>
          <button type="submit" disabled={loadingList || loadingDetails} className="shortlist-manager__button shortlist-manager__button--accent">Save shortlist</button>
        </form>
        {createError ? <p className="shortlist-manager__inline-error" role="alert">Couldn’t create shortlist. {createError} Try again.</p> : null}
      </section> : null}

      <section className="shortlist-manager__filters-card" aria-label="Filters and actions">
        <div className="shortlist-manager__filter-grid">
          <label className="shortlist-manager__filter-label">Search
            <div className="shortlist-manager__input-wrap"><Search size={18} strokeWidth={1.5} aria-hidden="true" /><input className="shortlist-manager__input shortlist-manager__input--with-icon" value={query} onChange={(e) => { setCurrentPage(1); setQuery(e.target.value) }} placeholder="Search shortlists or candidates" /></div>
          </label>
          <label className="shortlist-manager__filter-label">Job
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className="shortlist-manager__select"><option value="all">All jobs</option>{shortlistJobOptions.map((job) => <option key={job} value={job}>{job}</option>)}</select>
          </label>
          <label className="shortlist-manager__filter-label">Status
            <select className="shortlist-manager__select" value={filters.decisionStatus} onChange={(e) => { setCurrentPage(1); setFilters((current) => ({ ...current, decisionStatus: e.target.value })) }}><option value="all">All decision states</option>{filterOptions.decisionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <label className="shortlist-manager__filter-label">Sort
            <select value={currentSort} onChange={(e) => onChangeSort(e.target.value)} className="shortlist-manager__select"><option value="rating_desc">Rating (High to Low)</option><option value="rating_asc">Rating (Low to High)</option><option value="added_desc">Recently Added</option><option value="added_asc">Oldest Added</option></select>
          </label>
        </div>
        <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button>
      </section>

      <section className="shortlist-manager__stats" aria-label="Shortlist stats">
        <article className="shortlist-manager__stat-card"><h3>Total shortlists</h3><p>{stats.totalShortlists}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Candidates in selected shortlist</h3><p>{stats.selectedCandidates}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Added this week</h3><p>{stats.addedThisWeek}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Decision-ready / rated</h3><p>{stats.ratedCount}</p></article>
      </section>

      <section className="shortlist-manager__list-card" aria-label="Paginated shortlist list and cards">
        {error ? <div className="shortlist-manager__alert" role="alert"><p>{error}. Please retry. If this continues, contact support.</p><button type="button" onClick={onRetry} className="shortlist-manager__button shortlist-manager__button--accent"><RefreshCw size={18} strokeWidth={1.5} aria-hidden="true" />Retry</button></div> : null}

        {loadingList ? <div className="shortlist-manager__skeleton-list" role="status" aria-label="Loading shortlists"><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /></div> : null}

        {!loadingList && !hasShortlists ? <div className="shortlist-manager__empty"><p>No shortlists yet.</p><p className="shortlist-manager__muted-text">Create your first shortlist to start reviewing candidates.</p></div> : null}

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
            {selectedShortlist && <div className="shortlist-manager__panel-header"><h3>{selectedShortlist.name}</h3><p>{getShortlistJobLabel(selectedShortlist)} · {allCandidates.length} candidate(s)</p>{selectedShortlist.description ? <p className="shortlist-manager__muted-text">{selectedShortlist.description}</p> : null}</div>}
            {hasSelectedShortlist && loadingDetails ? <div className="shortlist-manager__skeleton-list" role="status" aria-label="Loading shortlist details"><div className="shortlist-manager__skeleton-card" /><div className="shortlist-manager__skeleton-card" /></div> : null}
            {selectedShortlist && !loadingDetails && paginatedCandidates.length > 0 ? <div className="shortlist-manager__candidate-list">{paginatedCandidates.map((candidate) => {
              const rating = getRatingValue(candidate)
              const decisionStatus = getDecisionStatus(candidate)
              return <article key={candidate.id || candidate.resume_id} className="shortlist-manager__candidate-card"><div><h4 className="shortlist-manager__candidate-name">{candidate.filename || candidate.resume_id || 'Unnamed candidate'}</h4><p className="shortlist-manager__candidate-notes">{candidate.notes || 'No notes added.'}</p><div className="shortlist-manager__chip-list"><span className="shortlist-manager__chip">Decision: {decisionStatus}</span><span className="shortlist-manager__chip"><Star size={14} strokeWidth={1.5} aria-hidden="true" />{rating ? `${rating}/5` : 'Unrated'}</span><span className="shortlist-manager__chip"><CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" />Added {formatDate(candidate.added_at)}</span></div></div><div className="shortlist-manager__candidate-actions"><button type="button" onClick={async () => {
                const candidateLabel = candidate.filename || candidate.resume_id || 'this candidate'
                const confirmed = window.confirm(`Remove ${candidateLabel} from this shortlist?`)
                if (!confirmed) return
                await onRemoveCandidate(candidate.resume_id)
              }} className="shortlist-manager__button shortlist-manager__button--danger" aria-label={`Remove ${candidate.filename || candidate.resume_id || 'candidate'} from shortlist`}><Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />Remove</button></div></article>
            })}</div> : null}
            {selectedShortlist && !loadingDetails && allCandidates.length === 0 ? <div className="shortlist-manager__empty"><p>No candidates in this shortlist yet.</p><p className="shortlist-manager__muted-text">Add candidates from the Candidates directory to begin decisions.</p><a className="shortlist-manager__button shortlist-manager__button--accent shortlist-manager__link-button" href="/candidates">Go to Candidates</a></div> : null}
            {selectedShortlist && !loadingDetails && filteredCandidates.length > PAGE_SIZE ? <nav className="shortlist-manager__pagination" aria-label="Candidate pagination"><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Previous</button><span aria-live="polite">Page {currentPage} of {totalPages}</span><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</button></nav> : null}
            {showNoMatches ? <div className="shortlist-manager__empty"><p>No candidates match your current filters.</p><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button></div> : null}
          </div>
        </div> : null}
      </section>
    </section>
  )
}
