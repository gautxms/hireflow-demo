import { useEffect, useMemo, useRef, useState } from 'react'
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
import BillingSuccess from './pages/BillingSuccess'
import BillingCancel from './pages/BillingCancel'
import Checkout from './pages/Checkout'
import PublicFooter from './components/PublicFooter'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth, pathname, onAuthSuccess, authPrompt }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)

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

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return undefined
    }

    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isProfileMenuOpen])

  const getPageContent = () => {
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

    if (pathname === '/billing/success') {
      return <BillingSuccess />
    }

    if (pathname === '/billing/cancel') {
      return <BillingCancel />
    }

    if (pathname === '/checkout') {
      return <Checkout />
    }

    if (pathname === '/account') {
      return (
        <div style={{ padding: '2rem', maxWidth: 680, margin: '0 auto' }}>
          <h1 style={{ marginBottom: '0.5rem' }}>Account</h1>
          <p style={{ color: '#4b5563' }}>Account details are coming soon.</p>
        </div>
      )
    }

    if (!isAuthenticated && pathname === '/signup') {
      return <SignupPage onAuthSuccess={onAuthSuccess} onGoToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && pathname === '/login') {
      return <LoginPage onAuthSuccess={onAuthSuccess} onGoToSignup={() => navigate('/signup')} promptMessage={authPrompt} />
    }

    return (
      <>
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
      </>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 16px', background: '#f9fafb' }}>
        {isAuthenticated ? (
          <div style={{ position: 'relative' }} ref={profileMenuRef}>
            <button
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              aria-label="Open user menu"
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: '1px solid #d1d5db',
                background: '#111827',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              U
            </button>

            {isProfileMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  minWidth: 180,
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.12)',
                  padding: 6,
                  zIndex: 20,
                }}
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setIsProfileMenuOpen(false)
                    navigate('/account')
                  }}
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                >
                  Account
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setIsProfileMenuOpen(false)
                    navigate('/pricing')
                  }}
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                >
                  Billing
                </button>
                <div style={{ height: 1, background: '#e5e7eb', margin: '6px 0' }} />
                <button
                  role="menuitem"
                  onClick={() => {
                    setIsProfileMenuOpen(false)
                    onLogout()
                  }}
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 6, cursor: 'pointer', color: '#b91c1c' }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button onClick={() => navigate('/login')}>Login</button>
            <button onClick={() => navigate('/signup')}>Sign up</button>
          </>
        )}
      </div>
      {getPageContent()}
      <PublicFooter />
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState('')
  const [isAuthInitialized, setIsAuthInitialized] = useState(false)
  const [pathname, setPathname] = useState(window.location.pathname)
  const [authPrompt, setAuthPrompt] = useState('')

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || ''
    setToken(storedToken)
    setIsAuthInitialized(true)
  }, [])

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

  if (!isAuthInitialized) {
    return null
  }

  return (
    <MainSite
      isAuthenticated={isAuthenticated}
      onLogout={logout}
      onRequireAuth={requireAuth}
      pathname={pathname}
      onAuthSuccess={handleAuthSuccess}
      authPrompt={authPrompt}
    />
  )
}
