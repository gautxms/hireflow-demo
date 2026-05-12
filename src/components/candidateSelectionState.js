function candidateSelectionKey(candidate) {
  return candidate?.resumeId
}

export function getSelectedCandidates(candidates, selectedIds) {
  const selectedSet = new Set(selectedIds)
  return candidates.filter((candidate) => selectedSet.has(candidateSelectionKey(candidate)))
}

export function computeAllVisibleSelected(visibleCandidates, selectedIds) {
  if (!visibleCandidates.length) {
    return false
  }

  const selectedSet = new Set(selectedIds)
  return visibleCandidates.every((candidate) => selectedSet.has(candidateSelectionKey(candidate)))
}

export function toggleSelection(selectedIds, candidateKey) {
  return selectedIds.includes(candidateKey)
    ? selectedIds.filter((id) => id !== candidateKey)
    : [...selectedIds, candidateKey]
}

export function toggleSelectAllVisible(selectedIds, visibleCandidates) {
  const visibleKeys = visibleCandidates.map((candidate) => candidateSelectionKey(candidate)).filter(Boolean)
  const visibleSet = new Set(visibleKeys)
  const selectedSet = new Set(selectedIds)
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedSet.has(key))

  if (allVisibleSelected) {
    return selectedIds.filter((id) => !visibleSet.has(id))
  }

  return [...new Set([...selectedIds, ...visibleKeys])]
}

export function pruneSelection(selectedIds, allowedCandidates) {
  const allowedKeys = new Set(allowedCandidates.map((candidate) => candidateSelectionKey(candidate)).filter(Boolean))
  return selectedIds.filter((id) => allowedKeys.has(id))
}

export function dedupeCandidatesByResumeId(candidates) {
  const seen = new Set()
  const duplicates = new Set()
  const deduped = []

  candidates.forEach((candidate) => {
    const resumeId = candidateSelectionKey(candidate)
    if (!resumeId) return

    if (seen.has(resumeId)) {
      duplicates.add(resumeId)
      return
    }

    seen.add(resumeId)
    deduped.push(candidate)
  })

  return { candidates: deduped, duplicateResumeIds: [...duplicates] }
}
