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
import AdminUsersPage from './components/AdminUsersPage'
import AdminUserDetailPage from './components/AdminUserDetailPage'

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'
const USER_STORAGE_KEY = 'hireflow_auth_user'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const PROTECTED_PAGES = new Set(['uploader', 'results', 'dashboard', 'settings'])

function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

function MainSite({ isAuthenticated, user, onLogout, onRequireAuth }) {
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

  const handleSelectPlan = (planId) => {
    console.log('Selected plan:', planId)
    handleNavigate('uploader', 'Please sign up to upload resumes and run screening.')
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
          <>
            {user?.role === 'admin' && <button onClick={() => navigate('/admin/users')}>Admin</button>}
            <button onClick={onLogout}>Logout</button>
          </>
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
          onViewPricing={() => handleNavigate('pricing')}
          onViewDashboard={() => handleNavigate('dashboard', 'Please login to access your dashboard.')}
          onViewAbout={() => handleNavigate('about')}
          onViewDemo={() => handleNavigate('demo')}
          onViewContact={() => handleNavigate('contact')}
          onViewHelp={() => handleNavigate('help')}
        />
      )}

      {currentPage === 'pricing' && (
        <PricingPage
          onSelectPlan={handleSelectPlan}
          onBack={() => handleNavigate('landing')}
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
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem(USER_STORAGE_KEY)

    if (!storedUser) {
      return null
    }

    try {
      return JSON.parse(storedUser)
    } catch {
      return null
    }
  })
  const [pathname, setPathname] = useState(window.location.pathname)
  const [authPrompt, setAuthPrompt] = useState('')

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const isAuthenticated = useMemo(() => Boolean(token), [token])

  const handleAuthSuccess = (payload) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, payload.token)

    if (payload.user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user))
      setUser(payload.user)
    }

    setToken(payload.token)
    setAuthPrompt('')
    navigate('/')
  }

  const logout = async () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
    setToken('')
    setUser(null)
    navigate('/login')
  }

  const requireAuth = (message) => {
    setAuthPrompt(message)
    navigate('/login')
  }

  useEffect(() => {
    const loadCurrentUser = async () => {
      if (!token) {
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        })

        const payload = await parseResponsePayload(response)

        if (!response.ok || !payload?.user) {
          logout()
          return
        }

        setUser(payload.user)
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user))
      } catch {
        // keep existing local user data on temporary network errors
      }
    }

    loadCurrentUser()
  }, [token])

  useEffect(() => {
    if (isAuthenticated && (pathname === '/login' || pathname === '/signup')) {
      navigate('/')
    }
  }, [isAuthenticated, pathname])

  if (!isAuthenticated && pathname === '/signup') {
    return <SignupPage onAuthSuccess={handleAuthSuccess} onGoToLogin={() => navigate('/login')} />
  }

  if (!isAuthenticated && pathname === '/login') {
    return <LoginPage onAuthSuccess={handleAuthSuccess} onGoToSignup={() => navigate('/signup')} promptMessage={authPrompt} />
  }

  if (pathname === '/admin/users' || pathname.startsWith('/admin/users/')) {
    if (!isAuthenticated) {
      requireAuth('Please login as an admin to continue.')
      return null
    }

    if (user?.role !== 'admin') {
      return (
        <main style={{ padding: 24 }}>
          <h1>Admin access required</h1>
          <p>You do not have permission to view this page.</p>
          <button onClick={() => navigate('/')}>Back to Home</button>
        </main>
      )
    }

    if (pathname === '/admin/users') {
      return <AdminUsersPage token={token} />
    }

    const userId = pathname.split('/')[3]
    return <AdminUserDetailPage token={token} userId={userId} />
  }

  return <MainSite isAuthenticated={isAuthenticated} user={user} onLogout={logout} onRequireAuth={requireAuth} />
}
