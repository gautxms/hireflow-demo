// Determine API base URL based on environment
const API_BASE = (() => {
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

  // Fallback for preview/staging
  return 'https://api.hireflow.dev/api'
})()

export default API_BASE
