import { resolveCandidateResumeMetadata, toDisplayText } from './candidateResultsState.js'

const MIME_LABELS = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'text/plain': 'TXT',
}

function resolveRawFileType(candidate) {
  return toDisplayText(
    candidate?.file_type ?? candidate?.fileType ?? candidate?.mime_type ?? candidate?.mimeType,
    '',
  ).trim().toLowerCase()
}

function resolveFilenameForType(candidate) {
  const metadataFilename = resolveCandidateResumeMetadata(candidate).resumeFilename
  const fallbackFilename =
    candidate?.sourceFilename
    ?? candidate?.originalFilename
    ?? candidate?.original_filename
    ?? candidate?.resume_filename
    ?? candidate?.filename

  return toDisplayText(metadataFilename || fallbackFilename, '').trim()
}

export function resolveResumeFileTypeLabel(candidate) {
  const rawType = resolveRawFileType(candidate)
  if (rawType) {
    return MIME_LABELS[rawType] || rawType.toUpperCase()
  }

  const extension = resolveFilenameForType(candidate).split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'PDF'
  if (extension === 'docx') return 'DOCX'
  if (extension === 'doc') return 'DOC'
  if (extension === 'txt') return 'TXT'

  return 'FILE'
}
