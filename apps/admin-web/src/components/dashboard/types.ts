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

/** Formats a minor-unit integer string (kobo) as whole Naira with thousands separators. */
export function formatMinor(minor: string | number | null | undefined, currency = 'NGN'): string {
  if (minor === null || minor === undefined) return '—';
  const symbol = currency === 'NGN' ? '₦' : `${currency} `;
  try {
    const asBigInt = BigInt(minor);
    const negative = asBigInt < BigInt(0);
    const abs = negative ? -asBigInt : asBigInt;
    const naira = abs / BigInt(100);
    const kobo = abs % BigInt(100);
    const wholePart = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${symbol}${wholePart}.${kobo.toString().padStart(2, '0')}`;
  } catch {
    return String(minor);
  }
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
