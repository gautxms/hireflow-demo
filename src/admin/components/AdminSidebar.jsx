const SECTIONS = [
  { key: 'users', label: 'Users', icon: '👥' },
  { key: 'subscriptions', label: 'Subscriptions', icon: '💳' },
  { key: 'uploads', label: 'Uploads', icon: '📤' },
  { key: 'analytics', label: 'Analytics', icon: '📊' },
  { key: 'logs', label: 'Logs', icon: '📜' },
  { key: 'health', label: 'Health', icon: '🩺' },
]

export default function AdminSidebar({ activeSection, onNavigate, mobileOpen, onClose }) {
  return (
    <>
      <button
        type="button"
        className={`admin-sidebar-overlay ${mobileOpen ? 'admin-sidebar-overlay--visible' : ''}`}
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={onClose}
      />

      <aside className={`admin-sidebar dark:bg-slate-950 ${mobileOpen ? 'admin-sidebar--open' : ''}`}>
        <div className="admin-sidebar__brand dark:text-white">HireFlow Admin</div>

        <nav aria-label="Admin sections">
          <ul className="admin-sidebar__nav">
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.key
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(section.key)
                      onClose()
                    }}
                    className={`admin-sidebar__item ${isActive ? 'admin-sidebar__item--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="admin-sidebar__icon" aria-hidden="true">{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}

export { SECTIONS }
