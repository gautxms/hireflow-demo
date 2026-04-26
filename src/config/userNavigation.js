export const USER_SECTION_NAVIGATION = [
  {
    key: 'results',
    label: 'Results',
    href: '/results',
    aliases: ['/results', '/account/results'],
    requiresAuth: true,
  },
  {
    key: 'jobDescriptions',
    label: 'Job descriptions',
    href: '/job-descriptions',
    aliases: ['/job-descriptions', '/account/job-descriptions'],
    requiresAuth: true,
    requiresActiveSubscription: true,
  },
  {
    key: 'billing',
    label: 'Billing',
    href: '/billing',
    aliases: ['/billing', '/account/billing'],
    requiresAuth: true,
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    aliases: ['/settings', '/account/settings'],
    requiresAuth: true,
  },
]

export const USER_SECTION_ALIASES = USER_SECTION_NAVIGATION.reduce((aliases, section) => {
  section.aliases.forEach((aliasPath) => {
    aliases[aliasPath] = section.href
  })

  return aliases
}, {})

export function resolveUserSectionPath(pathname) {
  return USER_SECTION_ALIASES[pathname] || pathname
}
