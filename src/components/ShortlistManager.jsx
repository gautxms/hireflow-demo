import { useMemo, useState } from 'react'
import {
  createShortlistExportRows,
  buildShortlistExportFilename,
  filterShortlistCandidates,
  getAnalysisSource,
  getDecisionStatus,
  getRatingValue,
  getCandidateJobContext,
} from './shortlistState'
import './ShortlistManager.css'

const PAGE_SIZE = 15

function toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const neutralizeFormulaCell = (value) => {
    const text = String(value ?? '')
    return /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  }
  const escape = (value) => `"${neutralizeFormulaCell(value).replaceAll('"', '""')}"`
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n')
}

function triggerDownload(filename, body, mimeType) {
  const blob = new Blob([body], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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
    onRefresh,
    onRetry,
    onRemoveCandidate,
    loadingList,
    loadingDetails,
    error,
  } = props

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filters, setFilters] = useState({ decisionStatus: 'all', rating: 'all', analysisSource: 'all' })
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [createError, setCreateError] = useState('')
  const resetFilters = () => {
    setCurrentPage(1)
    setQuery('')
    setFilters({ decisionStatus: 'all', rating: 'all', analysisSource: 'all' })
  }

  const selectedShortlist = useMemo(() => shortlists.find((item) => item.id === selectedShortlistId) || null, [shortlists, selectedShortlistId])
  const allCandidates = useMemo(() => shortlistDetails?.candidates || [], [shortlistDetails?.candidates])

  const filterOptions = useMemo(() => ({
    decisionStatuses: [...new Set(allCandidates.map((candidate) => getDecisionStatus(candidate)))].sort(),
    analysisSources: [...new Set(allCandidates.map((candidate) => getAnalysisSource(candidate)))].sort(),
  }), [allCandidates])

  const filteredCandidates = useMemo(() => {
    const byAdvanced = filterShortlistCandidates(allCandidates, filters)
    const q = query.trim().toLowerCase()
    if (!q) return byAdvanced
    return byAdvanced.filter((candidate) => `${candidate.filename || ''} ${candidate.resume_id || ''} ${candidate.notes || ''}`.toLowerCase().includes(q))
  }, [allCandidates, filters, query])

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE))
  const paginatedCandidates = filteredCandidates.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const exportRows = useMemo(() => createShortlistExportRows(filteredCandidates), [filteredCandidates])
  const showPagination = filteredCandidates.length > PAGE_SIZE
  const hasShortlists = shortlists.length > 0
  const hasCandidates = allCandidates.length > 0
  const hasSelectedShortlist = Boolean(selectedShortlist)
  const showDataControls = hasSelectedShortlist && hasCandidates

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!name.trim()) return
    setCreateError('')
    try {
      await onCreateShortlist({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
    } catch (createActionError) {
      setCreateError(createActionError?.message || 'Unable to create shortlist.')
    }
  }

  const stats = {
    totalShortlists: shortlists.length,
    selectedCandidates: allCandidates.length,
    filteredCandidates: filteredCandidates.length,
    ratedCount: allCandidates.filter((candidate) => getRatingValue(candidate)).length,
  }

  return (
    <section className="shortlist-manager" aria-label="Shortlists page">
      <header className="shortlist-manager__header-card" aria-label="Shortlists workspace">
        <div>
          <h2 className="shortlist-manager__title">Shortlist workspace</h2>
          <p className="shortlist-manager__muted-text">Manage collections and make candidate decisions with context.</p>
        </div>
        <div className="shortlist-manager__header-actions">
          <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={onRefresh}>Refresh</button>
        </div>
      </header>

      <section className="shortlist-manager__filters-card" aria-label="Create shortlist">
        <form onSubmit={handleCreate} className="shortlist-manager__create-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New shortlist name" className="shortlist-manager__input" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="shortlist-manager__input" />
          <button type="submit" disabled={loadingList || loadingDetails} className="shortlist-manager__create-button">Create shortlist</button>
        </form>

        {createError ? <p className="shortlist-manager__inline-error" role="alert">Couldn’t create shortlist. {createError} Try again.</p> : null}
      </section>

      {showDataControls ? <section className="shortlist-manager__filters-card" aria-label="Filter shortlist candidates">
        <div className="shortlist-manager__filter-grid">
          <label className="shortlist-manager__filter-label">Search<input className="shortlist-manager__input" value={query} onChange={(e) => { setCurrentPage(1); setQuery(e.target.value) }} placeholder="Search candidates" /></label>
          <label className="shortlist-manager__filter-label">Sort<select value={currentSort} onChange={(e) => onChangeSort(e.target.value)} className="shortlist-manager__select"><option value="rating_desc">Rating (High to Low)</option><option value="rating_asc">Rating (Low to High)</option><option value="added_desc">Recently Added</option><option value="added_asc">Oldest Added</option></select></label>
          <button type="button" className="shortlist-manager__button shortlist-manager__button--accent" onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? 'Hide filters' : 'Show filters'}</button>
        </div>

        {showAdvanced ? <div className="shortlist-manager__advanced-panel">
          <label className="shortlist-manager__filter-label">Decision status<select className="shortlist-manager__select" value={filters.decisionStatus} onChange={(e) => { setCurrentPage(1); setFilters((c) => ({ ...c, decisionStatus: e.target.value })) }}><option value="all">All decision states</option>{filterOptions.decisionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="shortlist-manager__filter-label">Rating<select className="shortlist-manager__select" value={filters.rating} onChange={(e) => { setCurrentPage(1); setFilters((c) => ({ ...c, rating: e.target.value })) }}><option value="all">All ratings</option><option value="rated">Rated only</option><option value="unrated">Unrated only</option><option value="5">5/5</option><option value="4">4/5</option><option value="3">3/5</option><option value="2">2/5</option><option value="1">1/5</option></select></label>
          <label className="shortlist-manager__filter-label">Analysis source<select className="shortlist-manager__select" value={filters.analysisSource} onChange={(e) => { setCurrentPage(1); setFilters((c) => ({ ...c, analysisSource: e.target.value })) }}><option value="all">All sources</option>{filterOptions.analysisSources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
          <div className="shortlist-manager__actions">
            <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button>
            <button type="button" disabled={!exportRows.length} onClick={() => triggerDownload(buildShortlistExportFilename(selectedShortlist?.name || 'shortlist', 'csv'), toCsv(exportRows), 'text/csv;charset=utf-8')} className="shortlist-manager__button shortlist-manager__button--neutral">Export CSV</button>
            <button type="button" disabled={!exportRows.length} onClick={() => triggerDownload(buildShortlistExportFilename(selectedShortlist?.name || 'shortlist', 'json'), JSON.stringify(exportRows, null, 2), 'application/json;charset=utf-8')} className="shortlist-manager__button shortlist-manager__button--neutral">Export JSON</button>
          </div>
        </div> : null}
      </section> : null}

      <section className="shortlist-manager__stats" aria-label="Shortlist stats">
        <article className="shortlist-manager__stat-card"><h3>Total shortlists</h3><p>{stats.totalShortlists}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Selected shortlist candidates</h3><p>{stats.selectedCandidates}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Matches current filters</h3><p>{stats.filteredCandidates}</p></article>
        <article className="shortlist-manager__stat-card"><h3>Rated candidates</h3><p>{stats.ratedCount}</p></article>
      </section>

      <section className="shortlist-manager__list-card" aria-label="Paginated shortlist list and cards">
        {error ? <div className="shortlist-manager__alert" role="alert"><p>{error}</p><button type="button" onClick={onRetry} className="shortlist-manager__button shortlist-manager__button--accent">Retry</button></div> : null}

        {loadingList ? <p className="shortlist-manager__muted-text" role="status">Loading shortlists…</p> : null}

        {!loadingList && !hasShortlists ? <div className="shortlist-manager__empty"><p>No shortlists yet.</p><p className="shortlist-manager__muted-text">Create your first shortlist to start reviewing candidates.</p><button type="button" className="shortlist-manager__button shortlist-manager__button--accent" onClick={() => document.querySelector('.shortlist-manager__create-form input')?.focus()}>Create shortlist</button></div> : null}

        {hasShortlists ? <div className="shortlist-manager__pills">{shortlists.map((list) => <button key={list.id} type="button" onClick={() => onSelectShortlist(list.id)} className={`shortlist-manager__pill ${list.id === selectedShortlistId ? 'is-selected' : ''}`}>{list.name} ({list.candidate_count || 0})</button>)}</div> : null}

        {selectedShortlist && loadingDetails ? <p className="shortlist-manager__muted-text" role="status">Loading shortlist details…</p> : null}

        {selectedShortlist && !loadingDetails && paginatedCandidates.length > 0 ? <>
          <div className="shortlist-manager__candidate-list">{paginatedCandidates.map((candidate) => {
            const rating = getRatingValue(candidate)
            const decisionStatus = getDecisionStatus(candidate)
            const analysisSource = getAnalysisSource(candidate)
            return <article key={candidate.id || candidate.resume_id} className="shortlist-manager__candidate-card"><div><h4 className="shortlist-manager__candidate-name">{candidate.filename || candidate.resume_id || 'Unnamed candidate'}</h4><p className="shortlist-manager__candidate-notes">{candidate.notes || 'No notes available.'}</p><div className="shortlist-manager__chip-list"><span className="shortlist-manager__chip">Decision: {decisionStatus}</span><span className="shortlist-manager__chip">Rating: {rating ? `${rating}/5` : 'Unrated'}</span><span className="shortlist-manager__chip">Source: {analysisSource}</span><span className="shortlist-manager__chip">Job: {getCandidateJobContext(candidate)}</span></div></div><div className="shortlist-manager__candidate-actions"><div className="shortlist-manager__added-at">{candidate.added_at ? new Date(candidate.added_at).toLocaleDateString() : 'Added date unavailable'}</div><button type="button" onClick={async () => {
              const candidateLabel = candidate.filename || candidate.resume_id || "this candidate"
              const confirmed = window.confirm(`Remove ${candidateLabel} from this shortlist?`)
              if (!confirmed) return
              await onRemoveCandidate(candidate.resume_id)
            }} className="shortlist-manager__button shortlist-manager__button--danger">Remove</button></div></article>
          })}</div>

          {showPagination ? <nav className="shortlist-manager__pagination" aria-label="Candidate pagination">
            <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span aria-live="polite">Page {currentPage} of {totalPages}</span>
            <button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </nav> : null}
        </> : null}

        {selectedShortlist && !loadingDetails && allCandidates.length === 0 ? <div className="shortlist-manager__empty"><p>No candidates in this shortlist yet.</p><p className="shortlist-manager__muted-text">Add candidates from the Candidates directory to begin decisions.</p><a className="shortlist-manager__button shortlist-manager__button--accent shortlist-manager__link-button" href="/candidates">Go to Candidates</a></div> : null}
        {selectedShortlist && !loadingDetails && allCandidates.length > 0 && filteredCandidates.length === 0 ? <div className="shortlist-manager__empty"><p>No candidates match your current filters.</p><button type="button" className="shortlist-manager__button shortlist-manager__button--neutral" onClick={resetFilters}>Clear filters</button></div> : null}
      </section>
    </section>
  )
}
