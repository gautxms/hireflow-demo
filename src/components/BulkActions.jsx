export default function BulkActions({ selectedCount, children }) {
  const noun = selectedCount === 1 ? 'candidate' : 'candidates'
  return (
    <div className="bulk-toolbar">
      <div className="bulk-selected-label">{selectedCount} {noun} selected</div>
      <div className="bulk-actions">
        {children}
      </div>
    </div>
  )
}
