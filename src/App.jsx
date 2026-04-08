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
import VerifyEmailInfoPage from './components/VerifyEmailInfoPage'
import VerifyEmail from './pages/VerifyEmail'
import Terms from './pages/Terms'
import PrivacyPage from './components/PrivacyPage'
import RefundPolicy from './pages/RefundPolicy'
import BillingSuccess from './pages/BillingSuccess'
import BillingCancel from './pages/BillingCancel'
import BillingPage from './pages/BillingPage'
import UpdatePaymentMethodPage from './pages/UpdatePaymentMethodPage'
import Checkout from './pages/Checkout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import AccountSettingsPage from './pages/AccountSettingsPage'
import AccountPage from './pages/AccountPage'
import PublicFooter from './components/PublicFooter'
import AdminLogsPage from './admin/pages/AdminLogsPage'
import AdminHealthPage from './admin/pages/AdminHealthPage'
import AdminAnalyticsPage from './admin/pages/AdminAnalyticsPage'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
}

function getStoredSubscriptionStatus() {
  return localStorage.getItem('subscription_status') || 'inactive'
}

function getStoredUserProfile() {
  const storedUserProfile = localStorage.getItem(USER_STORAGE_KEY)

  if (!storedUserProfile) {
    return null
  }

  try {
    return JSON.parse(storedUserProfile)
  } catch {
    return null
  }
}

function navigate(pathname, options = {}) {
  if (window.location.pathname !== pathname) {
    window.history.pushState(options.state ?? {}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth, pathname, onAuthSuccess, onSignupSuccess, onUserProfileUpdate, authPrompt, subscriptionStatus, userProfile, pendingVerificationEmail, setPendingVerificationEmail }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const profileMenuRef = useRef(null)

  const handleNavigate = (page, promptMessage = 'Please login or sign up to continue.') => {
    if (!isAuthenticated && PROTECTED_PAGES.has(page)) {
      onRequireAuth(promptMessage)
      setCurrentPage('landing')
      return
    }

    if (page === 'uploader' && isAuthenticated) {
      const storedSubscriptionStatus = getStoredSubscriptionStatus()
      if (storedSubscriptionStatus !== 'active' && storedSubscriptionStatus !== 'trialing') {
        navigate('/pricing?reason=upgrade_required')
        return
      }
    }

    setCurrentPage(page)
  }

  const handleFileUploaded = (candidateResults) => {
    setUploadedFiles(candidateResults)
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

  const normalizedSubscriptionStatus = (subscriptionStatus || 'inactive').toLowerCase()
  const isActiveSubscriber = normalizedSubscriptionStatus === 'active'
  const canViewUpgradePricing = !isAuthenticated || normalizedSubscriptionStatus === 'trialing' || normalizedSubscriptionStatus === 'cancelled' || normalizedSubscriptionStatus === 'canceled' || normalizedSubscriptionStatus === 'inactive'

  const getPageContent = () => {
    if (pathname === '/pricing') {
      if (isAuthenticated && isActiveSubscriber) {
        navigate('/billing')
        return null
      }
      return <Pricing isAuthenticated={isAuthenticated} onRequireAuth={onRequireAuth} />
    }

    if (pathname === '/about') {
      return <AboutPage onBack={() => navigate('/')} />
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
      return <Checkout onAuthSuccess={onAuthSuccess} />
    }

    if (pathname === '/account') {
      if (!isAuthenticated) {
        onRequireAuth('Please login or sign up to manage your account settings.')
        return null
      }

      return <AccountPage token={localStorage.getItem(TOKEN_STORAGE_KEY) || ''} user={userProfile} onLogout={onLogout} onUserProfileUpdate={onUserProfileUpdate} />
    }

    if (pathname === '/settings') {
      if (!isAuthenticated) {
        onRequireAuth('Please login or sign up to manage your account settings.')
        return null
      }

      return <AccountSettingsPage />
    }

    if (pathname === '/billing') {
      return <BillingPage />
    }

    if (pathname === '/account/payment-method') {
      if (!isAuthenticated) {
        onRequireAuth('Please login to update your payment method.')
        return null
      }
      return <UpdatePaymentMethodPage />
    }

    if (pathname === '/admin/logs') {
      return <AdminLogsPage />
    }

    if (pathname === '/admin/health') {
      return <AdminHealthPage />
    }

    if (pathname === '/admin/analytics') {
      return <AdminAnalyticsPage />
    }

    if (!isAuthenticated && pathname === '/signup') {
      return <SignupPage onSignupSuccess={onSignupSuccess} onGoToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && pathname === '/login') {
      return <LoginPage onAuthSuccess={onAuthSuccess} onGoToSignup={() => navigate('/signup')} onForgotPassword={() => navigate('/forgot-password')} promptMessage={authPrompt} onNavigateToVerifyEmail={(email) => {
        setPendingVerificationEmail(email)
        navigate('/verify-email-info')
      }} />
    }

    if (!isAuthenticated && pathname === '/verify-email-info') {
      return <VerifyEmailInfoPage onBackToLogin={() => navigate('/login')} email={pendingVerificationEmail} />
    }

    if (!isAuthenticated && pathname === '/forgot-password') {
      return <ForgotPasswordPage onBackToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && pathname === '/reset-password') {
      return <ResetPasswordPage onGoToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && pathname.startsWith('/reset-password/')) {
      const resetToken = pathname.replace('/reset-password/', '')
      const url = new URL(window.location.href)

      if (!url.searchParams.get('token') && resetToken) {
        url.searchParams.set('token', resetToken)
        window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`)
      }

      return <ResetPasswordPage onGoToLogin={() => navigate('/login')} />
    }

    if (pathname === '/verify') {
      return <VerifyEmail />
    }

    if (pathname === '/verify-email/success') {
      return (
        <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f9fafb' }}>
          <div style={{ background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', textAlign: 'center', maxWidth: '400px' }}>
            <div style={{ fontSize: '60px', color: '#22c55e', marginBottom: '20px' }}>✓</div>
            <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '10px' }}>Email verified!</h1>
            <p style={{ fontSize: '16px', color: '#333', marginBottom: '30px', lineHeight: '1.6' }}>
              Your email has been successfully verified. You can now log in to your account.
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                background: 'var(--accent)',
                color: '#111',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Go to login
            </button>
          </div>
        </main>
      )
    }

    return (
      <>
        {currentPage === 'landing' && (
          <LandingPage
            onStartDemo={() => handleNavigate('uploader', 'Please sign up to try the resume screening demo.')}
          />
        )}


        {currentPage === 'uploader' && (
          <ResumeUploader
            onFileUploaded={handleFileUploaded}
            onBack={() => handleNavigate('landing')}
            isAuthenticated={isAuthenticated}
            onRequireAuth={onRequireAuth}
            subscriptionStatus={subscriptionStatus}
          />
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

  const profileInitial = (userProfile?.name?.trim()?.[0] || userProfile?.email?.trim()?.[0] || 'U').toUpperCase()
  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/verify-email-info' || pathname === '/verify-email/success' || pathname === '/forgot-password' || pathname === '/reset-password' || pathname.startsWith('/reset-password/')
  const handlePricingClick = () => navigate('/pricing')
  const handleFeaturesClick = () => {
    setIsMobileNavOpen(false)
    if (pathname !== '/') {
      navigate('/')
    }
    setCurrentPage('landing')
    window.setTimeout(() => {
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }
  const handleHelpClick = () => {
    setIsMobileNavOpen(false)
    if (pathname !== '/') {
      navigate('/')
    }
    setCurrentPage('help')
  }
  const handleAboutClick = () => {
    setIsMobileNavOpen(false)
    navigate('/about')
  }

  return (
    <>
      <header className="site-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'rgba(10,10,15,0.95)', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, zIndex: 200 }}>
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault()
            setIsMobileNavOpen(false)
            navigate('/')
          }}
          className="logo"
          style={{ color: '#fff', textDecoration: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.02em', fontSize: '1.2rem', padding: 0, height: 'auto' }}
        >
          Hire<span style={{ color: 'var(--accent)' }}>Flow</span>
        </a>
        <button
          type="button"
          className="mobile-nav-toggle touch-target"
          aria-label="Toggle main navigation"
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen((open) => !open)}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: '#fff', borderRadius: 8, display: 'none' }}
        >
          ☰
        </button>
        <div className={`nav-links ${isMobileNavOpen ? 'is-open' : ''}`} aria-label="Primary">
          <button onClick={handleFeaturesClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Features</button>
          {canViewUpgradePricing && (
            <button onClick={() => { setIsMobileNavOpen(false); handlePricingClick() }} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
              {isAuthenticated ? 'Upgrade' : 'Pricing'}
            </button>
          )}
          <button onClick={handleAboutClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>About</button>
          <button onClick={handleHelpClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Help</button>
        </div>
        <div className={`site-auth-actions ${isMobileNavOpen ? 'is-open' : ''}`} style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#111827',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {profileInitial}
              </button>

              {isProfileMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    minWidth: 180,
                    background: '#171723',
                    border: '1px solid rgba(255,255,255,0.1)',
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
                    style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#fff', padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Account
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false)
                      navigate('/billing')
                    }}
                    style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#fff', padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Billing
                  </button>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
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
              <button onClick={() => { setIsMobileNavOpen(false); navigate('/login') }} style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}>Login</button>
              <button onClick={() => { setIsMobileNavOpen(false); navigate('/signup') }} style={{ border: 'none', background: 'var(--accent)', color: '#111', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>Sign up</button>
            </>
          )}
        </div>
      </header>
      <main>
        {getPageContent()}
      </main>
      <PublicFooter />
    </>
  )
}

export default function App() {
  const [token, setToken] = useState('')
  const [isAuthInitialized, setIsAuthInitialized] = useState(false)
  const [pathname, setPathname] = useState(window.location.pathname)
  const [authPrompt, setAuthPrompt] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState(getStoredSubscriptionStatus())
  const [userProfile, setUserProfile] = useState(getStoredUserProfile())
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('')

  useEffect(() => {
    setToken(getStoredToken())

    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || ''
    setToken(storedToken)
    setIsAuthInitialized(true)
  }, [])

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    const onAuthStateRefresh = () => {
      setToken(getStoredToken())
      setSubscriptionStatus(getStoredSubscriptionStatus())
      setUserProfile(getStoredUserProfile())
    }
    const onStorage = (event) => {
      if (event.key === TOKEN_STORAGE_KEY) {
        setToken(event.newValue || '')
      }

      if (event.key === USER_STORAGE_KEY) {
        setUserProfile(getStoredUserProfile())
      }

      if (event.key === 'subscription_status') {
        setSubscriptionStatus(event.newValue || 'inactive')
      }
    }

    window.addEventListener('popstate', onPopState)
    window.addEventListener('storage', onStorage)
    window.addEventListener('hireflow-auth-updated', onAuthStateRefresh)

    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('hireflow-auth-updated', onAuthStateRefresh)
    }
  }, [])

  const isAuthenticated = useMemo(() => Boolean(token), [token])

  const handleAuthSuccess = (newToken, nextSubscriptionStatus = 'inactive', nextUserProfile = null, redirectPath = '/') => {
    const normalizedSubscriptionStatus = nextSubscriptionStatus || 'inactive'
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    localStorage.setItem('subscription_status', normalizedSubscriptionStatus)
    if (nextUserProfile) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUserProfile))
    }
    setToken(newToken)
    setSubscriptionStatus(normalizedSubscriptionStatus)
    setUserProfile(nextUserProfile)
    setAuthPrompt('')
    navigate(redirectPath)
  }

  const logout = async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem('subscription_status')
    localStorage.removeItem(USER_STORAGE_KEY)
    setToken('')
    setSubscriptionStatus('inactive')
    setUserProfile(null)
    navigate('/login')
  }

  const requireAuth = (message) => {
    setAuthPrompt(message)
    navigate('/login')
  }

  const handleSignupSuccess = (email = '') => {
    setAuthPrompt('')
    setPendingVerificationEmail(email)
    navigate('/verify-email-info')
  }

  const handleUserProfileUpdate = (nextUserProfile) => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUserProfile || null))
    setUserProfile(nextUserProfile || null)
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
      onSignupSuccess={handleSignupSuccess}
      onUserProfileUpdate={handleUserProfileUpdate}
      authPrompt={authPrompt}
      subscriptionStatus={subscriptionStatus}
      userProfile={userProfile}
      pendingVerificationEmail={pendingVerificationEmail}
      setPendingVerificationEmail={setPendingVerificationEmail}
    />
  )
}
