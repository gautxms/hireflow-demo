function isPaymentsEnabled() {
  return String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true'
}

function requirePaymentsEnabled(_req, res, next) {
  if (!isPaymentsEnabled()) {
    return res.status(503).json({
      error: 'Payments are currently disabled. Set PAYMENTS_ENABLED=true to enable Stripe endpoints.',
    })
  }

  return next()
}

export { isPaymentsEnabled, requirePaymentsEnabled }
