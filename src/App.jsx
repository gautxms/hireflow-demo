import { useEffect, useMemo, useState } from 'react'
import LandingPage from './components/LandingPage'
import PricingPage from './components/PricingPage'
import ResumeUploader from './components/ResumeUploader'
import CandidateResults from './components/CandidateResults'
import OperationsDashboard from './components/Dashboard'
import SettingsPage from './components/SettingsPage'
import HelpPage from './components/HelpPage'
import AboutPage from './components/AboutPage'
import DemoBookingPage from './components/DemoBookingPage'
import ContactPage from './components/ContactPage'
import LoginPage from './components/LoginPage'
import SignupPage from './components/SignupPage'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function AuthenticatedApp({ onLogout }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)

  const handleFileUploaded = (files) => {
    setUploadedFiles(files)
    setCurrentPage('results')
  }

  const handleSelectPlan = (planId) => {
    console.log('Selected plan:', planId)
    setCurrentPage('uploader')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', background: '#f9fafb' }}>
        <button onClick={onLogout}>Logout</button>
      </div>
      {currentPage === 'landing' && (
        <LandingPage
          onStartDemo={() => setCurrentPage('uploader')}
          onViewPricing={() => setCurrentPage('pricing')}
          onViewDashboard={() => setCurrentPage('dashboard')}
          onViewAbout={() => setCurrentPage('about')}
          onViewDemo={() => setCurrentPage('demo')}
          onViewContact={() => setCurrentPage('contact')}
          onViewHelp={() => setCurrentPage('help')}
        />
      )}

      {currentPage === 'pricing' && (
        <PricingPage
          onSelectPlan={handleSelectPlan}
          onBack={() => setCurrentPage('landing')}
        />
      )}

      {currentPage === 'uploader' && (
        <ResumeUploader onFileUploaded={handleFileUploaded} onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'results' && (
        <CandidateResults
          candidates={uploadedFiles}
          onBack={() => setCurrentPage('uploader')}
        />
      )}

      {currentPage === 'dashboard' && (
        <OperationsDashboard onNavigate={setCurrentPage} />
      )}

      {currentPage === 'settings' && (
        <SettingsPage onBack={() => setCurrentPage('dashboard')} />
      )}

      {currentPage === 'help' && (
        <HelpPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'about' && (
        <AboutPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'demo' && (
        <DemoBookingPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'contact' && (
        <ContactPage onBack={() => setCurrentPage('landing')} />
      )}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '')
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const isAuthenticated = useMemo(() => Boolean(token), [token])

  const handleAuthSuccess = (newToken) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
    navigate('/')
  }

  const logout = async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    navigate('/login')
  }

  useEffect(() => {
    if (!isAuthenticated) {
      if (pathname !== '/login' && pathname !== '/signup') {
        navigate('/login')
      }
      return
    }

    if (pathname === '/login' || pathname === '/signup') {
      navigate('/')
    }
  }, [isAuthenticated, pathname])

  if (!isAuthenticated && pathname === '/signup') {
    return <SignupPage onAuthSuccess={handleAuthSuccess} />
  }

  if (!isAuthenticated) {
    return <LoginPage onAuthSuccess={handleAuthSuccess} />
  }

  return <AuthenticatedApp onLogout={logout} />
}
