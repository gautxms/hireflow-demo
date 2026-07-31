import BrandLogo from '../components/BrandLogo'
import PublicFooter from '../components/PublicFooter'

export default function PublicSiteShell({ children }) {
  return (
    <>
      <header className="site-header">
        <BrandLogo className="site-header__logo" />
        <nav className="site-header__nav-links" aria-label="Primary">
          <a className="site-header__nav-button" href="/#features">Features</a>
          <a className="site-header__nav-button" href="/ai-resume-screening">Solutions</a>
          <a className="site-header__nav-button" href="/pricing">Pricing</a>
          <a className="site-header__nav-button" href="/about">About</a>
          <a className="site-header__nav-button" href="/help">Help</a>
        </nav>
        <div className="site-header__auth-actions">
          <a className="btn-ghost btn-ghost--accent" href="/login">Login</a>
          <a className="btn-primary" href="/signup">Sign up</a>
        </div>
      </header>
      <main>{children}</main>
      <PublicFooter />
    </>
  )
}
