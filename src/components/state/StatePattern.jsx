const ICONS = {
  loading: '⏳',
  empty: '📭',
  error: '⚠️',
  success: '✓',
  info: 'ℹ️',
}

export default function StatePattern({
  kind = 'info',
  title,
  description,
  action = null,
  secondaryAction = null,
  illustration = null,
  compact = false,
  className = '',
}) {
  const classes = ['state-pattern', `state-pattern--${kind}`, compact ? 'state-pattern--compact' : '', className].filter(Boolean).join(' ')
  const visual = illustration ?? ICONS[kind] ?? ICONS.info

  return (
    <section className={classes} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="state-pattern__visual" aria-hidden>{visual}</div>
      <div className="state-pattern__content">
        <h2 className="state-pattern__title">{title}</h2>
        {description ? <p className="state-pattern__description">{description}</p> : null}
        {(action || secondaryAction) ? (
          <div className="state-pattern__actions">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </section>
  )
}
