import { useMemo, useState } from 'react'
import {
  createShortlistExportRows,
  filterShortlistCandidates,
  getAnalysisSource,
  getDecisionStatus,
  getRatingValue,
} from './shortlistState'
import './ShortlistManager.css'

function toCsv(rows) {
  if (!rows.length) {
    return ''
  }

  const headers = Object.keys(rows[0])
  const neutralizeFormulaCell = (value) => {
    const text = String(value ?? '')
    return /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  }
  const escape = (value) => `"${neutralizeFormulaCell(value).replaceAll('"', '""')}"`
  const lines = [headers.join(',')]

  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','))
  }

  return lines.join('\n')
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

export default function ShortlistManager({
  shortlists,
  selectedShortlistId,
  shortlistDetails,
  currentSort,
  onSelectShortlist,
  onCreateShortlist,
  onChangeSort,
  onRefresh,
  onRemoveCandidate,
  loading,
  error,
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filters, setFilters] = useState({
    decisionStatus: 'all',
    rating: 'all',
    analysisSource: 'all',
  })

  const selectedShortlist = useMemo(
    () => shortlists.find((item) => item.id === selectedShortlistId) || null,
    [shortlists, selectedShortlistId],
  )

  const allCandidates = useMemo(() => shortlistDetails?.candidates || [], [shortlistDetails?.candidates])

  const filterOptions = useMemo(() => {
    const decisionStatuses = [...new Set(allCandidates.map((candidate) => getDecisionStatus(candidate)))].sort()
    const analysisSources = [...new Set(allCandidates.map((candidate) => getAnalysisSource(candidate)))].sort()
    return { decisionStatuses, analysisSources }
  }, [allCandidates])

  const filteredCandidates = useMemo(() => {
    return filterShortlistCandidates(allCandidates, filters)
  }, [allCandidates, filters])

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!name.trim()) {
      return
    }

    await onCreateShortlist({
      name: name.trim(),
      description: description.trim(),
    })

    setName('')
    setDescription('')
  }

  const exportRows = useMemo(() => createShortlistExportRows(filteredCandidates), [filteredCandidates])

  return (
    <section className="shortlist-manager">
      <div className="shortlist-manager__header">
        <h2 className="shortlist-manager__title">Candidate Shortlists</h2>
        <button
          onClick={onRefresh}
          className="touch-target shortlist-manager__button shortlist-manager__button--accent"
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleCreate} className="shortlist-manager__create-form">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New shortlist name"
          className="shortlist-manager__input"
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          className="shortlist-manager__input"
        />
        <button
          type="submit"
          disabled={loading}
          className="shortlist-manager__create-button"
        >
          Create
        </button>
      </form>

      {error ? <p className="shortlist-manager__error">{error}</p> : null}

      <div className="shortlist-manager__pills">
        {shortlists.map((list) => (
          <button
            key={list.id}
            onClick={() => onSelectShortlist(list.id)}
            className={`shortlist-manager__pill ${list.id === selectedShortlistId ? 'is-selected' : ''}`}
          >
            {list.name} ({list.candidate_count || 0})
          </button>
        ))}
      </div>

      {selectedShortlist ? (
        <div>
          <div className="shortlist-manager__selected-header">
            <div>
              <h3 className="shortlist-manager__selected-title">{selectedShortlist.name}</h3>
              <p className="shortlist-manager__muted-text">{selectedShortlist.description || 'No description provided'}</p>
            </div>
            <label className="shortlist-manager__sort-label">
              Sort
              <select
                value={currentSort}
                onChange={(event) => onChangeSort(event.target.value)}
                className="shortlist-manager__select"
              >
                <option value="rating_desc">Rating (High to Low)</option>
                <option value="rating_asc">Rating (Low to High)</option>
                <option value="added_desc">Recently Added</option>
                <option value="added_asc">Oldest Added</option>
              </select>
            </label>
          </div>

          <div className="shortlist-manager__advanced-toggle">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="shortlist-manager__button shortlist-manager__button--accent"
            >
              {showAdvanced ? 'Hide advanced controls' : 'Show advanced controls'}
            </button>
          </div>

          {showAdvanced ? (
            <div className="shortlist-manager__advanced-panel">
              <div className="shortlist-manager__filter-grid">
                <label className="shortlist-manager__filter-label">
                  Decision status
                  <select className="shortlist-manager__select" value={filters.decisionStatus} onChange={(event) => setFilters((current) => ({ ...current, decisionStatus: event.target.value }))}>
                    <option value="all">All decision states</option>
                    {filterOptions.decisionStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="shortlist-manager__filter-label">
                  Rating
                  <select className="shortlist-manager__select" value={filters.rating} onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))}>
                    <option value="all">All ratings</option>
                    <option value="rated">Rated only</option>
                    <option value="unrated">Unrated only</option>
                    <option value="5">5/5</option>
                    <option value="4">4/5</option>
                    <option value="3">3/5</option>
                    <option value="2">2/5</option>
                    <option value="1">1/5</option>
                  </select>
                </label>
                <label className="shortlist-manager__filter-label">
                  Analysis source
                  <select className="shortlist-manager__select" value={filters.analysisSource} onChange={(event) => setFilters((current) => ({ ...current, analysisSource: event.target.value }))}>
                    <option value="all">All sources</option>
                    {filterOptions.analysisSources.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="shortlist-manager__actions">
                <button
                  type="button"
                  disabled={!exportRows.length}
                  onClick={() => triggerDownload(`shortlist-${selectedShortlist.name}-export.csv`, toCsv(exportRows), 'text/csv;charset=utf-8')}
                  className="shortlist-manager__button shortlist-manager__button--neutral"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  disabled={!exportRows.length}
                  onClick={() => triggerDownload(`shortlist-${selectedShortlist.name}-export.json`, JSON.stringify(exportRows, null, 2), 'application/json;charset=utf-8')}
                  className="shortlist-manager__button shortlist-manager__button--neutral"
                >
                  Export JSON
                </button>
              </div>
            </div>
          ) : null}

          <div className="shortlist-manager__candidate-list">
            {filteredCandidates.map((candidate) => {
              const rating = getRatingValue(candidate)
              const decisionStatus = getDecisionStatus(candidate)
              const analysisSource = getAnalysisSource(candidate)

              return (
                <div key={candidate.id} className="shortlist-manager__candidate-card">
                  <div>
                    <div className="shortlist-manager__candidate-name">{candidate.filename || candidate.resume_id || 'Unnamed candidate'}</div>
                    <div className="shortlist-manager__candidate-notes">{candidate.notes || 'No notes for this entry (legacy-safe fallback).'}</div>
                    <div className="shortlist-manager__chip-list">
                      <span className="shortlist-manager__chip">Decision: {decisionStatus}</span>
                      <span className="shortlist-manager__chip">Rating: {rating ? `${rating}/5` : 'Unrated'}</span>
                      <span className="shortlist-manager__chip">Source: {analysisSource}</span>
                    </div>
                  </div>
                  <div className="shortlist-manager__candidate-actions">
                    <div className="shortlist-manager__added-at">
                      {candidate.added_at ? new Date(candidate.added_at).toLocaleDateString() : 'Added date unavailable'}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveCandidate(candidate.resume_id)}
                      className="shortlist-manager__button shortlist-manager__button--danger"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
            {!filteredCandidates.length ? (
              <p className="shortlist-manager__muted-text shortlist-manager__muted-text--flush">No candidates match the current shortlist filters.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="shortlist-manager__muted-text shortlist-manager__muted-text--flush">Create a shortlist or select one to view candidates.</p>
      )}
    </section>
  )
}
