import AppHeader from '../AppHeader'
import BrandLogo from '../BrandLogo'
import { createElement, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  Briefcase,
  ScanSearch,
  Users,
  ClipboardCheck,
  BarChart3,
  Settings2,
  Pin,
  ChevronLeft,
  ChevronRight,
  Home,
  FileText,
  Target,
} from 'lucide-react'
import { hasActiveSubscription } from '../../utils/routeGuards'
import { openCookiePreferences } from '../../privacy/cookieConsent'

const ICONS_BY_KEY = {
  dashboard: LayoutDashboard,
  jobs: Briefcase,
  analyses: ScanSearch,
  candidates: Users,
  shortlists: ClipboardCheck,
  reports: BarChart3,
  settings: Settings2,
  home: Home,
  file: FileText,
  target: Target,
  users: Users,
  chart: BarChart3,
}

const DEFAULT_NAV = [
  { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
  { label: 'Jobs', path: '/jobs', Icon: Briefcase },
  { label: 'Analyses', path: '/analyses', Icon: ScanSearch },
  { label: 'Candidates', path: '/candidates', Icon: Users },
  { label: 'Shortlists', path: '/shortlists', Icon: ClipboardCheck },
  { label: 'Reports', path: '/reports', Icon: BarChart3, badge: 'New', proOnly: true },
  { label: 'Settings', path: '/settings', Icon: Settings2 },
]

export default function UserAppShell({ children, pathname, onNavigate, pageTitleProp, userProfile = null, subscriptionStatus = 'inactive', navItems = DEFAULT_NAV }) {
  const getInitialPinned = () => {
    try {
      return localStorage.getItem('hf-sb-pinned') !== 'false'
    } catch {
      return true
    }
  }

  const persistPinned = (nextPinned) => {
    try {
      localStorage.setItem('hf-sb-pinned', String(nextPinned))
    } catch {
      // Ignore storage failures to keep sidebar behavior functional.
    }
  }
  const [pinned, setPinned] = useState(getInitialPinned)
  const [expanded, setExpanded] = useState(getInitialPinned)

  const isSubscribed = hasActiveSubscription(String(subscriptionStatus || 'inactive').trim().toLowerCase())

  const normalizedNavItems = useMemo(() => {
    return (Array.isArray(navItems) ? navItems : DEFAULT_NAV).map((item) => {
      if (item.Icon) {
        return item
      }

      return {
        ...item,
        Icon: ICONS_BY_KEY[item.icon] || LayoutDashboard,
      }
    })
  }, [navItems])

  const pageTitle = useMemo(() => {
    if (typeof pageTitleProp === 'string' && pageTitleProp.trim()) {
      return pageTitleProp.trim()
    }

    const activeNavItem = normalizedNavItems.find((item) => item.path === pathname)
    if (activeNavItem?.label) {
      return activeNavItem.label
    }

    if (pathname === '/dashboard') {
      return 'Dashboard'
    }

    if (pathname === '/') {
      return 'Home'
    }

    return String(pathname || '/').split('/').filter(Boolean).map((segment) => segment.replace(/[-_]+/g, ' ')).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(' • ') || 'Workspace'
  }, [normalizedNavItems, pageTitleProp, pathname])

  const pin = () => {
    const next = !pinned
    setPinned(next)
    setExpanded(next)
    persistPinned(next)
  }

  const collapse = () => {
    setExpanded(false)
    setPinned(false)
    persistPinned(false)
  }

  const expand = () => {
    setExpanded(true)
    setPinned(true)
    persistPinned(true)
  }

  return (
    <div className="app-shell-layout">
      <aside
        className={`app-sb ${expanded ? 'app-sb--open' : 'app-sb--closed'}`}
        onMouseEnter={() => { if (!pinned) setExpanded(true) }}
        onMouseLeave={() => { if (!pinned) setExpanded(false) }}
      >
        <button
          type="button"
          className="app-sb-logo"
          onClick={() => onNavigate('/')}
          aria-label="Go to home"
        >
          <BrandLogo as="span" className="app-sb-logo-text" />
        </button>

        <nav className="app-sb-nav">
          {normalizedNavItems.map(({ label, path, Icon, badge, proOnly, isLocked }) => {
            const locked = Boolean(isLocked || (proOnly && !isSubscribed))
            const isActive = pathname === path
            return (
              <button
                key={path}
                type="button"
                onClick={() => onNavigate(locked ? '/pricing' : path)}
                className={`app-sb-item${isActive ? ' app-sb-item--active' : ''}${locked ? ' app-sb-item--locked' : ''}`}
                title={!expanded ? label : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                {createElement(Icon, { size: 18, strokeWidth: 1.5, className: 'app-sb-icon' })}
                <span className="app-sb-label">
                  {label}
                  {badge && <span className="app-sb-badge">{badge}</span>}
                  {locked && !badge && <span className="app-sb-badge app-sb-badge--pro">Pro</span>}
                </span>
              </button>
            )
          })}
        </nav>

        {!isSubscribed && expanded && (
          <div className="app-sb-upgrade">
            <div className="app-sb-upgrade-title">Upgrade to Pro</div>
            <div className="app-sb-upgrade-body">800 analyses/month, Reports & API</div>
            <button className="app-sb-upgrade-btn" onClick={() => onNavigate('/pricing')}>View Plans</button>
          </div>
        )}

        <div className="app-sb-footer">
          {expanded && (
            <button type="button" className={`app-sb-pin${pinned ? ' app-sb-pin--active' : ''}`} onClick={pin}>
              <Pin size={18} strokeWidth={1.5} />
              <span>{pinned ? 'Pinned' : 'Pin sidebar'}</span>
            </button>
          )}
          <button type="button" className="app-sb-chevron" onClick={expanded ? collapse : expand} title={expanded ? 'Collapse' : 'Expand'} aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
            {expanded ? <ChevronLeft size={18} strokeWidth={1.5} /> : <ChevronRight size={18} strokeWidth={1.5} />}
          </button>
        </div>
      </aside>
      <main className="user-app-shell__content">
        <AppHeader
          user={userProfile}
          isSubscribed={isSubscribed}
          pageTitle={pageTitle}
        />
        <div className="user-app-shell__page-content">{children}</div>
        <footer className="user-app-shell__footer" aria-label="Workspace footer">
          <span className="user-app-shell__footer-copy">© {new Date().getFullYear()} HireFlow</span>
          <div className="user-app-shell__footer-links">
            <button type="button" onClick={() => onNavigate('/privacy')} className="user-app-shell__footer-link">Privacy</button>
            <button type="button" onClick={() => onNavigate('/terms')} className="user-app-shell__footer-link">Terms</button>
            <button type="button" onClick={() => onNavigate('/cookie-policy')} className="user-app-shell__footer-link">Cookies</button>
            <button type="button" onClick={openCookiePreferences} className="user-app-shell__footer-link">Cookie preferences</button>
            <button type="button" onClick={() => onNavigate('/help')} className="user-app-shell__footer-link">Help</button>
          </div>
        </footer>
      </main>
    </div>
  )
}
