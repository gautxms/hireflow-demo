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
  const { loading, retrying, error, upload, retriedAt, retryParsing, reload } = useAdminUploadDetails(uploadId)

  if (loading) return <div className="p-6 text-sm text-slate-600">Loading upload details…</div>
  if (!upload) return <div className="p-6">{error ? <StateAlert state={error} onRetry={() => void reload()} /> : <EmptyState title="Upload not found" description="This upload may have been removed or is unavailable." />}</div>

  return (
    <div className="space-y-4 p-6">
      {error ? <StateAlert state={error} onRetry={() => void reload()} /> : null}
      <UploadPreview
        upload={upload}
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
