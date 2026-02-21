export default function LandingPage({ onStartDemo }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white overflow-hidden">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse animation-delay-2000"></div>
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-slate-900/50 backdrop-blur-xl border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center relative z-10">
          <div className="flex items-center space-x-2">
            <div className="text-3xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              HireFlow
            </div>
          </div>
          <div className="hidden sm:flex space-x-8">
            <button className="text-purple-200 hover:text-purple-300 font-medium transition">Features</button>
            <button className="text-purple-200 hover:text-purple-300 font-medium transition">Pricing</button>
            <button className="text-purple-200 hover:text-purple-300 font-medium transition">Docs</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 py-20 sm:py-24 relative z-10">
        <div className="max-w-4xl w-full">
          {/* Main Headline */}
          <div className="text-center mb-12">
            <div className="inline-block mb-6 px-4 py-2 bg-purple-500/20 border border-purple-500/50 rounded-full backdrop-blur">
              <span className="text-sm font-semibold text-purple-300">✨ Powered by AI</span>
            </div>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black mb-6 leading-tight">
              Hire Your Next
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">Engineer in 30 Days</span>
            </h1>
            <p className="text-lg sm:text-xl text-purple-100 max-w-2xl mx-auto mb-8 leading-relaxed font-light">
              Stop wasting 20+ hours per hire. HireFlow automates resume screening, conducts interviews, and ranks candidates. You make better decisions in 2 hours instead of 20.
            </p>
          </div>

          {/* Benefits Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
            <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-sm p-8 rounded-2xl border border-purple-500/30 hover:border-purple-500/60 hover:shadow-2xl hover:shadow-purple-500/20 transition">
              <div className="text-4xl mb-4">⚡</div>
              <h3 className="font-bold text-white mb-2 text-lg">50% Less Time</h3>
              <p className="text-purple-100 text-sm leading-relaxed">From 20+ hours to 2-3 hours per hire. Faster decisions, faster starts.</p>
            </div>
            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 backdrop-blur-sm p-8 rounded-2xl border border-blue-500/30 hover:border-blue-500/60 hover:shadow-2xl hover:shadow-blue-500/20 transition">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="font-bold text-white mb-2 text-lg">Better Decisions</h3>
              <p className="text-purple-100 text-sm leading-relaxed">AI scores 20+ dimensions: skills, culture fit, bias removed, transparent.</p>
            </div>
            <div className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 backdrop-blur-sm p-8 rounded-2xl border border-cyan-500/30 hover:border-cyan-500/60 hover:shadow-2xl hover:shadow-cyan-500/20 transition">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="font-bold text-white mb-2 text-lg">Save $3-5K/Hire</h3>
              <p className="text-purple-100 text-sm leading-relaxed">Eliminate recruiter overhead. Payback by your 2nd hire.</p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-8">
            <button
              onClick={onStartDemo}
              className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold py-4 px-8 rounded-xl text-lg shadow-2xl shadow-purple-500/50 hover:shadow-3xl hover:shadow-purple-500/80 transition duration-200 transform hover:scale-105"
            >
              🚀 See It In Action
            </button>
            <button className="w-full sm:w-auto text-purple-200 font-semibold py-4 px-8 rounded-xl border-2 border-purple-500/50 hover:border-purple-400 hover:text-purple-300 transition backdrop-blur">
              📺 Watch Demo (2 min)
            </button>
          </div>
          
          <p className="text-center text-sm text-purple-300 font-medium">
            No credit card required. Free demo. Takes 2 minutes.
          </p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="px-4 py-12 bg-gradient-to-r from-purple-500/5 to-blue-500/5 border-y border-purple-500/20 backdrop-blur-sm relative z-10">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent mb-2">28 days</div>
              <p className="text-sm text-purple-300">Average hire cycle</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">82%</div>
              <p className="text-sm text-purple-300">Offer acceptance rate</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">20+</div>
              <p className="text-sm text-purple-300">Scoring dimensions</p>
            </div>
            <div>
              <div className="text-4xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">$3-5K</div>
              <p className="text-sm text-purple-300">Savings per hire</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950/80 backdrop-blur-sm py-8 px-4 border-t border-purple-500/20 relative z-10">
        <div className="max-w-6xl mx-auto text-center text-purple-300 text-sm">
          <p>© 2026 HireFlow. Built for founders who move fast.</p>
        </div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.4; }
        }
        @keyframes pulse-delay {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.4; }
        }
        .animate-pulse {
          animation: pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animation-delay-2000 {
          animation: pulse-delay 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          animation-delay: 2s;
        }
      `}</style>
    </div>
  )
}
