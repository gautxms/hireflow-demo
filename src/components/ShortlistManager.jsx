import { useMemo, useState } from 'react'

export default function ShortlistManager({
  shortlists,
  selectedShortlistId,
  shortlistDetails,
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

  const selectedShortlist = useMemo(
    () => shortlists.find((item) => item.id === selectedShortlistId) || null,
    [shortlists, selectedShortlistId],
  )

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

  return (
    <section style={{ maxWidth: '1200px', margin: '0 auto 2rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>Candidate Shortlists</h2>
        <button
          onClick={onRefresh}
          className="touch-target"
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', borderRadius: '6px', padding: '0.4rem 0.75rem', cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', marginBottom: '1rem' }}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New shortlist name"
          style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ minHeight: 44, background: 'var(--accent)', color: 'var(--ink)', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', padding: '0 1rem' }}
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
              background: list.id === selectedShortlistId ? 'var(--accent)' : 'transparent',
              color: list.id === selectedShortlistId ? 'var(--ink)' : 'var(--text)',
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
              <p style={{ margin: 0, color: 'var(--muted)' }}>{selectedShortlist.description || 'No description provided'}</p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)' }}>
              Sort
              <select
                onChange={(event) => onChangeSort(event.target.value)}
                style={{ background: 'var(--ink)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '0.4rem 0.5rem' }}
              >
                <option value="rating_desc">Rating (High to Low)</option>
                <option value="rating_asc">Rating (Low to High)</option>
                <option value="added_desc">Recently Added</option>
                <option value="added_asc">Oldest Added</option>
              </select>
            </label>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
            {(shortlistDetails?.candidates || []).map((candidate) => (
              <div key={candidate.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', background: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.7rem 0.85rem' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{candidate.filename || candidate.resume_id}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.86rem' }}>{candidate.notes || 'No notes'}</div>
                </div>
                <div style={{ alignSelf: 'center', color: 'var(--accent)' }}>
                  {candidate.rating ? `${candidate.rating}/5` : 'Unrated'}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveCandidate(candidate.resume_id)}
                  style={{ background: 'transparent', color: '#ef4444', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            ))}
            {!shortlistDetails?.candidates?.length ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>No candidates in this shortlist yet.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, color: 'var(--muted)' }}>Create a shortlist or select one to view candidates.</p>
      )}
    </section>
  )
}
