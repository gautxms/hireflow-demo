export default function BulkActions({ selectedCount, children }) {
  const hasSelection = selectedCount > 0

  return (
    <div className="bulk-toolbar">
      <p className="bulk-label">
        {hasSelection ? `${selectedCount} selected` : 'Select candidates to run bulk actions'}
      </p>

      <div className={`bulk-actions ${hasSelection ? '' : 'bulk-actions--disabled'}`.trim()}>
        {children}
      </div>
    </div>
  )
}
