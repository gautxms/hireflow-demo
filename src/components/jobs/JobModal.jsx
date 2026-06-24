import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import JobDescriptionForm from '../JobDescriptionForm'

export default function JobModal({ isOpen, mode, item, resetToken, isSubmitting, onSubmit, onClose, triggerRef, errorMessage }) {
  const dialogRef = useRef(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [isOpen, isSubmitting, onClose])

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef?.current?.focus?.({ preventScroll: true })
    }
    wasOpenRef.current = isOpen
  }, [isOpen, triggerRef])

  if (!isOpen) return null

  return createPortal(
    <div className="ui-modal job-modal" role="dialog" aria-modal="true" aria-labelledby="job-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
      <div ref={dialogRef} className="ui-card ui-card--card-spacing ui-modal__dialog job-modal__dialog">
        <div className="job-modal__header">
          <div>
            <h2 id="job-modal-title" className="job-modal__title">{mode === 'edit' ? 'Edit Job' : 'Create Job'}</h2>
            <p className="job-modal__subtitle">Create and maintain structured job profiles for analysis workflows.</p>
          </div>
          <button type="button" className="job-modal__close" aria-label="Close job modal" onClick={onClose} disabled={isSubmitting}><X size={18} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>
        {errorMessage ? <p className="job-modal__error" role="alert">{errorMessage}</p> : null}
        <JobDescriptionForm initialValue={item} resetToken={resetToken} onSubmit={onSubmit} onCancel={onClose} isSubmitting={isSubmitting} />
      </div>
    </div>, document.body,
  )
}
