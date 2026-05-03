import { CircleAlert, CircleCheckBig } from 'lucide-react'

const STATUS_ICON = {
  success: CircleCheckBig,
  warning: CircleAlert,
}

export default function BillingStatusLayout({
  status = 'success',
  title,
  subtitle,
  details,
  actions,
  footer,
}) {
  const Icon = STATUS_ICON[status] || CircleCheckBig

  return (
    <main className="billing-shell billing-shell--centered">
      <section className={`billing-shell__card billing-shell__status-card billing-shell__status-card--${status}`}>
        <div className={`billing-shell__status-icon billing-shell__status-icon--${status}`}>
          <Icon size={18} strokeWidth={1.5} />
        </div>

        <h1 className="billing-shell__title billing-shell__status-title">{title}</h1>
        <p className="billing-shell__subtitle billing-shell__status-subtitle">{subtitle}</p>

        {details ? <div className="billing-shell__summary">{details}</div> : null}

        {footer ? <p className="billing-shell__countdown">{footer}</p> : null}

        {actions ? <div className="billing-shell__actions billing-shell__status-actions">{actions}</div> : null}
      </section>
    </main>
  )
}
