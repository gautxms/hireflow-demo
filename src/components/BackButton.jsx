function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

export default function BackButton({ label = 'Back to Home', to = '/' }) {
  return (
    <button
      onClick={() => navigate(to)}
      className="back-button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'transparent',
        color: '#d6ff4b',
        fontWeight: '500',
        cursor: 'pointer',
      }}
    >
      ← {label}
    </button>
  )
}
