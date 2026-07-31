import LandingPage from '../components/LandingPage'
import AboutPage from '../components/AboutPage'
import ContactPage from '../components/ContactPage'
import HelpPage from '../components/HelpPage'
import PrivacyPage from '../components/PrivacyPage'
import AiDisclosurePage from '../components/AiDisclosurePage'
import TrustPage from '../components/TrustPage'
import CookiePolicyPage from '../components/CookiePolicyPage'
import Pricing from '../pages/Pricing'
import Terms from '../pages/Terms'
import RefundPolicy from '../pages/RefundPolicy'
import IntentLandingPage from '../pages/seo/IntentLandingPage'
import CookieConsentProvider from '../components/privacy/CookieConsentProvider'
import { getPublicRoute } from '../config/publicRouteManifest'
import PublicSiteShell from './PublicSiteShell'

const navigate = (pathname) => {
  if (typeof window !== 'undefined') {
    window.location.assign(pathname)
  }
}

function renderRoute(route) {
  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    navigate('/')
  }

  switch (route.componentKey) {
    case 'landing':
      return <LandingPage onStartDemo={() => navigate('/pricing')} ctaLabel="View pricing" />
    case 'pricing':
      return <Pricing isAuthenticated={false} onRequireAuth={() => navigate('/login')} trialEligible />
    case 'about':
      return <AboutPage onBack={onBack} />
    case 'contact':
      return <ContactPage onBack={onBack} />
    case 'help':
      return <HelpPage onBack={onBack} />
    case 'terms':
      return <Terms />
    case 'privacy':
      return <PrivacyPage />
    case 'aiDisclosure':
      return <AiDisclosurePage />
    case 'trust':
      return <TrustPage />
    case 'cookiePolicy':
      return <CookiePolicyPage />
    case 'refundPolicy':
      return <RefundPolicy />
    case 'intent':
      return <IntentLandingPage pathname={route.path} />
    default:
      throw new Error(`No public component registered for ${route.path} (${route.componentKey}).`)
  }
}

export default function PublicRouteApp({ pathname }) {
  const route = getPublicRoute(pathname)
  if (!route?.staticGeneration) {
    throw new Error(`Route is not configured for static generation: ${pathname}`)
  }

  return (
    <CookieConsentProvider>
      <PublicSiteShell>{renderRoute(route)}</PublicSiteShell>
    </CookieConsentProvider>
  )
}
