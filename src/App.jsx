import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
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
import LoginPage from './components/LoginPage'
import SignupPage from './components/SignupPage'
import VerifyEmailInfoPage from './components/VerifyEmailInfoPage'
import VerifyEmail from './pages/VerifyEmail'
import Terms from './pages/Terms'
import PrivacyPage from './components/PrivacyPage'
import RefundPolicy from './pages/RefundPolicy'
const BillingSuccess = lazy(() => import('./pages/BillingSuccess'))
const BillingCancel = lazy(() => import('./pages/BillingCancel'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const UpdatePaymentMethodPage = lazy(() => import('./pages/UpdatePaymentMethodPage'))
const Checkout = lazy(() => import('./pages/Checkout'))
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
const AccountSettingsPage = lazy(() => import('./pages/AccountSettingsPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const JobDescriptionPage = lazy(() => import('./pages/JobDescriptionPage'))
import PublicFooter from './components/PublicFooter'
import API_BASE from './config/api'
import './styles/app-route-states.css'
const AdminLogsPage = lazy(() => import('./admin/pages/AdminLogsPage'))
const AdminHealthPage = lazy(() => import('./admin/pages/AdminHealthPage'))
const AdminAnalyticsPage = lazy(() => import('./admin/pages/AdminAnalyticsPage'))
const AdminDashboard = lazy(() => import('./admin/pages/AdminDashboard'))
const AdminUsersPage = lazy(() => import('./admin/pages/AdminUsersPage'))
const AdminSubscriptionsPage = lazy(() => import('./admin/pages/AdminSubscriptionsPage'))
const AdminPaymentsPage = lazy(() => import('./admin/pages/AdminPaymentsPage'))
const AdminUploadsPage = lazy(() => import('./admin/pages/AdminUploadsPage'))
const AdminUploadDetailsPage = lazy(() => import('./admin/pages/AdminUploadDetailsPage'))
const AdminUserDetailsPage = lazy(() => import('./admin/pages/AdminUserDetailsPage'))
const AdminSecurityPage = lazy(() => import('./admin/pages/AdminSecurityPage'))
const AdminLoginPage = lazy(() => import('./admin/pages/AdminLoginPage'))
const AdminSetup2FA = lazy(() => import('./admin/pages/AdminSetup2FA'))
const AdminShell = lazy(() => import('./admin/components/AdminShell'))
const AdminPageFeedbackWidget = lazy(() => import('./admin/components/AdminPageFeedbackWidget'))
const AdminRouteFallback = lazy(() => import('./admin/components/AdminRouteFallback'))

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
  const [sharedResults, setSharedResults] = useState(null)
  const [sharedResultsLoading, setSharedResultsLoading] = useState(false)
  const [sharedResultsError, setSharedResultsError] = useState('')
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
    const match = pathname.match(/^\/results\/([^/]+)$/)

    if (!match) {
      setSharedResults(null)
      setSharedResultsError('')
      setSharedResultsLoading(false)
      return
    }

    const controller = new AbortController()
    const shareToken = decodeURIComponent(match[1])

    const loadSharedResults = async () => {
      try {
        setSharedResultsLoading(true)
        setSharedResultsError('')

        const response = await fetch(`${API_BASE}/results/shared/${shareToken}`, {
          signal: controller.signal,
        })

        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load shared results')
        }

        setSharedResults(payload)
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        setSharedResults(null)
        setSharedResultsError(error.message || 'Unable to load shared results')
      } finally {
        if (!controller.signal.aborted) {
          setSharedResultsLoading(false)
        }
      }
    }

    loadSharedResults()

    return () => {
      controller.abort()
    }
  }, [pathname])

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
    if (pathname.match(/^\/results\/[^/]+$/)) {
      if (sharedResultsError) {
        return (
          <main className="route-state route-state--shared-error">
            <div className="route-state-card">
              <h1 className="route-state-card__title">Shared results unavailable</h1>
              <p className="route-state-card__message">{sharedResultsError}</p>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="route-state-card__action"
              >
                Go to home
              </button>
            </div>
          </main>
        )
      }

      return (
        <CandidateResults
          candidates={sharedResults?.candidates || []}
          onBack={() => navigate('/')}
          isSharedLoading={sharedResultsLoading}
        />
      )
    }

    if (pathname === '/pricing') {
      if (isAuthenticated && isActiveSubscriber) {
        navigate('/billing')
        return null
      }
      return <Pricing isAuthenticated={isAuthenticated} onRequireAuth={onRequireAuth} />
    }

    if (pathname === '/about') {
      return <AboutPage onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
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

    if (pathname === '/job-descriptions') {
      if (!isAuthenticated) {
        onRequireAuth('Please login to manage job descriptions.')
        return null
      }

      if (!isActiveSubscriber) {
        navigate('/pricing?reason=upgrade_required')
        return null
      }

      return <JobDescriptionPage onRequireAuth={onRequireAuth} />
    }

    if (pathname === '/account/payment-method') {
      if (!isAuthenticated) {
        onRequireAuth('Please login to update your payment method.')
        return null
      }
      return <UpdatePaymentMethodPage />
    }

    const isAdminPath = pathname.startsWith('/admin')
    const hasStoredAdminSession = Boolean(localStorage.getItem('admin_session'))

    if (pathname === '/admin/login') {
      return <AdminLoginPage />
    }

    if (pathname === '/admin/setup-2fa' || pathname === '/admin/setup') {
      return <AdminSetup2FA />
    }

    const logoutAdmin = async () => {
      await fetch(`${API_BASE}/auth/admin/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})

      localStorage.removeItem('admin_session')
      localStorage.removeItem('admin_id')
      navigate('/admin/login')
    }

    const renderAdminSection = (sectionProps, page) => (
      <AdminShell key={pathname} onLogout={logoutAdmin} {...sectionProps}>
        {page}
        <AdminPageFeedbackWidget routeContext={pathname} />
      </AdminShell>
    )

    if (isAdminPath && !hasStoredAdminSession) {
      navigate('/admin/login')
      return null
    }

    if (pathname === '/admin' || pathname === '/admin/overview') {
      return renderAdminSection({
        sectionKey: 'overview',
        title: 'Overview',
        subtitle: 'Your map of every admin area in one place.',
        purpose: 'Use this page to understand the information architecture and move into each operational section.',
        breadcrumbs: ['Admin', 'Overview'],
      }, <AdminDashboard />)
    }

    if (pathname === '/admin/users') {
      return renderAdminSection({
        sectionKey: 'users',
        title: 'Users',
        subtitle: 'Manage account access, status, and profile integrity.',
        purpose: 'Use this page to search users, inspect account details, and take support or safety actions.',
        breadcrumbs: ['Admin', 'Users'],
      }, <AdminUsersPage />)
    }

    if (pathname.startsWith('/admin/users/')) {
      return renderAdminSection({
        sectionKey: 'users',
        title: 'User details',
        subtitle: 'Focused user view for account-level interventions.',
        purpose: 'Use this page to review one user and perform profile, password, access, or moderation actions.',
        breadcrumbs: ['Admin', 'Users', 'User details'],
      }, <AdminUserDetailsPage />)
    }

    if (pathname === '/admin/billing') {
      return renderAdminSection({
        sectionKey: 'billing',
        title: 'Billing',
        subtitle: 'Subscriptions, payments, and refunds in one workflow.',
        purpose: 'Use this page to monitor revenue, retry failed transactions, and resolve customer billing requests.',
        breadcrumbs: ['Admin', 'Billing'],
      }, (
        <div className="admin-page">
          <AdminSubscriptionsPage />
          <AdminPaymentsPage />
        </div>
      ))
    }

    if (pathname === '/admin/uploads') {
      return renderAdminSection({
        sectionKey: 'uploads',
        title: 'Uploads',
        subtitle: 'Track resume processing performance and exceptions.',
        purpose: 'Use this page to audit parsing outcomes, isolate failures, and open individual upload details.',
        breadcrumbs: ['Admin', 'Uploads'],
      }, <AdminUploadsPage />)
    }

    if (pathname.startsWith('/admin/uploads/')) {
      return renderAdminSection({
        sectionKey: 'uploads',
        title: 'Upload details',
        subtitle: 'Single-upload diagnostics and retry operations.',
        purpose: 'Use this page to inspect a specific upload artifact and re-run parsing when recovery is needed.',
        breadcrumbs: ['Admin', 'Uploads', 'Upload details'],
      }, <AdminUploadDetailsPage />)
    }

    if (pathname === '/admin/logs') {
      return renderAdminSection({
        sectionKey: 'logs',
        title: 'Logs',
        subtitle: 'Investigate application errors and webhook events.',
        purpose: 'Use this page to triage incidents, identify patterns, and mark issues as resolved.',
        breadcrumbs: ['Admin', 'Logs'],
      }, <AdminLogsPage />)
    }

    if (pathname === '/admin/health') {
      return renderAdminSection({
        sectionKey: 'health',
        title: 'Health',
        subtitle: 'Live status of infrastructure and API reliability.',
        purpose: 'Use this page to monitor system health signals and spot degradation before users are impacted.',
        breadcrumbs: ['Admin', 'Health'],
      }, <AdminHealthPage />)
    }

    if (pathname === '/admin/analytics') {
      return renderAdminSection({
        sectionKey: 'analytics',
        title: 'Analytics',
        subtitle: 'Business and product performance trends.',
        purpose: 'Use this page to understand growth, retention, conversion, and revenue momentum.',
        breadcrumbs: ['Admin', 'Analytics'],
      }, <AdminAnalyticsPage />)
    }

    if (pathname === '/admin/security') {
      return renderAdminSection({
        sectionKey: 'security',
        title: 'Security',
        subtitle: 'Authentication posture and admin access controls.',
        purpose: 'Use this page to access session controls, 2FA setup, and operational security reminders.',
        breadcrumbs: ['Admin', 'Security'],
      }, <AdminSecurityPage />)
    }

    if (isAdminPath) {
      return renderAdminSection({
        sectionKey: 'overview',
        title: 'Section not found',
        subtitle: 'This admin route is not available in the current release.',
        purpose: 'Use the action below to return to a supported area.',
        breadcrumbs: ['Admin', 'Not found'],
      }, <AdminRouteFallback title="Section unavailable" description="The requested section is unavailable or still in progress." />)
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
        <main className="route-state route-state--email-verified">
          <div className="route-state-card route-state-card--verified">
            <div className="route-state-card__check">✓</div>
            <h1 className="route-state-card__title route-state-card__title--verified">Email verified!</h1>
            <p className="route-state-card__message route-state-card__message--verified">
              Your email has been successfully verified. You can now log in to your account.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="route-state-card__action"
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
            ctaLabel={isActiveSubscriber ? 'Analyze Resumes' : 'View Plans'}
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
      <header className="site-header">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault()
            setIsMobileNavOpen(false)
            navigate('/')
          }}
          className="site-logo"
        >
          Hire<span>Flow</span>
        </a>
        <button
          type="button"
          className="mobile-nav-toggle touch-target"
          aria-label="Toggle main navigation"
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen((open) => !open)}
        >
          ☰
        </button>
        <div className={`nav-links ${isMobileNavOpen ? 'is-open' : ''}`} aria-label="Primary">
          <button type="button" className="site-nav-button" onClick={handleFeaturesClick}>Features</button>
          {canViewUpgradePricing && (
            <button type="button" className="site-nav-button" onClick={() => { setIsMobileNavOpen(false); handlePricingClick() }}>
              {isAuthenticated ? 'Upgrade' : 'Pricing'}
            </button>
          )}
          <button type="button" className="site-nav-button" onClick={handleAboutClick}>About</button>
          <button type="button" className="site-nav-button" onClick={handleHelpClick}>Help</button>
        </div>
        <div className={`site-auth-actions ${isMobileNavOpen ? 'is-open' : ''}`}>
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
                  {isActiveSubscriber && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setIsProfileMenuOpen(false)
                        navigate('/job-descriptions')
                      }}
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#fff', padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Job descriptions
                    </button>
                  )}
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
              <button type="button" className="btn-ghost" onClick={() => { setIsMobileNavOpen(false); navigate('/login') }}>Login</button>
              <button type="button" className="btn-primary" onClick={() => { setIsMobileNavOpen(false); navigate('/signup') }}>Sign up</button>
            </>
          )}
        </div>
      </header>
      <main>
        <Suspense fallback={<div style={{ padding: '1rem', color: 'var(--muted)' }}>Loading…</div>}>
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
