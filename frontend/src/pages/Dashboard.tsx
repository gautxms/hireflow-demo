import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDashboardData } from '../api/dashboard';
import CashSummaryCard from '../components/dashboard/CashSummaryCard';
import OpenPositionsTable from '../components/dashboard/OpenPositionsTable';
import PnlSummaryCard from '../components/dashboard/PnlSummaryCard';
import PortfolioSummaryCard from '../components/dashboard/PortfolioSummaryCard';
import RecentTradesTable from '../components/dashboard/RecentTradesTable';
import SystemStatusCard from '../components/dashboard/SystemStatusCard';
import type { DashboardData, DashboardErrors } from '../types/dashboard';

const POLL_INTERVAL_MS = 12000;

const createInitialData = (): DashboardData => ({ positions: [], recentActivity: [] });

export default function Dashboard() {
  const [data, setData] = useState<DashboardData>(createInitialData());
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [isInitialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (isManual = false) => {
    setRefreshing(true);

    try {
      const result = await fetchDashboardData();
      setData((prev) => ({ ...prev, ...result.data }));
      setErrors(result.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh dashboard';
      setErrors((prev) => ({ ...prev, health: message, recentActivity: prev.recentActivity ?? message }));
    } finally {
      setRefreshing(false);
      if (isManual || isInitialLoading) {
        setInitialLoading(false);
      }
    }
  }, [isInitialLoading]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const combinedStatusError = useMemo(
    () => [errors.health, errors.config, errors.broker].filter(Boolean).join(' • '),
    [errors.health, errors.config, errors.broker],
  );

  return (
    <main style={{ padding: 20, background: '#f8fafc', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Trading Dashboard</h1>
          <p style={{ margin: '6px 0 0', color: '#64748b' }}>Phase 1 monitor: portfolio, positions, trades, and system health.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <small style={{ color: '#64748b' }}>Last updated: {data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : '—'}</small>
          <button
            onClick={() => void refresh(true)}
            disabled={isRefreshing}
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px 12px',
              background: '#fff',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
            }}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 18,
        }}
      >
        <PortfolioSummaryCard label="Portfolio Value" value={data.portfolio?.equity} loading={isInitialLoading} error={errors.portfolio} />
        <CashSummaryCard availableCash={data.cash?.availableCash} loading={isInitialLoading} error={errors.cash} />
        <PnlSummaryCard label="Realized P&L" pnl={data.portfolio?.realizedPnl} loading={isInitialLoading} error={errors.portfolio} />
        <PnlSummaryCard label="Unrealized P&L" pnl={data.portfolio?.unrealizedPnl} loading={isInitialLoading} error={errors.portfolio} />
        <PnlSummaryCard label="Net P&L" pnl={data.portfolio?.netPnl} loading={isInitialLoading} error={errors.costs} />
      </section>

      <section style={{ marginTop: 16, border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>Open Positions</h2>
        <OpenPositionsTable positions={data.positions} loading={isInitialLoading} error={errors.positions} />
      </section>

      <section style={{ marginTop: 16, border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>Recent Trades / Orders</h2>
        <RecentTradesTable rows={data.recentActivity} loading={isInitialLoading} error={errors.recentActivity} />
      </section>

      <section style={{ marginTop: 16 }}>
        <SystemStatusCard
          health={data.health}
          config={data.config}
          broker={data.broker}
          loading={isRefreshing && !isInitialLoading}
          error={combinedStatusError}
          lastUpdated={data.lastUpdated}
        />
      </section>
    </main>
  );
}
