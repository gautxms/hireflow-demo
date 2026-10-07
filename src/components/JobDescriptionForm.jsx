import { Upload, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import API_BASE from '../config/api'
import { fetchWithAccountAccessRefresh } from '../utils/accountAccessRefresh'
import { SUPPORTED_SALARY_CURRENCIES, serializeJobDescriptionForm, validateJobDescriptionForm } from './jobDescriptionFormState'
import { clearAutoFilledJobFields, mergeJobDescriptionPreview } from './jobDescriptionPrefill'

const MAX_JD_FILE_BYTES = 20 * 1024 * 1024

function normalizeWorkMode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[ -]/g, '')
  return ['onsite', 'hybrid', 'remote'].includes(normalized) ? normalized : ''
}

const blankState = {
  title: '',
  status: 'draft',
  workMode: '',
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
    workMode: normalizeWorkMode(initialValue.workMode || initialValue.employmentType),
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
  const [importMessage, setImportMessage] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const fileInputId = useId()
  const fileInputRef = useRef(null)
  const previewControllerRef = useRef(null)
  const previewSequenceRef = useRef(0)
  const manualEditsRef = useRef(new Set())
  const autoFilledFieldsRef = useRef(new Set())

  const hasExistingAttachment = Boolean(initialValue?.fileUrl)

  useEffect(() => {
    previewControllerRef.current?.abort()
    previewSequenceRef.current += 1
    manualEditsRef.current = new Set()
    autoFilledFieldsRef.current = new Set()
    setFormState(mapInitialValue(initialValue))
    setErrors({})
    setAttachmentError('')
    setImportMessage('')
    setIsExtracting(false)
    setJdFile(null)
    return () => {
      previewControllerRef.current?.abort()
      previewSequenceRef.current += 1
    }
  }, [initialValue, resetToken])

  const handleChange = (field) => (event) => {
    manualEditsRef.current.add(field)
    autoFilledFieldsRef.current.delete(field)
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

  const clearSelectedFile = () => {
    previewControllerRef.current?.abort()
    previewSequenceRef.current += 1
    if (fileInputRef.current) fileInputRef.current.value = ''
    setJdFile(null)
    setIsExtracting(false)
    setAttachmentError('')
    setImportMessage('')
  }

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    previewControllerRef.current?.abort()
    const requestId = ++previewSequenceRef.current
    setAttachmentError('')
    setImportMessage('')

    const validType = (file.name.toLowerCase().endsWith('.pdf') && file.type === 'application/pdf')
      || (file.name.toLowerCase().endsWith('.docx') && file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    if (!validType || file.size > MAX_JD_FILE_BYTES) {
      if (!initialValue) {
        const previousAutoFilled = autoFilledFieldsRef.current
        setFormState((prev) => clearAutoFilledJobFields(prev, previousAutoFilled, manualEditsRef.current))
        autoFilledFieldsRef.current = new Set()
      }
      setJdFile(null)
      setIsExtracting(false)
      setAttachmentError(validType ? 'JD file must be 20MB or smaller.' : 'Upload a PDF or DOCX job description.')
      return
    }

    setJdFile(file)
    if (initialValue) return

    const previousAutoFilled = autoFilledFieldsRef.current
    setFormState((prev) => clearAutoFilledJobFields(prev, previousAutoFilled, manualEditsRef.current))
    autoFilledFieldsRef.current = new Set()
    const token = localStorage.getItem(TOKEN_STORAGE_KEY) || ''
    if (!token) {
      setAttachmentError('Please login to fill job fields from this file.')
      return
    }

    const controller = new AbortController()
    previewControllerRef.current = controller
    setIsExtracting(true)

    try {
      const body = new FormData()
      body.append('jdFile', file)
      const response = await fetchWithAccountAccessRefresh(`${API_BASE}/job-descriptions/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not fill the job fields from this file.')
      if (!payload.fields || typeof payload.fields !== 'object') throw new Error('The job details could not be read. Enter them manually or try another file.')
      if (controller.signal.aborted || requestId !== previewSequenceRef.current) return

      setFormState((prev) => {
        const merged = mergeJobDescriptionPreview(prev, payload.fields, manualEditsRef.current)
        autoFilledFieldsRef.current = merged.autoFilledFields
        return merged.values
      })
      setErrors({})
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : []
      const followUp = [
        warnings.includes('JOB_TITLE_NOT_FOUND') ? 'Add a job title.' : '',
        warnings.includes('EXPERIENCE_RANGE_UNCLEAR') ? 'Check the experience range.' : '',
      ].filter(Boolean).join(' ')
      setImportMessage(`Job fields filled from the document. Review them before creating the job. ${followUp}`.trim())
    } catch (error) {
      if (controller.signal.aborted || requestId !== previewSequenceRef.current) return
      setAttachmentError(`${error.message || 'Could not fill job fields.'} The file remains selected; you can enter details manually.`)
    } finally {
      if (requestId === previewSequenceRef.current) {
        previewControllerRef.current = null
        setIsExtracting(false)
      }
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
    if (readOnly || isExtracting) return
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

  const attachmentSection = (
    <section className="job-form__section" aria-busy={isExtracting}>
      <h3>{initialValue ? 'Attachment' : 'Upload a job description'}</h3>
      {!initialValue ? <p className="job-form__help job-form__upload-intro">Upload a PDF or DOCX to fill the job fields, then review them before creating the job.</p> : null}
      <input ref={fileInputRef} id={fileInputId} className="job-form__file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileSelected} disabled={readOnly || isSubmitting} tabIndex={-1} />
      <div className="job-form__file-row">
        {!readOnly ? <button type="button" className="hf-btn hf-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}><Upload size={16} strokeWidth={1.5} aria-hidden="true" /> {jdFile ? 'Replace PDF/DOCX' : 'Upload PDF/DOCX'}</button> : null}
        <span className="job-form__file-name">{jdFile ? jdFile.name : (hasExistingAttachment ? 'Current attachment available' : 'No file selected')}</span>
        {hasExistingAttachment ? <button
          type="button"
          className="hf-btn hf-btn--secondary"
          onClick={openAttachmentInNewTab}
          disabled={isSubmitting}
          title="Open current JD attachment in a new tab"
        >
          View attachment
        </button> : null}
        {!readOnly && jdFile ? <button type="button" className="job-form__file-clear" aria-label="Clear selected JD file" onClick={clearSelectedFile} disabled={isSubmitting}><X size={14} strokeWidth={1.5} aria-hidden="true" /></button> : null}
      </div>
      <p className="job-form__help">Accepted formats: PDF or DOCX. Maximum size: 20MB.</p>
      {isExtracting ? <p className="job-form__import-status" role="status">Reading the document and filling job fields…</p> : null}
      {importMessage ? <p className="job-form__import-success" role="status">{importMessage}</p> : null}
      {attachmentError ? <p className="job-form__error" role="alert">{attachmentError}</p> : null}
    </section>
  )

  return (
    <form onSubmit={handleSubmit} className="job-form" noValidate>
      <div className="job-form__scrollable">
        {!initialValue ? attachmentSection : null}
        <section className="job-form__section">
          <h3>Core details</h3>
          <div className="job-form__grid job-form__grid--two">
            <label className="job-form__field" htmlFor="job-title"><span>Job title <em>*</em></span><input id="job-title" required className="job-form__control" placeholder="Senior Backend Engineer" value={formState.title} onChange={handleChange('title')} aria-invalid={Boolean(errors.title)} disabled={readOnly} /></label>
            <label className="job-form__field" htmlFor="job-status"><span>Status <em>*</em></span><select id="job-status" className="job-form__control" value={formState.status} onChange={handleChange('status')} disabled={readOnly}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
            <label className="job-form__field" htmlFor="job-work-mode"><span>Work mode</span><select id="job-work-mode" className="job-form__control" value={formState.workMode} onChange={handleChange('workMode')} disabled={readOnly}><option value="">Not specified</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
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

        {initialValue ? attachmentSection : null}
      </div>

      <div className="job-form__footer">
        {readOnly ? (
          <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel}>Close</button>
        ) : (
          <>
            <button type="button" className="hf-btn hf-btn--secondary" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
            <button type="submit" className="hf-btn hf-btn--primary" disabled={isSubmitting || isExtracting}>{isSubmitting ? 'Saving…' : (isExtracting ? 'Reading file…' : (initialValue ? 'Save changes' : 'Create Job'))}</button>
          </>
        )}
      </div>
    </form>
  )
}
