import { Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { SUPPORTED_SALARY_CURRENCIES, serializeJobDescriptionForm, validateJobDescriptionForm } from './jobDescriptionFormState'

const blankState = {
  title: '',
  description: '',
  requirements: '',
  skills: '',
  experienceMin: '',
  experienceMax: '',
  location: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'USD',
  status: 'draft',
}

function mapInitialValue(initialValue) {
  if (!initialValue) return blankState
  const fallbackExperience = initialValue.experienceYears ?? ''
  return {
    title: initialValue.title || '',
    description: initialValue.description || '',
    requirements: initialValue.requirements || '',
    skills: Array.isArray(initialValue.skills) ? initialValue.skills.join(', ') : '',
    experienceMin: initialValue.experienceMin ?? fallbackExperience,
    experienceMax: initialValue.experienceMax ?? fallbackExperience,
    location: initialValue.location || '',
    salaryMin: initialValue.salaryMin ?? '',
    salaryMax: initialValue.salaryMax ?? '',
    salaryCurrency: initialValue.salaryCurrency || 'USD',
    status: initialValue.status || 'draft',
  }
}

export default function JobDescriptionForm({ initialValue, resetToken, onSubmit, onCancel, isSubmitting }) {
  const [formState, setFormState] = useState(blankState)
  const [jdFile, setJdFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [showOptionalSections, setShowOptionalSections] = useState(false)
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
          <h3>Basic details</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field" htmlFor="job-title"><span>Job title <em>*</em></span><input id="job-title" required className="job-form__control" placeholder="Senior Backend Engineer" value={formState.title} onChange={handleChange('title')} aria-invalid={Boolean(errors.title)} /></label>
            <label className="job-form__field" htmlFor="job-status"><span>Status <em>*</em></span><select id="job-status" className="job-form__control" value={formState.status} onChange={handleChange('status')}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </div>
          {errors.title && <p className="job-form__error" role="alert">{errors.title}</p>}
        </section>

        <section className="job-form__section">
          <h3>Role content</h3>
          <label className="job-form__field" htmlFor="job-description"><span>Full job description <em>*</em></span><textarea id="job-description" className="job-form__control job-form__control--textarea" placeholder="Describe responsibilities, goals, and outcomes for this role." rows={5} value={formState.description} onChange={handleChange('description')} /></label>
          <label className="job-form__field" htmlFor="job-requirements"><span>Requirements <em>*</em></span><textarea id="job-requirements" className="job-form__control job-form__control--textarea" placeholder="Required qualifications and domain experience." rows={3} value={formState.requirements} onChange={handleChange('requirements')} /></label>
          <label className="job-form__field" htmlFor="job-skills"><span>Skills <em>*</em></span><input id="job-skills" className="job-form__control" placeholder="Node.js, PostgreSQL, AWS" value={formState.skills} onChange={handleChange('skills')} /></label>
        </section>

        <section className="job-form__section">
          <h3>Matching criteria</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field" htmlFor="job-experience-min"><span>Minimum experience (years) <em>*</em></span><input id="job-experience-min" type="number" min="0" className="job-form__control" placeholder="4" value={formState.experienceMin} onChange={handleChange('experienceMin')} aria-invalid={Boolean(errors.experienceMin)} /></label>
            <label className="job-form__field" htmlFor="job-experience-max"><span>Maximum experience (years) <em>*</em></span><input id="job-experience-max" type="number" min="0" className="job-form__control" placeholder="6" value={formState.experienceMax} onChange={handleChange('experienceMax')} aria-invalid={Boolean(errors.experienceMax)} /></label>
          </div>
          {(errors.experienceMin || errors.experienceMax) && <p className="job-form__error" role="alert">{errors.experienceMin || errors.experienceMax}</p>}
          <label className="job-form__field" htmlFor="job-location"><span>Location <em>*</em></span><input id="job-location" className="job-form__control" placeholder="San Francisco, CA" value={formState.location} onChange={handleChange('location')} /></label>
        </section>

        <section className="job-form__section job-form__section--optional">
          <button
            type="button"
            className="job-form__section-toggle"
            aria-expanded={showOptionalSections}
            onClick={() => setShowOptionalSections((current) => !current)}
          >
            <span>Optional details</span>
            <small>{showOptionalSections ? 'Hide' : 'Show'} compensation and JD upload</small>
          </button>
          {showOptionalSections ? (
            <div className="job-form__optional-content">
              <section className="job-form__subsection">
                <h3>Compensation <span>(optional)</span></h3>
                <div className="job-form__grid job-form__grid--three">
                  <label className="job-form__field" htmlFor="job-salary-currency"><span>Currency <i>Optional</i></span><select id="job-salary-currency" className="job-form__control" value={formState.salaryCurrency} onChange={handleChange('salaryCurrency')}>
                    {SUPPORTED_SALARY_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select></label>
                  <label className="job-form__field" htmlFor="job-salary-min"><span>Salary min <i>Optional</i></span><input id="job-salary-min" type="number" min="0" className="job-form__control" placeholder="120000" value={formState.salaryMin} onChange={handleChange('salaryMin')} /></label>
                  <label className="job-form__field" htmlFor="job-salary-max"><span>Salary max <i>Optional</i></span><input id="job-salary-max" type="number" min="0" className="job-form__control" placeholder="160000" value={formState.salaryMax} onChange={handleChange('salaryMax')} /></label>
                </div>
                {(errors.salaryCurrency || errors.salaryMin) && <p className="job-form__error" role="alert">{errors.salaryCurrency || errors.salaryMin}</p>}
              </section>

              <section className="job-form__subsection">
                <h3>JD file upload <span>(optional)</span></h3>
                <input ref={fileInputRef} id={fileInputId} className="job-form__file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setJdFile(event.target.files?.[0] || null)} />
                <div className="job-form__file-row">
                  <button type="button" className="hf-btn hf-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}><Upload size={16} strokeWidth={1.5} aria-hidden="true" /> Upload PDF/DOCX</button>
                  <span className="job-form__file-name">{jdFile ? jdFile.name : 'No file selected'}</span>
                  {jdFile ? <button type="button" className="job-form__file-clear" aria-label="Clear selected JD file" onClick={() => setJdFile(null)}><X size={14} strokeWidth={1.5} aria-hidden="true" /></button> : null}
                </div>
                <p className="job-form__help">Accepted formats: PDF or DOCX.</p>
              </section>
            </div>
          ) : null}
        </section>
      </div>

      <div className="job-form__footer">
        <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
        <button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : (initialValue ? 'Save changes' : 'Create Job')}</button>
      </div>
    </form>
  )
}
