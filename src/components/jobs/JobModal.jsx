import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import JobDescriptionForm from '../JobDescriptionForm'

export default function JobModal({ isOpen, mode, item, resetToken, isSubmitting, onSubmit, onClose, triggerRef }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      triggerRef?.current?.focus?.({ preventScroll: true })
    }
  }, [isOpen, isSubmitting, onClose, triggerRef])

  if (!isOpen) return null

  return createPortal(
    <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
      <div ref={dialogRef} className="ui-card ui-card--card-spacing ui-modal__dialog">
        <h2 id="job-modal-title" className="job-modal__title">{mode === 'edit' ? 'Edit Job Description' : 'Create Job Description'}</h2>
        <JobDescriptionForm initialValue={item} resetToken={resetToken} onSubmit={onSubmit} onCancel={onClose} isSubmitting={isSubmitting} renderAsModal />
      </div>
    </div>,
    document.body,
  )
}
