import StatePattern from '../../components/state/StatePattern'

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

export function EmptyState({ title, description, action, illustration }) {
  return (
    <StatePattern
      kind="empty"
      compact
      title={title}
      description={description}
      action={action}
      illustration={illustration}
      className="text-left"
    />
  )
}
