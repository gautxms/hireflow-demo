import { useMemo, useState } from 'react'
import API_BASE from '../config/api'
import { resolveCandidateScoreState, resolveRecommendationState } from './candidateResultsState'

const FEEDBACK_OPTIONS = [
  { type: 'helpful', label: '👍 Helpful' },
  { type: 'unhelpful', label: '👎 Unhelpful' },
  { type: 'flag_false_positive', label: '🚩 False Positive' },
  { type: 'flag_missing', label: '🧩 Missing Match' },
]

const CARD_BASE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-md)] transition-all duration-200 hover:shadow-[var(--shadow-lg)]'

export default function CandidateCard({ candidate, rank }) {
  const [isExpanded, setIsExpanded] = useState(rank === 1)
  const [feedbackType, setFeedbackType] = useState('')
  const [comment, setComment] = useState('')
  const [submitState, setSubmitState] = useState({ loading: false, success: '', error: '' })

  const candidateId = useMemo(() => {
    const raw = candidate?.id ?? `${rank}-${candidate?.name || 'candidate'}`
    return String(raw)
  }, [candidate?.id, candidate?.name, rank])

  const scoreState = resolveCandidateScoreState(candidate?.score)
  const recommendationState = resolveRecommendationState(candidate?.recommendation, candidate?.score)

  const submitFeedback = async (type) => {
    try {
      setSubmitState({ loading: true, success: '', error: '' })
      setFeedbackType(type)

      const response = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidateId,
          feedbackType: type,
          comment: comment.trim() || undefined,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save feedback')
      }

      setSubmitState({ loading: false, success: 'Thanks! Your feedback was saved.', error: '' })
    } catch (error) {
      setSubmitState({ loading: false, success: '', error: error.message || 'Unable to save feedback' })
    }
  }

  return (
    <div className={`${CARD_BASE} ${scoreState.surfaceClass}`}>
      <div
        className="flex cursor-pointer items-center justify-between gap-4 p-6 transition-colors hover:bg-[var(--color-white-alpha-03)] sm:p-8"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--color-bg-secondary)]">
            <span className="text-lg font-bold text-[var(--color-text-primary)]">#{rank}</span>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="mb-1 truncate text-xl font-bold text-[var(--color-text-primary)] sm:text-2xl">
              {candidate.name}
            </h3>
            <p className="truncate text-sm text-[var(--color-text-secondary)] sm:text-base">{candidate.experience}</p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className={`mb-2 inline-block rounded-[var(--radius-lg)] border px-6 py-3 text-2xl font-black ${scoreState.badgeClass}`}>
            {candidate.score}%
          </div>
          <div className="whitespace-nowrap text-xs sm:text-sm">
            <span className="mr-1">{recommendationState.icon}</span>
            <span className={`font-semibold ${recommendationState.accentSubtleText}`}>{candidate.recommendation}</span>
          </div>
        </div>

        <div className="ml-2 shrink-0 text-xl text-[var(--color-text-secondary)]">
          {isExpanded ? '▼' : '▶'}
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-6 border-t border-[var(--border)] bg-[var(--color-white-alpha-03)] p-6 sm:p-8">
          <div>
            <h4 className="mb-3 text-base font-bold text-[var(--color-text-primary)] sm:text-lg">🤖 AI Assessment</h4>
            <p className="text-sm leading-relaxed text-[var(--color-text-primary)] sm:text-base">{candidate.summary}</p>
          </div>

          <div>
            <h4 className="mb-3 text-base font-bold text-[var(--color-text-primary)] sm:text-lg">💻 Key Skills</h4>
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-[color:var(--color-accent-alpha-15)] bg-[var(--color-accent-alpha-08)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-green)]"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-success-alpha-35)] bg-[var(--color-success-alpha-12)] p-4">
              <h4 className="mb-3 text-base font-bold text-[var(--color-success-text)]">✓ Strengths</h4>
              <ul className="space-y-2">
                {candidate.pros.map((pro, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                    <span className="shrink-0 font-bold text-[var(--color-success)]">✓</span>
                    <span>{pro}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-warning-alpha-35)] bg-[var(--color-warning-alpha-12)] p-4">
              <h4 className="mb-3 text-base font-bold text-[var(--color-warning-text)]">⚠ Considerations</h4>
              <ul className="space-y-2">
                {candidate.cons.map((con, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                    <span className="shrink-0 font-bold text-[var(--color-warning-text)]">⚠</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4">
            <h4 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">🧠 Improve Ranking Quality</h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FEEDBACK_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => submitFeedback(option.type)}
                  disabled={submitState.loading}
                  className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm font-semibold transition ${feedbackType === option.type ? 'border-[var(--color-accent-green)] bg-[var(--color-accent-alpha-08)] text-[var(--color-accent-green)]' : 'border-[var(--border)] text-[var(--color-text-primary)] hover:border-[var(--color-accent-green)]'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm text-[var(--color-text-secondary)]">
              Optional comment
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 1000))}
                rows={3}
                placeholder="What looked right or wrong?"
                className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-green)] focus:outline-none"
              />
            </label>
            {submitState.success ? <p className="mt-2 text-sm text-[var(--color-success-text)]">{submitState.success}</p> : null}
            {submitState.error ? <p className="mt-2 text-sm text-[var(--color-error)]">{submitState.error}</p> : null}
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row">
            <button className="flex-1 rounded-[var(--radius-md)] bg-[var(--color-accent-green)] px-6 py-3 font-bold text-[var(--color-bg-primary)] transition hover:brightness-95">
              Schedule Interview
            </button>
            <button className="rounded-[var(--radius-md)] border border-[var(--color-accent-green)] px-6 py-3 font-bold text-[var(--color-accent-green)] transition hover:bg-[var(--color-accent-alpha-08)]">
              View Resume
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
