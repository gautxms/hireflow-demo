import '../styles/job-description.css'

export default function JobDescriptionList({
  items,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onSelect,
  selectedItemId,
}) {
  if (!items.length) {
    return (
      <div className="job-description-list__empty">
        No job descriptions yet.
      </div>
    )
  }

  return (
    <div className="job-description-list">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={() => onSelect?.(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect?.(item)
            }
          }}
          role="button"
          tabIndex={0}
          className={`job-description-list__card ${selectedItemId === item.id ? 'job-description-list__card--selected' : ''}`}
        >
          <div className="job-description-list__content">
            <div>
              <h3 className="job-description-list__title">{item.title}</h3>
              <p className="job-description-list__description">{item.description || 'No description yet.'}</p>
              <div className="job-description-list__meta">
                Status: <strong className="job-description-list__status">{item.status}</strong>
                {item.skills?.length ? ` • Skills: ${item.skills.join(', ')}` : ''}
                {(item.salaryMin !== null && item.salaryMin !== undefined) || (item.salaryMax !== null && item.salaryMax !== undefined)
                  ? ` • Salary: ${item.salaryMin ?? '-'} - ${item.salaryMax ?? '-'} ${item.salaryCurrency || 'USD'}`
                  : ''}
                {item.fileUrl ? ` • File: ${item.fileUrl.split('/').pop()}` : ''}
              </div>
            </div>
            <div className="job-description-list__actions">
              <button onClick={(event) => { event.stopPropagation(); onEdit(item) }} className="job-description-list__action">Edit</button>
              <button onClick={(event) => { event.stopPropagation(); onDuplicate(item) }} className="job-description-list__action">Duplicate</button>
              {item.status !== 'archived' && (
                <button onClick={(event) => { event.stopPropagation(); onArchive(item) }} className="job-description-list__action">Archive</button>
              )}
              <button onClick={(event) => { event.stopPropagation(); onDelete(item) }} className="job-description-list__action job-description-list__action--danger">Delete</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
