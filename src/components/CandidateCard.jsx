import { useState } from 'react'

export default function CandidateCard({ candidate, rank }) {
  const [isExpanded, setIsExpanded] = useState(rank === 1) // Auto-expand top candidate

  // Color coding for scores
  const getScoreColor = (score) => {
    if (score >= 85) return 'bg-green-100 text-green-800 border-green-300'
    if (score >= 75) return 'bg-blue-100 text-blue-800 border-blue-300'
    return 'bg-yellow-100 text-yellow-800 border-yellow-300'
  }

  const getRecommendationIcon = (rec) => {
    if (rec.includes('Strong')) return '⭐'
    if (rec.includes('Good')) return '👍'
    return '⏳'
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
      {/* Header */}
      <div
        className="p-6 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-6 flex-1">
          {/* Rank Badge */}
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-400">#{rank}</div>
          </div>

          {/* Candidate Info */}
          <div className="flex-1">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {candidate.name}
            </h3>
            <p className="text-gray-600">{candidate.experience}</p>
          </div>

          {/* Score & Recommendation */}
          <div className="text-right">
            <div className={`inline-block px-4 py-2 rounded-lg border font-bold text-lg mb-2 ${getScoreColor(candidate.score)}`}>
              {candidate.score}%
            </div>
            <div className="text-sm">
              <span className="mr-2">{getRecommendationIcon(candidate.recommendation)}</span>
              <span className="text-gray-700 font-semibold">{candidate.recommendation}</span>
            </div>
          </div>
        </div>

        {/* Expand Toggle */}
        <div className="ml-4 text-2xl text-gray-400">
          {isExpanded ? '▼' : '▶'}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-6 space-y-6">
          {/* Summary */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">AI Assessment</h4>
            <p className="text-gray-700 leading-relaxed">{candidate.summary}</p>
          </div>

          {/* Skills */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Key Skills</h4>
            <div className="flex flex-wrap gap-2">
              {candidate.skills.map((skill) => (
                <span
                  key={skill}
                  className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* Pros & Cons */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-green-900 mb-2">✓ Strengths</h4>
              <ul className="space-y-1">
                {candidate.pros.map((pro, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>{pro}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-orange-900 mb-2">⚠ Considerations</h4>
              <ul className="space-y-1">
                {candidate.cons.map((con, idx) => (
                  <li key={idx} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-orange-600">⚠</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-gray-300 flex gap-3">
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition flex-1">
              Schedule Interview
            </button>
            <button className="border border-gray-300 text-gray-700 hover:bg-gray-100 font-bold py-2 px-6 rounded-lg transition">
              View Full Resume
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
