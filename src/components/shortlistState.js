export function appendShortlist(shortlists, shortlist) {
  return [shortlist, ...shortlists.filter((item) => item.id !== shortlist.id)]
}

export function removeShortlistCandidate(shortlistDetails, resumeId) {
  return {
    ...shortlistDetails,
    candidates: (shortlistDetails?.candidates || []).filter((candidate) => candidate.resume_id !== resumeId),
  }
}
