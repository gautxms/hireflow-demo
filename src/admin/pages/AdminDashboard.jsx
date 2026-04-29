import { ADMIN_SECTIONS, navigateAdmin } from '../config/adminNavigation'
import { Icon } from '../../components/Icon'

export default function AdminDashboard() {
  return (
    <div className="admin-page">
      <section className="ui-card ui-card--card-spacing admin-overview-intro">
        <h2 className="admin-section-title">Admin information architecture</h2>
        <p className="admin-page__subtitle">Use this page as the map of every core admin area and what each area controls.</p>
      </section>

      <section className="admin-overview-grid" aria-label="Admin sections">
        {ADMIN_SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className="ui-card ui-card--card-spacing admin-overview-tile"
            onClick={() => navigateAdmin(section.href)}
          >
            <span className="admin-overview-tile__icon" aria-hidden="true">
              <Icon name={section.icon} size="lg" tone="accent" />
            </span>
            <span className="admin-overview-tile__label">{section.label}</span>
            <span className="admin-overview-tile__hint">Open {section.label.toLowerCase()} tools.</span>
          </button>
        ))}
      </section>
    </div>
  )
}
