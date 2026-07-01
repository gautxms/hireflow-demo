export default function BrandLogo({
  // Component is consumed as the JSX tag below; ESLint's base no-unused-vars does not mark that pattern as a read.
  // eslint-disable-next-line no-unused-vars
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
