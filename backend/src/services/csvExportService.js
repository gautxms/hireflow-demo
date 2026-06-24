const SPREADSHEET_FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

function shouldNeutralizeSpreadsheetFormula(value) {
  if (typeof value !== 'string') {
    return false
  }

  const firstCharacter = value.charAt(0)
  const firstNonWhitespaceCharacter = value.trimStart().charAt(0)

  return (
    SPREADSHEET_FORMULA_PREFIXES.has(firstCharacter)
    || SPREADSHEET_FORMULA_PREFIXES.has(firstNonWhitespaceCharacter)
  )
}

function neutralizeSpreadsheetFormula(value) {
  if (shouldNeutralizeSpreadsheetFormula(value)) {
    return `'${value}`
  }

  return value
}

export function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return ''
  }

  const normalized = neutralizeSpreadsheetFormula(typeof value === 'string' ? value : String(value))
  const escaped = normalized.replaceAll('"', '""')

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`
  }

  return escaped
}

const STRUCTURED_LIST_KEYS = [
  'tools_and_platforms',
  'methodologies',
  'domain_expertise',
  'soft_skills',
]

function normalizeListItems(value) {
  return value
    .map((item) => {
      if (item === null || item === undefined) {
        return ''
      }

      if (typeof item === 'object') {
        return ''
      }

      return String(item).trim()
    })
    .filter(Boolean)
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return normalizeListItems(value).join('; ')
  }

  if (value && typeof value === 'object') {
    return STRUCTURED_LIST_KEYS
      .flatMap((key) => (Array.isArray(value[key]) ? normalizeListItems(value[key]) : []))
      .join('; ')
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
