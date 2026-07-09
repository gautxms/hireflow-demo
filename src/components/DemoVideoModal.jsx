import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), video[controls], [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function DemoVideoModal({ videoUrl, posterUrl, captionsUrl, onClose, triggerRef }) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const videoRef = useRef(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    wasOpenRef.current = true
    closeButtonRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR))
      if (!focusable.length) return

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

    const video = videoRef.current
    const trigger = triggerRef?.current

    if (video) {
      video.play()?.catch(() => {
        // Browser autoplay policies may block audio playback; controls remain available.
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      video?.pause()
      if (wasOpenRef.current) {
        trigger?.focus?.({ preventScroll: true })
      }
    }
  }, [onClose, triggerRef])

  const handleClose = () => {
    videoRef.current?.pause()
    onClose()
  }

  return (
    <div className="ui-modal demo-video-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose() }}>
      <div
        ref={dialogRef}
        className="ui-card ui-card--card-spacing ui-modal__dialog demo-video-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-video-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="demo-video-modal__header">
          <h2 id="demo-video-modal-title" className="demo-video-modal__title">Product demo</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="demo-video-modal__close"
            aria-label="Close product demo video"
            onClick={handleClose}
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="demo-video-modal__frame">
          <video
            ref={videoRef}
            className="demo-video-modal__video"
            autoPlay
            controls
            playsInline
            preload="metadata"
            poster={posterUrl || undefined}
            title="HireFlow product demo video"
          >
            <source src={videoUrl} />
            {captionsUrl ? <track kind="captions" src={captionsUrl} srcLang="en" label="English captions" default /> : null}
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </div>
  )
}
