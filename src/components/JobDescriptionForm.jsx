import { Upload, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import API_BASE from '../config/api'
import { SUPPORTED_SALARY_CURRENCIES, serializeJobDescriptionForm, validateJobDescriptionForm } from './jobDescriptionFormState'

const blankState = {
  title: '',
  status: 'draft',
  workMode: 'onsite',
  location: '',
  experienceMin: '',
  experienceMax: '',
  description: '',
  responsibilities: '',
  requirements: '',
  qualifications: '',
  keyResponsibilities: '',
  skills: '',
  additionalInfo: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'USD',
}

function mapInitialValue(initialValue) {
  if (!initialValue) return blankState
  const fallbackExperience = initialValue.experienceYears ?? ''
  return {
    title: initialValue.title || '',
    status: initialValue.status || 'draft',
    workMode: initialValue.workMode || initialValue.employmentType || 'onsite',
    location: initialValue.location || '',
    experienceMin: initialValue.experienceMin ?? fallbackExperience,
    experienceMax: initialValue.experienceMax ?? fallbackExperience,
    description: initialValue.description || '',
    responsibilities: initialValue.responsibilities || '',
    requirements: initialValue.requirements || '',
    qualifications: initialValue.qualifications || initialValue.requirements || '',
    keyResponsibilities: initialValue.keyResponsibilities || '',
    skills: Array.isArray(initialValue.skills) ? initialValue.skills.join(', ') : '',
    additionalInfo: initialValue.additionalInfo || '',
    salaryMin: initialValue.salaryMin ?? '',
    salaryMax: initialValue.salaryMax ?? '',
    salaryCurrency: initialValue.salaryCurrency || 'USD',
  }
}

const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

export default function JobDescriptionForm({ initialValue, resetToken, onSubmit, onCancel, isSubmitting, readOnly = false }) {
  const [formState, setFormState] = useState(blankState)
  const [jdFile, setJdFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [attachmentError, setAttachmentError] = useState('')
  const fileInputId = useId()
  const fileInputRef = useRef(null)

  const hasExistingAttachment = Boolean(initialValue?.fileUrl)

  useEffect(() => {
    setFormState(mapInitialValue(initialValue))
    setErrors({})
    setAttachmentError('')
    setJdFile(null)
  }, [initialValue, resetToken])

  const handleChange = (field) => (event) => {
    setFormState((prev) => ({ ...prev, [field]: event.target.value }))
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const handleNumberWheel = (event) => {
    if (document.activeElement === event.currentTarget) {
      event.preventDefault()
    }
  }

  const openAttachmentInNewTab = useCallback(async () => {
    if (!initialValue?.id || !hasExistingAttachment) {
      setAttachmentError('No attachment is available for this job description yet.')
      return
    }

    const token = localStorage.getItem(TOKEN_STORAGE_KEY) || ''
    if (!token) {
      setAttachmentError('Please login to view JD attachments.')
      return
    }

    setAttachmentError('')

    try {
      const response = await fetch(`${API_BASE}/job-descriptions/${encodeURIComponent(initialValue.id)}/attachment`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Unable to open job description attachment')
      }

      const fileBlob = await response.blob()
      const objectUrl = window.URL.createObjectURL(fileBlob)
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000)
    } catch (error) {
      setAttachmentError(error.message || 'Unable to open job description attachment')
    }
  }, [hasExistingAttachment, initialValue?.id])
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (readOnly) return
    const nextErrors = validateJobDescriptionForm(formState)
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const serialized = serializeJobDescriptionForm(formState)
    const payload = new FormData()

    Object.entries({ ...serialized, skills: formState.skills }).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      payload.append(key, String(value))
    })

    if (jdFile) {
      payload.append('jdFile', jdFile)
    }

    await onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="job-form" noValidate>
      <div className="job-form__scrollable">
        <section className="job-form__section">
          <h3>Core details</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field" htmlFor="job-title"><span>Job title <em>*</em></span><input id="job-title" required className="job-form__control" placeholder="Senior Backend Engineer" value={formState.title} onChange={handleChange('title')} aria-invalid={Boolean(errors.title)} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-status"><span>Status <em>*</em></span><select id="job-status" className="job-form__control" value={formState.status} onChange={handleChange('status')} disabled={readOnly}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
            <label className="job-form__field" htmlFor="job-work-mode"><span>Work mode</span><select id="job-work-mode" className="job-form__control" value={formState.workMode} onChange={handleChange('workMode')} disabled={readOnly}><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
            <label className="job-form__field" htmlFor="job-location"><span>Location</span><input id="job-location" className="job-form__control" placeholder="San Francisco, CA" value={formState.location} onChange={handleChange('location')} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-experience-min"><span>Experience min (years)</span><input id="job-experience-min" type="number" min="0" className="job-form__control" placeholder="4" value={formState.experienceMin} onChange={handleChange('experienceMin')} onWheel={handleNumberWheel} aria-invalid={Boolean(errors.experienceMin)} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-experience-max"><span>Experience max (years)</span><input id="job-experience-max" type="number" min="0" className="job-form__control" placeholder="6" value={formState.experienceMax} onChange={handleChange('experienceMax')} onWheel={handleNumberWheel} aria-invalid={Boolean(errors.experienceMax)} disabled={readOnly} /></label>
          </div>
          {(errors.title || errors.experienceMin || errors.experienceMax) && <p className="job-form__error" role="alert">{errors.title || errors.experienceMin || errors.experienceMax}</p>}
        </section>

        <section className="job-form__section">
          <h3>Content</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field job-form__field--full" htmlFor="job-description"><span>Full job description</span><textarea id="job-description" className="job-form__control job-form__control--textarea" placeholder="Describe responsibilities, goals, and outcomes for this role." rows={5} value={formState.description} onChange={handleChange('description')} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-responsibilities"><span>Key responsibilities</span><textarea id="job-responsibilities" className="job-form__control job-form__control--textarea" placeholder="List the day-to-day ownership areas." rows={4} value={formState.responsibilities} onChange={handleChange('responsibilities')} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-requirements"><span>Qualifications</span><textarea id="job-requirements" className="job-form__control job-form__control--textarea" placeholder="Required qualifications and domain experience." rows={4} value={formState.requirements} onChange={handleChange('requirements')} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-skills"><span>Skills</span><input id="job-skills" className="job-form__control" placeholder="Node.js, PostgreSQL, AWS" value={formState.skills} onChange={handleChange('skills')} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-additional-info"><span>Additional info</span><input id="job-additional-info" className="job-form__control" placeholder="Team setup, interview loop, visa support, etc." value={formState.additionalInfo} onChange={handleChange('additionalInfo')} disabled={readOnly} /></label>
          </div>
        </section>

        <section className="job-form__section">
          <h3>Attachment</h3>
          <input ref={fileInputRef} id={fileInputId} className="job-form__file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setJdFile(event.target.files?.[0] || null)} disabled={readOnly} />
          <div className="job-form__file-row">
            {!readOnly ? <button type="button" className="hf-btn hf-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}><Upload size={16} strokeWidth={1.5} aria-hidden="true" /> Upload PDF/DOCX</button> : null}
            <span className="job-form__file-name">{jdFile ? jdFile.name : (hasExistingAttachment ? 'Current attachment available' : 'No file selected')}</span>
            <button
              type="button"
              className="hf-btn hf-btn--secondary"
              onClick={openAttachmentInNewTab}
              disabled={isSubmitting || !hasExistingAttachment}
              aria-disabled={isSubmitting || !hasExistingAttachment}
              title={hasExistingAttachment ? 'Open current JD attachment in a new tab' : 'No attachment available yet'}
            >
              View attachment
            </button>
            {!readOnly && jdFile ? <button type="button" className="job-form__file-clear" aria-label="Clear selected JD file" onClick={() => setJdFile(null)}><X size={14} strokeWidth={1.5} aria-hidden="true" /></button> : null}
          </div>
          <p className="job-form__help">Accepted formats: PDF or DOCX.</p>
          {attachmentError ? <p className="job-form__error" role="alert">{attachmentError}</p> : null}
        </section>
      </div>

      <div className="job-form__footer">
        {readOnly ? (
          <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel}>Close</button>
        ) : (
          <>
            <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
            <button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : (initialValue ? 'Save changes' : 'Create Job')}</button>
          </>
        )}
      </div>
    </form>
  )
}
