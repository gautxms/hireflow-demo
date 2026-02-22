export default function LandingPage({ onStartDemo }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #2d1b4e 50%, #0f172a 100%)' }}>
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-gray-900 bg-opacity-50 backdrop-blur border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-3xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            HireFlow
          </div>
          <div className="hidden sm:flex space-x-8">
            <button className="text-purple-300 hover:text-purple-200 font-medium">Features</button>
            <button className="text-purple-300 hover:text-purple-200 font-medium">Pricing</button>
            <button className="text-purple-300 hover:text-purple-200 font-medium">Docs</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 py-20">
        <div className="max-w-4xl w-full text-center">
          {/* Badge */}
          <div className="inline-block mb-6 px-4 py-2 rounded-full border border-purple-500 bg-purple-900 bg-opacity-30">
            <span className="text-sm font-semibold text-purple-300">✨ Powered by AI</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-6xl sm:text-7xl font-black mb-6 leading-tight">
            Hire Your Next
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">Engineer in 30 Days</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8">
            Stop wasting 20+ hours per hire. HireFlow automates resume screening, conducts interviews, and ranks candidates. You make better decisions in 2 hours instead of 20.
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
            <div className="p-8 rounded-2xl border border-purple-500 border-opacity-30 bg-purple-900 bg-opacity-20 hover:bg-opacity-40 transition">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="font-bold text-white mb-2 text-lg">50% Less Time</h3>
              <p className="text-gray-300 text-sm">From 20+ hours to 2-3 hours per hire. Faster decisions, faster starts.</p>
            </div>
            <div className="p-8 rounded-2xl border border-blue-500 border-opacity-30 bg-blue-900 bg-opacity-20 hover:bg-opacity-40 transition">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="font-bold text-white mb-2 text-lg">Better Decisions</h3>
              <p className="text-gray-300 text-sm">AI scores 20+ dimensions: skills, culture fit, bias removed, transparent.</p>
            </div>
            <div className="p-8 rounded-2xl border border-cyan-500 border-opacity-30 bg-cyan-900 bg-opacity-20 hover:bg-opacity-40 transition">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="font-bold text-white mb-2 text-lg">Save $3-5K/Hire</h3>
              <p className="text-gray-300 text-sm">Eliminate recruiter overhead. Payback by your 2nd hire.</p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-8">
            <button
              onClick={onStartDemo}
              className="px-8 py-4 rounded-lg font-bold text-lg text-white transition transform hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)', boxShadow: '0 0 30px rgba(168, 85, 247, 0.5)' }}
            >
              🚀 See It In Action
            </button>
            <button className="px-8 py-4 rounded-lg font-bold text-lg text-white border-2 border-purple-500 hover:bg-purple-900 hover:bg-opacity-30 transition">
              📺 Watch Demo (2 min)
            </button>
          </div>

          <p className="text-sm text-gray-400">
            No credit card required. Free demo. Takes 2 minutes.
          </p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="px-4 py-12 border-t border-gray-700" style={{ background: 'rgba(0, 0, 0, 0.2)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent mb-2">28 days</div>
              <p className="text-sm text-gray-400">Average hire cycle</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">82%</div>
              <p className="text-sm text-gray-400">Offer acceptance rate</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">20+</div>
              <p className="text-sm text-gray-400">Scoring dimensions</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">$3-5K</div>
              <p className="text-sm text-gray-400">Savings per hire</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-6 border-t border-gray-700 text-center text-gray-400 text-sm">
        © 2026 HireFlow. Built for founders who move fast.
      </footer>
    </div>
  )
}
