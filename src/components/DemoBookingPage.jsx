import { useState } from 'react'
import API_BASE from '../config/api'
import PublicPageLayout from './public/PublicPageLayout'

const TIME_SLOTS = ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM']
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']

function generateDates() {
  const dates = []
  const today = new Date()
  for (let i = 1; i <= 14; i += 1) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    if (date.getDay() !== 0 && date.getDay() !== 6) dates.push({ date, formatted: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) })
  }
  return dates
}

export default function DemoBookingPage({ onBack }) {
  const [step, setStep] = useState('info')
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', company: '', companySize: '', phone: '', message: '' })
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTime, setSelectedTime] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const availableDates = generateDates()

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
    if (submitError) setSubmitError('')
  }

  const validateStep1 = () => {
    const next = {}
    if (!formData.firstName.trim()) next.firstName = 'First name required'
    if (!formData.lastName.trim()) next.lastName = 'Last name required'
    if (!formData.email.trim()) next.email = 'Email required'
    if (!formData.email.includes('@')) next.email = 'Valid email required'
    if (!formData.company.trim()) next.company = 'Company name required'
    if (!formData.companySize) next.companySize = 'Company size required'
    if (!formData.phone.trim()) next.phone = 'Phone number required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submitDemoRequest = async () => {
    if (!selectedDate || !selectedTime || isSubmitting) return

    setIsSubmitting(true)
    setSubmitError('')

    try {
      const response = await fetch(`${API_BASE}/inquiries/demo-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${formData.firstName} ${formData.lastName}`.trim(),
          email: formData.email,
          company: formData.company,
          companySize: formData.companySize,
          phone: formData.phone,
          message: formData.message || `Requested demo booking for ${selectedDate} at ${selectedTime} EST.`,
          selectedDate,
          selectedTime,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to confirm booking right now.')
      }

      setStep('confirmation')
    } catch (error) {
      setSubmitError(error?.message || 'Unable to confirm booking right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const stepState = {
    info: [true, false, false],
    calendar: [true, true, false],
    confirmation: [true, true, true]
  }[step]

  return (
    <PublicPageLayout header={<div className="public-page-header"><button onClick={onBack} className="public-page-back-button public-nav-text">← Back</button></div>}>

      <main className="public-page-main public-section">
        <div className="public-page-hero public-hero-compact">
          <h1 className="public-page-title">{step === 'info' ? 'See Hireflow in action — free 30-minute demo' : step === 'calendar' ? 'Pick a Time' : 'Demo Confirmed!'}</h1>
          <p className="public-page-subtitle">
            {step === 'info' && 'Book a personalized walkthrough to see how Hireflow handles resume intake, ranking, and shortlist collaboration for your team. We focus the session on your hiring goals and current process so you leave with clear next steps.'}
            {step === 'calendar' && 'Select a date and time that works best for you (All times in EST)'}
            {step === 'confirmation' && 'Your booking is confirmed. We emailed your meeting details.'}
          </p>
        </div>

        <div className="demo-stepper">
          {['Your Info', 'Pick Time', 'Confirm'].map((label, idx) => (
            <div key={label} className="demo-step-group">
              <div className={`demo-step ${stepState[idx] ? 'active' : ''}`}><div className="demo-step-dot">{stepState[idx] ? '✓' : idx + 1}</div><span className="public-nav-text">{label}</span></div>
              {idx < 2 && <div className={`demo-step-line ${stepState[idx + 1] ? 'active' : ''}`} />}
            </div>
          ))}
        </div>

        {step === 'info' && (
          <>
            <div className="demo-info-layout">
              <section className="public-card demo-content-stack">
                <h2 className="public-section-title demo-content-title">See Hireflow in action — free 30-minute demo</h2>
                <p className="public-copy">
                  In your live demo, we walk through the full resume screening workflow in Hireflow, from creating a role to reviewing ranked candidates.
                  You will see how the platform helps teams triage high-volume applicant pipelines faster without losing context.
                  This session is designed for recruiters, HR managers, and hiring teams who want a clearer, more consistent evaluation process.
                  We tailor the walkthrough to your hiring motion, role types, and current screening bottlenecks so the conversation stays practical.
                </p>

                <section className="demo-content-section">
                  <h3 className="public-card-title">What you&apos;ll learn in your demo</h3>
                  <ul className="demo-content-list public-copy">
                    <li>How to upload resumes in bulk and automatically score candidates against a specific role.</li>
                    <li>How Hireflow&apos;s AI ranking surfaces stronger-fit candidates and highlights supporting evidence.</li>
                    <li>How to configure role-specific scoring criteria so the ranking reflects your real hiring priorities.</li>
                    <li>How to build and export shortlists for hiring manager review and downstream interview planning.</li>
                    <li>How to fit Hireflow into your existing stack using exports and handoff-friendly workflows.</li>
                  </ul>
                </section>
              </section>

              <div>
                <form className="public-form public-form-grid">
                  <div className="public-form-grid cols-2">
                    {[
                      ['firstName', 'First Name *', 'text', 'John'],
                      ['lastName', 'Last Name *', 'text', 'Smith']
                    ].map(([name, label, type, placeholder]) => (
                      <div key={name} className={`public-form-field ${errors[name] ? 'has-error' : ''}`}>
                        <label htmlFor={name}>{label}</label>
                        <input id={name} type={type} name={name} value={formData[name]} onChange={handleInputChange} placeholder={placeholder} />
                        {errors[name] && <div className="public-form-error">{errors[name]}</div>}
                      </div>
                    ))}
                  </div>

                  {[
                    ['email', 'Work Email *', 'email', 'john@company.com'],
                    ['phone', 'Phone Number *', 'tel', '+1 (555) 123-4567']
                  ].map(([name, label, type, placeholder]) => (
                    <div key={name} className={`public-form-field ${errors[name] ? 'has-error' : ''}`}>
                      <label htmlFor={name}>{label}</label>
                      <input id={name} type={type} name={name} value={formData[name]} onChange={handleInputChange} placeholder={placeholder} />
                      {errors[name] && <div className="public-form-error">{errors[name]}</div>}
                    </div>
                  ))}

                  <div className="public-form-grid cols-2">
                    <div className={`public-form-field ${errors.company ? 'has-error' : ''}`}>
                      <label htmlFor="company">Company Name *</label>
                      <input id="company" type="text" name="company" value={formData.company} onChange={handleInputChange} placeholder="TechCorp Inc" />
                      {errors.company && <div className="public-form-error">{errors.company}</div>}
                    </div>
                    <div className={`public-form-field ${errors.companySize ? 'has-error' : ''}`}>
                      <label htmlFor="companySize">Company Size *</label>
                      <select id="companySize" name="companySize" value={formData.companySize} onChange={handleInputChange}>
                        <option value="">Select size</option>
                        {COMPANY_SIZES.map((size) => <option key={size} value={size}>{size} employees</option>)}
                      </select>
                      {errors.companySize && <div className="public-form-error">{errors.companySize}</div>}
                    </div>
                  </div>

                  <div className="public-form-field">
                    <label htmlFor="message">Additional Notes (Optional)</label>
                    <textarea id="message" name="message" rows="4" value={formData.message} onChange={handleInputChange} placeholder="Tell us about your hiring challenges..." />
                  </div>
                </form>

                <div className="public-button-row center public-mt-md">
                  <button className="public-btn-primary" onClick={() => validateStep1() && setStep('calendar')}>Continue to Calendar →</button>
                </div>
              </div>
            </div>

            <div className="demo-lower-content">
              <section className="public-card demo-content-section">
                <h3 className="public-card-title">What our customers say</h3>
                <div className="public-faq-grid">
                  <p className="public-copy">&ldquo;Before Hireflow, we spent hours manually sorting resumes for every open role. Now our team starts each week with a ranked shortlist and fewer back-and-forths with hiring managers.&rdquo; — Sarah, HR Manager at a 200-person SaaS company</p>
                  <p className="public-copy">&ldquo;The biggest win is consistency. We align on role criteria up front, and Hireflow applies that logic to every applicant so our screening decisions are easier to explain.&rdquo; — Marcus, Talent Lead at a multi-location healthcare group</p>
                  <p className="public-copy">&ldquo;We hire across operations and customer support, and volume can spike fast. Hireflow helps us quickly spot qualified applicants without missing strong candidates buried in the queue.&rdquo; — Priya, People Operations Manager at a logistics company</p>
                </div>
              </section>

              <section className="public-card demo-content-section">
                <h3 className="public-card-title">Before your demo</h3>
                <ul className="demo-content-list public-copy">
                  <li>Have a current job description ready so we can tailor examples to a real role.</li>
                  <li>Think about your current screening bottlenecks, especially where decisions slow down.</li>
                  <li>Invite your hiring manager if possible so alignment can start during the session.</li>
                </ul>
              </section>

              <p className="public-copy center">No hard sell, no obligation — and you can cancel or reschedule anytime.</p>
            </div>
          </>
        )}

        {step === 'calendar' && (
          <>
            <div className="public-grid-2">
              <section>
                <h3 className="public-card-title">Select Date</h3>
                <div className="demo-slot-grid">
                  {availableDates.map((d) => (
                    <button key={d.formatted} className={`demo-slot-btn ${selectedDate === d.formatted ? 'selected' : ''}`} onClick={() => { setSelectedDate(d.formatted); setSelectedTime(null) }}>{d.formatted}</button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="public-card-title">{selectedDate ? `Available Times on ${selectedDate}` : 'Select a date first'}</h3>
                {selectedDate && (
                  <div className="demo-slot-grid cols-2">
                    {TIME_SLOTS.map((time) => <button key={time} className={`demo-slot-btn ${selectedTime === time ? 'selected' : ''}`} onClick={() => setSelectedTime(time)}>{time}</button>)}
                  </div>
                )}
              </section>
            </div>

            {selectedDate && selectedTime && <div className="status-message status-message--info">📅 Demo scheduled for <strong>{selectedDate} at {selectedTime} EST</strong>. A confirmation email will be sent to {formData.email}.</div>}
            {submitError && <div className="status-message status-message--error">{submitError}</div>}

            <div className="public-button-row center">
              <button className="public-btn-secondary" onClick={() => setStep('info')}>← Back</button>
              <button className="public-btn-primary" disabled={!selectedDate || !selectedTime || isSubmitting} onClick={submitDemoRequest}>{isSubmitting ? 'Submitting...' : 'Confirm Booking →'}</button>
            </div>
          </>
        )}

        {step === 'confirmation' && (
          <section className="public-form demo-confirm-card">
            <div className="status-message status-message--success">✅ Your demo is confirmed.</div>
            <div className="public-faq-grid">
              <p className="public-copy"><strong>Date & Time:</strong> {selectedDate} at {selectedTime} EST</p>
              <p className="public-copy"><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
              <p className="public-copy"><strong>Company:</strong> {formData.company}</p>
            </div>
            <div className="public-button-row center">
              <button className="public-btn-secondary" onClick={() => { setStep('info'); setSelectedDate(null); setSelectedTime(null); setSubmitError('') }}>Book Another Demo</button>
            </div>
          </section>
        )}
      </main>
    </PublicPageLayout>
  )
}
