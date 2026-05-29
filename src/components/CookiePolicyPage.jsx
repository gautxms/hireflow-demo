import ContentDocument from './ContentDocument'

export default function CookiePolicyPage() {
  return (
    <ContentDocument title="Cookie Policy" eyebrow="Privacy">
      <p className="content-document__paragraph">
        This Cookie Policy explains how HireFlow uses cookies and similar browser storage technologies across hireflow.dev and the HireFlow app.
      </p>
      <h2 className="content-document__heading">What cookies and storage are</h2>
      <p className="content-document__paragraph">
        Cookies and similar storage technologies let a website remember information in your browser. They can support core service features, security, preferences, analytics, or marketing integrations.
      </p>
      <h2 className="content-document__heading">Necessary cookies and storage</h2>
      <p className="content-document__paragraph">
        Necessary storage is always enabled because it keeps HireFlow secure and functional. It may be used for login, session continuity, admin security, routing recovery, workspace preferences, and basic app functionality.
      </p>
      <h2 className="content-document__heading">Analytics cookies</h2>
      <p className="content-document__paragraph">
        Analytics storage is optional and disabled unless you consent. When enabled, HireFlow may use privacy-conscious analytics to understand aggregate product usage and improve reliability, navigation, and onboarding.
      </p>
      <h2 className="content-document__heading">Marketing cookies</h2>
      <p className="content-document__paragraph">
        Marketing storage is optional and disabled unless you consent. HireFlow does not currently add advertising pixels through this category in this phase, but the control exists so future marketing tools can be introduced safely.
      </p>
      <h2 className="content-document__heading">Candidate and resume data</h2>
      <p className="content-document__paragraph">
        HireFlow does not use resume contents, candidate names, candidate contact details, AI reasoning, or job description text for advertising. Product analytics should avoid personal data and recruiting content.
      </p>
      <h2 className="content-document__heading">Changing your preferences</h2>
      <p className="content-document__paragraph">
        You can update your choices at any time by selecting “Cookie preferences” in the site footer or workspace footer. Your preference is stored in your browser and can be changed or cleared from browser settings.
      </p>
    </ContentDocument>
  )
}
