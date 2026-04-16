import { useEffect, useMemo, useState } from 'react'
import { ADMIN_SECTIONS, navigateAdmin } from '../config/adminNavigation'
import '../styles/admin.css'

const MOBILE_BREAKPOINT_PX = 960

function formatSessionLabel() {
  const raw = localStorage.getItem('admin_session')

  if (!raw) {
    return 'Session unavailable'
  }

  try {
    const parsed = JSON.parse(raw)
    const expiry = parsed?.expiresAt ? new Date(parsed.expiresAt).getTime() : 0

    if (!expiry) {
      return 'Session active'
    }

    const secondsLeft = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
    const seconds = String(secondsLeft % 60).padStart(2, '0')

    return `Session ${minutes}:${seconds}`
  } catch {
    return 'Session active'
  }
}

export default function AdminShell({ sectionKey, title, subtitle, purpose, breadcrumbs = [], children, onLogout }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth <= MOBILE_BREAKPOINT_PX
  })
  const primaryMobileItems = ADMIN_SECTIONS.slice(0, 4)

  const currentSection = useMemo(
    () => ADMIN_SECTIONS.find((item) => item.key === sectionKey),
    [sectionKey],
  )

  const go = (href) => {
    setMobileNavOpen(false)
    navigateAdmin(href)
  }

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT_PX

      setIsMobileViewport(mobile)

      if (!mobile) {
        setMobileNavOpen(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <div className="admin-shell-v2">
      <aside className="admin-shell-v2__sidebar" aria-label="Admin sections">
        <div className="admin-shell-v2__brand">HireFlow Admin</div>
        <nav>
          <ul className="admin-shell-v2__nav-list">
            {ADMIN_SECTIONS.map((item) => {
              const active = item.key === sectionKey
              return (
                <li key={item.key}>
                  <button type="button" className={`admin-shell-v2__nav-item ${active ? 'is-active' : ''}`} onClick={() => go(item.href)} aria-current={active ? 'page' : undefined}>
                    <span aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>

      <div className="admin-shell-v2__main">
        <header className="admin-shell-v2__header">
          <div>
            <p className="admin-shell-v2__section">{currentSection?.label || 'Admin'}</p>
            <h1>{title}</h1>
            <p className="admin-shell-v2__subtitle">{subtitle}</p>
          </div>
          <div className="admin-shell-v2__header-actions">
            <span>{formatSessionLabel()}</span>
            <button type="button" className="ui-btn" onClick={onLogout}>Logout</button>
          </div>
        </header>

        <div className="admin-shell-v2__breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`}>
              {index > 0 ? ' / ' : ''}
              {crumb}
            </span>
          ))}
        </div>

        <p className="admin-shell-v2__purpose">{purpose}</p>

        <main className="admin-shell-v2__content">{children}</main>
        <footer className="admin-shell-v2__footer">HireFlow admin console</footer>
      </div>

      {isMobileViewport ? (
        <nav className="admin-shell-v2__mobile-tabs" aria-label="Admin quick navigation">
          {primaryMobileItems.map((item) => {
            const active = item.key === sectionKey
            return (
              <button key={item.key} type="button" className={`admin-shell-v2__mobile-tab ${active ? 'is-active' : ''}`} onClick={() => go(item.href)} aria-current={active ? 'page' : undefined}>
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
          <button type="button" className="admin-shell-v2__mobile-tab" onClick={() => setMobileNavOpen(true)}>
            <span aria-hidden="true">☰</span>
            <span>More</span>
          </button>
        </nav>
      ) : null}

      {isMobileViewport && mobileNavOpen ? (
        <div className="admin-shell-v2__mobile-drawer" role="dialog" aria-modal="true" aria-label="More admin sections">
          <button type="button" className="admin-shell-v2__mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close menu" />
          <div className="admin-shell-v2__mobile-panel">
            <h2>All sections</h2>
            {ADMIN_SECTIONS.map((item) => {
              const active = item.key === sectionKey
              return (
                <button key={item.key} type="button" className={`admin-shell-v2__mobile-panel-item ${active ? 'is-active' : ''}`} onClick={() => go(item.href)}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
