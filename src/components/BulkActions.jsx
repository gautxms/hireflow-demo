export default function BulkActions({ selectedCount, children }) {
  return (
    <div className="bulk-toolbar">
      <div className="bulk-selected-label">{selectedCount} selected</div>
      <div className="bulk-actions">
        {children}
      </div>
    </div>
  )
}
