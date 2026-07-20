export function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').trim()).filter(Boolean))]
}

export function applyTagOperation(existingTags, incomingTags, operation) {
  const current = normalizeTags(existingTags)
  const incoming = normalizeTags(incomingTags)

  if (operation === 'replace') {
    return incoming
  }

  if (operation === 'remove') {
    const removeSet = new Set(incoming)
    return current.filter((tag) => !removeSet.has(tag))
  }

  return normalizeTags([...current, ...incoming])
}

export function mapCandidateTagRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      resumeId: String(row?.resume_id ?? row?.resumeId ?? '').trim(),
      tags: normalizeTags(row?.tags).sort((a, b) => a.localeCompare(b)),
    }))
    .filter((row) => row.resumeId)
}
