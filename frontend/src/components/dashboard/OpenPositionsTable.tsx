import type { Position } from '../../types/dashboard';

interface OpenPositionsTableProps {
  positions: Position[];
  loading?: boolean;
  error?: string;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export default function OpenPositionsTable({ positions, loading, error }: OpenPositionsTableProps) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading open positions…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (!positions.length) return <p style={{ color: '#6b7280' }}>No open positions yet.</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {['Symbol', 'Exchange', 'Product', 'Qty', 'Avg Entry', 'Last', 'Market Value', 'Unrealized P&L', 'Status'].map((label) => (
              <th key={label} style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '10px 8px', color: '#374151' }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.id ?? `${position.symbol}-${position.quantity}`}>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{position.symbol}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{position.exchange || '—'}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{position.productType || '—'}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{position.quantity}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{inrFormatter.format(position.avgEntryPrice)}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{inrFormatter.format(position.lastPrice)}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{inrFormatter.format(position.marketValue)}</td>
              <td
                style={{
                  padding: '10px 8px',
                  borderBottom: '1px solid #f3f4f6',
                  color: position.unrealizedPnl >= 0 ? '#15803d' : '#b91c1c',
                }}
              >
                {inrFormatter.format(position.unrealizedPnl)}
              </td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid #f3f4f6' }}>{position.status || 'OPEN'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
