/**
 * Shapes for the read-only operational sources behind System Health (ARENA 6).
 *
 * These are deliberately *display* types over server payloads, not re-definitions of them: the
 * fields the console renders are listed, everything else is ignored rather than echoed. That keeps a
 * backend addition from silently becoming an admin-visible claim, and keeps the console honest about
 * which endpoint said what.
 */

/** Mirrors `HealthComponentReport` in `src/operations/operations.types.ts`. */
export interface HealthComponent {
  key: string;
  label: string;
  /** `ok` | `degraded` | `error` | `unknown` on the current server contract. */
  state: string;
  /** `CHECKED` | `UNAVAILABLE` | `NOT_CONFIGURED` — whether anything was measured at all. */
  availability: string;
  meaning: string;
  detail: Record<string, unknown>;
  checkedAt: string;
  source: string;
  reason?: string;
}

export interface UnavailableSource {
  area: string;
  reason: string;
  /** Which read named it, so an operator can re-run that read instead of guessing. */
  source: string;
  checkedAt: string | null;
}

/** One `AttentionItem` from the operations centre view. */
export interface AttentionItem {
  id: string;
  area: string;
  urgency: string;
  severity: string;
  summary: string;
  context?: Record<string, unknown>;
}

export interface OperationsCentre {
  generatedAt: string;
  clear: boolean;
  partial: boolean;
  items: AttentionItem[];
  unavailable: UnavailableSource[];
  counts?: { immediate: number; routine: number; info: number };
  scope?: string;
}

export interface OperationalSnapshot {
  generatedAt: string;
  unavailable: Array<{ signal: string; reason: string }>;
  samples?: unknown;
}

export interface HealthPayload {
  [key: string]: unknown;
  status?: string;
  timestamp?: string;
  components?: unknown;
}

export const HEALTH_SOURCE_PATHS = {
  metrics: '/internal/metrics',
  diagnostics: '/internal/diagnostics',
  operationsCentre: '/internal/operations-centre',
  operationalMetrics: '/internal/operational-metrics',
  outbox: '/internal/outbox',
} as const;

export const asRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isHealthComponentArray = (value: unknown): value is HealthComponent[] =>
  Array.isArray(value) &&
  value.every(
    (row) =>
      asRecord(row) &&
      typeof row.key === 'string' &&
      typeof row.label === 'string' &&
      typeof row.state === 'string' &&
      typeof row.availability === 'string' &&
      typeof row.meaning === 'string' &&
      typeof row.checkedAt === 'string' &&
      typeof row.source === 'string',
  );

export const isUnavailableList = (value: unknown): value is Array<{ area: string; reason: string }> =>
  Array.isArray(value) &&
  value.every((row) => asRecord(row) && typeof row.area === 'string' && typeof row.reason === 'string');

export const isAttentionItemList = (value: unknown): value is AttentionItem[] =>
  Array.isArray(value) &&
  value.every((row) => asRecord(row) && typeof row.id === 'string' && typeof row.summary === 'string');

/**
 * Timestamps are rendered with an explicit fallback. "not reported" is a statement about the payload;
 * a blank cell would be read as "no event", which is a different claim entirely.
 */
export const stamp = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') return 'not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'not reported' : date.toLocaleString();
};
