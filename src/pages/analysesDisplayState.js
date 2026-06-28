import { buildResumeFileIdentity } from '../utils/resumeFileIdentity.js'

export function normalizeStatus(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  const STATUS_ALIAS_MAP = {
    queued: 'pending',
    retrying: 'processing',
  }
  return STATUS_ALIAS_MAP[normalizedStatus] || normalizedStatus
}

export function deriveDisplayStatus(analysis) {
  const summary = analysis?.summary || {}
  const total = Number(summary.total || 0)
  const complete = Number(summary.complete || 0)
  const failed = Number(summary.failed || 0)
  const processing = Number(summary.processing || 0)
  const pending = Number(summary.pending || 0)

  if (total > 0 && complete === total && failed === 0) return 'complete'
  if (total > 0 && failed === total) return 'failed'
  if (total > 0 && complete > 0 && failed > 0 && pending === 0 && processing === 0) return 'partial'
  if (processing > 0) return 'processing'
  if (total > 0 && pending > 0 && complete + failed < total) return 'processing'

  return normalizeStatus(analysis?.liveStatus || analysis?.status)
}

function isTerminalAnalysis(analysis) {
  const status = deriveDisplayStatus(analysis)
  return status === 'complete' || status === 'completed' || status === 'failed' || status === 'partial'
}

function mergeExpectedFiles(serverFiles, expectedFiles) {
  const merged = Array.isArray(serverFiles) ? [...serverFiles] : []
  const seen = new Set(merged.map((file) => String(buildResumeFileIdentity(file).filename || file?.name || '').trim()).filter(Boolean))
  expectedFiles.forEach((file) => {
    const filename = String(file.filename || file.name || '').trim()
    if (filename && !seen.has(filename)) {
      merged.push(file)
      seen.add(filename)
    }
  })
  return merged
}

export function mergeInFlightAnalysis(analysis, overlay) {
  if (!overlay || isTerminalAnalysis(analysis)) return analysis

  const expectedFileCount = Number(overlay.expectedFileCount || 0)
  const serverSummary = analysis?.summary || {}
  const serverFileCount = Number(analysis?.fileCount ?? serverSummary.total ?? 0)
  const complete = Number(serverSummary.complete || 0)
  const failed = Number(serverSummary.failed || 0)
  const unresolved = Math.max(expectedFileCount - complete - failed, 0)
  const total = Math.max(Number(serverSummary.total || 0), serverFileCount, expectedFileCount)
  const processing = Math.max(Number(serverSummary.processing || 0), unresolved)
  const pending = Math.max(Number(serverSummary.pending || 0), total - complete - failed - processing, 0)
  const files = mergeExpectedFiles(analysis?.files, overlay.expectedFiles || [])
  const filesPreview = mergeExpectedFiles(analysis?.filesPreview, overlay.expectedFiles || [])

  return {
    ...analysis,
    name: analysis?.name || overlay.name,
    createdAt: analysis?.createdAt || overlay.createdAt,
    jobDescriptionId: analysis?.jobDescriptionId || overlay.jobDescriptionId,
    liveStatus: 'processing',
    status: normalizeStatus(analysis?.status) === 'pending' ? 'processing' : analysis?.status,
    fileCount: Math.max(serverFileCount, expectedFileCount),
    summary: {
      ...serverSummary,
      total,
      complete,
      failed,
      processing,
      pending,
    },
    files,
    filesPreview,
  }
}

export function mergeInFlightAnalyses(serverItems, overlaysById) {
  const overlays = overlaysById || {}
  const merged = (Array.isArray(serverItems) ? serverItems : []).map((analysis) => mergeInFlightAnalysis(analysis, overlays[String(analysis.id)]))
  const existingIds = new Set(merged.map((analysis) => String(analysis.id)))

  Object.values(overlays).forEach((overlay) => {
    if (!overlay?.analysisId || existingIds.has(String(overlay.analysisId))) return
    merged.push(mergeInFlightAnalysis({
      id: overlay.analysisId,
      name: overlay.name,
      createdAt: overlay.createdAt,
      jobDescriptionId: overlay.jobDescriptionId,
      status: 'processing',
      liveStatus: 'processing',
      fileCount: 0,
      summary: { total: 0, complete: 0, failed: 0, processing: 0, pending: 0 },
      files: [],
      filesPreview: [],
    }, overlay))
  })

  return merged
}
