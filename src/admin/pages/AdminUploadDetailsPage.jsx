import { useMemo } from 'react'
import UploadPreview from '../components/UploadPreview'
import StateAlert from '../components/StateAlert'
import { EmptyState } from '../components/WidgetState'
import { useAdminUploadDetails } from '../hooks/useAdminUploads'

function inferUploadIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

export default function AdminUploadDetailsPage({ uploadId: uploadIdProp }) {
  const uploadId = useMemo(() => uploadIdProp || inferUploadIdFromPath(), [uploadIdProp])
  const {
    loading,
    retrying,
    error,
    upload,
    tokenUsageHistory,
    tokenUsageSummary,
    retriedAt,
    retryParsing,
    reload,
  } = useAdminUploadDetails(uploadId)

  if (loading) return <div className="admin-page"><div className="text-sm">Loading upload details…</div></div>
  if (!upload) return <div className="admin-page">{error ? <StateAlert state={error} onRetry={() => void reload()} /> : <EmptyState title="Upload not found" description="This upload may have been removed or is unavailable." />}</div>

  return (
    <div className="admin-page">
      {error ? <StateAlert state={error} onRetry={() => void reload()} /> : null}
      <UploadPreview
        upload={upload}
        tokenUsageHistory={tokenUsageHistory}
        tokenUsageSummary={tokenUsageSummary}
        retriedAt={retriedAt}
        retrying={retrying}
        onRetry={async () => {
          const payload = await retryParsing()
          if (payload?.ok) window.alert(payload.message || 'Parsing retry queued.')
        }}
      />
    </div>
  )
}
