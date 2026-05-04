import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import StatePattern from './components/state/StatePattern'
import LandingPage from './components/LandingPage'
const Pricing = lazy(() => loadPublicRouteChunk(() => import('./pages/Pricing'), { route: '/pricing' }))
const ResumeUploader = lazy(() => import('./components/ResumeUploader'))
const CandidateResults = lazy(() => import('./components/CandidateResults'))
const OperationsDashboard = lazy(() => import('./components/NewDashboard'))
const LegacyOperationsDashboard = lazy(() => import('./components/Dashboard'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const HelpPage = lazy(() => loadPublicRouteChunk(() => import('./components/HelpPage'), { route: '/help' }))
const AboutPage = lazy(() => loadPublicRouteChunk(() => import('./components/AboutPage'), { route: '/about' }))
const DemoBookingPage = lazy(() => loadPublicRouteChunk(() => import('./components/DemoBookingPage'), { route: '/demo' }))
const ContactPage = lazy(() => loadPublicRouteChunk(() => import('./components/ContactPage'), { route: '/contact' }))
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
import BrandLogo from './components/BrandLogo'
import PageSeo from './components/PageSeo'
import UserAppShell from './components/app-shell/UserAppShell'
import PublicRouteChunkErrorBoundary from './components/PublicRouteChunkErrorBoundary'
import { loadPublicRouteChunk } from './utils/lazyRouteLoader'
import API_BASE from './config/api'
import IntentLandingPage from './pages/seo/IntentLandingPage'
import { INTENT_PAGE_ORDER } from './pages/seo/intentPages'
import { trackIntentLanding } from './seo/organicTracking'
import './styles/app-route-states.css'
import './styles/analyses-pages.css'
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
import { isUserShellRoutePath } from './config/userShellRouting'
import { RESULTS_EMPTY_STATE_COPY, getSharedResultsToken, isResultsRootPath, isSharedResultsPath } from './utils/resultsRouteContract'
import { guardAuthenticatedRoute, guardSubscriptionRoute, hasActiveSubscription } from './utils/routeGuards'
import { FEATURE_KEYS, isFeatureEnabled } from './config/featureFlags'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_user_profile'
const CREATE_ANALYSIS_INTENT_STORAGE_KEY = 'hireflow_create_analysis_intent'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])
const PUBLIC_ROUTE_PATHS = new Set([
  '/',
  '/login',
  '/signup',
  '/pricing',
  '/about',
  '/help',
  '/contact',
  '/demo',
  '/privacy',
  '/terms',
  '/refund-policy',
  ...INTENT_PAGE_ORDER,
])
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

function markCreateAnalysisIntent() {
  const intent = {
    id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  }
  sessionStorage.setItem(CREATE_ANALYSIS_INTENT_STORAGE_KEY, JSON.stringify(intent))
}

function consumeCreateAnalysisIntent() {
  try {
    const rawIntent = sessionStorage.getItem(CREATE_ANALYSIS_INTENT_STORAGE_KEY)
    if (!rawIntent) {
      return false
    }
    const parsedIntent = JSON.parse(rawIntent)
    const maxAgeMs = 10 * 60 * 1000
    const isFreshIntent = parsedIntent?.createdAt && (Date.now() - parsedIntent.createdAt) <= maxAgeMs
    sessionStorage.removeItem(CREATE_ANALYSIS_INTENT_STORAGE_KEY)
    return Boolean(isFreshIntent)
  } catch {
    sessionStorage.removeItem(CREATE_ANALYSIS_INTENT_STORAGE_KEY)
    return false
  }
}

function shouldDisableUserShell(pathname) {
  return isSharedResultsPath(pathname)
}

function shouldRenderWithinUserShell(pathname, isAuthenticated) {
  if (!isAuthenticated) {
    return false
  }

  if (PUBLIC_ROUTE_PATHS.has(pathname)) {
    return false
  }

  const isRootLandingPath = pathname === '/'
  const resolvedPathname = isRootLandingPath ? pathname : (isAuthenticated ? resolveUserSectionPath(pathname) : pathname)

  if (resolvedPathname.startsWith('/admin') || shouldDisableUserShell(resolvedPathname) || PUBLIC_ROUTE_PATHS.has(resolvedPathname)) {
    return false
  }

  return isUserShellRoutePath(resolvedPathname)
}

function MainSite({ isAuthenticated, onLogout, onRequireAuth, pathname, onAuthSuccess, onSignupSuccess, onUserProfileUpdate, authPrompt, subscriptionStatus, userProfile, pendingVerificationEmail, setPendingVerificationEmail }) {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)
  const [resultsRecoveryAttempted, setResultsRecoveryAttempted] = useState(false)
  const [sharedResults, setSharedResults] = useState(null)
  const [sharedResultsLoading, setSharedResultsLoading] = useState(false)
  const [sharedResultsError, setSharedResultsError] = useState('')
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const lastResultsValidatedOwnerKeyRef = useRef(null)
  const uploaderIntentAccessRef = useRef({ pathname: '', allowed: null })
  const { logout: logoutAdmin } = useAdminAuth()
  const resumeAnalysisOwnerKey = useMemo(() => getResumeAnalysisOwnerKey(userProfile), [userProfile])
  const routeDiagnosticsEnabled = import.meta.env.DEV || window.localStorage.getItem('debug_routes') === '1'

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

  const handleCreateAnalysis = () => {
    markCreateAnalysisIntent()
    navigate('/uploader')
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
    const isRootLandingPath = pathname === '/'
  const resolvedPathname = isRootLandingPath ? pathname : (isAuthenticated ? resolveUserSectionPath(pathname) : pathname)
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
  const analysesModuleEnabled = isFeatureEnabled(FEATURE_KEYS.analysesPages, { userProfile, subscriptionStatus })
  const candidateModuleEnabled = isFeatureEnabled(FEATURE_KEYS.candidateModule, { userProfile, subscriptionStatus })
  const dashboardReportsEnabled = isFeatureEnabled(FEATURE_KEYS.dashboardReports, { userProfile, subscriptionStatus })
  const isActiveSubscriber = hasActiveSubscription(normalizedSubscriptionStatus)
  const canViewUpgradePricing = !isAuthenticated || normalizedSubscriptionStatus === 'trialing' || normalizedSubscriptionStatus === 'cancelled' || normalizedSubscriptionStatus === 'canceled' || normalizedSubscriptionStatus === 'inactive'
  const isAdminPath = pathname.startsWith('/admin')
  const isRootLandingPath = pathname === '/'
  const resolvedPathname = isRootLandingPath ? pathname : (isAuthenticated ? resolveUserSectionPath(pathname) : pathname)

  const getPageContent = () => {
    // Contract: `/results/:token` always resolves through the shared-results loading path.
    if (isSharedResultsPath(resolvedPathname)) {
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
          candidates={{
            candidates: sharedResults?.candidates || [],
            parseMeta: sharedResults?.parseMeta || null,
          }}
          onBack={() => navigate('/')}
          isSharedLoading={sharedResultsLoading}
          userProfile={userProfile}
        />
      )
    }


    if (isRootLandingPath || resolvedPathname === '/ai-resume-screening') {
      return (
        <LandingPage
          onStartDemo={() => (isActiveSubscriber ? navigate('/dashboard') : navigate('/pricing'))}
          ctaLabel={isActiveSubscriber ? 'Dashboard' : 'View pricing'}
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

    if (resolvedPathname === '/dashboard') {
      const canAccessDashboard = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view the dashboard.',
        onRequireAuth,
      })
      if (!canAccessDashboard) {
        return null
      }
      if (!dashboardReportsEnabled) {
        return <LegacyOperationsDashboard onNavigate={handleNavigate} />
      }

      return <OperationsDashboard onNavigate={handleNavigate} />
    }

    if (resolvedPathname === '/dashboard/legacy') {
      const canAccessDashboard = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view the dashboard.',
        onRequireAuth,
      })
      if (!canAccessDashboard) {
        return null
      }
      return <LegacyOperationsDashboard onNavigate={handleNavigate} />
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

    if (INTENT_PAGE_ORDER.includes(resolvedPathname)) {
      return <IntentLandingPage pathname={resolvedPathname} />
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

    if (resolvedPathname === '/uploader') {
      if (uploaderIntentAccessRef.current.pathname !== pathname) {
        uploaderIntentAccessRef.current = {
          pathname,
          allowed: consumeCreateAnalysisIntent(),
        }
      }

      if (!uploaderIntentAccessRef.current.allowed) {
        navigate('/analyses')
        return null
      }

      const canAccessUploader = guardSubscriptionRoute({
        isAuthenticated,
        subscriptionStatus,
        onRequireAuth,
        onRequireUpgrade: () => navigate('/pricing?reason=upgrade_required'),
      })
      if (!canAccessUploader) {
        return null
      }
      return (
        <ResumeUploader
          onFileUploaded={handleFileUploaded}
          onBack={() => navigate('/analyses')}
          isAuthenticated={isAuthenticated}
          onRequireAuth={onRequireAuth}
          subscriptionStatus={subscriptionStatus}
          userProfile={userProfile}
        />
      )
    }

    if (resolvedPathname === '/create-analysis') {
      handleCreateAnalysis()
      return null
    }

    if (resolvedPathname === '/reports') {
      if (!dashboardReportsEnabled) {
        navigate('/dashboard/legacy')
        return null
      }

      const canAccessReports = guardSubscriptionRoute({
        isAuthenticated,
        subscriptionStatus,
        onRequireAuth,
        onRequireUpgrade: () => navigate('/pricing?reason=reports_upgrade_required'),
        authPromptMessage: 'Please login to view reports.',
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
          candidates={{
            candidates: uploadedFiles?.candidates || [],
            parseMeta: uploadedFiles?.parseMeta || null,
          }}
          onBack={() => navigate('/')}
          userProfile={userProfile}
        />
      )
    }


    if (resolvedPathname === '/analyses') {
      if (!analysesModuleEnabled) {
        navigate('/results')
        return null
      }

      const canAccessAnalyses = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view analyses.',
        onRequireAuth,
      })
      if (!canAccessAnalyses) {
        return null
      }

      return <AnalysesPage onCreateAnalysis={handleCreateAnalysis} />
    }

    if (resolvedPathname.startsWith('/analyses/')) {
      if (!analysesModuleEnabled) {
        navigate('/results')
        return null
      }

      const canAccessAnalysisDetail = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view analysis details.',
        onRequireAuth,
      })
      if (!canAccessAnalysisDetail) {
        return null
      }

      return <AnalysisDetailPage pathname={resolvedPathname} />
    }

    if (resolvedPathname === '/candidates') {
      if (!candidateModuleEnabled) {
        navigate('/results')
        return null
      }

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

    if (resolvedPathname.startsWith('/candidates/')) {
      if (!candidateModuleEnabled) {
        navigate('/results')
        return null
      }

      const canAccessCandidateDetail = guardAuthenticatedRoute({
        isAuthenticated,
        promptMessage: 'Please login to view candidate profiles.',
        onRequireAuth,
      })
      if (!canAccessCandidateDetail) {
        return null
      }

      return <CandidateDetailPage pathname={resolvedPathname} />
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

    if (resolvedPathname === '/account/payment-method') {
      if (!isAuthenticated) {
        onRequireAuth('Please login to update your payment method.')
        return null
      }
      return <UpdatePaymentMethodPage />
    }

    if (resolvedPathname === '/admin/login') {
      return <AdminLoginPage />
    }

    if (resolvedPathname === '/admin/setup-2fa' || resolvedPathname === '/admin/setup') {
      return <AdminSetup2FA />
    }

    const renderAdminSection = (sectionProps, page) => (
      <AdminRouteGuard>
        <AdminShell key={resolvedPathname} routePath={resolvedPathname} onLogout={logoutAdmin} {...sectionProps}>
          {page}
          <AdminPageFeedbackWidget routeContext={resolvedPathname} />
        </AdminShell>
      </AdminRouteGuard>
    )

    if (resolvedPathname === '/admin' || resolvedPathname === '/admin/overview') {
      return renderAdminSection({
        sectionKey: 'overview',
        title: 'Overview',
        subtitle: 'Your map of every admin area in one place.',
        purpose: 'Use this page to understand the information architecture and move into each operational section.',
        breadcrumbs: ['Admin', 'Overview'],
      }, <AdminDashboard />)
    }

    if (resolvedPathname === '/admin/users') {
      return renderAdminSection({
        sectionKey: 'users',
        title: 'Users',
        subtitle: 'Manage account access, status, and profile integrity.',
        purpose: 'Use this page to search users, inspect account details, and take support or safety actions.',
        breadcrumbs: ['Admin', 'Users'],
      }, <AdminUsersPage />)
    }

    if (resolvedPathname.startsWith('/admin/users/')) {
      return renderAdminSection({
        sectionKey: 'users',
        title: 'User details',
        subtitle: 'Focused user view for account-level interventions.',
        purpose: 'Use this page to review one user and perform profile, password, access, or moderation actions.',
        breadcrumbs: ['Admin', 'Users', 'User details'],
      }, <AdminUserDetailsPage />)
    }

    if (resolvedPathname === '/admin/billing') {
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

    if (resolvedPathname === '/admin/uploads') {
      return renderAdminSection({
        sectionKey: 'uploads',
        title: 'Uploads',
        subtitle: 'Track resume processing performance and exceptions.',
        purpose: 'Use this page to audit parsing outcomes, isolate failures, and open individual upload details.',
        breadcrumbs: ['Admin', 'Uploads'],
      }, <AdminUploadsPage />)
    }

    if (resolvedPathname.startsWith('/admin/uploads/')) {
      return renderAdminSection({
        sectionKey: 'uploads',
        title: 'Upload details',
        subtitle: 'Single-upload diagnostics and retry operations.',
        purpose: 'Use this page to inspect a specific upload artifact and re-run parsing when recovery is needed.',
        breadcrumbs: ['Admin', 'Uploads', 'Upload details'],
      }, <AdminUploadDetailsPage />)
    }

    if (resolvedPathname === '/admin/logs') {
      return renderAdminSection({
        sectionKey: 'logs',
        title: 'Logs',
        subtitle: 'Investigate application errors and webhook events.',
        purpose: 'Use this page to triage incidents, identify patterns, and mark issues as resolved.',
        breadcrumbs: ['Admin', 'Logs'],
      }, <AdminLogsPage />)
    }

    if (resolvedPathname === '/admin/health') {
      return renderAdminSection({
        sectionKey: 'health',
        title: 'Health',
        subtitle: 'Live status of infrastructure and API reliability.',
        purpose: 'Use this page to monitor system health signals and spot degradation before users are impacted.',
        breadcrumbs: ['Admin', 'Health'],
      }, <AdminHealthPage />)
    }

    if (resolvedPathname === '/admin/analytics') {
      return renderAdminSection({
        sectionKey: 'analytics',
        title: 'Analytics',
        subtitle: 'Business and product performance trends.',
        purpose: 'Use this page to understand growth, retention, conversion, and revenue momentum.',
        breadcrumbs: ['Admin', 'Analytics'],
      }, <AdminAnalyticsPage />)
    }

    if (resolvedPathname === '/admin/inquiries') {
      return renderAdminSection({
        sectionKey: 'inquiries',
        title: 'Inquiries',
        subtitle: 'Review inbound contact and demo requests.',
        purpose: 'Use this page to triage incoming inquiries, inspect submission details, and mark items as reviewed.',
        breadcrumbs: ['Admin', 'Inquiries'],
      }, <AdminInquiriesPage />)
    }

    if (resolvedPathname === '/admin/security') {
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

    if (!isAuthenticated && resolvedPathname === '/signup') {
      return <SignupPage onSignupSuccess={onSignupSuccess} onGoToLogin={() => navigate('/login')} />
    }

    if (resolvedPathname === '/login') {
      return <LoginPage onAuthSuccess={onAuthSuccess} onGoToSignup={() => navigate('/signup')} onForgotPassword={() => navigate('/forgot-password')} promptMessage={authPrompt} onNavigateToVerifyEmail={(email) => {
        setPendingVerificationEmail(email)
        navigate('/verify-email-info')
      }} />
    }

    if (!isAuthenticated && resolvedPathname === '/verify-email-info') {
      return <VerifyEmailInfoPage onBackToLogin={() => navigate('/login')} email={pendingVerificationEmail} />
    }

    if (!isAuthenticated && resolvedPathname === '/forgot-password') {
      return <ForgotPasswordPage onBackToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && resolvedPathname === '/reset-password') {
      return <ResetPasswordPage onGoToLogin={() => navigate('/login')} />
    }

    if (!isAuthenticated && resolvedPathname.startsWith('/reset-password/')) {
      const resetToken = resolvedPathname.replace('/reset-password/', '')
      const url = new URL(window.location.href)

      if (!url.searchParams.get('token') && resetToken) {
        url.searchParams.set('token', resetToken)
        window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`)
      }

      return <ResetPasswordPage onGoToLogin={() => navigate('/login')} />
    }

    if (resolvedPathname === '/verify') {
      return <VerifyEmail />
    }

    if (resolvedPathname === '/verify-email/success') {
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

    if (!isAuthenticated) {
      return (
        <LandingPage
          onStartDemo={() => navigate('/pricing')}
          ctaLabel="View pricing"
        />
      )
    }

    if (currentPage === 'dashboard') {
      return dashboardReportsEnabled
        ? <OperationsDashboard onNavigate={handleNavigate} />
        : <LegacyOperationsDashboard onNavigate={handleNavigate} />
    }

    if (currentPage === 'settings') {
      return <SettingsPage onBack={() => handleNavigate('dashboard')} />
    }

    if (currentPage === 'help') {
      return <HelpPage onBack={() => handleNavigate('landing')} />
    }

    if (currentPage === 'about') {
      return <AboutPage onBack={() => handleNavigate('landing')} />
    }

    if (currentPage === 'demo') {
      return <DemoBookingPage onBack={() => handleNavigate('landing')} />
    }

    if (currentPage === 'contact') {
      return <ContactPage onBack={() => handleNavigate('landing')} />
    }

    return (
      <LandingPage
        onStartDemo={() => (isActiveSubscriber ? navigate('/dashboard') : navigate('/pricing'))}
        ctaLabel={isActiveSubscriber ? 'Dashboard' : 'View pricing'}
      />
    )
  }

  const profileInitial = (userProfile?.name?.trim()?.[0] || userProfile?.email?.trim()?.[0] || 'U').toUpperCase()
  const handlePricingClick = () => navigate('/pricing')
  const handleFeaturesClick = () => {
    navigate('/')
    window.setTimeout(() => {
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }
  const handleHelpClick = () => {
    navigate('/help')
  }
  const handleAboutClick = () => {
    navigate('/about')
  }
  const handleSolutionsClick = () => {
    navigate('/ai-resume-screening')
  }
  const handleDashboardShortcutClick = () => {
    setIsProfileMenuOpen(false)
    navigate('/dashboard')
  }


  const userShellNavItems = useMemo(() => {
    return [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
      { key: 'jobs', label: 'Jobs', path: '/jobs', icon: 'jobs' },
      { key: 'analyses', label: 'Analyses', path: '/analyses', icon: 'analyses', isLocked: !analysesModuleEnabled },
      { key: 'candidates', label: 'Candidates', path: '/candidates', icon: 'candidates', isLocked: !candidateModuleEnabled },
      { key: 'shortlists', label: 'Shortlists', path: '/shortlists', icon: 'shortlists' },
      {
        key: 'reports',
        label: 'Reports',
        path: '/reports',
        icon: 'reports',
        isLocked: !dashboardReportsEnabled,
        badge: !dashboardReportsEnabled ? 'Pro' : '',
      },
      { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
    ]
  }, [analysesModuleEnabled, candidateModuleEnabled, dashboardReportsEnabled])


  useEffect(() => {
    if (!routeDiagnosticsEnabled) {
      return
    }

    let matchedBranch = 'public:fallback-landing'

    if (isSharedResultsPath(resolvedPathname)) matchedBranch = 'shared-results'
    else if (resolvedPathname === '/' || resolvedPathname === '/ai-resume-screening') matchedBranch = 'public:landing'
    else if (resolvedPathname === '/pricing') matchedBranch = 'public:pricing'
    else if (resolvedPathname.startsWith('/admin')) matchedBranch = 'admin'
    else if (isAuthenticated && shouldRenderWithinUserShell(resolvedPathname, isAuthenticated)) matchedBranch = 'user-shell'

    console.debug('[route-diagnostics]', { pathname, resolvedPathname, matchedBranch })
  }, [isAuthenticated, pathname, resolvedPathname, routeDiagnosticsEnabled])

  const routeRecoveryActions = useMemo(() => {
    const hardRedirect = (path) => {
      window.location.assign(path)
    }

    const isSubscribedUser = isAuthenticated && hasActiveSubscription(subscriptionStatus)
    const isAuthenticatedAppRoute = isAuthenticated && (
      resolvedPathname === '/uploader'
      || resolvedPathname === '/analyses'
      || resolvedPathname.startsWith('/analyses/')
      || shouldRenderWithinUserShell(resolvedPathname, isAuthenticated)
    )

    if (isAuthenticatedAppRoute) {
      if (isSubscribedUser) {
        return {
          primaryLabel: 'Go to analyses',
          primaryAction: () => hardRedirect('/analyses'),
          secondaryLabel: 'Go to dashboard',
          secondaryAction: () => hardRedirect('/dashboard'),
        }
      }

      return {
        primaryLabel: 'Go to dashboard',
        primaryAction: () => hardRedirect('/dashboard'),
      }
    }

    return {
      primaryLabel: 'Go to pricing',
      primaryAction: () => hardRedirect('/pricing'),
    }
  }, [isAuthenticated, resolvedPathname, subscriptionStatus])

  const pageContent = (
    <PublicRouteChunkErrorBoundary
      primaryAction={routeRecoveryActions.primaryAction}
      primaryLabel={routeRecoveryActions.primaryLabel}
      secondaryAction={routeRecoveryActions.secondaryAction}
      secondaryLabel={routeRecoveryActions.secondaryLabel}
    >
      <Suspense fallback={<div className="app-route-loading-fallback">Loading…</div>}>
        {getPageContent()}
      </Suspense>
    </PublicRouteChunkErrorBoundary>
  )
  const useUserShellLayout = shouldRenderWithinUserShell(resolvedPathname, isAuthenticated)

  useEffect(() => {
    document.body.classList.toggle('user-app-shell-active', useUserShellLayout)

    return () => {
      document.body.classList.remove('user-app-shell-active')
    }
  }, [useUserShellLayout])

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
        <UserAppShell
          pathname={pathname}
          onNavigate={navigate}
          onLogout={onLogout}
          userProfile={userProfile}
          navItems={userShellNavItems}
          subscriptionStatus={subscriptionStatus}
          showUpgradeCta={canViewUpgradePricing}
        >
          {pageContent}
        </UserAppShell>
      </>
    )
  }

  return (
    <>
      <PageSeo pathname={pathname} currentPage={currentPage} />
      <header className="site-header">
        <BrandLogo
          onClick={(event) => {
            event.preventDefault()
            navigate('/')
          }}
          className="site-header__logo"
        />
        <div className="site-header__nav-links" aria-label="Primary">
          <button type="button" className="site-header__nav-button" onClick={handleFeaturesClick}>Features</button>
          <button type="button" className="site-header__nav-button" onClick={handleSolutionsClick}>Solutions</button>
          {canViewUpgradePricing && (
            <button type="button" className="site-header__nav-button" onClick={handlePricingClick}>
              {isAuthenticated ? 'Upgrade' : 'Pricing'}
            </button>
          )}
          <button type="button" className="site-header__nav-button" onClick={handleAboutClick}>About</button>
          <button type="button" className="site-header__nav-button" onClick={handleHelpClick}>Help</button>
        </div>
        <div className="site-header__auth-actions">
          {isAuthenticated ? (
            <>
              {isActiveSubscriber ? (
                <button
                  type="button"
                  className="btn-ghost btn-ghost--accent"
                  onClick={handleDashboardShortcutClick}
                >
                  Dashboard
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ghost btn-ghost--accent"
                  onClick={handlePricingClick}
                >
                  View pricing
                </button>
              )}
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
                    <div className="site-profile-menu__divider" />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setIsProfileMenuOpen(false)
                        onLogout()
                      }}
                      className="site-profile-menu__item site-profile-menu__item--danger"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost btn-ghost--accent" onClick={() => navigate('/login')}>Login</button>
              <button type="button" className="btn-primary" onClick={() => navigate('/signup')}>Sign up</button>
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
  const [token, setToken] = useState(() => getStoredToken())
  const [isAuthInitialized] = useState(true)
  const [pathname, setPathname] = useState(window.location.pathname)
  const [authPrompt, setAuthPrompt] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState(getStoredSubscriptionStatus())
  const [userProfile, setUserProfile] = useState(getStoredUserProfile())
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('')

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
    // Authenticated users are intentionally redirected away from auth forms to the home route.
    if (isAuthenticated && (pathname === '/signup' || pathname === '/login')) {
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
