const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'jobs', label: 'Jobs', path: '/job-descriptions' },
  { key: 'analyses', label: 'Analyses', path: '/analyses' },
  { key: 'candidates', label: 'Candidates', path: '/candidates' },
  { key: 'shortlists', label: 'Shortlists', path: '/results' },
  { key: 'reports', label: 'Reports', path: '/billing' },
  { key: 'settings', label: 'Settings', path: '/settings' },
]

export default function UserAppShell({ children, pathname, onNavigate, navItems = DEFAULT_NAV_ITEMS }) {
  return (
    <div className="user-app-shell">
      <aside className="user-app-shell__sidebar" aria-label="App sections">
        <a
          href="/"
          className="user-app-shell__brand"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/')
          }}
        >
          Hire<span>Flow</span>
        </a>
        <nav className="user-app-shell__nav">
          {navItems.map((item) => {
            const isActive = pathname === item.path

            return (
              <button
                key={item.key}
                type="button"
                className={`user-app-shell__nav-item ${isActive ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>
      <main className="user-app-shell__content">
        {children}
      </main>
    </div>
  )
}
