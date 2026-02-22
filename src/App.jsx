import { useState } from 'react'
import LandingPage from './components/LandingPage'
import PricingPage from './components/PricingPage'
import ResumeUploader from './components/ResumeUploader'
import CandidateResults from './components/CandidateResults'
import OperationsDashboard from './components/Dashboard'
import SettingsPage from './components/SettingsPage'
import HelpPage from './components/HelpPage'
import AboutPage from './components/AboutPage'
import DemoBookingPage from './components/DemoBookingPage'
import ContactPage from './components/ContactPage'

const STRIPE_PAYMENT_LINKS = {
  starter: import.meta.env.VITE_STRIPE_STARTER_PAYMENT_LINK,
  pro: import.meta.env.VITE_STRIPE_PRO_PAYMENT_LINK
}

export default function App() {
  const [currentPage, setCurrentPage] = useState('landing')
  const [uploadedFiles, setUploadedFiles] = useState(null)

  const handleFileUploaded = (files) => {
    setUploadedFiles(files)
    setCurrentPage('results')
  }

  const handleSelectPlan = (planId) => {
    console.log('Selected plan:', planId)

    if (planId === 'enterprise') {
      setCurrentPage('contact')
      return
    }

    const checkoutUrl = STRIPE_PAYMENT_LINKS[planId]

    if (checkoutUrl) {
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer')
      return
    }

    setCurrentPage('uploader')
  }


  const hasStripeCheckout = Boolean(
    STRIPE_PAYMENT_LINKS.starter || STRIPE_PAYMENT_LINKS.pro
  )

  return (
    <div>
      {currentPage === 'landing' && (
        <LandingPage
          onStartDemo={() => setCurrentPage('uploader')}
          onViewPricing={() => setCurrentPage('pricing')}
          onViewDashboard={() => setCurrentPage('dashboard')}
          onViewAbout={() => setCurrentPage('about')}
          onViewDemo={() => setCurrentPage('demo')}
          onViewContact={() => setCurrentPage('contact')}
          onViewHelp={() => setCurrentPage('help')}
        />
      )}

      {currentPage === 'pricing' && (
        <PricingPage
          onSelectPlan={handleSelectPlan}
          onBack={() => setCurrentPage('landing')}
          hasStripeCheckout={hasStripeCheckout}
        />
      )}

      {currentPage === 'uploader' && (
        <ResumeUploader onFileUploaded={handleFileUploaded} onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'results' && (
        <CandidateResults
          candidates={uploadedFiles}
          onBack={() => setCurrentPage('uploader')}
        />
      )}

      {currentPage === 'dashboard' && (
        <OperationsDashboard onNavigate={setCurrentPage} />
      )}

      {currentPage === 'settings' && (
        <SettingsPage onBack={() => setCurrentPage('dashboard')} />
      )}

      {currentPage === 'help' && (
        <HelpPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'about' && (
        <AboutPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'demo' && (
        <DemoBookingPage onBack={() => setCurrentPage('landing')} />
      )}

      {currentPage === 'contact' && (
        <ContactPage onBack={() => setCurrentPage('landing')} />
      )}
    </div>
  )
}
