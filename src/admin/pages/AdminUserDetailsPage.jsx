import { useEffect, useMemo, useState } from 'react'
import BlockUserModal from '../components/BlockUserModal'
import UserModal from '../components/UserModal'
import useAdminUsers from '../hooks/useAdminUsers'

function getPathUserId() {
  const segments = window.location.pathname.split('/').filter(Boolean)
  return segments[segments.length - 1]
}

export default function AdminUserDetailsPage({ userId: userIdProp }) {
  const {
    loadUsers,
    getUserById,
    updateProfile,
    blockUser,
    unblockUser,
    resetPassword,
    impersonateUser,
    deleteUser,
    loading,
    error,
  } = useAdminUsers()

  const [blockOpen, setBlockOpen] = useState(false)
  const userId = useMemo(() => userIdProp || getPathUserId(), [userIdProp])
  const user = getUserById(userId)

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading user…</div>
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>
  if (!user) return <div className="p-6 text-sm text-slate-600">User not found.</div>

  return (
    <>
      <UserModal
        key={user.id}
        user={user}
        onClose={() => {
          window.history.pushState({}, '', '/admin/users')
          window.dispatchEvent(new PopStateEvent('popstate'))
        }}
        onSave={(updates) => updateProfile(user.id, updates)}
        onBlock={() => setBlockOpen(true)}
        onUnblock={() => unblockUser(user.id)}
        onResetPassword={() => resetPassword(user.id)}
        onImpersonate={() => impersonateUser(user.id)}
        onDelete={() => deleteUser(user.id)}
      />

      <BlockUserModal
        isOpen={blockOpen}
        user={user}
        onClose={() => setBlockOpen(false)}
        onConfirm={async (reason) => {
          await blockUser(user.id, reason)
          setBlockOpen(false)
        }}
      />
    </>
  )
}
