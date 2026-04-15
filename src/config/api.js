// Determine API base URL based on environment
const API_BASE = (() => {
  const configuredApiBase = import.meta.env.VITE_API_BASE_URL
  if (configuredApiBase) {
    return configuredApiBase
  }

  if (typeof window === 'undefined') {
    // SSR context (not applicable here, but good practice)
    return 'http://localhost:4000/api'
  }

  const hostname = window.location.hostname

  // Production: use api.hireflow.dev
  if (hostname === 'hireflow.dev' || hostname === 'www.hireflow.dev') {
    return 'https://api.hireflow.dev/api'
  }

  // Development: use localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000/api'
  }

  // Fallback for preview/staging and other unknown hosts.
  // Use same-origin /api path so platform rewrites (e.g. Vercel) are respected.
  return '/api'
})()

export default API_BASE
