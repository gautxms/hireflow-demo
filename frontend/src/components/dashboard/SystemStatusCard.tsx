import type { BrokerStatus, SystemConfig, SystemHealth } from '../../types/dashboard';

interface SystemStatusCardProps {
  health?: SystemHealth;
  config?: SystemConfig;
  broker?: BrokerStatus;
  loading?: boolean;
  error?: string;
  lastUpdated?: string;
}

const statusPill = (ok: boolean) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  background: ok ? '#dcfce7' : '#fee2e2',
  color: ok ? '#166534' : '#991b1b',
  marginLeft: 8,
});

export default function SystemStatusCard({ health, config, broker, loading, error, lastUpdated }: SystemStatusCardProps) {
  const backendOnline = health?.status === 'online';

  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
      <h3 style={{ marginTop: 0 }}>System Status</h3>
      {loading ? <p style={{ color: '#6b7280' }}>Refreshing status…</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <li>
          Backend
          <span style={statusPill(backendOnline)}>{backendOnline ? 'Online' : 'Offline'}</span>
        </li>
        <li>Environment: {config?.environment || 'unknown'}</li>
        <li style={{ textTransform: 'capitalize' }}>Trading mode: {config?.tradingMode || 'unknown'}</li>
        <li>
          Broker Enabled
          <span style={statusPill(Boolean(broker?.enabled))}>{broker?.enabled ? 'Yes' : 'No'}</span>
        </li>
        <li>
          Broker Configured
          <span style={statusPill(Boolean(broker?.configured))}>{broker?.configured ? 'Yes' : 'No'}</span>
        </li>
        <li>
          Broker Connected
          <span style={statusPill(Boolean(broker?.connected))}>{broker?.connected ? 'Yes' : 'No'}</span>
        </li>
        <li>Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '—'}</li>
      </ul>
    </section>
  );
}
