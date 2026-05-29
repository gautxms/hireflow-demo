import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  COOKIE_PREFERENCES_EVENT,
  DEFAULT_COOKIE_CONSENT,
  readCookieConsent,
  writeCookieConsent,
} from '../../privacy/cookieConsent'
import { CookieConsentContext } from './CookieConsentContext'

function ConsentToggle({ id, label, description, checked, disabled = false, onChange }) {
  return (
    <div className={`cookie-consent-choice${disabled ? ' cookie-consent-choice--locked' : ''}`}>
      <div>
        <label className="cookie-consent-choice__label" htmlFor={id}>{label}</label>
        <p className="cookie-consent-choice__description">{description}</p>
      </div>
      <button
        type="button"
        id={id}
        className={`cookie-consent-toggle${checked ? ' cookie-consent-toggle--on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
      >
        <span className="cookie-consent-toggle__thumb" />
      </button>
    </div>
  )
}

function CookiePreferencesModal({ draftPreferences, onDraftChange, onClose, onAcceptAll, onReject, onSave }) {
  const dialogRef = useRef(null)
  const lastFocusedElementRef = useRef(null)

  useEffect(() => {
    lastFocusedElementRef.current = document.activeElement
    window.setTimeout(() => dialogRef.current?.focus(), 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      lastFocusedElementRef.current?.focus?.()
    }
  }, [onClose])

  const updateDraft = (key, value) => {
    onDraftChange((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="cookie-consent-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="cookie-consent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-preferences-title"
        aria-describedby="cookie-preferences-description"
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cookie-consent-modal__header">
          <div>
            <p className="cookie-consent-modal__eyebrow">Privacy controls</p>
            <h2 id="cookie-preferences-title" className="cookie-consent-modal__title">Cookie preferences</h2>
          </div>
          <button type="button" className="cookie-consent-modal__close" onClick={onClose} aria-label="Close cookie preferences">
            ×
          </button>
        </div>

        <p id="cookie-preferences-description" className="cookie-consent-modal__description">
          Choose whether HireFlow can use optional analytics and marketing storage. Necessary storage stays on to keep your account, security, and workspace features working.
        </p>

        <div className="cookie-consent-modal__choices">
          <ConsentToggle
            id="cookie-consent-necessary"
            label="Necessary cookies"
            description="Required for login, session security, preferences, and core app functionality. These cannot be disabled."
            checked
            disabled
          />
          <ConsentToggle
            id="cookie-consent-analytics"
            label="Analytics cookies"
            description="Optional privacy-conscious product analytics that help us understand aggregate usage and improve HireFlow."
            checked={draftPreferences.analytics}
            onChange={(value) => updateDraft('analytics', value)}
          />
          <ConsentToggle
            id="cookie-consent-marketing"
            label="Marketing cookies"
            description="Optional category reserved for future advertising pixels. HireFlow does not currently use resume or candidate data for advertising."
            checked={draftPreferences.marketing}
            onChange={(value) => updateDraft('marketing', value)}
          />
        </div>

        <div className="cookie-consent-modal__actions">
          <button type="button" className="cookie-consent-button cookie-consent-button--primary" onClick={onSave}>Save preferences</button>
          <button type="button" className="cookie-consent-button cookie-consent-button--secondary" onClick={onAcceptAll}>Accept all</button>
          <button type="button" className="cookie-consent-button cookie-consent-button--ghost" onClick={onReject}>Reject non-essential</button>
        </div>
      </section>
    </div>
  )
}

function CookieBanner({ onAcceptAll, onReject, onManage }) {
  return (
    <aside className="cookie-consent-banner" aria-label="Cookie consent">
      <div className="cookie-consent-banner__copy">
        <p className="cookie-consent-banner__eyebrow">Privacy by design</p>
        <p className="cookie-consent-banner__text">
          We use necessary cookies to keep HireFlow secure. Optional analytics cookies help us improve the product. We do not use resume or candidate data for advertising.
        </p>
      </div>
      <div className="cookie-consent-banner__actions">
        <button type="button" className="cookie-consent-button cookie-consent-button--primary" onClick={onAcceptAll}>Accept all</button>
        <button type="button" className="cookie-consent-button cookie-consent-button--secondary" onClick={onReject}>Reject non-essential</button>
        <button type="button" className="cookie-consent-button cookie-consent-button--ghost" onClick={onManage}>Manage preferences</button>
      </div>
    </aside>
  )
}

export default function CookieConsentProvider({ children }) {
  const [consent, setConsent] = useState(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false)
  const [draftPreferences, setDraftPreferences] = useState(DEFAULT_COOKIE_CONSENT)

  useEffect(() => {
    const initializeConsent = () => {
      const storedConsent = readCookieConsent()
      setConsent(storedConsent)
      setDraftPreferences(storedConsent || DEFAULT_COOKIE_CONSENT)
      setIsInitialized(true)
    }

    const timer = window.setTimeout(initializeConsent, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const openPreferences = () => {
      setDraftPreferences(readCookieConsent() || DEFAULT_COOKIE_CONSENT)
      setIsPreferencesOpen(true)
    }

    window.addEventListener(COOKIE_PREFERENCES_EVENT, openPreferences)

    return () => {
      window.removeEventListener(COOKIE_PREFERENCES_EVENT, openPreferences)
    }
  }, [])

  const saveConsent = useCallback((preferences) => {
    const nextConsent = writeCookieConsent(preferences)
    setConsent(nextConsent)
    setDraftPreferences(nextConsent)
    setIsPreferencesOpen(false)
  }, [])

  const openPreferences = useCallback(() => {
    setDraftPreferences(consent || DEFAULT_COOKIE_CONSENT)
    setIsPreferencesOpen(true)
  }, [consent])

  const closePreferences = useCallback(() => {
    setIsPreferencesOpen(false)
  }, [])

  const acceptAll = useCallback(() => {
    saveConsent({ analytics: true, marketing: true })
  }, [saveConsent])

  const rejectNonEssential = useCallback(() => {
    saveConsent({ analytics: false, marketing: false })
  }, [saveConsent])

  const savePreferences = useCallback(() => {
    saveConsent(draftPreferences)
  }, [draftPreferences, saveConsent])

  const contextValue = useMemo(() => ({
    consent,
    hasSavedPreference: Boolean(consent),
    openPreferences,
    closePreferences,
    acceptAll,
    rejectNonEssential,
    savePreferences,
  }), [acceptAll, closePreferences, consent, openPreferences, rejectNonEssential, savePreferences])

  const shouldShowBanner = isInitialized && !consent && !isPreferencesOpen

  return (
    <CookieConsentContext.Provider value={contextValue}>
      {children}
      {shouldShowBanner && (
        <CookieBanner onAcceptAll={acceptAll} onReject={rejectNonEssential} onManage={openPreferences} />
      )}
      {isPreferencesOpen && (
        <CookiePreferencesModal
          draftPreferences={draftPreferences}
          onDraftChange={setDraftPreferences}
          onClose={closePreferences}
          onAcceptAll={acceptAll}
          onReject={rejectNonEssential}
          onSave={savePreferences}
        />
      )}
    </CookieConsentContext.Provider>
  )
}
