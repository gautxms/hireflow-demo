import BackButton from './BackButton'

export default function PrivacyPage() {
  return (
    <div className="policy-page">
      <main className="policy-page__main">
        <div className="policy-page__back-button-wrap">
          <BackButton />
        </div>
        <h1 className="policy-page__title">Privacy Policy</h1>
        <p>HireFlow processes business and candidate data to provide recruiting automation features for customers.</p>
        <h2>Information We Collect</h2>
        <p>We collect account information, workflow configuration, and content voluntarily submitted through the platform, including resumes and evaluation notes.</p>
        <h2>How We Use Information</h2>
        <p>Data is used to operate, secure, and improve HireFlow, provide customer support, and meet legal obligations.</p>
        <h2>Data Sharing</h2>
        <p>We do not sell personal information. Data may be shared with service providers who process data on our behalf under contractual protections.</p>
        <h2>Security and Retention</h2>
        <p>We apply technical and organizational safeguards to protect data and retain information only as long as necessary for legitimate business or legal needs.</p>
        <h2>Your Choices</h2>
        <p>You may request access, correction, or deletion of personal information where applicable law grants these rights by contacting privacy@hireflow.example.</p>
      </main>
    </div>
  )
}
