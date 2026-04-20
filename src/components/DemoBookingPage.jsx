import { useState } from 'react'

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

  const availableDates = generateDates()

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
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

  const stepState = {
    info: [true, false, false],
    calendar: [true, true, false],
    confirmation: [true, true, true]
  }[step]

  return (
    <div className="public-page">
      <div className="public-page-header">
        <button onClick={onBack} className="public-page-back-button public-nav-text">← Back</button>
      </div>

      <main className="public-page-main public-section">
        <div className="public-page-hero public-hero-compact">
          <h1 className="public-page-title">{step === 'info' ? 'Schedule Your Demo' : step === 'calendar' ? 'Pick a Time' : 'Demo Confirmed!'}</h1>
          <p className="public-page-subtitle">
            {step === 'info' && 'See HireFlow in action. Our team will show you how to reduce hiring time by 60% and make better hiring decisions.'}
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

            <div className="public-button-row center">
              <button className="public-btn-secondary" onClick={() => setStep('info')}>← Back</button>
              <button className="public-btn-primary" disabled={!selectedDate || !selectedTime} onClick={() => setStep('confirmation')}>Confirm Booking →</button>
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
              <button className="public-btn-secondary" onClick={() => { setStep('info'); setSelectedDate(null); setSelectedTime(null) }}>Book Another Demo</button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
