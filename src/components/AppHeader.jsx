import AuthenticatedProfileMenu from './AuthenticatedProfileMenu'

export default function AppHeader({ user, isSubscribed, pageTitle, onNavigate, onLogout, showUpgradeCta = true, upgradeStatusLabel = null, upgradeDescription = null, upgradeLabel = 'View plans', upgradePath = '/pricing' }) {
  const analysesLeft = user?.analysesRemaining ?? null
  const upgradeStatus = upgradeStatusLabel || (analysesLeft != null
    ? `Subscription required · ${analysesLeft} analyses remaining`
    : 'Subscription required')

  return (
    <header className="app-header">

      <div className="app-header-title">{pageTitle}</div>

      <div className="app-header-right">

        {/* Free user strip */}
        {!isSubscribed && showUpgradeCta && (
          <div
            className="app-header-free-strip"
            aria-label={upgradeDescription ? `${upgradeStatus}. ${upgradeDescription}` : upgradeStatus}
          >
            <span className="app-header-free-text">{upgradeStatus}</span>
            <button type="button" className="app-header-upgrade-btn"
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
