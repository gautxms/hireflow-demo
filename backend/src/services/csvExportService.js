function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const normalized = String(value)
  const escaped = normalized.replaceAll('"', '""')

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`
  }

  return escaped
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.join('; ')
  }

  return value || ''
}

export function buildCandidatesCsv(candidates = []) {
  const headers = ['name', 'email', 'score', 'summary', 'skills', 'strengths']
  const rows = candidates.map((candidate) => [
    candidate.name || '',
    candidate.email || '',
    Number(candidate.score || 0),
    candidate.summary || '',
    normalizeList(candidate.skills),
    normalizeList(candidate.strengths || candidate.pros),
  ])

  const csvLines = [headers, ...rows].map((row) => row.map(escapeCsvValue).join(','))
  return csvLines.join('\n')
}
