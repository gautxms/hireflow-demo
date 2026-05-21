import { Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { serializeJobDescriptionForm, validateJobDescriptionForm } from './jobDescriptionFormState'

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

export default function JobDescriptionForm({ initialValue, resetToken, onSubmit, onCancel, isSubmitting }) {
  const [formState, setFormState] = useState(blankState)
  const [jdFile, setJdFile] = useState(null)
  const [errors, setErrors] = useState({})
  const fileInputId = useId()
  const fileInputRef = useRef(null)

  useEffect(() => {
    setFormState(mapInitialValue(initialValue))
    setErrors({})
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

  const handleSubmit = async (event) => {
    event.preventDefault()
    const nextErrors = validateJobDescriptionForm(formState)
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    await onSubmit({
      ...serializeJobDescriptionForm(formState),
      skills: formState.skills,
      jdFile,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="job-form" noValidate>
      <div className="job-form__scrollable">
        <section className="job-form__section">
          <h3>Core details</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field" htmlFor="job-title"><span>Job title <em>*</em></span><input id="job-title" required className="job-form__control" placeholder="Senior Backend Engineer" value={formState.title} onChange={handleChange('title')} aria-invalid={Boolean(errors.title)} /></label>
            <label className="job-form__field" htmlFor="job-status"><span>Status <em>*</em></span><select id="job-status" className="job-form__control" value={formState.status} onChange={handleChange('status')}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
            <label className="job-form__field" htmlFor="job-work-mode"><span>Work mode</span><select id="job-work-mode" className="job-form__control" value={formState.workMode} onChange={handleChange('workMode')}><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
            <label className="job-form__field" htmlFor="job-location"><span>Location</span><input id="job-location" className="job-form__control" placeholder="San Francisco, CA" value={formState.location} onChange={handleChange('location')} /></label>
            <label className="job-form__field" htmlFor="job-experience-min"><span>Experience min (years)</span><input id="job-experience-min" type="number" min="0" className="job-form__control" placeholder="4" value={formState.experienceMin} onChange={handleChange('experienceMin')} aria-invalid={Boolean(errors.experienceMin)} /></label>
            <label className="job-form__field" htmlFor="job-experience-max"><span>Experience max (years)</span><input id="job-experience-max" type="number" min="0" className="job-form__control" placeholder="6" value={formState.experienceMax} onChange={handleChange('experienceMax')} aria-invalid={Boolean(errors.experienceMax)} /></label>
          </div>
          {(errors.title || errors.experienceMin || errors.experienceMax) && <p className="job-form__error" role="alert">{errors.title || errors.experienceMin || errors.experienceMax}</p>}
        </section>

        <section className="job-form__section">
          <h3>Content</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field job-form__field--full" htmlFor="job-description"><span>Full job description</span><textarea id="job-description" className="job-form__control job-form__control--textarea" placeholder="Describe responsibilities, goals, and outcomes for this role." rows={5} value={formState.description} onChange={handleChange('description')} /></label>
            <label className="job-form__field" htmlFor="job-responsibilities"><span>Key responsibilities</span><textarea id="job-responsibilities" className="job-form__control job-form__control--textarea" placeholder="List the day-to-day ownership areas." rows={4} value={formState.responsibilities} onChange={handleChange('responsibilities')} /></label>
            <label className="job-form__field" htmlFor="job-requirements"><span>Qualifications</span><textarea id="job-requirements" className="job-form__control job-form__control--textarea" placeholder="Required qualifications and domain experience." rows={4} value={formState.requirements} onChange={handleChange('requirements')} /></label>
            <label className="job-form__field" htmlFor="job-skills"><span>Skills</span><input id="job-skills" className="job-form__control" placeholder="Node.js, PostgreSQL, AWS" value={formState.skills} onChange={handleChange('skills')} /></label>
            <label className="job-form__field" htmlFor="job-additional-info"><span>Additional info</span><input id="job-additional-info" className="job-form__control" placeholder="Team setup, interview loop, visa support, etc." value={formState.additionalInfo} onChange={handleChange('additionalInfo')} /></label>
          </div>
        </section>

        <section className="job-form__section">
          <h3>Attachment</h3>
          <input ref={fileInputRef} id={fileInputId} className="job-form__file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setJdFile(event.target.files?.[0] || null)} />
          <div className="job-form__file-row">
            <button type="button" className="hf-btn hf-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}><Upload size={16} strokeWidth={1.5} aria-hidden="true" /> Upload PDF/DOCX</button>
            <span className="job-form__file-name">{jdFile ? jdFile.name : 'No file selected'}</span>
            {jdFile ? <button type="button" className="job-form__file-clear" aria-label="Clear selected JD file" onClick={() => setJdFile(null)}><X size={14} strokeWidth={1.5} aria-hidden="true" /></button> : null}
          </div>
          <p className="job-form__help">Accepted formats: PDF or DOCX.</p>
        </section>
      </div>

      <div className="job-form__footer">
        <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
        <button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : (initialValue ? 'Save changes' : 'Create Job')}</button>
      </div>
    </form>
  )
}
