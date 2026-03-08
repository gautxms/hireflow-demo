import { useEffect, useState } from 'react'

export function useLocation() {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    state: window.history.state,
  }))

  useEffect(() => {
    const handleLocationChange = () => {
      setLocation({
        pathname: window.location.pathname,
        state: window.history.state,
      })
    }

    window.addEventListener('popstate', handleLocationChange)

    return () => {
      window.removeEventListener('popstate', handleLocationChange)
    }
  }, [])

  return location
}
