import {
  BarChart3,
  BookText,
  CreditCard,
  FileText,
  FlaskConical,
  HeartPulse,
  Home,
  Leaf,
  Link,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Microscope,
  Phone,
  Rocket,
  Settings,
  ShieldCheck,
  Target,
  Upload,
  Users,
} from 'lucide-react'

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

const ICON_COMPONENTS = {
  home: Home,
  users: Users,
  creditCard: CreditCard,
  upload: Upload,
  chart: BarChart3,
  logs: BookText,
  health: HeartPulse,
  lock: Lock,
  menu: Menu,
  mail: Mail,
  phone: Phone,
  mapPin: MapPin,
  chat: MessageCircle,
  rocket: Rocket,
  file: FileText,
  settings: Settings,
  link: Link,
  target: Target,
  microscope: Microscope,
  shield: ShieldCheck,
  sprout: Leaf,
  flask: FlaskConical,
}

export function Icon({
  name,
  size = 'md',
  stroke = 'regular',
  tone = 'current',
  label,
  className = '',
}) {
  const IconComponent = ICON_COMPONENTS[name]

  if (!IconComponent) {
    return null
  }

  const ariaProps = label ? { 'aria-label': label } : { 'aria-hidden': true }
  const sizeClassName = ICON_SIZE_CLASSNAMES[size] || ICON_SIZE_CLASSNAMES.md
  const strokeClassName = ICON_STROKE_CLASSNAMES[stroke] || ICON_STROKE_CLASSNAMES.regular
  const toneClassName = ICON_TONE_CLASSNAMES[tone] || ICON_TONE_CLASSNAMES.current

  return (
    <span className={`hf-icon ${sizeClassName} ${strokeClassName} ${toneClassName} ${className}`.trim()}>
      <IconComponent
        {...ariaProps}
        size={18}
        strokeWidth={1.5}
      />
    </span>
  )
}

export const ICON_NAMES = new Set(Object.keys(ICON_COMPONENTS))
