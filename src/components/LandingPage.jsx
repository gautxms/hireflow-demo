export default function LandingPage({ onStartDemo }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">HireFlow</div>
          <div className="space-x-4">
            <button className="text-gray-600 hover:text-gray-900">Pricing</button>
            <button className="text-gray-600 hover:text-gray-900">Features</button>
            <button className="text-gray-600 hover:text-gray-900">Docs</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-3xl text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Hire Smarter, Faster
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            AI-powered resume screening and candidate ranking. Upload resumes, get intelligent insights in seconds.
          </p>
          
          {/* Feature Grid */}
          <div className="grid grid-cols-3 gap-4 mb-12 text-left">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">⚡</div>
              <h3 className="font-semibold text-gray-900 mb-2">Fast Screening</h3>
              <p className="text-sm text-gray-600">Analyze dozens of resumes in seconds</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">🎯</div>
              <h3 className="font-semibold text-gray-900 mb-2">Smart Ranking</h3>
              <p className="text-sm text-gray-600">AI scores and ranks candidates by fit</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="font-semibold text-gray-900 mb-2">Clear Insights</h3>
              <p className="text-sm text-gray-600">See why each candidate ranks</p>
            </div>
          </div>

          {/* CTA Button */}
          <button
            onClick={onStartDemo}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg text-lg shadow-lg transition duration-200"
          >
            Try Demo Now
          </button>
          
          <p className="text-sm text-gray-500 mt-6">
            No sign-up required. See how HireFlow works.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 py-8 px-4">
        <div className="max-w-6xl mx-auto text-center text-sm text-gray-600">
          <p>&copy; 2026 HireFlow. Powered by AI. Built for recruiting teams.</p>
        </div>
      </footer>
    </div>
  )
}
