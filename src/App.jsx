import { useState } from 'react'
import LandingPage from './components/LandingPage'
import Dashboard from './components/Dashboard'
import './index.css'

function App() {
  const [currentPage, setCurrentPage] = useState('landing') // 'landing' or 'dashboard'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {currentPage === 'landing' ? (
        <LandingPage onStartDemo={() => setCurrentPage('dashboard')} />
      ) : (
        <Dashboard onBack={() => setCurrentPage('landing')} />
      )}
    </div>
  )
}

export default App
