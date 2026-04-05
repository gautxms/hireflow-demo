import { Suspense, lazy } from 'react'

const App = lazy(() => import('../../src/App.jsx'))

export default function FrontendApp() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}
