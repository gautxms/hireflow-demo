import { useCallback, useEffect, useMemo, useState } from 'react'

function statusStyles(status) {
  if (status === 'complete') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200'
  if (status === 'processing') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function bytes(value) {
  const size = Number(value || 0)
  if (size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function date(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function inferUploadIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

export default function AdminUploadDetailsPage({ uploadId: uploadIdProp }) {
  const uploadId = useMemo(() => uploadIdProp || inferUploadIdFromPath(), [uploadIdProp])
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const [upload, setUpload] = useState(null)
  const [retriedAt, setRetriedAt] = useState(null)

  const loadUpload = useCallback(async () => {
    if (!uploadId) {
      setError('Missing upload id')
      return
    }

    try {
      setLoading(true)
      setError('')

      const response = await fetch(`/api/admin/uploads/${uploadId}`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to load upload details')

      const payload = await response.json()
      setUpload(payload.upload || null)
      setRetriedAt(payload.retriedAt || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [uploadId])

  useEffect(() => {
    void loadUpload()
  }, [loadUpload])

  const retryParsing = async () => {
    if (!uploadId) return

    try {
      setRetrying(true)
      setError('')

      const response = await fetch(`/api/admin/uploads/${uploadId}/retry`, {
        method: 'POST',
        credentials: 'include',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Retry failed')
      }

      window.alert(payload.message || 'Retry complete')
      await loadUpload()
    } catch (err) {
      setError(err.message)
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-600">Loading upload details…</div>
  }

  if (!upload) {
    return <div className="p-6 text-sm text-rose-600">{error || 'Upload not found.'}</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Upload Details</h1>
          <p className="mt-1 text-sm text-slate-500">ID: {upload.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/admin/uploads/${upload.id}/raw-text`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Raw Text
          </a>
          <button
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => retryParsing()}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry Parsing'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Filename</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{upload.filename}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">User</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{upload.userEmail || `User #${upload.userId}`}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Uploaded</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{date(upload.createdAt)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">File size</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{bytes(upload.fileSize)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Parse status</p>
          <p className="mt-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(upload.parseStatus)}`}>
              {upload.parseStatus}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Last retried</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{date(retriedAt)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-medium text-slate-900">Parse Result (JSON)</h2>
          <pre className="mt-3 max-h-72 overflow-auto rounded border border-slate-100 bg-slate-50 p-3 text-xs text-slate-800">
            {JSON.stringify(upload.parseResult || {}, null, 2)}
          </pre>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-medium text-slate-900">Errors</h2>
          <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
            {upload.parseError || 'No parse errors.'}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Extracted Text Preview</h2>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
          {upload.rawText || 'No extracted text available.'}
        </pre>
      </div>
    </div>
  )
}
