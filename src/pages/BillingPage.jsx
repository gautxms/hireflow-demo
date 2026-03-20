import { useEffect, useMemo, useState } from 'react'
import usePageSeo from '../hooks/usePageSeo'
import BackButton from '../components/BackButton'

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_PROD_API_BASE_URL = 'https://hireflow-backend-production.up.railway.app'
const TOKEN_STORAGE_KEY = 'hireflow_auth_token'

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  return import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL
}

const API_BASE_URL = resolveApiBaseUrl()

const CANCEL_REASONS = [
  'Too expensive',
  'Missing key feature',
  'Temporary pause',
  'Switching to competitor',
]

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: '1rem', zIndex: 40 }}>
      <div style={{ width: '100%', maxWidth: 540, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: '0.8rem' }}>{children}</div>
      </div>
    </div>
  )
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [targetPlan, setTargetPlan] = useState('monthly')
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0])

  usePageSeo('Billing & Subscription', 'Manage your subscription, invoices, and billing settings.')

  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  async function loadBilling() {
    if (!token) {
      setError('Please login to manage billing.')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [subRes, historyRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/subscriptions/current`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/subscriptions/history`, { headers: { Authorization: `Bearer ${token}` } }),
      ])

      const subPayload = await subRes.json()
      const historyPayload = await historyRes.json()

      if (!subRes.ok) {
        throw new Error(subPayload.error || 'Failed to load current subscription')
      }

      if (!historyRes.ok) {
        throw new Error(historyPayload.error || 'Failed to load invoice history')
      }

      setSubscription(subPayload.subscription)
      setHistory(historyPayload.invoices || [])
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to load billing details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBilling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchingLabel = useMemo(() => {
    if (!subscription) return ''
    return targetPlan === 'annual' ? 'Upgrade to annual (prorated)' : 'Downgrade to monthly'
  }, [subscription, targetPlan])

  async function changePlan() {
    const response = await fetch(`${API_BASE_URL}/api/subscriptions/change-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetPlan }),
    })

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to update plan')
    }

    setPlanModalOpen(false)
    await loadBilling()
  }

  async function cancelSubscription() {
    const response = await fetch(`${API_BASE_URL}/api/subscriptions/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason: cancelReason, acceptOffer: false }),
    })

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to cancel subscription')
    }

    setCancelModalOpen(false)
    await loadBilling()
  }

  async function downloadInvoice(invoiceId) {
    const response = await fetch(`${API_BASE_URL}/api/subscriptions/invoices/${invoiceId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Unable to download invoice')
    }

    const blob = await response.blob()
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `invoice-${invoiceId}.pdf`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  if (loading) {
    return <main style={{ padding: '2rem' }}>Loading billing dashboard…</main>
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)' }}>
      <section style={{ maxWidth: 980, margin: '0 auto', padding: '2.5rem 1rem 3rem' }}>
        <BackButton />
        <h1 style={{ marginBottom: '0.4rem' }}>Subscription Management</h1>
        <p style={{ color: 'var(--muted)' }}>View plans, upcoming charges, and invoice history.</p>

        {error ? <p style={{ color: '#ff8f8f' }}>{error}</p> : null}

        {subscription ? (
          <>
            <article style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', background: 'var(--card)' }}>
              <h2 style={{ marginTop: 0 }}>Current Plan</h2>
              <p style={{ margin: '0.2rem 0' }}><strong>{subscription.planLabel}</strong> — {subscription.costFormatted}</p>
              <p style={{ margin: '0.2rem 0', color: 'var(--muted)' }}>Renewal date: {subscription.renewalDate ? new Date(subscription.renewalDate).toLocaleDateString() : '—'}</p>
              <p style={{ margin: '0.2rem 0', color: 'var(--muted)' }}>Next billing: {subscription.nextBillingDate ? new Date(subscription.nextBillingDate).toLocaleDateString() : '—'}</p>
              <p style={{ margin: '0.2rem 0', color: 'var(--muted)' }}>Payment method: {subscription.paymentMethod}</p>
              <p style={{ margin: '0.2rem 0', color: 'var(--muted)' }}>Status: {subscription.status}</p>

              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { setTargetPlan(subscription.plan === 'monthly' ? 'annual' : 'monthly'); setPlanModalOpen(true) }}>
                  {subscription.plan === 'monthly' ? 'Upgrade to annual' : 'Downgrade to monthly'}
                </button>
                <button type="button" onClick={() => setCancelModalOpen(true)} disabled={subscription.status === 'cancelled'}>
                  Cancel subscription
                </button>
              </div>
            </article>

            <article style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', background: 'var(--card)' }}>
              <h2 style={{ marginTop: 0 }}>Billing History (past 12 months)</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th align="left">Date</th>
                    <th align="left">Amount</th>
                    <th align="left">Status</th>
                    <th align="left">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '0.6rem 0' }}>No invoices yet.</td></tr>
                  ) : history.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: '0.45rem 0' }}>{new Date(row.date).toLocaleDateString()}</td>
                      <td>{row.amountFormatted}</td>
                      <td>{row.status}</td>
                      <td>
                        <button type="button" onClick={() => downloadInvoice(row.id)} disabled={!row.canDownload}>Download PDF</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </>
        ) : null}
      </section>

      {planModalOpen ? (
        <Modal title="Confirm plan change" onClose={() => setPlanModalOpen(false)}>
          <p>{switchingLabel}</p>
          <p style={{ color: 'var(--muted)' }}>
            Upgrades apply prorated credits immediately. Downgrades take effect at the next billing date.
          </p>
          <button type="button" onClick={changePlan}>Confirm</button>
        </Modal>
      ) : null}

      {cancelModalOpen ? (
        <Modal title="Cancel subscription" onClose={() => setCancelModalOpen(false)}>
          <p>If you cancel, access remains active through the end of your current billing period.</p>
          <p style={{ color: 'var(--muted)' }}>Before you go: Contact support for a retention discount.</p>
          <label htmlFor="cancel-reason">Reason</label>
          <select id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} style={{ width: '100%', marginTop: '0.3rem', marginBottom: '0.8rem' }}>
            {CANCEL_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
          <button type="button" onClick={cancelSubscription}>Confirm cancellation</button>
        </Modal>
      ) : null}
    </main>
  )
}
