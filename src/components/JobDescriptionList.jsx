export default function JobDescriptionList({ items, onEdit, onDuplicate, onArchive, onDelete }) {
  if (!items.length) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', color: 'var(--muted)' }}>
        No job descriptions yet.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {items.map((item) => (
        <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>{item.title}</h3>
              <p style={{ margin: '0.4rem 0', color: 'var(--muted)' }}>{item.description || 'No description yet.'}</p>
              <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                Status: <strong style={{ color: '#fff' }}>{item.status}</strong>
                {item.skills?.length ? ` • Skills: ${item.skills.join(', ')}` : ''}
                {(item.salaryMin !== null && item.salaryMin !== undefined) || (item.salaryMax !== null && item.salaryMax !== undefined)
                  ? ` • Salary: ${item.salaryMin ?? '-'} - ${item.salaryMax ?? '-'} ${item.salaryCurrency || 'USD'}`
                  : ''}
                {item.fileUrl ? ` • File: ${item.fileUrl.split('/').pop()}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'start', flexWrap: 'wrap' }}>
              <button onClick={() => onEdit(item)} style={secondaryButton}>Edit</button>
              <button onClick={() => onDuplicate(item)} style={secondaryButton}>Duplicate</button>
              {item.status !== 'archived' && (
                <button onClick={() => onArchive(item)} style={secondaryButton}>Archive</button>
              )}
              <button onClick={() => onDelete(item)} style={dangerButton}>Delete</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const secondaryButton = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: '#fff',
  borderRadius: 8,
  padding: '0.45rem 0.7rem',
  cursor: 'pointer',
}

const dangerButton = {
  background: 'transparent',
  border: '1px solid #ef4444',
  color: '#ef4444',
  borderRadius: 8,
  padding: '0.45rem 0.7rem',
  cursor: 'pointer',
}
