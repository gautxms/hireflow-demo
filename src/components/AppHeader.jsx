import { Bell } from 'lucide-react'

export default function AppHeader({ user, isSubscribed, pageTitle }) {
  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()
    : 'U'
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
              onClick={() => window.location.href='/pricing'}>
              Upgrade
            </button>
          </div>
        )}

        {/* Pro badge */}
        {isSubscribed && (
          <span className="app-header-pro-badge">Pro</span>
        )}

        {/* Bell */}
        <button className="app-header-icon-btn" title="Notifications">
          <Bell size={15} strokeWidth={1.5}/>
        </button>

        {/* Avatar */}
        <div className="app-header-avatar"
          title={user?.name || 'Account'}
          onClick={() => window.location.href='/settings'}
          style={{cursor:'pointer'}}>
          {initials}
        </div>

      </div>
    </header>
  )
}
