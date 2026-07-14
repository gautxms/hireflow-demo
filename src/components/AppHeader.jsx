import AuthenticatedProfileMenu from './AuthenticatedProfileMenu'

export default function AppHeader({ user, isSubscribed, pageTitle, onNavigate, onLogout, showUpgradeCta = true, upgradeLabel = 'View plans', upgradePath = '/pricing' }) {
  const analysesLeft = user?.analysesRemaining ?? null

  return (
    <header className="app-header">

      <div className="app-header-title">{pageTitle}</div>

      <div className="app-header-right">

        {/* Free user strip */}
        {!isSubscribed && showUpgradeCta && (
          <div className="app-header-free-strip">
            <span className="app-header-free-text">
              {analysesLeft != null
                ? `Subscription required · ${analysesLeft} analyses remaining`
                : 'Subscription required'}
            </span>
            <button className="app-header-upgrade-btn"
              onClick={() => onNavigate(upgradePath)}>
              {upgradeLabel}
            </button>
          </div>
        )}

        {/* Paid plan badge */}
        {isSubscribed && (
          <span className="app-header-pro-badge">Plan</span>
        )}

        <AuthenticatedProfileMenu user={user} onNavigate={onNavigate} onLogout={onLogout} className="app-header-profile-menu" />

      </div>
    </header>
  )
}
