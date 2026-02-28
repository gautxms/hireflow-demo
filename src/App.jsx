import { useEffect, useMemo, useState } from 'react'
import LandingPage from './components/LandingPage'
import Pricing from './pages/Pricing'
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
import Terms from './pages/Terms'
import PrivacyPage from './components/PrivacyPage'
import RefundPolicy from './pages/RefundPolicy'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)

  const handleNavigate = (page, promptMessage = 'Please login or sign up to continue.') => {
    if (!isAuthenticated && PROTECTED_PAGES.has(page)) {
      onRequireAuth(promptMessage)
      setCurrentPage('landing')
      return
    }

    setCurrentPage(page)
  }

  const handleFileUploaded = (files) => {
    setUploadedFiles(files)
    handleNavigate('results')
  }


  useEffect(() => {
    if (!isAuthenticated && PROTECTED_PAGES.has(currentPage)) {
      onRequireAuth('Please login or sign up to continue.')
      setCurrentPage('landing')
    }
  }, [currentPage, isAuthenticated, onRequireAuth])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 16px', background: '#f9fafb' }}>
        {isAuthenticated ? (
          <button onClick={onLogout}>Logout</button>
        ) : (
          <>
            <button onClick={() => navigate('/login')}>Login</button>
            <button onClick={() => navigate('/signup')}>Sign up</button>
          </>
        )}
      </div>
      {currentPage === 'landing' && (
        <LandingPage
          onStartDemo={() => handleNavigate('uploader', 'Please sign up to try the resume screening demo.')}
          onViewPricing={() => navigate('/pricing')}
          onViewDashboard={() => handleNavigate('dashboard', 'Please login to access your dashboard.')}
          onViewAbout={() => handleNavigate('about')}
          onViewDemo={() => handleNavigate('demo')}
          onViewContact={() => handleNavigate('contact')}
          onViewHelp={() => handleNavigate('help')}
        />
      )}


      {currentPage === 'uploader' && (
        <ResumeUploader onFileUploaded={handleFileUploaded} onBack={() => handleNavigate('landing')} />
      )}

      {currentPage === 'results' && (
        <CandidateResults
          candidates={uploadedFiles}
          onBack={() => handleNavigate('uploader')}
        />
      )}

      {currentPage === 'dashboard' && (
        <OperationsDashboard onNavigate={handleNavigate} />
      )}

      {currentPage === 'settings' && (
        <SettingsPage onBack={() => handleNavigate('dashboard')} />
      )}

      {currentPage === 'help' && (
        <HelpPage onBack={() => handleNavigate('landing')} />
      )}

      {currentPage === 'about' && (
        <AboutPage onBack={() => handleNavigate('landing')} />
      )}

      {currentPage === 'demo' && (
        <DemoBookingPage onBack={() => handleNavigate('landing')} />
      )}

      {currentPage === 'contact' && (
        <ContactPage onBack={() => handleNavigate('landing')} />
      )}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '')
  const [pathname, setPathname] = useState(window.location.pathname)
  const [authPrompt, setAuthPrompt] = useState('')

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const isAuthenticated = useMemo(() => Boolean(token), [token])

  const handleAuthSuccess = (newToken) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
    setAuthPrompt('')
    navigate('/')
  }

  const logout = async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    navigate('/login')
  }

  const requireAuth = (message) => {
    setAuthPrompt(message)
    navigate('/login')
  }

  useEffect(() => {
    if (isAuthenticated && (pathname === '/login' || pathname === '/signup')) {
      navigate('/')
    }
  }, [isAuthenticated, pathname])


  if (pathname === '/pricing') {
    return <Pricing />
  }

  if (pathname === '/terms') {
    return <Terms />
  }

  if (pathname === '/privacy') {
    return <PrivacyPage />
  }

  if (pathname === '/refund-policy') {
    return <RefundPolicy />
  }

  if (!isAuthenticated && pathname === '/signup') {
    return <SignupPage onAuthSuccess={handleAuthSuccess} onGoToLogin={() => navigate('/login')} />
  }

  if (!isAuthenticated && pathname === '/login') {
    return <LoginPage onAuthSuccess={handleAuthSuccess} onGoToSignup={() => navigate('/signup')} promptMessage={authPrompt} />
  }

  return <MainSite isAuthenticated={isAuthenticated} onLogout={logout} onRequireAuth={requireAuth} />
}
