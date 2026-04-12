export type HealthStatus = 'online' | 'offline';

export interface SystemHealth {
  status: HealthStatus;
  timestamp?: string;
  uptimeSeconds?: number;
}

export interface SystemConfig {
  environment: string;
  tradingMode: 'paper' | 'live' | 'unknown';
}

export interface BrokerStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  brokerName?: string;
  message?: string;
  updatedAt?: string;
}

export interface PortfolioOverview {
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl?: number;
  updatedAt?: string;
}

export interface CashSummary {
  availableCash: number;
  utilizedCash?: number;
  totalCash?: number;
  updatedAt?: string;
}

export interface Position {
  id?: string;
  symbol: string;
  exchange?: string;
  productType?: string;
  quantity: number;
  avgEntryPrice: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  status?: string;
}

export type TradeSide = 'BUY' | 'SELL' | 'UNKNOWN';

export interface TradeOrderRow {
  id: string;
  time: string;
  symbol: string;
  side: TradeSide;
  orderType?: string;
  quantity: number;
  price?: number;
  avgPrice?: number;
  status: string;
  mode?: 'paper' | 'live' | 'unknown';
  rejectionReason?: string;
}

export interface CostSummary {
  totalCharges: number;
  brokerage?: number;
  taxes?: number;
  fees?: number;
  updatedAt?: string;
}

export interface DashboardData {
  health?: SystemHealth;
  config?: SystemConfig;
  broker?: BrokerStatus;
  portfolio?: PortfolioOverview;
  cash?: CashSummary;
  positions: Position[];
  recentActivity: TradeOrderRow[];
  costs?: CostSummary;
  lastUpdated?: string;
}

export interface DashboardErrors {
  health?: string;
  config?: string;
  broker?: string;
  portfolio?: string;
  cash?: string;
  positions?: string;
  recentActivity?: string;
  costs?: string;
}
