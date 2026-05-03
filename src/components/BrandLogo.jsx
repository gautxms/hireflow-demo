export default function BrandLogo({
  as: Component = 'a',
  href = '/',
  onClick,
  className = '',
  ...rest
}) {
  const classes = ['brand-logo', className].filter(Boolean).join(' ')

  return (
    <Component href={href} onClick={onClick} className={classes} {...rest}>
      Hire<span>Flow</span>
    </Component>
  )
}
