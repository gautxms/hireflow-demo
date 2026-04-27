import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import StatePattern from './components/state/StatePattern'
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
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const UpdatePaymentMethodPage = lazy(() => import('./pages/UpdatePaymentMethodPage'))
const Checkout = lazy(() => import('./pages/Checkout'))
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
const AccountSettingsPage = lazy(() => import('./pages/AccountSettingsPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const JobDescriptionPage = lazy(() => import('./pages/JobDescriptionPage'))
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'))
const CandidateDetailPage = lazy(() => import('./pages/CandidateDetailPage'))
const AnalysesPage = lazy(() => import('./pages/AnalysesPage'))
const AnalysisDetailPage = lazy(() => import('./pages/AnalysisDetailPage'))
import PublicFooter from './components/PublicFooter'
import PageSeo from './components/PageSeo'
import UserAppShell from './components/app-shell/UserAppShell'
import API_BASE from './config/api'
import IntentLandingPage from './pages/seo/IntentLandingPage'
import { INTENT_PAGE_ORDER } from './pages/seo/intentPages'
import { trackIntentLanding } from './seo/organicTracking'
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
const AdminInquiriesPage = lazy(() => import('./admin/pages/AdminInquiriesPage'))
const AdminLoginPage = lazy(() => import('./admin/pages/AdminLoginPage'))
const AdminSetup2FA = lazy(() => import('./admin/pages/AdminSetup2FA'))
const AdminShell = lazy(() => import('./admin/components/AdminShell'))
const AdminPageFeedbackWidget = lazy(() => import('./admin/components/AdminPageFeedbackWidget'))
const AdminRouteFallback = lazy(() => import('./admin/components/AdminRouteFallback'))
import useAdminAuth, { AdminAuthProvider } from './admin/hooks/useAdminAuth'
const AdminRouteGuard = lazy(() => import('./admin/components/AdminRouteGuard'))
import { clearResumeAnalysisResult, getResumeAnalysisOwnerKey, readResumeAnalysisResult } from './components/resumeAnalysisSession'
import { resolveUserSectionPath } from './config/userNavigation'
import { RESULTS_EMPTY_STATE_COPY, getSharedResultsToken, isResultsRootPath, isSharedResultsPath } from './utils/resultsRouteContract'
import { guardAuthenticatedRoute, guardSubscriptionRoute, hasActiveSubscription } from './utils/routeGuards'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])
const USER_SHELL_ROUTE_PATHS = new Set(['/account', '/settings', '/billing', '/reports', '/account/payment-method'])
const USER_SHELL_DISABLED_PATHS = new Set(['/results', '/job-descriptions', '/analyses'])

function isUserShellEnabled() {
  if (import.meta.env.VITE_ENABLE_USER_APP_SHELL === 'true') {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem('hireflow_enable_user_shell') === '1'
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

function shouldDisableUserShell(pathname) {
  if (USER_SHELL_DISABLED_PATHS.has(pathname)) {
    return true
  }

  return pathname.startsWith('/results/')
}

function shouldRenderWithinUserShell(pathname, isAuthenticated) {
  if (!isUserShellEnabled() || !isAuthenticated) {
    return false
  }

  if (shouldDisableUserShell(pathname)) {
    return false
  }

  return USER_SHELL_ROUTE_PATHS.has(pathname)
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth, pathname, onAuthSuccess, onSignupSuccess, onUserProfileUpdate, authPrompt, subscriptionStatus, userProfile, pendingVerificationEmail, setPendingVerificationEmail }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)
  const [resultsRecoveryAttempted, setResultsRecoveryAttempted] = useState(false)
  const [sharedResults, setSharedResults] = useState(null)
  const [sharedResultsLoading, setSharedResultsLoading] = useState(false)
  const [sharedResultsError, setSharedResultsError] = useState('')
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const lastResultsValidatedOwnerKeyRef = useRef(null)
  const { logout: logoutAdmin } = useAdminAuth()
  const resumeAnalysisOwnerKey = useMemo(() => getResumeAnalysisOwnerKey(userProfile), [userProfile])

  const hasCandidateResults = (value) => {
    if (Array.isArray(value)) {
      return value.length > 0
    }

    if (value && typeof value === 'object' && Array.isArray(value.candidates)) {
      return value.candidates.length > 0
    }

    return false
  }

  const handleNavigate = (page, promptMessage = 'Please login or sign up to continue.') => {
    if (!isAuthenticated && PROTECTED_PAGES.has(page)) {
      onRequireAuth(promptMessage)
      setCurrentPage('landing')
      return
    }

    if (page === 'uploader' && isAuthenticated) {
      const storedSubscriptionStatus = getStoredSubscriptionStatus()
      if (!hasActiveSubscription(storedSubscriptionStatus)) {
        navigate('/pricing?reason=upgrade_required')
        return
      }
    }

    setCurrentPage(page)
  }

  const handleFileUploaded = (candidateResults) => {
    // Contract: uploader success transitions into `/results` (latest authenticated analysis view).
    setUploadedFiles(candidateResults)
    setResultsRecoveryAttempted(false)
    handleNavigate('results')
  }


  useEffect(() => {
    if (!isAuthenticated && PROTECTED_PAGES.has(currentPage)) {
      onRequireAuth('Please login or sign up to continue.')
      setCurrentPage('landing')
    }
  }, [currentPage, isAuthenticated, onRequireAuth])

  useEffect(() => {
    if (!isAuthenticated) {
      setResultsRecoveryAttempted(false)
      lastResultsValidatedOwnerKeyRef.current = null
      return
    }

    const params = new URLSearchParams(window.location.search)
    const resolvedPathname = resolveUserSectionPath(pathname)
    const isResultsRoute = isResultsRootPath(resolvedPathname)
    const hasResumeAnalysisFlag = params.get('resumeAnalysis') === '1'

    if (isResultsRoute && currentPage !== 'results') {
      setCurrentPage('results')
    }

    const isResultsContext = currentPage === 'results' || isResultsRoute
    const shouldRevalidateForOwner = isResultsContext && lastResultsValidatedOwnerKeyRef.current !== resumeAnalysisOwnerKey
    const shouldTryRecovery = hasResumeAnalysisFlag
      || shouldRevalidateForOwner
      || (currentPage === 'results' && !hasCandidateResults(uploadedFiles))
      || (isResultsRoute && !hasCandidateResults(uploadedFiles))

    if (!shouldTryRecovery) {
      return
    }

    const latestResult = readResumeAnalysisResult(resumeAnalysisOwnerKey)

    if (latestResult && Array.isArray(latestResult.candidates) && latestResult.candidates.length > 0) {
      setUploadedFiles({
        candidates: latestResult.candidates,
        parseMeta: latestResult.parseMeta || null,
      })
      setResultsRecoveryAttempted(false)
    } else {
      setUploadedFiles(null)
      setResultsRecoveryAttempted(true)
    }
    lastResultsValidatedOwnerKeyRef.current = resumeAnalysisOwnerKey

    if (hasResumeAnalysisFlag) {
      params.delete('resumeAnalysis')
      const nextQuery = params.toString()
      const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname
      window.history.replaceState(window.history.state || {}, '', nextUrl)
    }
  }, [currentPage, isAuthenticated, pathname, resumeAnalysisOwnerKey, uploadedFiles])


  useEffect(() => {
    const shareToken = getSharedResultsToken(pathname)

    if (!shareToken) {
      setSharedResults(null)
      setSharedResultsError('')
      setSharedResultsLoading(false)
      return
    }

    const controller = new AbortController()

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
  const isActiveSubscriber = hasActiveSubscription(normalizedSubscriptionStatus)
  const canViewUpgradePricing = !isAuthenticated || normalizedSubscriptionStatus === 'trialing' || normalizedSubscriptionStatus === 'cancelled' || normalizedSubscriptionStatus === 'canceled' || normalizedSubscriptionStatus === 'inactive'
  const isAdminPath = pathname.startsWith('/admin')
  const resolvedPathname = resolveUserSectionPath(pathname)

  const getPageContent = () => {
    // Contract: `/results/:token` always resolves through the shared-results loading path.
    if (isSharedResultsPath(pathname)) {
      if (sharedResultsError) {
        return (
          <main className="route-state route-state--shared-error">
            <StatePattern
              kind="error"
              title="Shared results unavailable"
              description={sharedResultsError}
              action={(
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="route-state-card__action"
                >
                  Go to home
                </button>
              )}
            />
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

    if (resolvedPathname === '/pricing') {
      if (isAuthenticated && isActiveSubscriber) {
        navigate('/billing')
        return null
      }
      return <Pricing isAuthenticated={isAuthenticated} onRequireAuth={onRequireAuth} />
    }

    if (resolvedPathname === '/about') {
      return <AboutPage onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
    }

    if (resolvedPathname === '/contact') {
      return <ContactPage onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
    }

    if (resolvedPathname === '/help') {
      return <HelpPage onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
    }

    if (resolvedPathname === '/demo') {
      return <DemoBookingPage onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
    }

    if (resolvedPathname === '/terms') {
      return <Terms />
    }

    if (resolvedPathname === '/privacy') {
      return <PrivacyPage />
    }

    if (resolvedPathname === '/refund-policy') {
      return <RefundPolicy />
    }

    if (INTENT_PAGE_ORDER.includes(pathname)) {
      return <IntentLandingPage pathname={pathname} />
    }

    if (resolvedPathname === '/billing/success') {
      return <BillingSuccess />
    }

    if (resolvedPathname === '/billing/cancel') {
      return <BillingCancel />
    }

    if (resolvedPathname === '/checkout') {
      return <Checkout onAuthSuccess={onAuthSuccess} />
    }

    if (resolvedPathname === '/account') {
      const canAccessAccount = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login or sign up to manage your account settings.',
        onRequireAuth,
      })
      if (!canAccessAccount) {
        return null
      }

      return <AccountPage token={localStorage.getItem(TOKEN_STORAGE_KEY) || ''} user={userProfile} onLogout={onLogout} onUserProfileUpdate={onUserProfileUpdate} />
    }

    if (resolvedPathname === '/settings') {
      const canAccessSettings = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login or sign up to manage your account settings.',
        onRequireAuth,
      })
      if (!canAccessSettings) {
        return null
      }

      return <AccountSettingsPage />
    }

    if (resolvedPathname === '/billing') {
      return <BillingPage />
    }

    if (resolvedPathname === '/reports') {
      const canAccessReports = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view reports.',
        onRequireAuth,
      })
      if (!canAccessReports) {
        return null
      }

      return <ReportsPage />
    }

    if (isResultsRootPath(resolvedPathname)) {
      const canAccessResults = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view candidate analysis results.',
        onRequireAuth,
      })
      if (!canAccessResults) {
        return null
      }

      if (!hasCandidateResults(uploadedFiles) && resultsRecoveryAttempted) {
        return (
          <main className="route-state route-state--results-empty">
            <StatePattern
              kind="empty"
              title={RESULTS_EMPTY_STATE_COPY.title}
              description={RESULTS_EMPTY_STATE_COPY.description}
              action={(
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="route-state-card__action"
                >
                  {RESULTS_EMPTY_STATE_COPY.action}
                </button>
              )}
            />
          </main>
        )
      }

      return (
        <CandidateResults
          candidates={uploadedFiles}
          onBack={() => navigate('/')}
        />
      )
    }


    if (resolvedPathname === '/analyses') {
      const canAccessAnalyses = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view analyses.',
        onRequireAuth,
      })
      if (!canAccessAnalyses) {
        return null
      }

      return <AnalysesPage />
    }

    if (pathname.startsWith('/analyses/')) {
      const canAccessAnalysisDetail = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view analysis details.',
        onRequireAuth,
      })
      if (!canAccessAnalysisDetail) {
        return null
      }

      return <AnalysisDetailPage pathname={pathname} />
    }

    if (resolvedPathname === '/candidates') {
      const canAccessCandidates = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view candidates.',
        onRequireAuth,
      })
      if (!canAccessCandidates) {
        return null
      }

      return <CandidatesPage />
    }

    if (pathname.startsWith('/candidates/')) {
      const canAccessCandidateDetail = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view candidate profiles.',
        onRequireAuth,
      })
      if (!canAccessCandidateDetail) {
        return null
      }

      return <CandidateDetailPage pathname={pathname} />
    }

    if (resolvedPathname === '/job-descriptions') {
      const canAccessJobDescriptions = guardSubscriptionRoute({
        isAuthenticated,
        subscriptionStatus,
        onRequireAuth,
        onRequireUpgrade: () => navigate('/pricing?reason=upgrade_required'),
        authPromptMessage: 'Please login to manage job descriptions.',
      })
      if (!canAccessJobDescriptions) {
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

    if (pathname === '/admin/login') {
      return <AdminLoginPage />
    }

    if (pathname === '/admin/setup-2fa' || pathname === '/admin/setup') {
      return <AdminSetup2FA />
    }

    const renderAdminSection = (sectionProps, page) => (
      <AdminRouteGuard>
        <AdminShell key={pathname} routePath={pathname} onLogout={logoutAdmin} {...sectionProps}>
          {page}
          <AdminPageFeedbackWidget routeContext={pathname} />
        </AdminShell>
      </AdminRouteGuard>
    )

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

    if (pathname === '/admin/inquiries') {
      return renderAdminSection({
        sectionKey: 'inquiries',
        title: 'Inquiries',
        subtitle: 'Review inbound contact and demo requests.',
        purpose: 'Use this page to triage incoming inquiries, inspect submission details, and mark items as reviewed.',
        breadcrumbs: ['Admin', 'Inquiries'],
      }, <AdminInquiriesPage />)
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
          <StatePattern
            kind="success"
            title="Email verified!"
            description="Your email has been successfully verified. You can now log in to your account."
            action={(
              <button
                onClick={() => navigate('/login')}
                className="route-state-card__action"
              >
                Go to login
              </button>
            )}
          />
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
            userProfile={userProfile}
          />
        )}

        {currentPage === 'results' && (
          (!hasCandidateResults(uploadedFiles) && resultsRecoveryAttempted
            ? (
              <main className="route-state route-state--results-empty">
                <StatePattern
                  kind="empty"
                  title={RESULTS_EMPTY_STATE_COPY.title}
                  description={RESULTS_EMPTY_STATE_COPY.description}
                  action={(
                    <button
                      type="button"
                      onClick={() => handleNavigate('uploader')}
                      className="route-state-card__action"
                    >
                      {RESULTS_EMPTY_STATE_COPY.action}
                    </button>
                  )}
                />
              </main>
              )
            : (
              <CandidateResults
                candidates={uploadedFiles}
                onBack={() => handleNavigate('uploader')}
              />
              )
          )
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
  const handleSolutionsClick = () => {
    setIsMobileNavOpen(false)
    navigate('/ai-resume-screening')
  }

  const pageContent = (
    <Suspense fallback={<div style={{ padding: '1rem', color: 'var(--color-text-secondary)' }}>Loading…</div>}>
      {getPageContent()}
    </Suspense>
  )
  const useUserShellLayout = shouldRenderWithinUserShell(pathname, isAuthenticated)

  if (isAdminPath) {
    return (
      <div className="admin-app-root">
        <PageSeo pathname={pathname} currentPage={currentPage} />
        <main>{pageContent}</main>
      </div>
    )
  }

  if (useUserShellLayout) {
    return (
      <>
        <PageSeo pathname={pathname} currentPage={currentPage} />
        <UserAppShell pathname={pathname} onNavigate={navigate}>
          {pageContent}
        </UserAppShell>
      </>
    )
  }

  return (
    <>
      <PageSeo pathname={pathname} currentPage={currentPage} />
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
          <button type="button" className="site-nav-button" onClick={handleSolutionsClick}>Solutions</button>
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
            <div className="site-profile-menu" ref={profileMenuRef}>
              <button
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                aria-label="Open user menu"
                className="site-profile-menu__trigger"
              >
                {profileInitial}
              </button>

              {isProfileMenuOpen && (
                <div
                  role="menu"
                  className="site-profile-menu__list"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false)
                      navigate('/account')
                    }}
                    className="site-profile-menu__item"
                  >
                    Account
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false)
                      navigate('/billing')
                    }}
                    className="site-profile-menu__item"
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
                      className="site-profile-menu__item"
                    >
                      Job descriptions
                    </button>
                  )}
                  <div className="site-profile-menu__divider" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false)
                      onLogout()
                    }}
                    className="site-profile-menu__item site-profile-menu__item--danger"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button type="button" className="btn-ghost btn-ghost--accent" onClick={() => { setIsMobileNavOpen(false); navigate('/login') }}>Login</button>
              <button type="button" className="btn-primary" onClick={() => { setIsMobileNavOpen(false); navigate('/signup') }}>Sign up</button>
            </>
          )}
        </div>
      </header>
      <main>
        {pageContent}
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
    clearResumeAnalysisResult()
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
    if (!isAuthenticated) {
      return undefined
    }

    const verifyUserSession = async () => {
      const activeToken = getStoredToken()

      if (!activeToken) {
        return
      }

      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        })

        if (response.status !== 401) {
          return
        }
      } catch {
        return
      }

      localStorage.removeItem(TOKEN_STORAGE_KEY)
      localStorage.removeItem('subscription_status')
      localStorage.removeItem(USER_STORAGE_KEY)
      clearResumeAnalysisResult()
      setToken('')
      setSubscriptionStatus('inactive')
      setUserProfile(null)
      setAuthPrompt('Your session expired while you were away. Please log in again.')
      navigate('/login')
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void verifyUserSession()
      }
    }

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && (pathname === '/login' || pathname === '/signup')) {
      navigate('/')
    }
  }, [isAuthenticated, pathname])

  useEffect(() => {
    trackIntentLanding(pathname)
  }, [pathname])

  if (!isAuthInitialized) {
    return null
  }

  return (
    <AdminAuthProvider>
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
    </AdminAuthProvider>
  )
}
