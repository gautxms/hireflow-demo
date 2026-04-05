import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import PublicFooter from './components/PublicFooter'

const LandingPage = lazy(() => import('./components/LandingPage'))
const Pricing = lazy(() => import('./pages/Pricing'))
const ResumeUploader = lazy(() => import('./components/ResumeUploader'))
const CandidateResults = lazy(() => import('./components/CandidateResults'))
const OperationsDashboard = lazy(() => import('./components/Dashboard'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const HelpPage = lazy(() => import('./components/HelpPage'))
const AboutPage = lazy(() => import('./components/AboutPage'))
const DemoBookingPage = lazy(() => import('./components/DemoBookingPage'))
const ContactPage = lazy(() => import('./components/ContactPage'))
const LoginPage = lazy(() => import('./components/LoginPage'))
const SignupPage = lazy(() => import('./components/SignupPage'))
const VerifyEmailInfoPage = lazy(() => import('./components/VerifyEmailInfoPage'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const Terms = lazy(() => import('./pages/Terms'))
const PrivacyPage = lazy(() => import('./components/PrivacyPage'))
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'))
const BillingSuccess = lazy(() => import('./pages/BillingSuccess'))
const BillingCancel = lazy(() => import('./pages/BillingCancel'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const Checkout = lazy(() => import('./pages/Checkout'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const AccountSettingsPage = lazy(() => import('./pages/AccountSettingsPage'))

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function PageLoader() {
  return (
    <div style={{ minHeight: '40vh', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
      Loading…
    </div>
  )
}

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

function MainSite({ isAuthenticated, onLogout, onRequireAuth, pathname, onAuthSuccess, onSignupSuccess, authPrompt, subscriptionStatus, userProfile, pendingVerificationEmail, onSetPendingVerificationEmail }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)
  const [parseMeta, setParseMeta] = useState(null)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
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

  const handleFileUploaded = (payload) => {
    setUploadedFiles(payload?.candidates || [])
    setParseMeta(payload?.parseMeta || null)
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

    if (pathname === '/billing') {
      return <Pricing isAuthenticated={isAuthenticated} onRequireAuth={onRequireAuth} />
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

    if (pathname === '/account' || pathname === '/settings') {
      if (!isAuthenticated) {
        onRequireAuth('Please login or sign up to manage your account settings.')
        return null
      }

      return <AccountSettingsPage />
    }

    if (pathname === '/billing') {
      return <BillingPage />
    }

    if (!isAuthenticated && pathname === '/signup') {
      return <SignupPage onSignupSuccess={onSignupSuccess} onGoToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && pathname === '/login') {
      return <LoginPage onAuthSuccess={onAuthSuccess} onGoToSignup={() => navigate('/signup')} onForgotPassword={() => navigate('/forgot-password')} promptMessage={authPrompt} onNavigateToVerifyEmail={(email) => {
        onSetPendingVerificationEmail(email)
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


    if (pathname.startsWith('/results/')) {
      const shareToken = pathname.replace('/results/', '').split('/')[0]
      return <CandidateResults candidates={[]} shareToken={shareToken} onBack={() => navigate('/')} />
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
            parseMeta={parseMeta}
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
    if (pathname !== '/') {
      navigate('/')
    }
    setCurrentPage('landing')
    window.setTimeout(() => {
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }
  const handleHelpClick = () => {
    if (pathname !== '/') {
      navigate('/')
    }
    setCurrentPage('help')
  }
  const handleAboutClick = () => navigate('/about')

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'rgba(10,10,15,0.95)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault()
            navigate('/')
          }}
          className="logo"
          style={{ color: '#fff', textDecoration: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.02em', fontSize: '1.2rem', padding: 0, height: 'auto' }}
        >
          Hire<span style={{ color: 'var(--accent)' }}>Flow</span>
        </a>
        <div className="nav-links" aria-label="Primary">
          <button onClick={handleFeaturesClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Features</button>
          <button onClick={handlePricingClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Pricing</button>
          <button onClick={handleAboutClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>About</button>
          <button onClick={handleHelpClick} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Help</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
                      navigate('/pricing')
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
              <button onClick={() => navigate('/login')} style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}>Login</button>
              <button onClick={() => navigate('/signup')} style={{ border: 'none', background: 'var(--accent)', color: '#111', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontWeight: 600 }}>Sign up</button>
            </>
          )}
        </div>
      </header>
      <main>
        <Suspense fallback={<PageLoader />}>
          {getPageContent()}
        </Suspense>
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

    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    const lazyImages = document.querySelectorAll('img[data-src]')
    if (!lazyImages.length || !('IntersectionObserver' in window)) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return
          }

          const imageElement = entry.target
          const pendingSrc = imageElement.getAttribute('data-src')
          if (pendingSrc) {
            imageElement.src = pendingSrc
            imageElement.removeAttribute('data-src')
          }
          imageElement.setAttribute('loading', 'lazy')
          imageElement.setAttribute('decoding', 'async')
          observer.unobserve(imageElement)
        })
      },
      { rootMargin: '150px 0px' },
    )

    lazyImages.forEach((imageElement) => observer.observe(imageElement))
    return () => observer.disconnect()
  }, [pathname])

  const isAuthenticated = useMemo(() => Boolean(token), [token])

  const handleAuthSuccess = (newToken, nextSubscriptionStatus = 'inactive', nextUserProfile = null) => {
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
    navigate('/')
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
      authPrompt={authPrompt}
      subscriptionStatus={subscriptionStatus}
      userProfile={userProfile}
      pendingVerificationEmail={pendingVerificationEmail}
      onSetPendingVerificationEmail={setPendingVerificationEmail}
    />
  )
}
