import { ADMIN_SECTIONS, navigateAdmin } from '../config/adminNavigation'
import { Icon } from '../../components/Icon'

export default function AdminDashboard() {
  return (
    <div className="admin-page">
      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold">Admin information architecture</h2>
        <p className="mt-1 text-sm">Use this page as the map of every core admin area and what each area controls.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ADMIN_SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className="ui-card p-4 text-left"
            onClick={() => navigateAdmin(section.href)}
          >
            <Icon name={section.icon} size="lg" tone="accent" />
            <p className="mt-2 text-base font-semibold">{section.label}</p>
            <p className="mt-1 text-sm">Open {section.label.toLowerCase()} tools.</p>
          </button>
        ))}
      </section>
    </div>
  )
}
