export default function BulkActions({ selectedCount, children }) {
  const hasSelection = selectedCount > 0

  return (
    <div
      style={{
        maxWidth: '1200px',
        margin: '0 auto 1rem',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '1rem',
        display: 'flex',
        gap: '0.75rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.95rem' }}>
        {hasSelection ? `${selectedCount} selected` : 'Select candidates to run bulk actions'}
      </p>

      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          opacity: hasSelection ? 1 : 0.6,
          pointerEvents: hasSelection ? 'auto' : 'none'
        }}
      >
        {children}
      </div>
    </div>
  )
}
