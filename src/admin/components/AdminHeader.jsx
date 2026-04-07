function formatSeconds(seconds) {
  const bounded = Math.max(0, Number(seconds) || 0)
  const minutes = String(Math.floor(bounded / 60)).padStart(2, '0')
  const remainder = String(bounded % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

export default function AdminHeader({ sessionRemaining, onToggleSidebar, onLogout, profileName = 'Admin User' }) {
  return (
    <header className="admin-header dark:bg-slate-900 dark:text-slate-100">
      <button type="button" className="admin-header__menu" onClick={onToggleSidebar} aria-label="Toggle sidebar">☰</button>

      <div className="admin-header__title-wrap">
        <h1 className="admin-header__title">Admin Dashboard</h1>
        <p className="admin-header__subtitle">Session: {formatSeconds(sessionRemaining)}</p>
      </div>

      <div className="admin-header__actions">
        <div className="admin-header__shortcuts" aria-label="Keyboard shortcut hints">
          <span>j/k: nav</span>
          <span>e: edit</span>
          <span>r: refund</span>
        </div>

        <div className="admin-header__profile">{profileName}</div>
        <button type="button" className="admin-header__logout" onClick={onLogout}>Logout</button>
      </div>
    </header>
  )
}
