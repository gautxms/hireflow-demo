const ICON_SIZE_CLASSNAMES = {
  xs: 'hf-icon--size-xs',
  sm: 'hf-icon--size-sm',
  md: 'hf-icon--size-md',
  lg: 'hf-icon--size-lg',
  xl: 'hf-icon--size-xl',
}

const ICON_STROKE_CLASSNAMES = {
  thin: 'hf-icon--stroke-thin',
  regular: 'hf-icon--stroke-regular',
  bold: 'hf-icon--stroke-bold',
}

const ICON_TONE_CLASSNAMES = {
  default: 'hf-icon--tone-default',
  muted: 'hf-icon--tone-muted',
  accent: 'hf-icon--tone-accent',
  info: 'hf-icon--tone-info',
  success: 'hf-icon--tone-success',
  warning: 'hf-icon--tone-warning',
  danger: 'hf-icon--tone-danger',
  current: 'hf-icon--tone-current',
}

const ICON_PATHS = {
  home: <path d="M3 10.5L12 3l9 7.5M5.25 9.5V21h13.5V9.5" />,
  users: (
    <>
      <path d="M16.5 20v-1.5a3.75 3.75 0 0 0-3.75-3.75H7.5A3.75 3.75 0 0 0 3.75 18.5V20" />
      <path d="M10.125 11.25a3.375 3.375 0 1 0 0-6.75 3.375 3.375 0 0 0 0 6.75Z" />
      <path d="M20.25 20v-1.5a3.75 3.75 0 0 0-2.625-3.57" />
      <path d="M15.75 4.68a3.375 3.375 0 0 1 0 6.57" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.75" y="5.5" width="18.5" height="13" rx="2.5" />
      <path d="M2.75 10h18.5M7 14.5h3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V7" />
      <path d="m8.25 10.75 3.75-3.75 3.75 3.75" />
      <path d="M4 16.5v1a2.5 2.5 0 0 0 2.5 2.5h11a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </>
  ),
  chart: (
    <>
      <path d="M4.5 18.5h15" />
      <path d="M7.5 16v-3.5" />
      <path d="M12 16v-8" />
      <path d="M16.5 16v-6" />
    </>
  ),
  logs: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </>
  ),
  health: (
    <>
      <path d="M12 20.5s-6.75-4.3-6.75-10.05A4.2 4.2 0 0 1 9.5 6.25c1.1 0 2.15.45 2.5 1.25.35-.8 1.4-1.25 2.5-1.25a4.2 4.2 0 0 1 4.25 4.2C18.75 16.2 12 20.5 12 20.5Z" />
      <path d="M8.5 12h2.3l1.05-2.2L13.8 14l1-2h1.7" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <circle cx="12" cy="15" r="1" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  phone: <path d="M7 4.5h2.5l1.3 3.2-1.5 1.2a14.4 14.4 0 0 0 5.8 5.8l1.2-1.5 3.2 1.3V17a2 2 0 0 1-2.2 2C9.9 18.4 5.6 14.1 5 8.2A2 2 0 0 1 7 6Z" />,
  mapPin: (
    <>
      <path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  chat: (
    <>
      <path d="M5.5 18.5 6 15.5A7 7 0 1 1 19 11a7 7 0 0 1-11 5.8Z" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c4 1 6 3 7 7-2.2.7-4.7.5-7-1.8C9.7 10.5 9.4 13 10 15c-4-1-6-3-7-7 2.2-.7 4.7-.5 7 1.8C12.3 7.5 12.6 5 12 3Z" />
      <circle cx="12" cy="10" r="1.5" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.5h7l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
      <path d="M14 3.5V7h3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.3 1.3 0 0 1-1.8 1.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19a1.3 1.3 0 0 1-2.6 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.3 1.3 0 0 1-1.8-1.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H5a1.3 1.3 0 0 1 0-2.6h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.3 1.3 0 1 1 1.8-1.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V5a1.3 1.3 0 0 1 2.6 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.3 1.3 0 1 1 1.8 1.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6h.2a1.3 1.3 0 0 1 0 2.6h-.2a1 1 0 0 0-.9.6Z" />
    </>
  ),
  link: (
    <>
      <path d="M10 14 8.2 15.8a3 3 0 1 1-4.2-4.2L5.8 9.8" />
      <path d="M14 10 15.8 8.2a3 3 0 0 1 4.2 4.2L18.2 14" />
      <path d="M8.5 15.5 15.5 8.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  microscope: (
    <>
      <path d="M10 4h4M12 4v5l2.5 2.5" />
      <path d="M8 20h8M7 16h10" />
      <path d="M14.5 11.5A3.5 3.5 0 0 1 11 15H8.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 18 6v5.2c0 4.1-2.4 7.8-6 9.3-3.6-1.5-6-5.2-6-9.3V6Z" />
      <path d="m9.5 12 1.7 1.8L14.5 10" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 20v-6" />
      <path d="M12 14c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6Z" />
      <path d="M12 14c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6Z" />
    </>
  ),
}

export function Icon({
  name,
  size = 'md',
  stroke = 'regular',
  tone = 'current',
  label,
  className = '',
}) {
  const icon = ICON_PATHS[name]

  if (!icon) {
    return null
  }

  const ariaProps = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  const sizeClassName = ICON_SIZE_CLASSNAMES[size] || ICON_SIZE_CLASSNAMES.md
  const strokeClassName = ICON_STROKE_CLASSNAMES[stroke] || ICON_STROKE_CLASSNAMES.regular
  const toneClassName = ICON_TONE_CLASSNAMES[tone] || ICON_TONE_CLASSNAMES.current

  return (
    <span className={`hf-icon ${sizeClassName} ${strokeClassName} ${toneClassName} ${className}`.trim()}>
      <svg
        {...ariaProps}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g stroke="currentColor" strokeWidth="var(--hf-icon-stroke)" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </g>
      </svg>
    </span>
  )
}

export const ICON_NAMES = new Set(Object.keys(ICON_PATHS))
