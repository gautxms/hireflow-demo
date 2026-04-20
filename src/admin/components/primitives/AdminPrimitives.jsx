import AdminDataTable from '../table/AdminDataTable'
import { EmptyState as BaseEmptyState } from '../WidgetState'

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export function Card({ as = 'section', className = '', children, ...props }) {
  const Component = as
  return (
    <Component className={cx('ui-card admin-primitive-card', className)} {...props}>
      {children}
    </Component>
  )
}

export function SectionHeader({ title, subtitle, eyebrow, action, className = '' }) {
  return (
    <header className={cx('admin-section-header', className)}>
      <div>
        {eyebrow ? <p className="admin-section-header__eyebrow type-small">{eyebrow}</p> : null}
        <h2 className="admin-section-header__title type-h3">{title}</h2>
        {subtitle ? <p className="admin-section-header__subtitle type-body">{subtitle}</p> : null}
      </div>
      {action ? <div className="admin-section-header__action">{action}</div> : null}
    </header>
  )
}

export function FormRow({ label, htmlFor, hint, children, className = '' }) {
  return (
    <div className={cx('admin-form-row', className)}>
      {label ? <label htmlFor={htmlFor} className="admin-form-row__label type-body">{label}</label> : null}
      {children}
      {hint ? <p className="admin-form-row__hint type-small">{hint}</p> : null}
    </div>
  )
}

export function Alert({ tone = 'info', children, className = '', role }) {
  const resolvedRole = role || (tone === 'error' || tone === 'warning' ? 'alert' : 'status')
  return (
    <div className={cx('admin-inline-alert', `admin-inline-alert--${tone}`, 'type-body', className)} role={resolvedRole}>
      {children}
    </div>
  )
}

export function EmptyState(props) {
  return <BaseEmptyState {...props} />
}

export function DataTable(props) {
  return <AdminDataTable {...props} />
}
