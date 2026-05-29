export function getAppHeaderInitials(user = null) {
  const name = typeof user?.name === 'string' ? user.name.trim() : ''

  if (name) {
    const initials = name
      .split(/\s+/)
      .map((part) => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase()

    if (initials) {
      return initials
    }
  }

  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  const emailInitial = email[0]?.toUpperCase()

  return emailInitial || 'U'
}
