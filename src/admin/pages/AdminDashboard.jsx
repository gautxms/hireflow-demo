import { useEffect, useMemo, useRef, useState } from 'react'
import AdminSidebar, { SECTIONS } from '../components/AdminSidebar'
import AdminHeader from '../components/AdminHeader'
import useAdminAuth from '../hooks/useAdminAuth'
import '../styles/admin.css'

const SESSION_ALERT_THRESHOLD = 10 * 60

function sectionTitle(key) {
  return SECTIONS.find((item) => item.key === key)?.label || 'Overview'
}

export default function AdminDashboard() {
  const { isAdmin, isAuthenticated, expiresAt, payload } = useAdminAuth({ redirectTo: '/login' })
  const [activeSection, setActiveSection] = useState('users')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [shortcutsMessage, setShortcutsMessage] = useState('Use j/k to move between sections.')
  const [now, setNow] = useState(0)
  const hasWarnedRef = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const computedSessionRemaining = useMemo(() => {
    const expiry = Number(expiresAt || payload?.exp || 0) * 1000
    if (!expiry || !now) return 0
    return Math.max(0, Math.floor((expiry - now) / 1000))
  }, [expiresAt, now, payload?.exp])

  useEffect(() => {
    if (!hasWarnedRef.current && computedSessionRemaining > 0 && computedSessionRemaining <= SESSION_ALERT_THRESHOLD) {
      window.alert('Admin session will timeout in 10 minutes or less. Please save your work.')
      hasWarnedRef.current = true
    }
  }, [computedSessionRemaining])

  useEffect(() => {
    const indexFor = (key) => SECTIONS.findIndex((section) => section.key === key)

    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
      }

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const direction = event.key === 'j' ? 1 : -1
        const currentIndex = indexFor(activeSection)
        const nextIndex = (currentIndex + direction + SECTIONS.length) % SECTIONS.length
        const nextSection = SECTIONS[nextIndex].key
        setActiveSection(nextSection)
        setShortcutsMessage(`Moved to ${sectionTitle(nextSection)}.`)
      }

      if (event.key === 'e') {
        setShortcutsMessage(`Edit action ready for ${sectionTitle(activeSection)}.`)
      }

      if (event.key === 'r') {
        setShortcutsMessage(`Refund action opened from ${sectionTitle(activeSection)}.`)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeSection])

  const logout = () => {
    localStorage.removeItem('hireflow_auth_token')
    window.location.replace('/login')
  }

  if (!isAuthenticated || !isAdmin) {
    return null
  }

  return (
    <div className="admin-dashboard dark admin-shell">
      <AdminSidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />

      <div className="admin-main">
        <AdminHeader
          sessionRemaining={computedSessionRemaining}
          onToggleSidebar={() => setMobileSidebarOpen((current) => !current)}
          onLogout={logout}
          profileName={payload?.email || 'admin@hireflow.dev'}
        />

        <main className="admin-content dark:bg-slate-900 dark:text-slate-100">
          <div className="admin-content__heading">
            <h2>{sectionTitle(activeSection)}</h2>
            <p>Active page: <strong>{sectionTitle(activeSection)}</strong></p>
          </div>

          <section className="admin-card">
            <h3>Keyboard shortcuts</h3>
            <p>{shortcutsMessage}</p>
            <p className="admin-muted">Hints: press <kbd>j</kbd>/<kbd>k</kbd> to switch, <kbd>e</kbd> for edit, <kbd>r</kbd> for refund.</p>
          </section>
        </main>
      </div>
    </div>
  )
}
