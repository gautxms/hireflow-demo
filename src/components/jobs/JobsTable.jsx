function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export default function JobsTable({ items = [], onEdit, onArchive, onDelete }) {
  return (
    <div className="analyses-layout__table-shell">
      <table className="analyses-layout__table jobs-table" aria-label="Job descriptions table">
        <thead>
          <tr>
            <th scope="col" className="jobs-table__col-title">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Department</th>
            <th scope="col">Location</th>
            <th scope="col">Updated</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id || item.title} className="analyses-layout__row">
              <td className="analyses-layout__cell">
                <a href="/job-descriptions" className="jobs-table__title-link">
                  {item.title || 'Untitled role'}
                </a>
              </td>
              <td className="analyses-layout__cell">{item.status || 'draft'}</td>
              <td className="analyses-layout__cell">{item.department || '—'}</td>
              <td className="analyses-layout__cell">{item.location || '—'}</td>
              <td className="analyses-layout__cell">{formatDate(item.updatedAt || item.createdAt)}</td>
              <td className="analyses-layout__cell">
                <div className="jobs-table__actions" role="group" aria-label={`Actions for ${item.title || 'job'}`}>
                  <button type="button" className="jobs-table__action" onClick={() => onEdit?.(item)}>Edit</button>
                  <button type="button" className="jobs-table__action" onClick={() => onArchive?.(item)}>Archive</button>
                  <button type="button" className="jobs-table__action jobs-table__action--danger" onClick={() => onDelete?.(item)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
