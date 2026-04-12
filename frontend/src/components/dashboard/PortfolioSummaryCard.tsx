interface PortfolioSummaryCardProps {
  label: string;
  value?: number;
  loading?: boolean;
  error?: string;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export default function PortfolioSummaryCard({ label, value, loading, error }: PortfolioSummaryCardProps) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
      <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{label}</p>
      {loading ? (
        <p style={{ margin: '10px 0 0', color: '#6b7280' }}>Loading…</p>
      ) : error ? (
        <p style={{ margin: '10px 0 0', color: '#dc2626' }}>{error}</p>
      ) : (
        <h3 style={{ margin: '10px 0 0', fontSize: 24 }}>{inrFormatter.format(value ?? 0)}</h3>
      )}
    </div>
  );
}
