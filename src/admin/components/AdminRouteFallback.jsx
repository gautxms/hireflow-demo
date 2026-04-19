import { navigateAdmin } from '../config/adminNavigation'

export default function AdminRouteFallback({ title = 'Section unavailable', description, ctaLabel = 'Go to overview', ctaHref = '/admin/overview' }) {
  return (
    <div className="admin-page">
      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <button
          type="button"
          className="ui-btn mt-4"
          onClick={() => navigateAdmin(ctaHref)}
        >
          {ctaLabel}
        </button>
      </section>
    </div>
  )
}
