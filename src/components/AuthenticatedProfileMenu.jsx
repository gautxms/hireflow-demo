import { useEffect, useRef, useState } from 'react'
import { getAppHeaderInitials } from './appHeaderInitials.js'

export default function AuthenticatedProfileMenu({ user, onNavigate, onLogout, className = '' }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)
  const initials = getAppHeaderInitials(user)

  useEffect(() => {
    if (!isOpen) return undefined

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const navigateTo = (path) => {
    setIsOpen(false)
    onNavigate(path)
  }

  return (
    <div className={`site-profile-menu ${className}`.trim()} ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Open user menu"
        className="site-profile-menu__trigger"
      >
        {initials}
      </button>

      {isOpen ? (
        <div role="menu" className="site-profile-menu__list">
          <button role="menuitem" onClick={() => navigateTo('/settings')} className="site-profile-menu__item">
            Account settings
          </button>
          <button role="menuitem" onClick={() => navigateTo('/billing')} className="site-profile-menu__item">
            Plan & billing
          </button>
          <div className="site-profile-menu__divider" />
          <button
            role="menuitem"
            onClick={() => {
              setIsOpen(false)
              onLogout()
            }}
            className="site-profile-menu__item site-profile-menu__item--danger"
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  )
}
