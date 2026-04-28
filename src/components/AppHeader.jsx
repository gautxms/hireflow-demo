import { hasActiveSubscription } from '../utils/routeGuards'

const PAGE_TITLE_RULES = [
  { matches: (pathname) => pathname === '/' || pathname === '/dashboard', title: 'Dashboard' },
  { matches: (pathname) => pathname === '/job-descriptions', title: 'Jobs' },
  { matches: (pathname) => pathname === '/analyses', title: 'Analyses' },
  { matches: (pathname) => pathname.startsWith('/analyses/'), title: 'Analysis Details' },
  { matches: (pathname) => pathname === '/candidates', title: 'Candidates' },
  { matches: (pathname) => pathname.startsWith('/candidates/'), title: 'Candidate Details' },
  { matches: (pathname) => pathname === '/results', title: 'Shortlists' },
  { matches: (pathname) => pathname === '/reports', title: 'Reports' },
  { matches: (pathname) => pathname === '/settings', title: 'Settings' },
  { matches: (pathname) => pathname === '/account', title: 'Account' },
  { matches: (pathname) => pathname === '/billing', title: 'Billing' },
  { matches: (pathname) => pathname === '/account/payment-method', title: 'Payment Method' },
]

function getPageTitle(pathname) {
  const match = PAGE_TITLE_RULES.find((rule) => rule.matches(pathname))
  return match?.title || 'Workspace'
}

export default function AppHeader({ pathname, onNavigate, subscriptionStatus, userProfile }) {
  const pageTitle = getPageTitle(pathname)
  const isProSubscriber = hasActiveSubscription(subscriptionStatus)
  const profileInitial = (userProfile?.name?.trim()?.[0] || userProfile?.email?.trim()?.[0] || 'U').toUpperCase()

  return (
    <header className="app-header" aria-label="Workspace header">
      <div className="app-header__left">
        <h1 className="app-header__title">{pageTitle}</h1>
      </div>
      <div className="app-header__right">
        {isProSubscriber ? (
          <>
            <span className="app-header__pro-badge" aria-label="Pro plan">Pro</span>
            <button
              type="button"
              className="app-header__icon-button"
              aria-label="Notifications"
            >
              🔔
            </button>
          </>
        ) : (
          <div className="app-header__free-plan-strip" role="status" aria-live="polite">
            <span className="app-header__free-plan-label">Free plan</span>
            <button
              type="button"
              className="app-header__upgrade-cta"
              onClick={() => onNavigate('/pricing?reason=upgrade_required')}
            >
              Upgrade
            </button>
          </div>
        )}

        <button
          type="button"
          className="app-header__avatar"
          onClick={() => onNavigate('/account')}
          aria-label="Go to account settings"
        >
          {profileInitial}
        </button>
      </div>
    </header>
  )
}
