import AppHeader from '../AppHeader'
import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  Briefcase,
  ScanSearch,
  Users,
  ClipboardCheck,
  BarChart2,
  Settings2,
  Pin,
  ChevronLeft,
  ChevronRight,
  Grid2x2,
} from 'lucide-react'
import { hasActiveSubscription } from '../../utils/routeGuards'

const NAV = [
  { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
  { label: 'Jobs', path: '/job-descriptions', Icon: Briefcase },
  { label: 'Analyses', path: '/analyses', Icon: ScanSearch },
  { label: 'Candidates', path: '/candidates', Icon: Users },
  { label: 'Shortlists', path: '/results', Icon: ClipboardCheck },
  { label: 'Reports', path: '/reports', Icon: BarChart2, badge: 'New', proOnly: true },
  { label: 'Settings', path: '/settings', Icon: Settings2 },
]

export default function UserAppShell({ children, pathname, onNavigate, userProfile = null, subscriptionStatus = 'inactive' }) {
  const [expanded, setExpanded] = useState(true)
  const [pinned, setPinned] = useState(true)

  const isSubscribed = hasActiveSubscription(String(subscriptionStatus || 'inactive').trim().toLowerCase())

  useEffect(() => {
    const saved = localStorage.getItem('hf-sb-pinned')
    if (saved !== null) {
      const val = saved === 'true'
      setPinned(val)
      setExpanded(val)
    }
  }, [])

  const navItems = useMemo(() => NAV, [])

  const pin = () => {
    const next = !pinned
    setPinned(next)
    setExpanded(next)
    localStorage.setItem('hf-sb-pinned', String(next))
  }

  const collapse = () => {
    setExpanded(false)
    setPinned(false)
    localStorage.setItem('hf-sb-pinned', 'false')
  }

  const expand = () => {
    setExpanded(true)
    setPinned(true)
    localStorage.setItem('hf-sb-pinned', 'true')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', overflow: 'hidden' }}>
      <aside
        className={`app-sb ${expanded ? 'app-sb--open' : 'app-sb--closed'}`}
        onMouseEnter={() => { if (!pinned) setExpanded(true) }}
        onMouseLeave={() => { if (!pinned) setExpanded(false) }}
      >
        <div className="app-sb-logo">
          <Grid2x2 size={20} strokeWidth={1.8} color="#c8ff00" style={{ flexShrink: 0 }} />
          <span className="app-sb-logo-text"><span style={{ color: '#fff' }}>Hire</span><span style={{ color: '#c8ff00' }}>Flow</span></span>
        </div>

        <nav className="app-sb-nav">
          {navItems.map(({ label, path, Icon, badge, proOnly }) => {
            const locked = proOnly && !isSubscribed
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
                <Icon size={18} strokeWidth={1.5} className="app-sb-icon" />
                <span className="app-sb-label">
                  {label}
                  {badge && <span className="app-sb-badge">{badge}</span>}
                  {locked && <span className="app-sb-badge app-sb-badge--pro">Pro</span>}
                </span>
              </button>
            )
          })}
        </nav>

        {!isSubscribed && expanded && (
          <div className="app-sb-upgrade">
            <div className="app-sb-upgrade-title">Upgrade to Pro</div>
            <div className="app-sb-upgrade-body">Unlimited analyses, Reports & API</div>
            <button className="app-sb-upgrade-btn" onClick={() => onNavigate('/pricing')}>View Plans</button>
          </div>
        )}

        <div className="app-sb-footer">
          {expanded && (
            <button type="button" className={`app-sb-pin${pinned ? ' app-sb-pin--active' : ''}`} onClick={pin}>
              <Pin size={12} strokeWidth={1.5} />
              <span>{pinned ? 'Pinned' : 'Pin sidebar'}</span>
            </button>
          )}
          <button type="button" className="app-sb-chevron" onClick={expanded ? collapse : expand} title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronLeft size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
          </button>
        </div>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <AppHeader pathname={pathname} onNavigate={onNavigate} subscriptionStatus={subscriptionStatus} userProfile={userProfile} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: '#0a0a0a' }}>
          {children}
        </main>
        <footer className="app-footer-bar">
          <span>© 2026 HireFlow</span>
          <div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/help">Help</a></div>
        </footer>
      </div>
    </div>
  )
}
