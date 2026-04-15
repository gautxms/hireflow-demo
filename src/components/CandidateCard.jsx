import { useMemo, useState } from 'react'
import API_BASE from '../config/api'

const FEEDBACK_OPTIONS = [
  { type: 'helpful', label: '👍 Helpful' },
  { type: 'unhelpful', label: '👎 Unhelpful' },
  { type: 'flag_false_positive', label: '🚩 False Positive' },
  { type: 'flag_missing', label: '🧩 Missing Match' },
]

export default function CandidateCard({ candidate, rank }) {
  const [isExpanded, setIsExpanded] = useState(rank === 1)
  const [feedbackType, setFeedbackType] = useState('')
  const [comment, setComment] = useState('')
  const [submitState, setSubmitState] = useState({ loading: false, success: '', error: '' })

  const candidateId = useMemo(() => {
    const raw = candidate?.id ?? `${rank}-${candidate?.name || 'candidate'}`
    return String(raw)
  }, [candidate?.id, candidate?.name, rank])

  const getScoreColor = (score) => {
    if (score >= 85) return 'from-green-500 to-emerald-600 shadow-lg'
    if (score >= 75) return 'from-blue-500 to-cyan-600 shadow-md'
    return 'from-amber-500 to-orange-600 shadow-md'
  }

  const getScoreBgColor = (score) => {
    if (score >= 85) return 'bg-green-50 border-green-200'
    if (score >= 75) return 'bg-blue-50 border-blue-200'
    return 'bg-amber-50 border-amber-200'
  }

  const getRecommendationIcon = (rec) => {
    if (rec.includes('Strong')) return '⭐'
    if (rec.includes('Good')) return '👍'
    return '⏳'
  }

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
    <div className={`bg-white rounded-2xl border-2 overflow-hidden hover:shadow-xl transition-all duration-200 ${getScoreBgColor(candidate.score)}`}>
      <div
        className="p-6 sm:p-8 cursor-pointer hover:bg-opacity-50 transition-colors flex items-center justify-between gap-4"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4 sm:gap-6 flex-1 min-w-0">
          <div className="flex-shrink-0 w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center">
            <span className="text-lg font-bold text-slate-700">#{rank}</span>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-1 truncate">
              {candidate.name}
            </h3>
            <p className="text-sm sm:text-base text-slate-600 truncate">{candidate.experience}</p>
          </div>
        </div>

        <div className="flex-shrink-0 text-right">
          <div className={`inline-block bg-gradient-to-r ${getScoreColor(candidate.score)} text-white font-black text-2xl px-6 py-3 rounded-xl mb-2`}>
            {candidate.score}%
          </div>
          <div className="text-xs sm:text-sm whitespace-nowrap">
            <span className="mr-1">{getRecommendationIcon(candidate.recommendation)}</span>
            <span className="text-slate-700 font-semibold">{candidate.recommendation}</span>
          </div>
        </div>

        <div className="flex-shrink-0 text-xl text-slate-400 ml-2">
          {isExpanded ? '▼' : '▶'}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t-2 border-slate-200 bg-slate-50/50 p-6 sm:p-8 space-y-6">
          <div>
            <h4 className="font-bold text-slate-900 mb-3 text-base sm:text-lg">🤖 AI Assessment</h4>
            <p className="text-slate-700 leading-relaxed text-sm sm:text-base">{candidate.summary}</p>
          </div>

          <div>
            <h4 className="font-bold text-slate-900 mb-3 text-base sm:text-lg">💻 Key Skills</h4>
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((skill) => (
                <span
                  key={skill}
                  className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-md hover:shadow-lg transition"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="bg-white p-4 rounded-xl border-2 border-green-100">
              <h4 className="font-bold text-green-900 mb-3 text-base">✓ Strengths</h4>
              <ul className="space-y-2">
                {candidate.pros.map((pro, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex gap-2 items-start">
                    <span className="text-green-600 flex-shrink-0 font-bold">✓</span>
                    <span>{pro}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white p-4 rounded-xl border-2 border-amber-100">
              <h4 className="font-bold text-amber-900 mb-3 text-base">⚠ Considerations</h4>
              <ul className="space-y-2">
                {candidate.cons.map((con, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex gap-2 items-start">
                    <span className="text-amber-600 flex-shrink-0 font-bold">⚠</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="font-bold text-slate-900 mb-3 text-base">🧠 Improve Ranking Quality</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FEEDBACK_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => submitFeedback(option.type)}
                  disabled={submitState.loading}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${feedbackType === option.type ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-700 hover:border-indigo-400'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm text-slate-600">
              Optional comment
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 1000))}
                rows={3}
                placeholder="What looked right or wrong?"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>
            {submitState.success ? <p className="mt-2 text-sm text-green-700">{submitState.success}</p> : null}
            {submitState.error ? <p className="mt-2 text-sm text-rose-700">{submitState.error}</p> : null}
          </div>

          <div className="pt-4 border-t-2 border-slate-200 flex flex-col sm:flex-row gap-3">
            <button className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition transform hover:scale-105 shadow-lg flex-1">
              Schedule Interview
            </button>
            <button className="border-2 border-slate-300 hover:border-indigo-600 text-slate-700 hover:text-indigo-600 font-bold py-3 px-6 rounded-lg transition">
              View Resume
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
