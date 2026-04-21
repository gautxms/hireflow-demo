import { useEffect } from 'react'
import useAdminAuth from '../hooks/useAdminAuth'
import { redirectToAdminLogin } from '../utils/adminErrorState'

export default function AdminRouteGuard({ children }) {
  const { isAdminAuthenticated, authCheckStatus, verifyAuth } = useAdminAuth()

  useEffect(() => {
    if (authCheckStatus === 'idle') {
      void verifyAuth()
    }
  }, [authCheckStatus, verifyAuth])

  useEffect(() => {
    if (authCheckStatus === 'unauthenticated') {
      redirectToAdminLogin({ reason: 'invalid_session', message: 'Please sign in to continue.' })
    }
  }, [authCheckStatus])

  if (authCheckStatus === 'checking' || authCheckStatus === 'idle') {
    return <main className="admin-page">Checking admin session…</main>
  }

  if (!isAdminAuthenticated) {
    return null
  }

  return children
}
