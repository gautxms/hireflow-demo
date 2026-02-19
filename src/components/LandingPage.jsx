export default function LandingPage({ onStartDemo }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-white via-slate-50 to-slate-100">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="text-3xl font-black bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
              HireFlow
            </div>
          </div>
          <div className="hidden sm:flex space-x-8">
            <button className="text-slate-600 hover:text-slate-900 font-medium transition">Features</button>
            <button className="text-slate-600 hover:text-slate-900 font-medium transition">Pricing</button>
            <button className="text-slate-600 hover:text-slate-900 font-medium transition">Docs</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 py-20 sm:py-24">
        <div className="max-w-4xl w-full">
          {/* Main Headline */}
          <div className="text-center mb-12">
            <div className="inline-block mb-6 px-4 py-2 bg-blue-100 rounded-full">
              <span className="text-sm font-semibold text-blue-700">Powered by AI</span>
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-900 mb-6 leading-tight">
              Hire Your Next Engineer in
              <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent"> 30 Days</span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto mb-8 leading-relaxed">
              Stop wasting 20+ hours per hire. HireFlow automates resume screening, conducts interviews, and ranks candidates. You make better decisions in 2 hours instead of 20.
            </p>
          </div>

          {/* Benefits Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
            <div className="bg-white/50 backdrop-blur-sm p-8 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg transition">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="font-bold text-slate-900 mb-2 text-lg">50% Less Time</h3>
              <p className="text-slate-600 text-sm leading-relaxed">From 20+ hours to 2-3 hours per hire. Faster decisions, faster starts.</p>
            </div>
            <div className="bg-white/50 backdrop-blur-sm p-8 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg transition">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="font-bold text-slate-900 mb-2 text-lg">Better Decisions</h3>
              <p className="text-slate-600 text-sm leading-relaxed">AI scores 20+ dimensions: skills, culture fit, bias removed, transparent.</p>
            </div>
            <div className="bg-white/50 backdrop-blur-sm p-8 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg transition">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="font-bold text-slate-900 mb-2 text-lg">Save $3-5K/Hire</h3>
              <p className="text-slate-600 text-sm leading-relaxed">Eliminate recruiter overhead. Payback by your 2nd hire.</p>
            </div>
          </div>

          {/* CTA Button */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-8">
            <button
              onClick={onStartDemo}
              className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-4 px-8 rounded-xl text-lg shadow-xl hover:shadow-2xl transition duration-200 transform hover:scale-105"
            >
              See It In Action →
            </button>
            <button className="w-full sm:w-auto text-slate-700 font-semibold py-4 px-8 rounded-xl border-2 border-slate-300 hover:border-indigo-600 hover:text-indigo-600 transition">
              Watch Demo (2 min)
            </button>
          </div>
          
          <p className="text-center text-sm text-slate-500 font-medium">
            No credit card required. Free demo. Takes 2 minutes.
          </p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="px-4 py-12 bg-white/40 border-y border-slate-200/50">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl font-black text-indigo-600 mb-2">28 days</div>
              <p className="text-sm text-slate-600">Average hire cycle</p>
            </div>
            <div>
              <div className="text-3xl font-black text-blue-600 mb-2">82%</div>
              <p className="text-sm text-slate-600">Offer acceptance rate</p>
            </div>
            <div>
              <div className="text-3xl font-black text-indigo-600 mb-2">20+</div>
              <p className="text-sm text-slate-600">Scoring dimensions</p>
            </div>
            <div>
              <div className="text-3xl font-black text-blue-600 mb-2">$3-5K</div>
              <p className="text-sm text-slate-600">Savings per hire</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900/95 backdrop-blur-sm py-8 px-4 mt-auto">
        <div className="max-w-6xl mx-auto text-center text-sm text-slate-400">
          <p>&copy; 2026 HireFlow. Made for technical teams. Powered by AI.</p>
        </div>
      </footer>
    </div>
  )
}
