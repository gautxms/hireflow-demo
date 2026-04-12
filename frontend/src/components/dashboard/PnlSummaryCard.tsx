interface PnlSummaryCardProps {
  label: string;
  pnl?: number;
  loading?: boolean;
  error?: string;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export default function PnlSummaryCard({ label, pnl, loading, error }: PnlSummaryCardProps) {
  const color = (pnl ?? 0) >= 0 ? '#15803d' : '#b91c1c';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
      <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{label}</p>
      {loading ? (
        <p style={{ margin: '10px 0 0', color: '#6b7280' }}>Loading…</p>
      ) : error ? (
        <p style={{ margin: '10px 0 0', color: '#dc2626' }}>{error}</p>
      ) : (
        <h3 style={{ margin: '10px 0 0', fontSize: 24, color }}>{inrFormatter.format(pnl ?? 0)}</h3>
      )}
    </div>
  );
}
