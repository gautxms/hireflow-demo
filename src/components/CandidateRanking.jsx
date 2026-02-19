import CandidateCard from './CandidateCard'

// Mock candidate data with AI scores
const MOCK_CANDIDATES = [
  {
    id: 1,
    name: 'Sarah Chen',
    score: 92,
    recommendation: 'Strong match',
    skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
    experience: '5 years full-stack',
    summary:
      'Sarah demonstrates excellent technical skills with proven experience building scalable applications. Her background in modern web technologies aligns perfectly with our needs.',
    pros: [
      'Strong React expertise',
      'Full-stack capabilities',
      'Leadership experience',
    ],
    cons: ['Relatively new to AWS'],
  },
  {
    id: 2,
    name: 'Marcus Johnson',
    score: 78,
    recommendation: 'Good match',
    skills: ['Python', 'Django', 'Vue.js', 'AWS'],
    experience: '4 years backend-focused',
    summary:
      'Marcus has solid backend engineering skills and AWS experience. Would be a good fit for infrastructure-heavy projects, though React experience is limited.',
    pros: [
      'AWS specialist',
      'Strong backend skills',
      'DevOps mindset',
    ],
    cons: ['Limited frontend experience', 'Less startup experience'],
  },
  {
    id: 3,
    name: 'Elena Rodriguez',
    score: 68,
    recommendation: 'Possible match',
    skills: ['Java', 'Spring Boot', 'C++', 'Docker'],
    experience: '6 years enterprise development',
    summary:
      'Elena brings enterprise software experience and container knowledge. Good fundamentals, but would need ramp-up time on modern JavaScript frameworks.',
    pros: [
      'Strong fundamentals',
      'Container expertise',
      'Enterprise experience',
    ],
    cons: [
      'Java-focused background',
      'Limited JavaScript experience',
      'Enterprise pace',
    ],
  },
]

export default function CandidateRanking({ uploadedFile }) {
  return (
    <div className="space-y-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="text-3xl font-bold text-blue-600 mb-2">3</div>
          <p className="text-gray-600">Candidates Analyzed</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="text-3xl font-bold text-green-600 mb-2">1</div>
          <p className="text-gray-600">Strong Matches</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="text-3xl font-bold text-purple-600 mb-2">86</div>
          <p className="text-gray-600">Avg Score</p>
        </div>
      </div>

      {/* AI Summary Box */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl">🤖</div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              AI Summary
            </h2>
            <p className="text-gray-700 leading-relaxed">
              Based on the uploaded resumes, Sarah Chen stands out as the top candidate with strong full-stack capabilities
              and cultural fit. We recommend scheduling an interview with Sarah first, followed by Marcus for infrastructure
              projects. All three candidates show solid fundamentals and would benefit your team in different ways.
            </p>
          </div>
        </div>
      </div>

      {/* Candidate Rankings */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Ranked Candidates</h2>
        <div className="space-y-4">
          {MOCK_CANDIDATES.map((candidate, index) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              rank={index + 1}
            />
          ))}
        </div>
      </div>

      {/* Export / Next Steps */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Next Steps
        </h3>
        <p className="text-gray-600 mb-4">
          Ready to screen more candidates? Upload another batch or share these
          results with your hiring team.
        </p>
        <div className="flex gap-4 justify-center">
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition">
            Share Results
          </button>
          <button className="border border-blue-600 text-blue-600 hover:bg-blue-50 font-bold py-2 px-6 rounded-lg transition">
            Download PDF
          </button>
        </div>
      </div>
    </div>
  )
}
