export function getSelectedCandidates(candidates, selectedIds) {
  const selectedSet = new Set(selectedIds)
  return candidates.filter((candidate) => selectedSet.has(candidate._bulkKey))
}

export function computeAllVisibleSelected(visibleCandidates, selectedIds) {
  if (!visibleCandidates.length) {
    return false
  }

  const selectedSet = new Set(selectedIds)
  return visibleCandidates.every((candidate) => selectedSet.has(candidate._bulkKey))
}

export function toggleSelection(selectedIds, candidateKey) {
  return selectedIds.includes(candidateKey)
    ? selectedIds.filter((id) => id !== candidateKey)
    : [...selectedIds, candidateKey]
}

export function toggleSelectAllVisible(selectedIds, visibleCandidates) {
  const visibleKeys = visibleCandidates.map((candidate) => candidate._bulkKey)
  const visibleSet = new Set(visibleKeys)
  const selectedSet = new Set(selectedIds)
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedSet.has(key))

  if (allVisibleSelected) {
    return selectedIds.filter((id) => !visibleSet.has(id))
  }

  return [...new Set([...selectedIds, ...visibleKeys])]
}

export function pruneSelection(selectedIds, allowedCandidates) {
  const allowedKeys = new Set(allowedCandidates.map((candidate) => candidate._bulkKey))
  return selectedIds.filter((id) => allowedKeys.has(id))
}
