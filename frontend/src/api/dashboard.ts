import { getJson } from './client';
import type {
  BrokerStatus,
  CashSummary,
  CostSummary,
  DashboardData,
  DashboardErrors,
  PortfolioOverview,
  Position,
  SystemConfig,
  SystemHealth,
  TradeOrderRow,
  TradeSide,
} from '../types/dashboard';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (typeof value === 'object' && value !== null ? (value as UnknownRecord) : {});

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
};

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const asBool = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback);

const parseHealth = (payload: unknown): SystemHealth => {
  const record = asRecord(payload);
  const statusRaw = asString(record.status, 'offline').toLowerCase();
  const status = statusRaw === 'ok' || statusRaw === 'healthy' || statusRaw === 'online' ? 'online' : 'offline';

  return {
    status,
    timestamp: asString(record.timestamp) || new Date().toISOString(),
    uptimeSeconds: asNumber(record.uptime ?? record.uptimeSeconds, 0),
  };
};

const parseConfig = (payload: unknown): SystemConfig => {
  const record = asRecord(payload);
  const env = asString(record.environment ?? record.env, 'unknown');
  const modeRaw = asString(record.tradingMode ?? record.mode, 'unknown').toLowerCase();
  const tradingMode = modeRaw === 'paper' || modeRaw === 'live' ? modeRaw : 'unknown';

  return { environment: env, tradingMode };
};

const parseBrokerStatus = (payload: unknown): BrokerStatus => {
  const record = asRecord(payload);

  return {
    enabled: asBool(record.enabled),
    configured: asBool(record.configured),
    connected: asBool(record.connected),
    brokerName: asString(record.brokerName ?? record.name),
    message: asString(record.message),
    updatedAt: asString(record.updatedAt ?? record.timestamp),
  };
};

const parsePortfolio = (payload: unknown): PortfolioOverview => {
  const record = asRecord(payload);

  return {
    equity: asNumber(record.equity ?? record.portfolioValue ?? record.totalValue),
    realizedPnl: asNumber(record.realizedPnl ?? record.realizedPnL),
    unrealizedPnl: asNumber(record.unrealizedPnl ?? record.unrealizedPnL),
    netPnl: asNumber(record.netPnl ?? record.totalPnl, Number.NaN),
    updatedAt: asString(record.updatedAt ?? record.timestamp),
  };
};

const parseCash = (payload: unknown): CashSummary => {
  const record = asRecord(payload);

  return {
    availableCash: asNumber(record.availableCash ?? record.available),
    utilizedCash: asNumber(record.utilizedCash ?? record.utilized, Number.NaN),
    totalCash: asNumber(record.totalCash ?? record.total, Number.NaN),
    updatedAt: asString(record.updatedAt ?? record.timestamp),
  };
};

const parsePosition = (item: unknown): Position => {
  const record = asRecord(item);
  const quantity = asNumber(record.quantity ?? record.qty);
  const lastPrice = asNumber(record.lastPrice ?? record.ltp);

  return {
    id: asString(record.id),
    symbol: asString(record.symbol),
    exchange: asString(record.exchange),
    productType: asString(record.productType ?? record.product),
    quantity,
    avgEntryPrice: asNumber(record.avgEntryPrice ?? record.averagePrice),
    lastPrice,
    marketValue: asNumber(record.marketValue, quantity * lastPrice),
    unrealizedPnl: asNumber(record.unrealizedPnl ?? record.unrealizedPnL),
    status: asString(record.status, quantity !== 0 ? 'OPEN' : 'CLOSED'),
  };
};

const parseSide = (value: unknown): TradeSide => {
  const normalized = asString(value, '').toUpperCase();
  if (normalized === 'BUY' || normalized === 'SELL') return normalized;
  return 'UNKNOWN';
};

const parseTradeOrder = (item: unknown): TradeOrderRow => {
  const record = asRecord(item);

  return {
    id: asString(record.id ?? record.orderId ?? record.tradeId, crypto.randomUUID()),
    time: asString(record.time ?? record.timestamp ?? record.createdAt, new Date(0).toISOString()),
    symbol: asString(record.symbol),
    side: parseSide(record.side ?? record.transactionType),
    orderType: asString(record.orderType ?? record.type),
    quantity: asNumber(record.quantity ?? record.qty),
    price: asNumber(record.price, Number.NaN),
    avgPrice: asNumber(record.avgPrice ?? record.averagePrice, Number.NaN),
    status: asString(record.status, 'UNKNOWN'),
    mode: ((): 'paper' | 'live' | 'unknown' => {
      const raw = asString(record.mode ?? record.executionMode, 'unknown').toLowerCase();
      if (raw === 'paper' || raw === 'live') return raw;
      return 'unknown';
    })(),
    rejectionReason: asString(record.rejectionReason ?? record.reason),
  };
};

const parseCostSummary = (payload: unknown): CostSummary => {
  const record = asRecord(payload);

  return {
    totalCharges: asNumber(record.totalCharges ?? record.totalCost),
    brokerage: asNumber(record.brokerage, Number.NaN),
    taxes: asNumber(record.taxes ?? record.tax, Number.NaN),
    fees: asNumber(record.fees, Number.NaN),
    updatedAt: asString(record.updatedAt ?? record.timestamp),
  };
};

export async function fetchDashboardData(): Promise<{ data: DashboardData; errors: DashboardErrors }> {
  const data: DashboardData = {
    positions: [],
    recentActivity: [],
    lastUpdated: new Date().toISOString(),
  };
  const errors: DashboardErrors = {};

  const promises = await Promise.allSettled([
    getJson('/health'),
    getJson('/api/v1/system/config'),
    getJson('/api/v1/broker/status'),
    getJson('/api/v1/portfolio'),
    getJson('/api/v1/portfolio/cash'),
    getJson('/api/v1/portfolio/positions'),
    getJson('/api/v1/portfolio/trades'),
    getJson('/api/v1/orders'),
    getJson('/api/v1/costs/summary'),
  ]);

  const [
    healthResult,
    configResult,
    brokerResult,
    portfolioResult,
    cashResult,
    positionsResult,
    tradesResult,
    ordersResult,
    costsResult,
  ] = promises;

  if (healthResult.status === 'fulfilled') data.health = parseHealth(healthResult.value);
  else errors.health = healthResult.reason?.message ?? 'Failed to load backend health';

  if (configResult.status === 'fulfilled') data.config = parseConfig(configResult.value);
  else errors.config = configResult.reason?.message ?? 'Failed to load system config';

  if (brokerResult.status === 'fulfilled') data.broker = parseBrokerStatus(brokerResult.value);
  else errors.broker = brokerResult.reason?.message ?? 'Failed to load broker status';

  if (portfolioResult.status === 'fulfilled') data.portfolio = parsePortfolio(portfolioResult.value);
  else errors.portfolio = portfolioResult.reason?.message ?? 'Failed to load portfolio';

  if (cashResult.status === 'fulfilled') data.cash = parseCash(cashResult.value);
  else errors.cash = cashResult.reason?.message ?? 'Failed to load cash summary';

  if (positionsResult.status === 'fulfilled') {
    const raw = Array.isArray(positionsResult.value)
      ? positionsResult.value
      : (asRecord(positionsResult.value).positions as unknown[]) ?? [];
    data.positions = raw.map(parsePosition).filter((row) => row.symbol);
  } else {
    errors.positions = positionsResult.reason?.message ?? 'Failed to load positions';
  }

  const activityRows: TradeOrderRow[] = [];

  if (tradesResult.status === 'fulfilled') {
    const raw = Array.isArray(tradesResult.value)
      ? tradesResult.value
      : (asRecord(tradesResult.value).trades as unknown[]) ?? [];
    activityRows.push(...raw.map(parseTradeOrder));
  } else {
    errors.recentActivity = tradesResult.reason?.message ?? 'Failed to load trades';
  }

  if (ordersResult.status === 'fulfilled') {
    const raw = Array.isArray(ordersResult.value)
      ? ordersResult.value
      : (asRecord(ordersResult.value).orders as unknown[]) ?? [];
    activityRows.push(...raw.map(parseTradeOrder));
  }

  data.recentActivity = activityRows
    .filter((row) => row.symbol)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 25);

  if (costsResult.status === 'fulfilled') data.costs = parseCostSummary(costsResult.value);
  else errors.costs = costsResult.reason?.message ?? 'Cost summary unavailable';

  data.lastUpdated = new Date().toISOString();

  if (Number.isNaN(data.portfolio?.netPnl) && data.portfolio) {
    const estimatedNet = data.portfolio.realizedPnl + data.portfolio.unrealizedPnl - (data.costs?.totalCharges ?? 0);
    data.portfolio.netPnl = estimatedNet;
  }

  return { data, errors };
}
