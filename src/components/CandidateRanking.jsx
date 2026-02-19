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
    <div className="space-y-8 pb-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl border border-indigo-200 p-6 text-center hover:shadow-lg transition">
          <div className="text-4xl font-black text-indigo-600 mb-2">3</div>
          <p className="text-sm font-semibold text-indigo-700">Candidates Analyzed</p>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl border border-green-200 p-6 text-center hover:shadow-lg transition">
          <div className="text-4xl font-black text-green-600 mb-2">1</div>
          <p className="text-sm font-semibold text-green-700">Strong Matches</p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-cyan-100 rounded-xl border border-blue-200 p-6 text-center hover:shadow-lg transition">
          <div className="text-4xl font-black text-blue-600 mb-2">86%</div>
          <p className="text-sm font-semibold text-blue-700">Average Quality</p>
        </div>
      </div>

      {/* AI Summary Box */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-8 shadow-xl text-white">
        <div className="flex items-start gap-4">
          <div className="text-4xl flex-shrink-0">✨</div>
          <div>
            <h2 className="text-2xl font-bold mb-3">
              AI-Powered Summary
            </h2>
            <p className="text-indigo-100 leading-relaxed text-base">
              Sarah Chen stands out as the <span className="font-semibold text-white">top match</span> with exceptional full-stack capabilities. Marcus brings strong backend expertise, ideal for infrastructure work. Elena offers enterprise experience. We recommend starting interviews with Sarah and Marcus.
            </p>
          </div>
        </div>
      </div>

      {/* Candidate Rankings */}
      <div className="space-y-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-3xl font-bold text-slate-900">Top Candidates</h2>
          <span className="text-sm text-slate-600">Ranked by fit</span>
        </div>
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

      {/* Next Steps CTA */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-8 text-center hover:shadow-xl transition">
        <h3 className="text-2xl font-bold text-slate-900 mb-3">
          Ready to Move Forward?
        </h3>
        <p className="text-slate-600 mb-6 max-w-2xl mx-auto">
          This is just the beginning. HireFlow can help you schedule interviews, send candidate feedback, and track your hiring pipeline in real time.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-xl transition transform hover:scale-105 shadow-lg">
            Schedule Interviews
          </button>
          <button className="border-2 border-slate-300 hover:border-indigo-600 text-slate-700 hover:text-indigo-600 font-bold py-3 px-6 rounded-xl transition">
            View Full Reports
          </button>
        </div>
      </div>

      {/* Footer Note */}
      <div className="text-center text-sm text-slate-500">
        <p>This is a demo. Real scoring uses AI to analyze 20+ dimensions: skills, culture fit, experience, communication, and more.</p>
      </div>
    </div>
  )
}
