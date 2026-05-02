import AppHeader from '../AppHeader'
import { createElement, useEffect, useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { hasActiveSubscription } from '../../utils/routeGuards'
import {
  LayoutDashboard, Briefcase, ScanSearch, Users, ClipboardCheck, BarChart2, Settings2, Pin, ChevronLeft, ChevronRight, Lock
} from 'lucide-react'

const SIDEBAR_PINNED_STORAGE_KEY = 'hireflow_user_sidebar_pinned'

const PAGE_TITLE_RULES = [
  { matches: (value) => value === '/' || value === '/dashboard', title: 'Dashboard' },
  { matches: (value) => value === '/job-descriptions', title: 'Jobs' },
  { matches: (value) => value === '/analyses', title: 'Analyses' },
  { matches: (value) => value.startsWith('/analyses/'), title: 'Analysis Details' },
  { matches: (value) => value === '/candidates', title: 'Candidates' },
  { matches: (value) => value.startsWith('/candidates/'), title: 'Candidate Details' },
  { matches: (value) => value === '/results', title: 'Shortlists' },
  { matches: (value) => value === '/reports', title: 'Reports' },
  { matches: (value) => value === '/settings', title: 'Settings' },
  { matches: (value) => value === '/account', title: 'Account' },
  { matches: (value) => value === '/billing', title: 'Billing' },
  { matches: (value) => value === '/account/payment-method', title: 'Payment Method' },
]

function getPageTitle(pathname) {
  const match = PAGE_TITLE_RULES.find((rule) => rule.matches(pathname))
  return match?.title || 'Dashboard'
}

const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { key: 'jobs', label: 'Jobs', path: '/job-descriptions', icon: Briefcase },
  { key: 'analyses', label: 'Analyses', path: '/analyses', icon: ScanSearch },
  { key: 'candidates', label: 'Candidates', path: '/candidates', icon: Users },
  { key: 'shortlists', label: 'Shortlists', path: '/results', icon: ClipboardCheck },
  { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart2 },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings2 },
]

function readStoredPinnedState() {
  if (typeof window === 'undefined') {
    return true
  }

  const rawPinnedState = window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY)
  if (rawPinnedState === null) {
    return true
  }

  return rawPinnedState === 'true'
}

export default function UserAppShell({
  children,
  pathname,
  onNavigate,
  userProfile = null,
  navItems = DEFAULT_NAV_ITEMS,
  subscriptionStatus = 'inactive',
  showUpgradeCta = false,
}) {
  const [isPinned, setIsPinned] = useState(() => readStoredPinnedState())
  const [isHoverExpanded, setIsHoverExpanded] = useState(false)

  const normalizedSubscriptionStatus = String(subscriptionStatus || 'inactive').trim().toLowerCase()
  const isPremiumUser = hasActiveSubscription(normalizedSubscriptionStatus)
  const isExpanded = isPinned || isHoverExpanded
  const pageTitle = getPageTitle(pathname)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, String(isPinned))
  }, [isPinned])

  const decoratedNavItems = useMemo(() => {
    return navItems.map((item) => {
      if (item.key !== 'reports') {
        return item
      }

      return {
        ...item,
        isLocked: item.isLocked ?? !isPremiumUser,
        badge: item.badge || (!isPremiumUser ? 'Pro' : ''),
      }
    })
  }, [isPremiumUser, navItems])

  return (
    <div className={`user-app-shell ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
      <aside
        className={`user-app-shell__sidebar ${isPinned ? 'is-pinned' : 'is-unpinned'} ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
        aria-label="App sections"
        onMouseEnter={() => {
          if (!isPinned) {
            setIsHoverExpanded(true)
          }
        }}
        onMouseLeave={() => {
          if (!isPinned) {
            setIsHoverExpanded(false)
          }
        }}
      >
        <div className="user-app-shell__sidebar-header">
          <a
            href="/"
            className="user-app-shell__brand"
            onClick={(event) => {
              event.preventDefault()
              onNavigate('/')
            }}
          >
            <Icon name="rocket" size="sm" className="user-app-shell__brand-icon" />
            <span className="user-app-shell__brand-wordmark">Hire<span>Flow</span></span>
          </a>
          <button
            type="button"
            className="user-app-shell__pin-toggle"
            aria-pressed={isPinned}
            onClick={() => {
              setIsPinned((current) => !current)
              setIsHoverExpanded(false)
            }}
            aria-label={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
            title={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
          >
            {isPinned ? <ChevronLeft size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
            <span className="user-app-shell__pin-indicator">
              {isPinned ? <Pin size={12} strokeWidth={1.7} /> : null}
              {isPinned ? 'Pinned' : 'Hover to expand'}
            </span>
          </button>
        </div>

        <nav className="user-app-shell__nav">
          {decoratedNavItems.map((item) => {
            const isActive = pathname === item.path
            const isLocked = Boolean(item.isLocked)

            return (
              <button
                key={item.key}
                type="button"
                className={`user-app-shell__nav-item ${isActive ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}`}
                data-tooltip={!isExpanded ? item.label : undefined}
                onClick={() => {
                  if (isLocked) {
                    return
                  }

                  onNavigate(item.path)
                }}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isLocked ? 'true' : undefined}
                title={!isExpanded ? `${item.label}${isLocked ? ' (Locked)' : ''}` : undefined}
                aria-label={`${item.label}${isLocked ? ' (Locked)' : ''}`}
              >
                <span className="user-app-shell__nav-item-icon-wrap">
                  {typeof item.icon === 'string'
                    ? <Icon name={item.icon} size="sm" className="user-app-shell__nav-item-icon" />
                    : item.icon
                      ? createElement(item.icon, { size: 18, strokeWidth: 1.5, className: 'user-app-shell__nav-item-icon' })
                      : <LayoutDashboard size={18} strokeWidth={1.5} className="user-app-shell__nav-item-icon" />}
                  {isLocked ? <Lock size={11} strokeWidth={1.7} className="user-app-shell__nav-item-lock" /> : null}
                </span>
                <span className="user-app-shell__nav-item-label">{item.label}</span>
                {item.badge ? <span className="user-app-shell__nav-item-badge">{item.badge}</span> : null}
              </button>
            )
          })}
        </nav>

        {showUpgradeCta && !isPremiumUser ? (
          <div className="user-app-shell__upgrade-box">
            <p className="user-app-shell__upgrade-title">Unlock Pro</p>
            <p className="user-app-shell__upgrade-copy">Get Reports, deeper insights, and unlimited exports.</p>
            <button
              type="button"
              className="user-app-shell__upgrade-button"
              onClick={() => onNavigate('/pricing?reason=sidebar_upgrade')}
            >
              Upgrade
            </button>
          </div>
        ) : null}
      </aside>
      <main className="user-app-shell__content">
        <AppHeader
          user={userProfile}
          isSubscribed={isPremiumUser}
          pageTitle={pageTitle}
        />
        <div className="user-app-shell__page-content">{children}</div>
        <footer className="user-app-shell__footer" aria-label="Workspace footer">
          <span className="user-app-shell__footer-copy">© {new Date().getFullYear()} HireFlow</span>
          <div className="user-app-shell__footer-links">
            <button type="button" onClick={() => onNavigate('/help')} className="user-app-shell__footer-link">Help</button>
            <button type="button" onClick={() => onNavigate('/about')} className="user-app-shell__footer-link">About</button>
            <button type="button" onClick={() => onNavigate('/privacy')} className="user-app-shell__footer-link">Privacy</button>
          </div>
        </footer>
      </main>
    </div>
  )
}
