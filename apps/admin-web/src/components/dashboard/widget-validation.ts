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
