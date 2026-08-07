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

export interface DiagnosticsReport {
  status: 'ok' | 'degraded';
  version: string;
  database: { status: 'ok' | 'error' };
  migrations: { status: 'ok' | 'error'; appliedCount: number };
  reconciliation: { status: 'PASS' | 'WARNING' | 'ERROR' };
  pendingOutbox: number;
  timestamp: string;
}

export interface MetricsView {
  generatedAt: string;
  metrics: Record<string, string>;
}
