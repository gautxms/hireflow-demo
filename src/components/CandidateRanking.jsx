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

const STATS = [
  {
    value: '3',
    label: 'Candidates Analyzed',
    classes: 'bg-[var(--color-accent-alpha-08)] border-[color:var(--color-accent-alpha-15)] text-[var(--accent)]',
  },
  {
    value: '1',
    label: 'Strong Matches',
    classes: 'bg-[var(--color-success-alpha-12)] border-[color:var(--color-success-alpha-35)] text-[var(--color-success-text)]',
  },
  {
    value: '86%',
    label: 'Average Quality',
    classes: 'bg-[var(--color-white-alpha-04)] border-[var(--border)] text-[var(--text)]',
  },
]

export default function CandidateRanking() {
  return (
    <div className="space-y-8 pb-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map((stat) => (
          <div key={stat.label} className={`rounded-[var(--radius-lg)] border p-6 text-center shadow-[var(--shadow-sm)] transition hover:shadow-[var(--shadow-md)] ${stat.classes}`}>
            <div className="mb-2 text-4xl font-black">{stat.value}</div>
            <p className="text-sm font-semibold">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-accent-alpha-15)] bg-[var(--color-accent-alpha-08)] p-8 shadow-[var(--shadow-md)] text-[var(--text)]">
        <div className="flex items-start gap-4">
          <div className="shrink-0 text-4xl">✨</div>
          <div>
            <h2 className="mb-3 text-2xl font-bold">
              AI-Powered Summary
            </h2>
            <p className="text-base leading-relaxed text-[var(--muted)]">
              Sarah Chen stands out as the <span className="font-semibold text-[var(--text)]">top match</span> with exceptional full-stack capabilities. Marcus brings strong backend expertise, ideal for infrastructure work. Elena offers enterprise experience. We recommend starting interviews with Sarah and Marcus.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-3xl font-bold text-[var(--text)]">Top Candidates</h2>
          <span className="text-sm text-[var(--muted)]">Ranked by fit</span>
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

      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-[var(--shadow-md)] transition hover:shadow-[var(--shadow-lg)]">
        <h3 className="mb-3 text-2xl font-bold text-[var(--text)]">
          Ready to Move Forward?
        </h3>
        <p className="mx-auto mb-6 max-w-2xl text-[var(--muted)]">
          This is just the beginning. HireFlow can help you schedule interviews, send candidate feedback, and track your hiring pipeline in real time.
        </p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <button className="rounded-[var(--radius-lg)] bg-[var(--accent)] px-6 py-3 font-bold text-[var(--ink)] transition hover:brightness-95">
            Schedule Interviews
          </button>
          <button className="rounded-[var(--radius-lg)] border border-[var(--accent)] px-6 py-3 font-bold text-[var(--accent)] transition hover:bg-[var(--color-accent-alpha-08)]">
            View Full Reports
          </button>
        </div>
      </div>

      <div className="text-center text-sm text-[var(--muted)]">
        <p>This is a demo. Real scoring uses AI to analyze 20+ dimensions: skills, culture fit, experience, communication, and more.</p>
      </div>
    </div>
  )
}
