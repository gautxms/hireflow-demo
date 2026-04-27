import { useMemo, useState } from 'react'
import {
  createShortlistExportRows,
  filterShortlistCandidates,
  getAnalysisSource,
  getDecisionStatus,
  getRatingValue,
} from './shortlistState'

function toCsv(rows) {
  if (!rows.length) {
    return ''
  }

  const headers = Object.keys(rows[0])
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
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

  const allCandidates = shortlistDetails?.candidates || []

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
    <section style={{ maxWidth: '1200px', margin: '0 auto 2rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>Candidate Shortlists</h2>
        <button
          onClick={onRefresh}
          className="touch-target"
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-accent-green)', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', marginBottom: '1rem' }}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New shortlist name"
          style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--border)', color: 'var(--color-text-primary)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--border)', color: 'var(--color-text-primary)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ minHeight: 44, background: 'var(--color-accent-green)', color: 'var(--color-bg-primary)', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', padding: '0 1rem' }}
        >
          Create
        </button>
      </form>

      {error ? <p style={{ color: '#ef4444', marginTop: 0 }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {shortlists.map((list) => (
          <button
            key={list.id}
            onClick={() => onSelectShortlist(list.id)}
            style={{
              background: list.id === selectedShortlistId ? 'var(--color-accent-green)' : 'transparent',
              color: list.id === selectedShortlistId ? 'var(--color-bg-primary)' : 'var(--color-text-primary)',
              border: '1px solid var(--border)',
              borderRadius: '999px',
              padding: '0.35rem 0.8rem',
              cursor: 'pointer',
            }}
          >
            {list.name} ({list.candidate_count || 0})
          </button>
        ))}
      </div>

      {selectedShortlist ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.35rem 0' }}>{selectedShortlist.name}</h3>
              <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{selectedShortlist.description || 'No description provided'}</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-secondary)' }}>
              Sort
              <select
                value={currentSort}
                onChange={(event) => onChangeSort(event.target.value)}
                style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--border)', color: 'var(--color-text-primary)', borderRadius: '6px', padding: '0.4rem 0.5rem' }}
              >
                <option value="rating_desc">Rating (High to Low)</option>
                <option value="rating_asc">Rating (Low to High)</option>
                <option value="added_desc">Recently Added</option>
                <option value="added_asc">Oldest Added</option>
              </select>
            </label>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              style={{ background: 'transparent', color: 'var(--color-accent-green)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.6rem', cursor: 'pointer' }}
            >
              {showAdvanced ? 'Hide advanced controls' : 'Show advanced controls'}
            </button>
          </div>

          {showAdvanced ? (
            <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '0.9rem', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.8rem' }}>
              <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>
                  Decision status
                  <select value={filters.decisionStatus} onChange={(event) => setFilters((current) => ({ ...current, decisionStatus: event.target.value }))}>
                    <option value="all">All decision states</option>
                    {filterOptions.decisionStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>
                  Rating
                  <select value={filters.rating} onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))}>
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
                <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.86rem', color: 'var(--color-text-secondary)' }}>
                  Analysis source
                  <select value={filters.analysisSource} onChange={(event) => setFilters((current) => ({ ...current, analysisSource: event.target.value }))}>
                    <option value="all">All sources</option>
                    {filterOptions.analysisSources.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={!exportRows.length}
                  onClick={() => triggerDownload(`shortlist-${selectedShortlist.name}-export.csv`, toCsv(exportRows), 'text/csv;charset=utf-8')}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-text-primary)', borderRadius: '6px', padding: '0.35rem 0.6rem', cursor: 'pointer' }}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  disabled={!exportRows.length}
                  onClick={() => triggerDownload(`shortlist-${selectedShortlist.name}-export.json`, JSON.stringify(exportRows, null, 2), 'application/json;charset=utf-8')}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--color-text-primary)', borderRadius: '6px', padding: '0.35rem 0.6rem', cursor: 'pointer' }}
                >
                  Export JSON
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
            {filteredCandidates.map((candidate) => {
              const rating = getRatingValue(candidate)
              const decisionStatus = getDecisionStatus(candidate)
              const analysisSource = getAnalysisSource(candidate)

              return (
                <div key={candidate.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem', background: 'var(--color-bg-primary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.7rem 0.85rem' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{candidate.filename || candidate.resume_id || 'Unnamed candidate'}</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.86rem', marginTop: '0.2rem' }}>{candidate.notes || 'No notes for this entry (legacy-safe fallback).'}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem', fontSize: '0.78rem' }}>
                      <span style={{ border: '1px solid var(--border)', borderRadius: '999px', padding: '0.15rem 0.5rem' }}>Decision: {decisionStatus}</span>
                      <span style={{ border: '1px solid var(--border)', borderRadius: '999px', padding: '0.15rem 0.5rem' }}>Rating: {rating ? `${rating}/5` : 'Unrated'}</span>
                      <span style={{ border: '1px solid var(--border)', borderRadius: '999px', padding: '0.15rem 0.5rem' }}>Source: {analysisSource}</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'end' }}>
                    <div style={{ alignSelf: 'center', color: 'var(--color-accent-green)', fontSize: '0.82rem' }}>
                      {candidate.added_at ? new Date(candidate.added_at).toLocaleDateString() : 'Added date unavailable'}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveCandidate(candidate.resume_id)}
                      style={{ background: 'transparent', color: '#ef4444', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
            {!filteredCandidates.length ? (
              <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>No candidates match the current shortlist filters.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Create a shortlist or select one to view candidates.</p>
      )}
    </section>
  )
}
