import React from 'react'

function isChunkLoadError(error) {
  const message = error?.message || ''
  return (
    error?.name === 'ChunkLoadError'
    || message.includes('Failed to fetch dynamically imported module')
    || message.includes('Loading chunk')
  )
}

export default class PublicRouteChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasChunkError: false }
  }

  static getDerivedStateFromError(error) {
    if (isChunkLoadError(error)) {
      return { hasChunkError: true }
    }
    return null
  }

  componentDidCatch(error) {
    if (!isChunkLoadError(error)) {
      throw error
    }
  }

  handleReload = () => window.location.reload()

  handlePrimaryAction = () => {
    const { primaryAction } = this.props
    if (typeof primaryAction === 'function') {
      primaryAction()
    }
  }

  handleSecondaryAction = () => {
    const { secondaryAction } = this.props
    if (typeof secondaryAction === 'function') {
      secondaryAction()
    }
  }

  render() {
    if (this.state.hasChunkError) {
      return (
        <main className="route-state route-state--error" role="alert" aria-live="assertive">
          <section className="route-state-card">
            <p className="route-state-card__eyebrow">HireFlow recovery mode</p>
            <h1 className="route-state-card__title">We couldn’t load this page</h1>
            <p className="route-state-card__description">
              Please reload to refresh app assets, or use the fallback action while we recover this route.
            </p>
            <div className="route-state-card__actions route-state-card__actions--recovery">
              <button type="button" className="route-state-card__action" onClick={this.handleReload}>Reload page</button>
              {typeof this.props.primaryAction === 'function' && (
                <button type="button" className="route-state-card__action" onClick={this.handlePrimaryAction}>{this.props.primaryLabel || 'Go to dashboard'}</button>
              )}
              {typeof this.props.secondaryAction === 'function' && (
                <button type="button" className="route-state-card__action" onClick={this.handleSecondaryAction}>{this.props.secondaryLabel || 'Go to pricing'}</button>
              )}
            </div>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
