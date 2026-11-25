import { formatFinancialAmount } from '../../utils/financial-display';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02
 *
 * Mirrors the shapes returned by the real backend (`src/dashboard/dashboard.service.ts` /
 * `dashboard-widget-data.service.ts` / `dashboard-widget-registry.ts`). Kept intentionally small
 * and permissive (optional fields) — these describe REAL API responses, not a design aspiration,
 * and the backend is the single source of truth for what each widget actually returns.
 */

export type DashboardWidgetKind =
  | 'identity'
  | 'entitlements'
  | 'kpi-summary'
  | 'table'
  | 'status-breakdown'
  | 'trend'
  | 'link';

export interface ResolvedWidget {
  widgetKey: string;
  order: number;
  title?: string;
  displayName: string;
  description: string;
  fetchMode: 'proxy' | 'direct';
  endpoint?: string;
  supportsPeriodFilter?: boolean;
  kind: DashboardWidgetKind | string;
  authorized: boolean;
  /** Catalogue functions the widget needs; used to explain a restricted tile. */
  requiredFunctions?: readonly string[];
  /**
   * The workspace the server says holds this card's records. Declared by the backend registry,
   * resolved through the console's navigation guard, and never synthesized on the client.
   */
  drilldown?: { view: string; label: string; preset?: string };
  /** Endpoint that answers for this card, so a figure can be traced to its source. */
  dataEndpoint?: string;
}

/**
 * `notification-delivery-exceptions` payload shape, as produced by
 * `GET /internal/a2/workforce/dashboard/widgets/notification-delivery-exceptions`.
 *
 * `availability`/`configuration` are the load-bearing pair: a measured zero, an unreadable
 * delivery log and a deployment with no transport configured are three different operational
 * truths and the card must not flatten them into one number.
 */
export interface NotificationExceptionsResponse {
  period: DashboardPeriod;
  from: string;
  to: string;
  availability: 'MEASURED' | 'UNAVAILABLE';
  configuration?: 'CONFIGURED' | 'NO_TRANSPORT_CONFIGURED' | 'UNKNOWN';
  configurationNote?: string;
  reason?: string;
  window?: { hours?: number; from?: string; to?: string };
  totals: {
    deliveries: number;
    exceptions: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  errorCodes: Array<{ errorCode: string; count: number; lastSeenAt: string | null }>;
  retry: {
    pending?: number;
    failedAwaitingRetry?: number;
    dead?: number;
    unknown?: number;
    oldestPendingAt?: string | null;
    nextScheduledRetryAt?: string | null;
    manualRetrySupported: false;
    policyReference?: string;
  };
  provider: {
    availability: 'CHECKED' | 'UNKNOWN';
    projectionScope?: string;
    channels: Array<{ channel: string; available: boolean }>;
  };
  definition?: string;
  checkedAt: string;
  source?: string;
}

export interface ResolvedDashboard {
  templateKey: string;
  displayName: string;
  description: string;
  isFallback: boolean;
  fallbackReason?: string;
  widgets: ResolvedWidget[];
}

export interface DashboardTemplateSummary {
  id: string;
  templateKey: string;
  displayName: string;
  description: string;
  operationalArea: string;
  isActive: boolean;
  layout: { widgets: Array<{ widgetKey: string; order: number; title?: string }> };
  createdAt: string;
  updatedAt: string;
}

export interface RoleDashboardAssignmentSummary {
  id: string;
  roleKey: string;
  templateKey: string;
  assignedBy: string;
  assignedAt: string;
  reason?: string | null;
}

export interface AuthorizationRoleSummary {
  id: string;
  roleKey: string;
  displayName: string;
  isActive: boolean;
}

export interface WidgetRegistryEntry {
  widgetKey: string;
  displayName: string;
  description: string;
  requiredFunctions: readonly string[];
  fetchMode: 'proxy' | 'direct';
  endpoint?: string;
  supportsPeriodFilter?: boolean;
  kind: DashboardWidgetKind | string;
  /** Declared destination for the card's records, as read from the server-side registry. */
  drilldown?: { view: string; label: string; preset?: string };
}

export type DashboardPeriod = 'today' | '7d' | '30d' | 'custom';

export interface TransactionByType {
  type: 'W2W' | 'C2W' | 'W2C' | 'C2C';
  completedCount: number;
  completedValueMinor: string;
  failedCount: number;
  pendingCount: number;
  feeRevenueMinor: string | null;
}

export interface TransactionSummaryResponse {
  period: DashboardPeriod;
  from: string;
  to: string;
  currency: string;
  totalCompletedCount: number;
  totalCompletedValueMinor: string;
  totalFailedCount: number;
  totalPendingCount: number;
  successRatePercent: number | null;
  totalFeeRevenueMinor: string;
  feeRevenueNote: string;
  byType: TransactionByType[];
  commission: null;
  commissionNote: string;
  previousPeriod?: {
    from: string;
    to: string;
    totalCompletedCount: number;
    totalCompletedValueMinor: string;
    successRatePercent: number | null;
    totalFeeRevenueMinor: string;
  };
  comparison?: {
    definition: string;
    completedCountChangePercent: number | null;
    completedValueChangePercent: number | null;
  };
}

export interface TransactionTrendResponse {
  period: DashboardPeriod;
  from: string;
  to: string;
  currency: string;
  definition: string;
  daily: Array<{ date: string; completedCount: number; completedValueMinor: string }>;
}

export interface RecentTransactionRow {
  type: 'W2W' | 'C2W' | 'W2C' | 'C2C';
  reference: string;
  amountMinor: string;
  feeMinor: string | null;
  currency: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

/** Display exact NGN kobo as naira; retain other currencies in their authoritative minor units. */
export function formatMinor(minor: string | number | null | undefined, currency?: string): string {
  if (minor === null || minor === undefined) return '—';
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) return 'Amount unavailable';
  const raw = String(minor);
  if (!/^-?\d+$/.test(raw) || typeof currency !== 'string' || !currency.trim())
    return 'Amount unavailable';
  return formatFinancialAmount(raw, currency);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}
