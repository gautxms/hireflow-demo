import { useEffect, useState } from 'react'
import { SUPPORTED_SALARY_CURRENCIES, serializeJobDescriptionForm, validateJobDescriptionForm } from './jobDescriptionFormState'

const blankState = {
  title: '',
  description: '',
  requirements: '',
  skills: '',
  experienceYears: '',
  location: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'USD',
  status: 'draft',
}

export default function JobDescriptionForm({ initialValue, resetToken, onSubmit, onCancel, isSubmitting }) {
  const [formState, setFormState] = useState(blankState)
  const [jdFile, setJdFile] = useState(null)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (initialValue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState({
        title: initialValue.title || '',
        description: initialValue.description || '',
        requirements: initialValue.requirements || '',
        skills: Array.isArray(initialValue.skills) ? initialValue.skills.join(', ') : '',
        experienceYears: initialValue.experienceYears ?? '',
        location: initialValue.location || '',
        salaryMin: initialValue.salaryMin ?? '',
        salaryMax: initialValue.salaryMax ?? '',
        salaryCurrency: initialValue.salaryCurrency || 'USD',
        status: initialValue.status || 'draft',
      })
    } else {
      setFormState(blankState)
    }

    setErrors({})
    setJdFile(null)
  }, [initialValue, resetToken])

  const handleChange = (field) => (event) => {
    setFormState((prev) => ({ ...prev, [field]: event.target.value }))
    setErrors((prev) => {
      if (!prev[field]) {
        return prev
      }

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
    <form onSubmit={handleSubmit} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>{initialValue ? 'Edit Job Description' : 'New Job Description'}</h2>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <input required placeholder="Job title" value={formState.title} onChange={handleChange('title')} style={inputStyle} />
        <textarea placeholder="Paste full job description text" value={formState.description} onChange={handleChange('description')} rows={5} style={inputStyle} />
        <textarea placeholder="Requirements" value={formState.requirements} onChange={handleChange('requirements')} rows={3} style={inputStyle} />
        <input placeholder="Skills (comma separated)" value={formState.skills} onChange={handleChange('skills')} style={inputStyle} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
          <input type="number" min="0" placeholder="Experience years" value={formState.experienceYears} onChange={handleChange('experienceYears')} style={inputStyle} />
          <input placeholder="Location" value={formState.location} onChange={handleChange('location')} style={inputStyle} />
          <select aria-label="Salary currency" value={formState.salaryCurrency} onChange={handleChange('salaryCurrency')} style={inputStyle}>
            {SUPPORTED_SALARY_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
          <input type="number" min="0" placeholder="Salary min" value={formState.salaryMin} onChange={handleChange('salaryMin')} style={inputStyle} />
          <input type="number" min="0" placeholder="Salary max" value={formState.salaryMax} onChange={handleChange('salaryMax')} style={inputStyle} />
        </div>

        {errors.salaryCurrency && <p style={errorStyle}>{errors.salaryCurrency}</p>}
        {errors.salaryMin && <p style={errorStyle}>{errors.salaryMin}</p>}

        <label style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Upload JD file (PDF/DOCX)
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setJdFile(event.target.files?.[0] || null)}
            style={{ display: 'block', marginTop: '0.4rem' }}
          />
        </label>

        <label style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Status
          <select value={formState.status} onChange={handleChange('status')} style={{ ...inputStyle, marginTop: '0.4rem' }}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
        <button type="submit" disabled={isSubmitting} style={primaryButtonStyle}>
          {isSubmitting ? 'Saving...' : (initialValue ? 'Save changes' : 'Create JD')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel</button>
        )}
      </div>
    </form>
  )
}

const inputStyle = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#111827',
  color: '#fff',
  padding: '0.65rem 0.8rem',
}

const primaryButtonStyle = {
  background: 'var(--accent)',
  border: 'none',
  color: '#111827',
  fontWeight: 700,
  borderRadius: 8,
  padding: '0.7rem 1rem',
  cursor: 'pointer',
}

const secondaryButtonStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: '#fff',
  borderRadius: 8,
  padding: '0.7rem 1rem',
  cursor: 'pointer',
}

const errorStyle = {
  color: '#ef4444',
  margin: 0,
  fontSize: '0.9rem',
}
