import { navigateAdmin } from '../config/adminNavigation'

export default function AdminSecurityPage() {
  return (
    <div className="admin-page">
      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-slate-900">Session controls</h2>
        <p className="mt-1 text-sm text-slate-600">Manage admin authentication settings and quickly access the sign-in controls.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="ui-btn" onClick={() => navigateAdmin('/admin/login')}>
            Open admin sign-in
          </button>
          <button type="button" className="ui-btn" onClick={() => navigateAdmin('/admin/setup-2fa')}>
            Open 2FA setup wizard
          </button>
        </div>
      </section>

      <section className="ui-card p-4">
        <h2 className="text-lg font-semibold text-slate-900">Security checklist</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Require 2FA for every admin account.</li>
          <li>Rotate backup codes and store them offline.</li>
          <li>Review suspicious access weekly in Logs.</li>
          <li>Revoke old sessions after staffing changes.</li>
        </ul>
      </section>
    </div>
  )
}
