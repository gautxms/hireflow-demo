import { createElement, useSyncExternalStore } from 'react'
import App from '../App.jsx'

const subscribe = () => () => {}
// Match the anonymous SSR tree during hydration, then hand routing to the auth-aware app.
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export default function StaticPublicRouteBootstrap({ PublicRouteComponent, pathname }) {
  const showAuthenticatedApp = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)

  if (showAuthenticatedApp) {
    return <App />
  }

  return createElement(PublicRouteComponent, { pathname })
}
