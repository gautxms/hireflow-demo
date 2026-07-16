import BrandLogo from '../BrandLogo'
import AuthenticatedProfileMenu from '../AuthenticatedProfileMenu'
import { openCookiePreferences } from '../../privacy/cookieConsent'

export default function AuthenticatedAccountShell({ children, pathname, onNavigate, onLogout, userProfile, requiresBillingRecovery = false }) {
  const isBillingPage = pathname === '/billing' || pathname === '/billing/'
  const billingActionPath = requiresBillingRecovery ? '/billing' : '/pricing'
  const billingActionLabel = requiresBillingRecovery ? 'Review billing' : 'View plans'

  return (
    <div className="account-shell-layout">
      <header className="account-shell-header">
        <BrandLogo
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/')
          }}
          className="account-shell-logo"
        />
        <div className="account-shell-actions">
          {!isBillingPage ? (
            <button type="button" className="btn-primary account-shell-plans" onClick={() => onNavigate(billingActionPath)}>
              {billingActionLabel}
            </button>
          ) : null}
          <AuthenticatedProfileMenu user={userProfile} onNavigate={onNavigate} onLogout={onLogout} />
        </div>
      </header>
      <main className="account-shell-main" aria-label="Account area" data-pathname={pathname}>{children}</main>
      <footer className="user-app-shell__footer account-shell-footer" aria-label="Account footer">
        <span className="user-app-shell__footer-copy">© {new Date().getFullYear()} HireFlow</span>
        <div className="user-app-shell__footer-links">
          <button type="button" onClick={() => onNavigate('/privacy')} className="user-app-shell__footer-link">Privacy</button>
          <button type="button" onClick={() => onNavigate('/terms')} className="user-app-shell__footer-link">Terms</button>
          <button type="button" onClick={openCookiePreferences} className="user-app-shell__footer-link">Cookie preferences</button>
          <button type="button" onClick={() => onNavigate('/help')} className="user-app-shell__footer-link">Help</button>
        </div>
      </footer>
    </div>
  )
}
