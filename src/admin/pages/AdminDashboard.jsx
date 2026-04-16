import { ADMIN_SECTIONS, navigateAdmin } from '../config/adminNavigation'

export default function AdminDashboard() {
  return (
    <div className="space-y-6 p-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Admin information architecture</h2>
        <p className="mt-1 text-sm text-slate-600">Use this page as the map of every core admin area and what each area controls.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ADMIN_SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300 hover:bg-indigo-50"
            onClick={() => navigateAdmin(section.href)}
          >
            <p className="text-2xl" aria-hidden="true">{section.icon}</p>
            <p className="mt-2 text-base font-semibold text-slate-900">{section.label}</p>
            <p className="mt-1 text-sm text-slate-600">Open {section.label.toLowerCase()} tools.</p>
          </button>
        ))}
      </section>
    </div>
  )
}
