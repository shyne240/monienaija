/** Runtime checks for dashboard widget responses. A malformed or incomplete response is not an empty result. */
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const minor = (value: unknown): value is string => typeof value === 'string' && /^-?\d+$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const verification = (value: unknown) => value === 'PASS' || value === 'WARNING' || value === 'ERROR';

export interface ReconciliationWidgetData {
  report: { status: string; generatedAt: string; checks: Array<{ name: string; status: string; message: string }> };
  trialBalance: { generatedAt: string; balanced: boolean; dimensions: Array<{ currency: string; accountingUnit: string; totalDebitsMinor: string; totalCreditsMinor: string; balanced: boolean }> };
}

export function isReconciliationWidgetData(value: unknown): value is ReconciliationWidgetData {
  if (!object(value) || !object(value.report) || !object(value.trialBalance)) return false;
  const report = value.report, trial = value.trialBalance;
  return verification(report.status) && timestamp(report.generatedAt) && Array.isArray(report.checks) &&
    report.checks.every((check: unknown) => object(check) && text(check.name) && verification(check.status) && typeof check.message === 'string') &&
    timestamp(trial.generatedAt) && typeof trial.balanced === 'boolean' && Array.isArray(trial.dimensions) &&
    trial.dimensions.every((row: unknown) => object(row) && text(row.currency) && text(row.accountingUnit) &&
      minor(row.totalDebitsMinor) && minor(row.totalCreditsMinor) && typeof row.balanced === 'boolean' &&
      row.balanced === (BigInt(row.totalDebitsMinor) === BigInt(row.totalCreditsMinor))) &&
    trial.balanced === trial.dimensions.every((row: { balanced: boolean }) => row.balanced);
}

export interface StatusCountData {
  byStatus?: Array<{ status: string; count: number }>;
  byCategoryStatus?: Array<{ category: string; status: string; count: number }>;
  pendingApplicationCount?: number;
}

export function isStatusCountData(value: unknown, widgetKey: string): value is StatusCountData {
  if (!object(value)) return false;
  if (widgetKey === 'compliance-case-summary') {
    return Array.isArray(value.byCategoryStatus) && value.byCategoryStatus.every((row: unknown) =>
      object(row) && text(row.category) && text(row.status) && count(row.count));
  }
  if (!['agent-lifecycle-summary', 'kyc-queue-summary', 'fraud-case-summary'].includes(widgetKey) || !Array.isArray(value.byStatus) ||
      !value.byStatus.every((row: unknown) => object(row) && text(row.status) && count(row.count))) return false;
  return widgetKey !== 'agent-lifecycle-summary' || count(value.pendingApplicationCount);
}

export function isTransactionSummary(value: unknown, period: string, compare: boolean): boolean {
  if (!object(value) || value.period !== period || !timestamp(value.from) || !timestamp(value.to) || Date.parse(value.from) > Date.parse(value.to) ||
      !text(value.currency) || !count(value.totalCompletedCount) || !count(value.totalFailedCount) || !count(value.totalPendingCount) ||
      !minor(value.totalCompletedValueMinor) || !minor(value.totalFeeRevenueMinor) ||
      !(value.successRatePercent === null || (typeof value.successRatePercent === 'number' && Number.isFinite(value.successRatePercent) && value.successRatePercent >= 0 && value.successRatePercent <= 100)) ||
      typeof value.feeRevenueNote !== 'string' || typeof value.commissionNote !== 'string' || !Array.isArray(value.byType)) return false;
  if (!value.byType.every((row: unknown) => object(row) && ['W2W','C2W','W2C','C2C'].includes(row.type) &&
      count(row.completedCount) && count(row.failedCount) && count(row.pendingCount) && minor(row.completedValueMinor) &&
      (row.feeRevenueMinor === null || minor(row.feeRevenueMinor)))) return false;
  if (compare && !object(value.comparison)) return false;
  if (value.comparison !== undefined) {
    const comparison = value.comparison;
    if (!object(comparison) || typeof comparison.definition !== 'string' ||
        ![comparison.completedCountChangePercent, comparison.completedValueChangePercent].every(v => v === null || (typeof v === 'number' && Number.isFinite(v)))) return false;
  }
  return true;
}

export function isTransactionTrend(value: unknown, period: string): boolean {
  return object(value) && value.period === period && timestamp(value.from) && timestamp(value.to) &&
    Date.parse(value.from) <= Date.parse(value.to) && text(value.currency) && typeof value.definition === 'string' &&
    Array.isArray(value.daily) && value.daily.every((row: unknown) => object(row) && /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      timestamp(row.date) && count(row.completedCount) && minor(row.completedValueMinor));
}
