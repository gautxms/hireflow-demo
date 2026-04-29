import AppHeader from '../AppHeader'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../Icon'

const SIDEBAR_PINNED_STORAGE_KEY = 'hireflow_user_sidebar_pinned'

const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: 'home' },
  { key: 'jobs', label: 'Jobs', path: '/job-descriptions', icon: 'file' },
  { key: 'analyses', label: 'Analyses', path: '/analyses', icon: 'target' },
  { key: 'candidates', label: 'Candidates', path: '/candidates', icon: 'users' },
  { key: 'shortlists', label: 'Shortlists', path: '/results', icon: 'chart' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: 'chart' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
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
  const isPremiumUser = normalizedSubscriptionStatus === 'active'
  const isExpanded = isPinned || isHoverExpanded

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
            onClick={() => {
              setIsPinned((current) => !current)
              setIsHoverExpanded(false)
            }}
            aria-label={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
            title={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
          >
            <Icon name={isPinned ? 'link' : 'menu'} size="sm" />
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
                  <Icon name={item.icon || 'file'} size="sm" className="user-app-shell__nav-item-icon" />
                  {isLocked ? <Icon name="lock" size="xs" className="user-app-shell__nav-item-lock" /> : null}
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
          pathname={pathname}
          onNavigate={onNavigate}
          subscriptionStatus={subscriptionStatus}
          userProfile={userProfile}
        />
        <div className="user-app-shell__page-content">{children}</div>
      </main>
    </div>
  )
}
