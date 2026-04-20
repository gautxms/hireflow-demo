import { useState } from 'react'
import { Icon } from './Icon'

const OFFICES = [
  { city: 'San Francisco', address: '123 Tech Street', state: 'San Francisco, CA 94103', phone: '+1 (555) 123-4567', hours: 'Mon-Fri: 9am-6pm PT' },
  { city: 'New York', address: '456 Innovation Ave', state: 'New York, NY 10001', phone: '+1 (555) 234-5678', hours: 'Mon-Fri: 9am-6pm ET' },
  { city: 'London', address: '789 Tech Park', state: 'London, UK EC1A 1AA', phone: '+44 (0) 20 7946 0958', hours: 'Mon-Fri: 9am-6pm GMT' }
]

export default function ContactPage({ onBack }) {
  const [formData, setFormData] = useState({ name: '', email: '', company: '', subject: '', message: '' })
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const contactMethods = [
    { icon: 'mail', title: 'Email', description: 'Best for detailed inquiries', value: 'hello@hireflow.dev' },
    { icon: 'phone', title: 'Phone', description: 'Call us during business hours', value: '+1 (555) 123-4567' },
    { icon: 'mapPin', title: 'Office', description: 'Visit us in San Francisco', value: '123 Tech Street, SF, CA 94103' },
    { icon: 'chat', title: 'Live Chat', description: 'Instant support (9am-6pm EST)', value: 'Start Chat' }
  ]

  const faqItems = [
    { question: 'What are your support hours?', answer: 'We offer support Monday-Friday, 9am-6pm EST. Enterprise customers get 24/7 support.' },
    { question: 'How quickly will I get a response?', answer: 'We aim to respond to all inquiries within 2 hours during business hours. For urgent matters, call our phone line.' },
    { question: 'Do you offer phone support?', answer: 'Yes! Pro and Enterprise plans include phone support. Starter plans can upgrade to add phone support.' },
    { question: 'Can I schedule a call with your team?', answer: 'Absolutely! Visit our Demo Booking page to schedule a time that works best for you.' },
    { question: 'What if I have billing questions?', answer: 'Billing inquiries can be sent to billing@hireflow.dev or discussed during a scheduled call with our team.' },
    { question: 'Do you have a privacy policy?', answer: 'Yes, you can review our full privacy policy, terms of service, and security documentation on our Legal page.' }
  ]

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const validateForm = () => {
    const next = {}
    if (!formData.name.trim()) next.name = 'Name is required'
    if (!formData.email.trim()) next.email = 'Email is required'
    if (!formData.email.includes('@')) next.email = 'Valid email is required'
    if (!formData.subject.trim()) next.subject = 'Subject is required'
    if (!formData.message.trim()) next.message = 'Message is required'
    if (formData.message.length < 10) next.message = 'Message must be at least 10 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validateForm()) return
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitting(false)
      setSubmitted(true)
      setFormData({ name: '', email: '', company: '', subject: '', message: '' })
      setTimeout(() => setSubmitted(false), 5000)
    }, 1500)
  }

  return (
    <div className="public-page contact-page">
      <div className="public-page-header">
        <button onClick={onBack} className="public-page-back-button public-nav-text">← Back</button>
      </div>

      <section className="public-page-hero">
        <h1 className="public-page-title">Get in Touch</h1>
        <p className="public-page-subtitle">Have questions? We'd love to hear from you. Send us a message and we'll respond as soon as possible.</p>
      </section>

      <section className="public-section public-section-alt">
        <div className="public-page-main">
          <h2 className="public-section-title center">Contact Information</h2>
          <div className="public-feature-grid">
            {contactMethods.map((method) => (
              <article key={method.title} className="public-card contact-center-card">
                <Icon name={method.icon} size="xl" tone="accent" className="contact-icon" />
                <h3 className="public-card-title">{method.title}</h3>
                <p className="public-card-copy">{method.description}</p>
                <div className="status-message status-message--info contact-method-value">{method.value}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section public-page-main">
        <div className="public-grid-2">
          <div>
            <h2 className="public-section-title">Send us a Message</h2>
            {submitted && <div className="status-message status-message--success"><strong>Message Sent!</strong> Thank you for reaching out. We'll get back to you within 2 hours.</div>}

            <form onSubmit={handleSubmit} className="public-form public-form-grid">
              {[
                ['name', 'Full Name *', 'text', 'John Smith'],
                ['email', 'Email Address *', 'email', 'john@company.com'],
                ['company', 'Company (Optional)', 'text', 'TechCorp Inc']
              ].map(([name, label, type, placeholder]) => (
                <div key={name} className={`public-form-field ${errors[name] ? 'has-error' : ''}`}>
                  <label htmlFor={name}>{label}</label>
                  <input id={name} type={type} name={name} value={formData[name]} onChange={handleInputChange} placeholder={placeholder} />
                  {errors[name] && <div className="public-form-error">{errors[name]}</div>}
                </div>
              ))}

              <div className={`public-form-field ${errors.subject ? 'has-error' : ''}`}>
                <label htmlFor="subject">Subject *</label>
                <select id="subject" name="subject" value={formData.subject} onChange={handleInputChange}>
                  <option value="">Select a subject</option>
                  <option value="sales">Sales Inquiry</option><option value="support">Technical Support</option><option value="billing">Billing Question</option><option value="partnership">Partnership Opportunity</option><option value="feedback">Product Feedback</option><option value="other">Other</option>
                </select>
                {errors.subject && <div className="public-form-error">{errors.subject}</div>}
              </div>

              <div className={`public-form-field ${errors.message ? 'has-error' : ''}`}>
                <label htmlFor="message">Message *</label>
                <textarea id="message" name="message" rows="6" value={formData.message} onChange={handleInputChange} placeholder="Tell us how we can help..." />
                {errors.message && <div className="public-form-error">{errors.message}</div>}
              </div>

              <button type="submit" disabled={isSubmitting} className="public-btn-primary">{isSubmitting ? 'Sending...' : 'Send Message'}</button>
            </form>
          </div>

          <div>
            <h2 className="public-section-title">Frequently Asked Questions</h2>
            <div className="public-faq-grid">
              {faqItems.map((item) => (
                <article key={item.question} className="public-card">
                  <h4 className="public-card-title contact-accent-title">{item.question}</h4>
                  <p className="public-card-copy">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="public-section public-section-alt">
        <div className="public-page-main">
          <h2 className="public-section-title center">Our Offices</h2>
          <div className="public-feature-grid">
            {OFFICES.map((office) => (
              <article key={office.city} className="public-card">
                <h3 className="public-card-title contact-accent-title contact-office-heading"><Icon name="mapPin" size="sm" tone="accent" />{office.city}</h3>
                <p className="public-card-copy">{office.address}<br />{office.state}</p>
                <p className="public-card-copy"><strong>Phone:</strong> {office.phone}<br /><strong>Hours:</strong> {office.hours}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
