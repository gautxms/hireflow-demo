function SkeletonRow() {
  return <div className="h-4 animate-pulse rounded bg-slate-300" />
}

export function TableSkeleton({ rows = 4, columns = 5 }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, idx) => (
        <tr key={idx} className="border-t border-slate-100">
          {Array.from({ length: columns }, (_, colIdx) => (
            <td key={colIdx} className="px-4 py-3"><SkeletonRow /></td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="ui-card rounded-lg border-dashed bg-slate-50 p-5 text-center">
      <p className="text-3xl" aria-hidden>📭</p>
      <p className="mt-1 font-medium text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-700">{description}</p>
      {action || null}
    </div>
  )
}
