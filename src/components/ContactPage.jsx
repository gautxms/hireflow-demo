import { useState } from 'react'
import API_BASE from '../config/api'
import { Icon } from './Icon'
import PublicPageLayout from './public/PublicPageLayout'

export default function ContactPage({ onBack }) {
  const [formData, setFormData] = useState({ name: '', email: '', company: '', subject: '', message: '' })
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const contactMethods = [
    { icon: 'mail', title: 'Email', description: 'Best for detailed inquiries and deletion requests', value: 'hello@hireflow.dev' },
    { icon: 'chat', title: 'Contact form', description: 'Share product, billing, privacy, or support questions', value: 'Use the form below' },
    { icon: 'target', title: 'Demo requests', description: 'Book time to review HireFlow workflows', value: 'Schedule a demo' }
  ]

  const faqItems = [
    { question: 'How do I contact HireFlow?', answer: 'Use the form on this page or email hello@hireflow.dev. We review messages as quickly as practical during launch preparation.' },
    { question: 'Can I request data deletion?', answer: 'Yes. Email hello@hireflow.dev with enough detail to identify the account, workspace, job, resume, or candidate record involved.' },
    { question: 'Can I schedule a call with your team?', answer: 'Yes. Visit the demo page to request a time to review HireFlow workflows.' },
    { question: 'What if I have billing questions?', answer: 'Send billing questions through this form or to hello@hireflow.dev so we can review your account context.' },
    { question: 'Do you have privacy and AI processing information?', answer: 'Yes. Review the Privacy Policy, Terms of Service, Cookie Policy, and AI Disclosure linked in the footer.' }
  ]

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
    if (submitError) setSubmitError('')
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm() || isSubmitting) return

    setIsSubmitting(true)
    setSubmitError('')

    try {
      const response = await fetch(`${API_BASE}/inquiries/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to send your message right now.')
      }

      setSubmitted(true)
      setFormData({ name: '', email: '', company: '', subject: '', message: '' })
      setTimeout(() => setSubmitted(false), 5000)
    } catch (error) {
      setSubmitError(error?.message || 'Unable to send your message right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PublicPageLayout className="contact-page" header={<div className="public-page-header"><button onClick={onBack} className="public-page-back-button public-nav-text">← Back</button></div>}>

      <section className="public-page-hero">
        <h1 className="public-page-title">Get in Touch</h1>
        <p className="public-page-subtitle">Have questions about HireFlow, privacy, billing, or launch readiness? Send a message and we’ll review it as soon as practical.</p>
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
            {submitted && <div className="status-message status-message--success"><strong>Message sent.</strong> Thank you for reaching out. We’ll review your message as soon as practical.</div>}
            {submitError && <div className="status-message status-message--error">{submitError}</div>}

            <form onSubmit={handleSubmit} className="public-form public-form-grid">
              {[
                ['name', 'Full Name *', 'text', 'John Smith'],
                ['email', 'Email Address *', 'email', 'john@company.com'],
                ['company', 'Company', 'text', 'TechCorp Inc']
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

    </PublicPageLayout>
  )
}
