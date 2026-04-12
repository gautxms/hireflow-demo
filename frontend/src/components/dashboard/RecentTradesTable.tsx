import type { TradeOrderRow } from '../../types/dashboard';

interface RecentTradesTableProps {
  rows: TradeOrderRow[];
  loading?: boolean;
  error?: string;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

export default function RecentTradesTable({ rows, loading, error }: RecentTradesTableProps) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading recent trades/orders…</p>;
  if (error && !rows.length) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (!rows.length) return <p style={{ color: '#6b7280' }}>No recent activity available.</p>;

  return (
    <div>
      {error ? <p style={{ color: '#b45309', marginTop: 0 }}>Partial data warning: {error}</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {['Time', 'Symbol', 'Side', 'Order Type', 'Quantity', 'Price / Avg', 'Status', 'Paper/Live', 'Rejection Reason'].map((label) => (
                <th key={label} style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '10px 8px', color: '#374151' }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{formatTime(row.time)}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.symbol}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.side}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.orderType || '—'}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.quantity}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>
                  {Number.isFinite(row.price) ? inrFormatter.format(row.price as number) : '—'} /{' '}
                  {Number.isFinite(row.avgPrice) ? inrFormatter.format(row.avgPrice as number) : '—'}
                </td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.status}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6', textTransform: 'capitalize' }}>{row.mode || 'unknown'}</td>
                <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{row.rejectionReason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
