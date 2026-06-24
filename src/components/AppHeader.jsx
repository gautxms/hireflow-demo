import { Bell } from 'lucide-react'
import { getAppHeaderInitials } from './appHeaderInitials.js'

export default function AppHeader({ user, isSubscribed, pageTitle }) {
  const navigateTo = (path) => {
    if (typeof window !== 'undefined' && window?.location) {
      window.location.href = path
    }
  }

  const initials = getAppHeaderInitials(user)
  const analysesLeft = user?.analysesRemaining ?? null

  return (
    <header className="app-header">

      <div className="app-header-title">{pageTitle}</div>

      <div className="app-header-right">

        {/* Free user strip */}
        {!isSubscribed && (
          <div className="app-header-free-strip">
            <span className="app-header-free-text">
              {analysesLeft != null
                ? `Free plan · ${analysesLeft} analyses remaining`
                : 'Free plan'}
            </span>
            <button className="app-header-upgrade-btn"
              onClick={() => navigateTo('/pricing')}>
              Upgrade
            </button>
          </div>
        )}

        {/* Paid plan badge */}
        {isSubscribed && (
          <span className="app-header-pro-badge">Plan</span>
        )}

        {/* Bell */}
        <button className="app-header-icon-btn" title="Notifications">
          <Bell size={18} strokeWidth={1.5} />
        </button>

        {/* Avatar */}
        <div className="app-header-avatar"
          title={user?.name || 'Account'}
          onClick={() => navigateTo('/settings')}>
          {initials}
        </div>

      </div>
    </header>
  )
}
