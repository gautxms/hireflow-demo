import { useState } from 'react'
import LandingPage from './components/LandingPage'
import Dashboard from './components/Dashboard'

export default function App() {
  const [showDemo, setShowDemo] = useState(false)

  return (
    <>
      {!showDemo ? (
        <LandingPage onStartDemo={() => setShowDemo(true)} />
      ) : (
        <Dashboard onBack={() => setShowDemo(false)} />
      )}
    </>
  )
}
