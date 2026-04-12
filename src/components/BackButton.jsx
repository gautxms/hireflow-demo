function navigate(pathname) {
  if (window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function handleBackNavigation({ to, onBack }) {
  if (typeof onBack === 'function') {
    onBack()
    return
  }

  if (to && window.location.pathname !== to) {
    navigate(to)
    return
  }

  if (window.history.length > 1) {
    window.history.back()
    return
  }

  navigate('/')
}

export default function BackButton({ label = 'Back to Home', to = '/', onBack }) {
  return (
    <button
      onClick={() => handleBackNavigation({ to, onBack })}
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
