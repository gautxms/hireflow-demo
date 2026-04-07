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

export default function UploadPreview({ upload, retriedAt, onRetry, retrying }) {
  if (!upload) return null

  const downloadParseResult = () => {
    const data = JSON.stringify(upload.parseResult || {}, null, 2)
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${upload.filename || 'parse-result'}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Upload Details</h1>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/admin/uploads/${upload.id}/raw-text`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Raw Text
          </a>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={downloadParseResult}
          >
            Download Parse Result
          </button>
          <button
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry Parsing'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <InfoTile label="Filename" value={upload.filename} />
        <InfoTile label="User" value={upload.userEmail || `User #${upload.userId}`} />
        <InfoTile label="Uploaded" value={date(upload.createdAt)} />
        <InfoTile label="File size" value={bytes(upload.fileSize)} />
        <InfoTile label="File format" value={upload.format || upload.fileType} />
        <InfoTile label="Last retried" value={date(retriedAt)} />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Parse status</p>
          <p className="mt-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(upload.parseStatus)}`}>
              {upload.parseStatus}
            </span>
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-medium text-slate-900">Parse Result</h2>
          <pre className="mt-3 max-h-80 overflow-auto rounded border border-slate-100 bg-slate-50 p-3 text-xs text-slate-800">
            {JSON.stringify(upload.parseResult || {}, null, 2)}
          </pre>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-medium text-slate-900">Errors</h2>
          <div className="mt-3 rounded border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
            {upload.parseError || 'No parse errors.'}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-medium text-slate-900">Extracted Text Preview</h2>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
          {upload.rawText || 'No extracted text available.'}
        </pre>
      </section>
    </div>
  )
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value || '—'}</p>
    </div>
  )
}
