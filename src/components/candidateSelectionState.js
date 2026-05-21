function resolveSelectionKey(candidate, keyResolver) {
  return keyResolver(candidate)
}

function toSelectionSet(selectedIds) {
  const selectedSet = new Set(selectedIds)
  return selectedSet
}

const defaultKeyResolver = (candidate) => candidate?._bulkKey

export function getSelectedCandidates(candidates, selectedIds, keyResolver = defaultKeyResolver) {
  const selectedSet = toSelectionSet(selectedIds)
  return candidates.filter((candidate) => selectedSet.has(resolveSelectionKey(candidate, keyResolver)))
}

export function computeAllVisibleSelected(visibleCandidates, selectedIds, keyResolver = defaultKeyResolver) {
  if (!visibleCandidates.length) {
    return false
  }

  const selectedSet = toSelectionSet(selectedIds)
  return visibleCandidates.every((candidate) => selectedSet.has(resolveSelectionKey(candidate, keyResolver)))
}

export function toggleSelection(selectedIds, candidateKey) {
  return selectedIds.includes(candidateKey)
    ? selectedIds.filter((id) => id !== candidateKey)
    : [...selectedIds, candidateKey]
}

export function toggleSelectAllVisible(selectedIds, visibleCandidates, keyResolver = defaultKeyResolver) {
  const visibleKeys = visibleCandidates.map((candidate) => resolveSelectionKey(candidate, keyResolver)).filter(Boolean)
  const visibleSet = new Set(visibleKeys)
  const selectedSet = new Set(selectedIds)
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedSet.has(key))

  if (allVisibleSelected) {
    return selectedIds.filter((id) => !visibleSet.has(id))
  }

  return [...new Set([...selectedIds, ...visibleKeys])]
}

export function pruneSelection(selectedIds, allowedCandidates, keyResolver = defaultKeyResolver) {
  const allowedKeys = new Set(allowedCandidates.map((candidate) => resolveSelectionKey(candidate, keyResolver)).filter(Boolean))
  return selectedIds.filter((id) => allowedKeys.has(id))
}
