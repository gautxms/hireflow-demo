import usePageSeo from '../hooks/usePageSeo'
import PublicFooter from './PublicFooter'

export default function TermsPage() {
  usePageSeo('HireFlow Terms of Service', 'Review the HireFlow Terms of Service for using our resume screening platform and related features.')

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '4rem 1.5rem', lineHeight: 1.7 }}>
        <h1 style={{ marginBottom: '1.5rem', fontFamily: 'var(--font-display)' }}>Terms of Service</h1>
        <p>By accessing HireFlow, you agree to use the service for lawful hiring operations and internal recruiting workflows only.</p>
        <h2>Acceptable Use</h2>
        <p>You are responsible for ensuring uploaded content is accurate, lawful, and that you have permission to process candidate information.</p>
        <h2>Service Availability</h2>
        <p>HireFlow may update, improve, or maintain the platform over time. We strive for reliable access but do not guarantee uninterrupted availability.</p>
        <h2>Intellectual Property</h2>
        <p>All platform materials, branding, and software remain the property of HireFlow or its licensors. You may not reverse engineer or resell the service.</p>
        <h2>Limitation of Liability</h2>
        <p>HireFlow is provided on an "as is" basis to the maximum extent permitted by law. Our aggregate liability is limited to fees paid for the service in the preceding 12 months.</p>
        <h2>Contact</h2>
        <p>Questions about these terms can be sent to legal@hireflow.example.</p>
      </main>
      <PublicFooter />
    </div>
  )
}
