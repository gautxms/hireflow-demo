import { formatResumeQuotaResetDate, getResumeAllowanceTone } from '../utils/resumeAnalysisQuota.js'

export default function ResumeAllowanceCard({ status, quota }) {
  if (status === 'loading') {
    return <article className="resume-allowance resume-allowance--loading" aria-busy="true"><h2>Resume allowance</h2><p>Loading allowance…</p></article>
  }
  if (status !== 'success' || !quota) {
    return <article className="resume-allowance resume-allowance--unavailable"><h2>Resume allowance</h2><p>Allowance temporarily unavailable.</p></article>
  }

  const tone = getResumeAllowanceTone(quota)
  const resetDate = formatResumeQuotaResetDate(quota.periodEnd)
  const progress = Math.max(0, Math.min(quota.percentageUsed, 100))
  const detail = tone === 'unavailable'
    ? 'An active subscription is required to analyze new resumes. Existing analyses and results remain available.'
    : tone === 'reached'
      ? 'The resume-analysis limit has been reached. Existing analyses and results remain available.'
      : tone === 'warning'
      ? `Only ${quota.available} resume ${quota.available === 1 ? 'analysis is' : 'analyses are'} currently available.`
      : tone === 'info'
        ? `You have ${quota.available} resume analyses available this period.`
        : ''

  return (
    <article className={`resume-allowance resume-allowance--${tone}`} aria-labelledby="resume-allowance-title">
      <div className="resume-allowance__header">
        <div><h2 id="resume-allowance-title">Resume allowance</h2><p className="resume-allowance__value">{quota.available} of {quota.limit} available</p></div>
        {resetDate ? <p className="resume-allowance__reset">Resets on {resetDate}</p> : null}
      </div>
      <div className="resume-allowance__track" role="progressbar" aria-label={`${quota.used} of ${quota.limit} resume analyses used; ${quota.available} currently available`} aria-valuemin="0" aria-valuemax={quota.limit} aria-valuenow={Math.min(quota.used, quota.limit)}>
        <span className="resume-allowance__fill" style={{ width: `${progress}%` }} />
      </div>
      {detail ? <p className="resume-allowance__detail">{detail}{resetDate && tone === 'warning' ? ` Resets on ${resetDate}.` : ''}</p> : null}
    </article>
  )
}
