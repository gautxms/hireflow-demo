// The API stores match scores on a 0–100 scale; results cards display 0–10.
export function formatDashboardMatchScore(value) {
  if (value === null || value === undefined || value === '') return '—'
  const score = Number(value)
  return Number.isFinite(score) ? (score / 10).toFixed(1) : '—'
}
