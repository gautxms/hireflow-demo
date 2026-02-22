import { useState } from 'react'
import LandingPage from './components/LandingPage'
import OperationsDashboard from './components/Dashboard'

export default function App() {
  const [view, setView] = useState('landing') // 'landing' or 'dashboard'

  return (
    <>
      {view === 'landing' ? (
        <LandingPage onStartDemo={() => setView('dashboard')} />
      ) : (
        <div>
          <button 
            onClick={() => setView('landing')}
            style={{
              position: 'fixed',
              top: '1rem',
              right: '2rem',
              background: 'var(--accent)',
              color: 'var(--ink)',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              zIndex: 50
            }}
          >
            ← Back to Landing
          </button>
          <OperationsDashboard />
        </div>
      )}
    </>
  )
}
