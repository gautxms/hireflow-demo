import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive } from 'lucide-react'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatSkillsCount(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '—'
  const count = skills.length
  return `${count} skill${count === 1 ? '' : 's'}`
}

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) return []
  return skills.map((entry) => String(entry || '').trim()).filter(Boolean)
}

function parseExperienceValue(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatExperience(item = {}) {
  const min = parseExperienceValue(item.experienceMin)
  const max = parseExperienceValue(item.experienceMax)
  const legacy = parseExperienceValue(item.experienceYears)

  if (min !== null && max !== null) return `${min}–${max} years`
  if (min !== null) return `${min}+ years`
  if (max !== null) return `Up to ${max} years`
  if (legacy !== null) return `${legacy} years`
  return '—'
}

function SkillsPreviewPopover({ item, isOpen, onOpen, onClose, popoverId }) {
  const anchorRef = useRef(null)
  const popoverRef = useRef(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const skills = normalizeSkills(item?.skills)

  useEffect(() => {
    if (!isOpen) return undefined

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return

      const maxLeft = Math.max(16, window.innerWidth - 16 - 320)
      setPosition({
        top: Math.round(rect.bottom + window.scrollY + 8),
        left: Math.round(Math.min(Math.max(16, rect.left + window.scrollX - 120), maxLeft)),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !popoverRef.current) return
    popoverRef.current.style.top = `${position.top}px`
    popoverRef.current.style.left = `${position.left}px`
  }, [isOpen, position])

  if (skills.length === 0) return <span className="analyses-layout__meta">—</span>

  return (
    <span className="analyses-files-preview" data-skills-popover-root="true">
      <button
        type="button"
        ref={anchorRef}
        className="analyses-files-preview__trigger"
        onClick={() => (isOpen ? onClose() : onOpen())}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-label={`View skills for ${item?.title || 'job'}`}
      >
        {formatSkillsCount(skills)}
      </button>
      {isOpen && createPortal(
        <div
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          className="analyses-files-preview__popover"
          data-skills-popover-root="true"
          aria-label="Skills list"
        >
          <p className="jobs-table__skills-list">{skills.join(', ')}</p>
        </div>,
        document.body,
      )}
    </span>
  )
}

export default function JobsTable({ items = [], onEdit, onArchive, archivingId = '' }) {
  const [openSkillsPopoverId, setOpenSkillsPopoverId] = useState(null)

  useEffect(() => {
    if (!openSkillsPopoverId) return undefined

    const handleKeydown = (event) => {
      if (event.key === 'Escape') setOpenSkillsPopoverId(null)
    }

    const handlePointerDown = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-skills-popover-root="true"]')) return
      setOpenSkillsPopoverId(null)
    }

    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)

    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [openSkillsPopoverId])

  return (
    <div className="analyses-layout__table-shell">
      <table className="analyses-layout__table jobs-table" aria-label="Job descriptions table">
        <thead>
          <tr>
            <th scope="col" className="jobs-table__col-title">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Experience</th>
            <th scope="col">Location</th>
            <th scope="col">Skills</th>
            <th scope="col">Created</th>
            <th scope="col">Updated</th>
            <th scope="col" className="jobs-table__actions-header">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemId = String(item.id)
            return (
              <tr key={item.id || item.title} className="analyses-layout__row">
                <td className="analyses-layout__cell" data-label="Title">
                  <button
                    type="button"
                    className="analyses-layout__title-link analyses-layout__open-link jobs-table__title-link-reset"
                    onClick={(event) => onEdit?.(item, event.currentTarget)}
                  >
                    <span className="analyses-layout__title">{item.title || 'Untitled role'}</span>
                  </button>
                </td>

                <td className="analyses-layout__cell" data-label="Status">
                  {item.status || 'draft'}
                </td>

                <td className="analyses-layout__cell" data-label="Experience">
                  <span className="analyses-layout__meta">{formatExperience(item)}</span>
                </td>

                <td className="analyses-layout__cell" data-label="Location">
                  {item.location || '—'}
                </td>

                <td className="analyses-layout__cell" data-label="Skills">
                  <SkillsPreviewPopover
                    item={item}
                    isOpen={openSkillsPopoverId === itemId}
                    onOpen={() => setOpenSkillsPopoverId(itemId)}
                    onClose={() => setOpenSkillsPopoverId(null)}
                    popoverId={`job-skills-popover-${itemId}`}
                  />
                </td>

                <td className="analyses-layout__cell" data-label="Created">
                  <span className="analyses-layout__meta">{formatDateTime(item.createdAt)}</span>
                </td>

                <td className="analyses-layout__cell" data-label="Updated">
                  <span className="analyses-layout__meta">{formatDateTime(item.updatedAt || item.createdAt)}</span>
                </td>

                <td className="analyses-layout__cell jobs-table__actions-cell" data-label="Actions">
                  <button
                    type="button"
                    className={`hf-btn hf-btn--secondary jobs-table__action-button${archivingId === itemId ? ' jobs-table__action-button--loading' : ''}`}
                    onClick={() => onArchive?.(item)}
                    disabled={archivingId === itemId || item.status === 'archived'}
                    aria-label={`${archivingId === itemId ? 'Archiving' : 'Archive'} job ${item.title || 'Untitled role'}`}
                    aria-busy={archivingId === itemId}
                  >
                    {archivingId === itemId ? (
                      <span className="jobs-table__action-spinner" aria-hidden="true" />
                    ) : (
                      <Archive size={16} aria-hidden="true" />
                    )}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
