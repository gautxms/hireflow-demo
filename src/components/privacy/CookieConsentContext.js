import { createContext, useContext } from 'react'

export const CookieConsentContext = createContext(null)

export function useCookieConsent() {
  const context = useContext(CookieConsentContext)

  if (!context) {
    return {
      consent: null,
      hasSavedPreference: false,
      openPreferences: () => {},
      closePreferences: () => {},
      acceptAll: () => {},
      rejectNonEssential: () => {},
      savePreferences: () => {},
    }
  }

  return context
}
