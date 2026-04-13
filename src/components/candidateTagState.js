function dedupeTags(tags = []) {
  return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))]
}

export function applyTagOperation(existingTags, incomingTags, operation) {
  const current = dedupeTags(existingTags)
  const incoming = dedupeTags(incomingTags)

  if (operation === 'replace') {
    return incoming
  }

  if (operation === 'remove') {
    const removeSet = new Set(incoming)
    return current.filter((tag) => !removeSet.has(tag))
  }

  return dedupeTags([...current, ...incoming])
}

export function applyOptimisticTagUpdate(tagMap, candidateKeys, tags, operation) {
  const snapshot = { ...tagMap }
  const next = { ...tagMap }

  candidateKeys.forEach((key) => {
    next[key] = applyTagOperation(next[key] || [], tags, operation)
  })

  return { next, rollback: snapshot }
}
