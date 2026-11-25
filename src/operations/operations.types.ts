import type { IdempotencyRecord } from './idempotency-record.entity';
import type { OutboxEventStatus } from './operations.enums';

export interface IdempotencyCommand {
  scope: string;
  key: string;
  requestHash: string;
  retentionSeconds: number;
}

export interface IdempotencyReservation {
  kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS';
  record: IdempotencyRecord;
}

export interface CompleteIdempotencyCommand {
  statusCode: number;
  responseBody: Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
}

export interface AuditEventCommand {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  correlationId?: string;
  requestId?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface OutboxEventCommand {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  eventKey?: string;
  schemaVersion?: number;
  classification?: string;
  retentionClass?: string;
  occurredAt?: Date;
  correlationId?: string;
  causationId?: string;
  availableAt?: Date;
}

export interface OutboxQuery {
  status?: OutboxEventStatus;
  limit?: number;
}

export interface OutboxView {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string | null;
  schemaVersion: number;
  classification: string;
  retentionClass: string;
  occurredAt: Date;
  correlationId: string | null;
  causationId: string | null;
  payload: Record<string, unknown>;
  status: OutboxEventStatus;
  attempts: number;
  availableAt: Date;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  limit?: number;
}

export interface AuditView {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  correlationId: string | null;
  requestId: string | null;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  occurredAt: Date;
}

/**
 * Per-component health reporting (ARENA 6 — System Health).
 *
 * Why this exists next to the flat fields rather than replacing them: the flat `database`/
 * `migrations`/`reconciliation`/`pendingOutbox` fields answer "is the service up", which is what
 * readiness and the maturity survey consume. They cannot answer the operational question an
 * operator actually asks — *which* component was checked, what its state *means*, and *when* that
 * specific check ran. A single report-level `timestamp` is not a per-probe check time: the
 * reconciliation pass and the `SELECT 1` do not happen at the same instant, and a stale answer has
 * to be visible as stale.
 *
 * The three-state `availability` is the point of the whole structure. `CHECKED` means the probe ran
 * and the component answered (including "it answered: broken"). `UNAVAILABLE` means the probe could
 * not be executed, so **nothing is known** about that component — it is never rendered as healthy,
 * and never as a zero. `NOT_CONFIGURED` means the component is deliberately absent in this
 * deployment, which is a configuration fact rather than an outage. Collapsing those three is
 * exactly the failure mode this repository already guards against elsewhere (see
 * `OperationalMetricsService.unavailable`, `OperationsCentreView.partial`).
 */
export type HealthComponentState = 'ok' | 'degraded' | 'error' | 'unknown';

export type HealthComponentAvailability = 'CHECKED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export interface HealthComponentReport {
  /** Stable key; dashboards and links key on this, never on the label. */
  key: string;
  /** Human-readable component name. */
  label: string;
  state: HealthComponentState;
  availability: HealthComponentAvailability;
  /** What `state` means for this component, in the operator's terms. */
  meaning: string;
  /** Bounded, non-sensitive facts the component reported. No identifiers, no secrets. */
  detail: Record<string, string | number | boolean | null>;
  /** ISO time at which *this* probe ran, not when the report was assembled. */
  checkedAt: string;
  /** The subsystem that answered, so the claim can be verified at its source. */
  source: string;
  /** Why nothing was measured. Required whenever availability is not `CHECKED`. */
  reason?: string;
}

export interface DiagnosticsReport {
  status: 'ok' | 'degraded';
  version: string;
  database: { status: 'ok' | 'error' };
  migrations: { status: 'ok' | 'error'; appliedCount: number };
  reconciliation: { status: 'PASS' | 'WARNING' | 'ERROR' };
  pendingOutbox: number;
  timestamp: string;
  /**
   * Optional on the contract because `DiagnosticsReport` is also assembled by consumers and test
   * fixtures that predate it; `DiagnosticsService.getDiagnostics()` always populates it. A
   * reader that finds it absent must say "no component breakdown was returned" rather than
   * assuming every component passed.
   */
  components?: HealthComponentReport[];
}

export interface MetricsView {
  generatedAt: string;
  metrics: Record<string, string>;
}
