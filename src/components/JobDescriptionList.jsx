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
    <div className="job-description-list" role="list" aria-label="Job descriptions">
      {items.map((item) => {
        const itemTitle = item.title || 'Untitled role'
        const isSelected = selectedItemId === item.id

        return (
          <article key={item.id} role="listitem" className={`job-description-list__card ${isSelected ? 'job-description-list__card--selected' : ''}`}>
            <div className="job-description-list__content">
              <div>
                <h3 className="job-description-list__title">
                  <button
                    type="button"
                    className="job-description-list__title-button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect?.(item)}
                  >
                    {itemTitle}
                  </button>
                </h3>
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
              <div className="job-description-list__actions" aria-label={`Actions for ${itemTitle}`}>
                <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item, event.currentTarget) }} className="job-description-list__action">Edit</button>
                <button type="button" onClick={(event) => { event.stopPropagation(); onDuplicate(item) }} className="job-description-list__action">Duplicate</button>
                {item.status !== 'archived' && (
                  <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(item) }} className="job-description-list__action">Archive</button>
                )}
                <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(item) }} className="job-description-list__action job-description-list__action--danger">Delete</button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
