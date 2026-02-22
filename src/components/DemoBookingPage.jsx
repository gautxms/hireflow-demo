import { useState } from 'react'

export default function DemoBookingPage({ onBack }) {
  const [step, setStep] = useState('info') // 'info', 'calendar', 'confirmation'
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    companySize: '',
    phone: '',
    message: ''
  })
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTime, setSelectedTime] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)

  const availableTimeSlots = [
    '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM'
  ]

  const companySizes = [
    '1-10',
    '11-50',
    '51-200',
    '201-500',
    '501-1000',
    '1000+'
  ]

  // Generate next 14 days
  const generateDates = () => {
    const dates = []
    const today = new Date()
    for (let i = 1; i <= 14; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)
      // Skip weekends
      if (date.getDay() !== 0 && date.getDay() !== 6) {
        dates.push({
          date: date,
          formatted: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        })
      }
    }
    return dates
  }

  const availableDates = generateDates()

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const validateStep1 = () => {
    const newErrors = {}
    if (!formData.firstName.trim()) newErrors.firstName = 'First name required'
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name required'
    if (!formData.email.trim()) newErrors.email = 'Email required'
    if (!formData.email.includes('@')) newErrors.email = 'Valid email required'
    if (!formData.company.trim()) newErrors.company = 'Company name required'
    if (!formData.companySize) newErrors.companySize = 'Company size required'
    if (!formData.phone.trim()) newErrors.phone = 'Phone number required'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleContinue = () => {
    if (validateStep1()) {
      setStep('calendar')
    }
  }

  const handleSelectDate = (date) => {
    setSelectedDate(date.formatted)
    setSelectedTime(null)
  }

  const handleSelectTime = (time) => {
    setSelectedTime(time)
  }

  const handleConfirmBooking = () => {
    if (selectedDate && selectedTime) {
      setStep('confirmation')
      setSubmitted(true)
      // In a real app, send data to backend/email service
      setTimeout(() => {
        // Could redirect or show success message
      }, 1000)
    }
  }

  const handleReset = () => {
    setStep('info')
    setSelectedDate(null)
    setSelectedTime(null)
    setSubmitted(false)
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 4rem' }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}
        >
          ← Back
        </button>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '3rem 2rem' }}>
        {/* Hero */}
        {step === 'info' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
                Schedule Your Demo
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto' }}>
                See HireFlow in action. Our team will show you how to reduce hiring time by 60% and make better hiring decisions.
              </p>
            </div>

            {/* Step Indicator */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '3rem', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  ✓
                </div>
                <span style={{ fontSize: '0.9rem' }}>Your Info</span>
              </div>
              <div style={{ width: '30px', height: '2px', background: 'var(--border)', marginTop: '15px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--border)',
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  2
                </div>
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Pick Time</span>
              </div>
              <div style={{ width: '30px', height: '2px', background: 'var(--border)', marginTop: '15px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--border)',
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  3
                </div>
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Confirm</span>
              </div>
            </div>

            {/* Form */}
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '2rem',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                    First Name *
                  </label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder="John"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(0,0,0,0.3)',
                      border: errors.firstName ? '1px solid #ef4444' : '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-body)'
                    }}
                  />
                  {errors.firstName && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.firstName}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                    Last Name *
                  </label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder="Smith"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(0,0,0,0.3)',
                      border: errors.lastName ? '1px solid #ef4444' : '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-body)'
                    }}
                  />
                  {errors.lastName && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.lastName}</div>}
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                  Work Email *
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@company.com"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: errors.email ? '1px solid #ef4444' : '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-body)'
                  }}
                />
                {errors.email && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.email}</div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                    Company Name *
                  </label>
                  <input
                    type="text"
                    name="company"
                    value={formData.company}
                    onChange={handleInputChange}
                    placeholder="TechCorp Inc"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(0,0,0,0.3)',
                      border: errors.company ? '1px solid #ef4444' : '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-body)'
                    }}
                  />
                  {errors.company && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.company}</div>}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                    Company Size *
                  </label>
                  <select
                    name="companySize"
                    value={formData.companySize}
                    onChange={handleInputChange}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(0,0,0,0.3)',
                      border: errors.companySize ? '1px solid #ef4444' : '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-body)',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">Select size</option>
                    {companySizes.map(size => (
                      <option key={size} value={size}>{size} employees</option>
                    ))}
                  </select>
                  {errors.companySize && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.companySize}</div>}
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+1 (555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: errors.phone ? '1px solid #ef4444' : '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-body)'
                  }}
                />
                {errors.phone && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.phone}</div>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                  Additional Notes (Optional)
                </label>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  placeholder="Tell us about your hiring challenges..."
                  rows="4"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-body)',
                    resize: 'vertical'
                  }}
                />
              </div>
            </div>

            {/* Button */}
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleContinue}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 3rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '1rem',
                  cursor: 'pointer'
                }}
              >
                Continue to Calendar →
              </button>
            </div>
          </>
        )}

        {/* Calendar Step */}
        {step === 'calendar' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
                Pick a Time
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '1.1rem' }}>
                Select a date and time that works best for you (All times in EST)
              </p>
            </div>

            {/* Step Indicator */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '3rem', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  ✓
                </div>
                <span style={{ fontSize: '0.9rem' }}>Your Info</span>
              </div>
              <div style={{ width: '30px', height: '2px', background: 'var(--accent)', marginTop: '15px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  ✓
                </div>
                <span style={{ fontSize: '0.9rem' }}>Pick Time</span>
              </div>
              <div style={{ width: '30px', height: '2px', background: 'var(--border)', marginTop: '15px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'var(--border)',
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  3
                </div>
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Confirm</span>
              </div>
            </div>

            {/* Calendar */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
              {/* Dates */}
              <div>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Select Date</h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {availableDates.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectDate(d)}
                      style={{
                        background: selectedDate === d.formatted ? 'var(--accent)' : 'var(--card)',
                        color: selectedDate === d.formatted ? 'var(--ink)' : 'var(--text)',
                        border: selectedDate === d.formatted ? 'none' : '1px solid var(--border)',
                        padding: '1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: selectedDate === d.formatted ? 'bold' : 'normal',
                        transition: 'all 0.2s',
                        textAlign: 'left'
                      }}
                    >
                      {d.formatted}
                    </button>
                  ))}
                </div>
              </div>

              {/* Times */}
              <div>
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem' }}>
                  {selectedDate ? `Available Times on ${selectedDate}` : 'Select a date first'}
                </h3>
                {selectedDate && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {availableTimeSlots.map((time, i) => (
                      <button
                        key={i}
                        onClick={() => handleSelectTime(time)}
                        style={{
                          background: selectedTime === time ? 'var(--accent)' : 'var(--card)',
                          color: selectedTime === time ? 'var(--ink)' : 'var(--text)',
                          border: selectedTime === time ? 'none' : '1px solid var(--border)',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: selectedTime === time ? 'bold' : 'normal',
                          transition: 'all 0.2s',
                          textAlign: 'center'
                        }}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            {selectedDate && selectedTime && (
              <div style={{
                background: 'rgba(232,255,90,0.1)',
                border: '1px solid var(--accent)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '2rem'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>📅 Your Demo is Scheduled for:</div>
                <div style={{ color: 'var(--accent)', fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  {selectedDate} at {selectedTime} EST
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                  A confirmation email will be sent to {formData.email}
                </div>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => setStep('info')}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleConfirmBooking}
                disabled={!selectedDate || !selectedTime}
                style={{
                  background: !selectedDate || !selectedTime ? 'var(--muted)' : 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: !selectedDate || !selectedTime ? 'not-allowed' : 'pointer',
                  opacity: !selectedDate || !selectedTime ? 0.5 : 1
                }}
              >
                Confirm Booking →
              </button>
            </div>
          </>
        )}

        {/* Confirmation Step */}
        {step === 'confirmation' && (
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
            {/* Success Animation */}
            <div style={{ fontSize: '5rem', marginBottom: '2rem' }}>
              ✓
            </div>

            <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)', color: 'var(--accent-2)' }}>
              Demo Confirmed!
            </h1>

            {/* Confirmation Details */}
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '2rem',
              marginBottom: '2rem'
            }}>
              <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Date & Time</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>
                  {selectedDate} at {selectedTime} EST
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Your Name</div>
                <div style={{ fontSize: '1.1rem' }}>
                  {formData.firstName} {formData.lastName}
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Company</div>
                <div style={{ fontSize: '1.1rem' }}>
                  {formData.company}
                </div>
              </div>
            </div>

            {/* Next Steps */}
            <div style={{
              background: 'rgba(90,255,184,0.1)',
              border: '1px solid var(--accent-2)',
              borderRadius: '8px',
              padding: '1.5rem',
              marginBottom: '2rem',
              textAlign: 'left'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>What Happens Next:</div>
              <ol style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.8', paddingLeft: '1.5rem' }}>
                <li>📧 Check your email for a calendar invite and Zoom link</li>
                <li>👥 Our team will walk you through HireFlow live</li>
                <li>🎯 We'll discuss your specific hiring challenges</li>
                <li>💬 Q&A time at the end - ask anything!</li>
              </ol>
            </div>

            {/* CTA */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => window.location.href = '/'}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--ink)',
                  border: 'none',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Back to Home
              </button>
              <button
                onClick={handleReset}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '0.75rem 2rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Schedule Another Demo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
