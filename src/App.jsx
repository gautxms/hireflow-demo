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
import CheckoutPage from './components/CheckoutPage'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth, subscription, subscriptionNotice }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)

  const handleNavigate = (page, promptMessage = 'Please login or sign up to continue.') => {
    if (subscription?.stripe_status === 'canceled' && PROTECTED_PAGES.has(page)) {
      setCurrentPage('landing')
      return
    }

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

      {subscription?.stripe_status === 'past_due' && (
        <div style={{ margin: '12px 16px', padding: '10px 12px', borderRadius: 8, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
          Your subscription is past due. Please update billing to avoid service interruption.
        </div>
      )}

      {subscription?.stripe_status === 'canceled' && (
        <div style={{ margin: '12px 16px', padding: '10px 12px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
          Your subscription is canceled. Premium features are currently blocked.
        </div>
      )}

      {subscriptionNotice && (
        <div style={{ margin: '12px 16px', padding: '10px 12px', borderRadius: 8, background: '#e2e8f0', color: '#1e293b', border: '1px solid #cbd5e1' }}>
          {subscriptionNotice}
        </div>
      )}
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
  const [subscription, setSubscription] = useState(null)
  const [subscriptionNotice, setSubscriptionNotice] = useState('')

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
    setSubscription(null)
    setSubscriptionNotice('')
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

  useEffect(() => {
    if (!token) {
      setSubscription(null)
      setSubscriptionNotice('')
      return
    }

    const controller = new AbortController()

    const fetchSubscription = async () => {
      try {
        const response = await fetch('/api/user/subscription', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        })

        if (!response.ok) {
          setSubscription(null)
          setSubscriptionNotice('')
          return
        }

        const data = await response.json()
        setSubscription(data)
        setSubscriptionNotice(data.stripe_status === 'canceled' ? 'Premium pages are unavailable on canceled subscriptions.' : '')
      } catch {
        setSubscription(null)
        setSubscriptionNotice('')
      }
    }

    fetchSubscription()

    return () => controller.abort()
  }, [token])


  if (!isAuthenticated && pathname === '/signup') {
    return <SignupPage onAuthSuccess={handleAuthSuccess} onGoToLogin={() => navigate('/login')} />
  }

  if (!isAuthenticated && pathname === '/login') {
    return <LoginPage onAuthSuccess={handleAuthSuccess} onGoToSignup={() => navigate('/signup')} promptMessage={authPrompt} />
  }

  if (pathname === '/pricing') {
    return <PricingPage onStartTrial={() => navigate('/checkout')} onBack={() => navigate('/')} />
  }

  if (pathname === '/checkout') {
    return <CheckoutPage onBack={() => navigate('/pricing')} />
  }

  return <MainSite isAuthenticated={isAuthenticated} onLogout={logout} onRequireAuth={requireAuth} subscription={subscription} subscriptionNotice={subscriptionNotice} />
}
