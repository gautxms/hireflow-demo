import { useState } from 'react'

const FEEDBACK_STORAGE_KEY = 'hireflow_parse_feedback_v1'

function readFeedback() {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export default function CandidateResults({ candidates, parseMeta, onBack, isLoading = false, loadingProgress = 0 }) {
  const [sortBy, setSortBy] = useState('score')
  const [filterTier, setFilterTier] = useState('all')
  const [manualCorrection, setManualCorrection] = useState('')
  const [feedbackSaved, setFeedbackSaved] = useState(false)

  const displayCandidates = candidates && candidates.length > 0 ? candidates : null
  const hasRenderableCandidates = Array.isArray(displayCandidates)
    && displayCandidates.length > 0
    && displayCandidates.every((candidate) => candidate && Array.isArray(candidate.skills))

  const confidence = Math.max(0, Math.min(100, Number(parseMeta?.confidence || 0)))
  const needsCorrection = Boolean(parseMeta?.requiresManualCorrection) || confidence < 70

  const saveFeedback = () => {
    const normalized = manualCorrection.trim()
    if (!normalized) return

    const history = readFeedback()
    history.unshift({
      submittedAt: new Date().toISOString(),
      methodUsed: parseMeta?.methodUsed || 'unknown',
      confidence,
      correction: normalized,
    })

    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(history.slice(0, 25)))
    setFeedbackSaved(true)
    setManualCorrection('')
  }

  if (isLoading) {
    return <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}><div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}><button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.9rem' }}>← Upload New Resumes</button><h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.75rem', fontFamily: 'var(--font-display)' }}>Parsing in background</h1><p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>We are processing resumes. This can take 1-5 minutes.</p><p style={{ color: 'var(--accent)' }}>Progress: {Math.max(0, Math.min(100, Number(loadingProgress || 0)))}%</p></div></div>
  }

  if (!hasRenderableCandidates) {
    return <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}><div style={{ maxWidth: '900px', margin: '0 auto' }}><button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Upload New Resumes</button><h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Ranking</h1><p style={{ color: 'var(--muted)' }}>Please upload resumes before viewing analysis.</p></div></div>
  }

  let filtered = displayCandidates
  if (filterTier !== 'all') filtered = filtered.filter((c) => c.tier === filterTier)
  if (sortBy === 'name') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  else if (sortBy === 'fit') {
    const fitOrder = { Excellent: 0, Strong: 1, Good: 2, Consider: 3 }
    filtered = [...filtered].sort((a, b) => (fitOrder[a.fit] || 4) - (fitOrder[b.fit] || 4))
  } else filtered = [...filtered].sort((a, b) => b.score - a.score)

  const getScoreColor = (score) => (score >= 90 ? 'var(--accent-2)' : score >= 80 ? 'var(--accent)' : score >= 70 ? '#f59e0b' : '#ef4444')
  const getTierBadge = (tier) => ({ top: { bg: 'rgba(90,255,184,0.15)', color: 'var(--accent-2)', label: '⭐ TOP' }, strong: { bg: 'rgba(232,255,90,0.15)', color: 'var(--accent)', label: '✓ STRONG' }, consider: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '→ CONSIDER' } }[tier] || { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '→ CONSIDER' })

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>← Upload New Resumes</button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>Candidate Ranking</h1>
        <p style={{ color: 'var(--muted)' }}>{filtered.length} candidates analyzed and ranked by fit</p>
        <div style={{ marginTop: '1rem', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.85rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          <span>Method used: <strong>{parseMeta?.methodUsed || 'ai-extraction'}</strong></span>
          <span>Confidence: <strong>{confidence}%</strong></span>
        </div>
        {needsCorrection && (
          <div style={{ marginTop: '1rem', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: '8px', padding: '1rem' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1rem' }}>Manual correction recommended (confidence below 70%)</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>{parseMeta?.feedback?.hint || 'Add corrections to improve future parsing quality.'}</p>
            <textarea value={manualCorrection} onChange={(event) => setManualCorrection(event.target.value)} placeholder="Add corrections (name, role, skills, years of experience, etc.)" rows={4} style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', padding: '0.7rem', resize: 'vertical' }} />
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button onClick={saveFeedback} style={{ background: 'var(--accent)', color: 'var(--ink)', border: 'none', borderRadius: '6px', padding: '0.55rem 1rem', fontWeight: 'bold', cursor: 'pointer' }}>Save correction feedback</button>
              {feedbackSaved && <span style={{ color: 'var(--accent-2)', fontSize: '0.9rem' }}>Feedback saved locally.</span>}
            </div>
          </div>
        )}
      </div>
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div><label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Sort By</label><select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}><option value="score">Score (High to Low)</option><option value="name">Name (A-Z)</option><option value="fit">Fit Quality</option></select></div>
        <div><label style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Filter</label><select value={filterTier} onChange={(e) => setFilterTier(e.target.value)} style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}><option value="all">All Candidates</option><option value="top">Top Tier Only</option><option value="strong">Strong & Above</option><option value="consider">All Including Consider</option></select></div>
      </div>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
        {filtered.map((candidate) => {
          const tier = getTierBadge(candidate.tier)
          return (
            <div key={candidate.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', transition: 'all 0.3s' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                <div><h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{candidate.name}</h3><p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>{candidate.position} • {candidate.experience}</p><p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{candidate.education}</p></div>
                <div style={{ textAlign: 'center' }}><div style={{ width: '100px', height: '100px', borderRadius: '50%', background: `radial-gradient(circle, ${getScoreColor(candidate.score)} 0%, transparent 70%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${getScoreColor(candidate.score)}` }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '2rem', fontWeight: 'bold', color: getScoreColor(candidate.score) }}>{candidate.score}</div><div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>score</div></div></div></div>
                <div style={{ textAlign: 'center' }}><div style={{ background: tier.bg, color: tier.color, padding: '0.75rem 1rem', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.9rem' }}>{tier.label}</div></div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}><h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem' }}>Skills</h4><div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{candidate.skills.map((skill, i) => <span key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.85rem' }}>{skill}</span>)}</div></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div><h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: 'var(--accent-2)' }}>✓ Strengths</h4><ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>{candidate.pros.map((pro, i) => <li key={i}>{pro}</li>)}</ul></div>
                <div><h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', fontSize: '0.95rem', color: '#f59e0b' }}>⚠ Considerations</h4><ul style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6', paddingLeft: '1.5rem' }}>{candidate.cons.map((con, i) => <li key={i}>{con}</li>)}</ul></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
