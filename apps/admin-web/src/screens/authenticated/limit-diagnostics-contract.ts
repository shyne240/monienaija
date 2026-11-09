type Row = Record<string, unknown>;
export interface DiagnosticsResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  data: Row[];
  staleThresholdMinutes?: number;
}

type DiagnosticKind = 'usage' | 'reservation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE = /^[A-Z0-9_]{3,80}$/;
const PRINCIPALS = ['CUSTOMER', 'AGENT', 'AGENT_CLASS', 'SEGMENT', 'GLOBAL'];
const DIMENSIONS = ['DAILY_AMOUNT', 'WEEKLY_AMOUNT', 'MONTHLY_AMOUNT', 'YEARLY_AMOUNT', 'DAILY_COUNT', 'WEEKLY_COUNT', 'MONTHLY_COUNT', 'YEARLY_COUNT'];
const WINDOWS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const STATUS = ['RESERVED', 'COMMITTED', 'RELEASED'];
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const minor = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const optionalString = (v: unknown) => v === undefined || v === null || typeof v === 'string';
const optionalDate = (v: unknown) => v === undefined || v === null || date(v);
const COMMON = ['id', 'principalType', 'principalId', 'limitProfileCode', 'limitRuleId', 'product', 'direction', 'channel', 'dimension', 'currency', 'windowType', 'windowKey', 'windowStart', 'windowEnd', 'createdAt', 'updatedAt'];
const USAGE = [...COMMON, 'usedAmountMinor', 'usedCount', 'reservedAmountMinor', 'reservedCount'];
const RESERVATION = [...COMMON, 'idempotencyKey', 'correlationId', 'amountMinor', 'count', 'status', 'limitUsageId', 'reservedAt', 'committedAt', 'releasedAt', 'version', 'ageSeconds', 'stale'];

export function parseDiagnostics(value: unknown, kind: DiagnosticKind, page: number, filters: object): DiagnosticsResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Row;
  if (response.page !== page || response.limit !== 20 || !uint(response.total) || !uint(response.totalPages) ||
      response.totalPages !== Math.max(1, Math.ceil(response.total / 20)) || !Array.isArray(response.data) ||
      response.data.length > 20 || response.data.length > response.total ||
      (kind === 'reservation' && (!uint(response.staleThresholdMinutes) || response.staleThresholdMinutes < 1))) return null;
  const expected = filters as Record<string, string>;
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const item of response.data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Row;
    if (!text(row.id) || !UUID.test(row.id) || seen.has(row.id.toLowerCase()) ||
        !text(row.principalId) || !UUID.test(row.principalId) || !PRINCIPALS.includes(row.principalType as string) ||
        !text(row.limitProfileCode) || !PROFILE.test(row.limitProfileCode) || !text(row.product) ||
        !DIMENSIONS.includes(row.dimension as string) || !text(row.currency) || !/^[A-Z]{3}$/.test(row.currency) ||
        !WINDOWS.includes(row.windowType as string) || !text(row.windowKey) || !date(row.windowStart) || !date(row.windowEnd) ||
        Date.parse(row.windowEnd) <= Date.parse(row.windowStart) || !optionalString(row.limitRuleId) ||
        !optionalString(row.direction) || !optionalString(row.channel) || !optionalDate(row.createdAt) || !optionalDate(row.updatedAt)) return null;
    seen.add(row.id.toLowerCase());
    if (kind === 'usage') {
      if (!minor(row.usedAmountMinor) || !minor(row.reservedAmountMinor) || !uint(row.usedCount) || !uint(row.reservedCount)) return null;
    } else {
      if (!STATUS.includes(row.status as string) || !text(row.idempotencyKey) || !optionalString(row.correlationId) || !optionalString(row.limitUsageId) ||
          !(row.amountMinor === null || minor(row.amountMinor)) || !(row.count === null || uint(row.count)) || !date(row.reservedAt) ||
          !optionalDate(row.committedAt) || !optionalDate(row.releasedAt) || !uint(row.version) || row.version < 1 ||
          !(row.ageSeconds === null || uint(row.ageSeconds)) || typeof row.stale !== 'boolean' ||
          (row.status !== 'RESERVED' && (row.stale || row.ageSeconds !== null))) return null;
    }
    // The backend normalizes enum filters to uppercase; identifiers and correlation keys
    // are exact string matches. A mismatch means the displayed page cannot be trusted.
    for (const key of ['limitProfileCode', 'principalType', 'product', 'dimension', 'currency', 'windowType', 'status']) {
      const wanted = expected[key]?.trim();
      if (wanted && (typeof row[key] !== 'string' || (row[key] as string).toUpperCase() !== wanted.toUpperCase())) return null;
    }
    for (const key of ['principalId', 'windowKey', 'idempotencyKey', 'correlationId']) {
      const wanted = expected[key]?.trim();
      if (wanted && row[key] !== wanted) return null;
    }
    if (expected.stale === 'true' && row.stale !== true) return null;
    for (const [filter, field, isFrom] of [['windowFrom', 'windowStart', true], ['windowTo', 'windowStart', false], ['reservedFrom', 'reservedAt', true], ['reservedTo', 'reservedAt', false]] as const) {
      const wanted = expected[filter]?.trim();
      if (wanted && (!date(wanted) || !date(row[field]) || (isFrom ? Date.parse(row[field] as string) < Date.parse(wanted) : Date.parse(row[field] as string) >= Date.parse(wanted)))) return null;
    }
    const keys = kind === 'usage' ? USAGE : RESERVATION;
    rows.push(Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, row[key]])));
  }
  return { page, limit: 20, total: response.total, totalPages: response.totalPages, data: rows,
    ...(kind === 'reservation' ? { staleThresholdMinutes: response.staleThresholdMinutes as number } : {}) };
}
