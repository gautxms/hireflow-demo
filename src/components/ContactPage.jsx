import { useState } from 'react'

export default function ContactPage({ onBack }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    subject: '',
    message: ''
  })
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const contactMethods = [
    {
      icon: '📧',
      title: 'Email',
      description: 'Best for detailed inquiries',
      value: 'hello@hireflow.dev',
      type: 'email'
    },
    {
      icon: '📞',
      title: 'Phone',
      description: 'Call us during business hours',
      value: '+1 (555) 123-4567',
      type: 'phone'
    },
    {
      icon: '📍',
      title: 'Office',
      description: 'Visit us in San Francisco',
      value: '123 Tech Street, SF, CA 94103',
      type: 'address'
    },
    {
      icon: '💬',
      title: 'Live Chat',
      description: 'Instant support (9am-6pm EST)',
      value: 'Start Chat',
      type: 'chat'
    }
  ]

  const faqItems = [
    {
      question: 'What are your support hours?',
      answer: 'We offer support Monday-Friday, 9am-6pm EST. Enterprise customers get 24/7 support.'
    },
    {
      question: 'How quickly will I get a response?',
      answer: 'We aim to respond to all inquiries within 2 hours during business hours. For urgent matters, call our phone line.'
    },
    {
      question: 'Do you offer phone support?',
      answer: 'Yes! Pro and Enterprise plans include phone support. Starter plans can upgrade to add phone support.'
    },
    {
      question: 'Can I schedule a call with your team?',
      answer: 'Absolutely! Visit our Demo Booking page to schedule a time that works best for you.'
    },
    {
      question: 'What if I have billing questions?',
      answer: 'Billing inquiries can be sent to billing@hireflow.dev or discussed during a scheduled call with our team.'
    },
    {
      question: 'Do you have a privacy policy?',
      answer: 'Yes, you can review our full privacy policy, terms of service, and security documentation on our Legal page.'
    }
  ]

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Name is required'
    if (!formData.email.trim()) newErrors.email = 'Email is required'
    if (!formData.email.includes('@')) newErrors.email = 'Valid email is required'
    if (!formData.subject.trim()) newErrors.subject = 'Subject is required'
    if (!formData.message.trim()) newErrors.message = 'Message is required'
    if (formData.message.length < 10) newErrors.message = 'Message must be at least 10 characters'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (validateForm()) {
      setIsSubmitting(true)
      // Simulate sending email
      setTimeout(() => {
        setIsSubmitting(false)
        setSubmitted(true)
        setFormData({ name: '', email: '', company: '', subject: '', message: '' })
        // Reset success message after 5 seconds
        setTimeout(() => setSubmitted(false), 5000)
      }, 1500)
    }
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

      {/* Hero Section */}
      <div style={{ padding: '6rem 4rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>
          Get in Touch
        </h1>
        <p style={{ fontSize: '1.2rem', color: 'var(--muted)', maxWidth: '700px', margin: '0 auto', lineHeight: '1.8' }}>
          Have questions? We'd love to hear from you. Send us a message and we'll respond as soon as possible.
        </p>
      </div>

      {/* Contact Methods */}
      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            Contact Information
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
            {contactMethods.map((method, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '2rem',
                  textAlign: 'center',
                  transition: 'all 0.3s'
                }}
              >
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
                  {method.icon}
                </div>
                <h3 style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  {method.title}
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  {method.description}
                </p>
                <div style={{
                  background: 'rgba(232,255,90,0.1)',
                  border: '1px solid var(--accent)',
                  borderRadius: '8px',
                  padding: '1rem',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  color: 'var(--accent)',
                  wordBreak: 'break-word'
                }}>
                  {method.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '4rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem' }}>
        {/* Contact Form */}
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', fontFamily: 'var(--font-display)' }}>
            Send us a Message
          </h2>

          {submitted && (
            <div style={{
              background: 'rgba(90,255,184,0.15)',
              border: '1px solid var(--accent-2)',
              borderRadius: '8px',
              padding: '1.5rem',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ fontSize: '1.5rem' }}>✓</div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--accent-2)' }}>
                    Message Sent!
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    Thank you for reaching out. We'll get back to you within 2 hours.
                  </div>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '2rem'
          }}>
            {/* Name */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Full Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="John Smith"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: errors.name ? '1px solid #ef4444' : '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-body)'
                }}
              />
              {errors.name && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.name}</div>}
            </div>

            {/* Email */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Email Address *
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

            {/* Company */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Company (Optional)
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
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-body)'
                }}
              />
            </div>

            {/* Subject */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Subject *
              </label>
              <select
                name="subject"
                value={formData.subject}
                onChange={handleInputChange}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: errors.subject ? '1px solid #ef4444' : '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer'
                }}
              >
                <option value="">Select a subject</option>
                <option value="sales">Sales Inquiry</option>
                <option value="support">Technical Support</option>
                <option value="billing">Billing Question</option>
                <option value="partnership">Partnership Opportunity</option>
                <option value="feedback">Product Feedback</option>
                <option value="other">Other</option>
              </select>
              {errors.subject && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.subject}</div>}
            </div>

            {/* Message */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                Message *
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                placeholder="Tell us how we can help..."
                rows="6"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: errors.message ? '1px solid #ef4444' : '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-body)',
                  resize: 'vertical'
                }}
              />
              {errors.message && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem' }}>{errors.message}</div>}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: '100%',
                background: 'var(--accent)',
                color: 'var(--ink)',
                border: 'none',
                padding: '0.75rem',
                borderRadius: '6px',
                fontWeight: 'bold',
                fontSize: '1rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1
              }}
            >
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>

        {/* FAQ Section */}
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', fontFamily: 'var(--font-display)' }}>
            Frequently Asked Questions
          </h2>

          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {faqItems.map((item, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '1.5rem'
                }}
              >
                <h4 style={{ fontWeight: 'bold', marginBottom: '0.75rem', color: 'var(--accent)' }}>
                  {item.question}
                </h4>
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.6' }}>
                  {item.answer}
                </p>
              </div>
            ))}
          </div>

          {/* Additional Help */}
          <div style={{
            background: 'rgba(232,255,90,0.1)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            padding: '1.5rem',
            marginTop: '2rem'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '1rem' }}>
              🎓 Need more help?
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem', lineHeight: '1.6' }}>
              Check out our Help Center for detailed guides, tutorials, and best practices for using HireFlow.
            </p>
            <button style={{
              background: 'var(--accent)',
              color: 'var(--ink)',
              border: 'none',
              padding: '0.5rem 1.5rem',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}>
              Visit Help Center
            </button>
          </div>
        </div>
      </div>

      {/* Office Locations */}
      <div style={{ padding: '4rem', background: 'var(--ink-2)', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', textAlign: 'center', fontFamily: 'var(--font-display)' }}>
            Our Offices
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
            {[
              {
                city: 'San Francisco',
                address: '123 Tech Street',
                state: 'San Francisco, CA 94103',
                phone: '+1 (555) 123-4567',
                hours: 'Mon-Fri: 9am-6pm PT'
              },
              {
                city: 'New York',
                address: '456 Innovation Ave',
                state: 'New York, NY 10001',
                phone: '+1 (555) 234-5678',
                hours: 'Mon-Fri: 9am-6pm ET'
              },
              {
                city: 'London',
                address: '789 Tech Park',
                state: 'London, UK EC1A 1AA',
                phone: '+44 (0) 20 7946 0958',
                hours: 'Mon-Fri: 9am-6pm GMT'
              }
            ].map((office, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '2rem'
                }}
              >
                <h3 style={{ fontWeight: 'bold', marginBottom: '1rem', color: 'var(--accent)' }}>
                  📍 {office.city}
                </h3>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: '1.8' }}>
                  <div>{office.address}</div>
                  <div>{office.state}</div>
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <div><strong>Phone:</strong> {office.phone}</div>
                    <div><strong>Hours:</strong> {office.hours}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Social Links */}
      <div style={{ padding: '4rem', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', fontFamily: 'var(--font-display)' }}>
          Follow Us
        </h2>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem' }}>
          {[
            { name: 'Twitter', icon: '𝕏', url: '#' },
            { name: 'LinkedIn', icon: '💼', url: '#' },
            { name: 'GitHub', icon: '🐙', url: '#' },
            { name: 'YouTube', icon: '▶️', url: '#' }
          ].map((social, i) => (
            <a
              key={i}
              href={social.url}
              style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                cursor: 'pointer',
                transition: 'all 0.3s',
                textDecoration: 'none',
                color: 'var(--text)'
              }}
              title={social.name}
            >
              {social.icon}
            </a>
          ))}
        </div>

        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          © 2024 HireFlow. All rights reserved. | <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Privacy Policy</a> | <a href="/terms" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Terms of Service</a>
        </p>
      </div>
    </div>
  )
}
