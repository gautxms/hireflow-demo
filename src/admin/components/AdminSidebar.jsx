import { useEffect, useState } from 'react'
import { ADMIN_SECTIONS } from '../config/adminNavigation'
import { Icon } from '../../components/Icon'

const SECTIONS = ADMIN_SECTIONS

export default function AdminSidebar({ activeSection, onNavigate, mobileOpen, onClose }) {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth <= 960
  })

  useEffect(() => {
    const handleResize = () => {
      setIsMobileViewport(window.innerWidth <= 960)
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const shouldRenderOverlay = isMobileViewport && mobileOpen

  return (
    <>
      {shouldRenderOverlay ? (
        <button
          type="button"
          className="admin-sidebar-overlay admin-sidebar-overlay--visible"
          aria-hidden={false}
          tabIndex={0}
          onClick={onClose}
        />
      ) : null}

      <aside className={`admin-sidebar ${mobileOpen ? 'admin-sidebar--open' : ''}`}>
        <div className="admin-sidebar__brand">HireFlow Admin</div>

        <nav aria-label="Admin sections">
          <ul className="admin-sidebar__nav">
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.key
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(section.key)
                      onClose()
                    }}
                    className={`admin-sidebar__item ${isActive ? 'admin-sidebar__item--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="admin-sidebar__icon"><Icon name={section.icon} size="sm" tone="current" /></span>
                    <span>{section.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}

export { SECTIONS }
