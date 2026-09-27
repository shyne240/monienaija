import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  CommissionDecisionSnapshot,
  FeeDecisionSnapshot,
  LimitDecisionSnapshot,
  RevenueDecisionSnapshot,
  RewardDecisionSnapshot,
} from './commercial-decision-snapshot.entity';

/**
 * V1-COMMERCIAL-DECISION-01 — Commercial Decision Snapshot foundation service.
 *
 * Records the immutable durable answer to "what commercial configuration and decisions were
 * applied to this transaction?" covering FEE / COMMISSION / REWARD / LIMIT as DISTINCT decision
 * sections (REVENUE reserved for the future retained-amount representation).
 *
 * Foundation-only guarantees:
 *  - No commercial policy values are invented here. Fee-free defaults (feeMinor=0,
 *    status NOT_CONFIGURED / NONE / NOT_EVALUATED) are first-class and fully supported.
 *  - This table is historical evidence: it is NEVER a second ledger, never holds wallet balances,
 *    and never becomes the usage authority (the limit Profile→Rule→Assignment→Usage→Reservation
 *    chain stays authoritative).
 *  - Rows are write-once. Corrections are NEW compensating rows referencing the original via
 *    supersedes_snapshot_id. UPDATE/DELETE are rejected at the database layer.
 *
 * Wiring model (runtime integration is future work — V1-COMMERCIAL-DECISION-02):
 *  - recordDecisionWithManager(manager, input) is meant to run INSIDE an existing flow's
 *    SERIALIZABLE boundary, joining its transaction — never a second transaction boundary.
 *  - recordDecision(input) provides the standalone foundation path with its own SERIALIZABLE
 *    wrapper + retry, used by tests and any future non-flow capture point.
 */

export type CommercialDecisionInputStatus = 'PENDING' | 'FINAL';

export interface RecordCommercialDecisionInput {
  idempotencyKey: string;
  product: string;
  direction?: 'INCOMING' | 'OUTGOING' | 'BOTH' | null;
  channel?: string | null;
  principalType: 'CUSTOMER' | 'AGENT';
  principalId: string;
  currency: string;
  principalAmountMinor: string | number;
  transactionReference: string;
  correlationId?: string | null;
  journalId?: string | null;
  decisionStatus?: CommercialDecisionInputStatus;
  finalizedAt?: Date | string | null;
  decidedAt?: Date | string;
  feeDecision: FeeDecisionSnapshot;
  commissionDecision: CommissionDecisionSnapshot;
  rewardDecision: RewardDecisionSnapshot;
  limitDecision: LimitDecisionSnapshot;
  revenueDecision?: RevenueDecisionSnapshot | null;
  configurationVersion?: string | null;
  createdBy: string;
  supersedesSnapshotId?: string | null;
  supersededReason?: string | null;
}

export interface RecordCommercialDecisionResult {
  /** Raw database row (snake_case keys); use CommercialDecisionSnapshotService.toSafeProjection() for API projection. */
  snapshot: Record<string, unknown>;
  replayed: boolean;
}

export interface CommercialDecisionListQuery {
  product?: string;
  principalType?: string;
  principalId?: string;
  decisionStatus?: string;
  page?: string | number;
  limit?: string | number;
}

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_SERIALIZATION_ATTEMPTS = 5;

const FEE_STATUSES = ['NOT_CONFIGURED', 'ZERO', 'APPLIED', 'WAIVED'];
const COMMISSION_STATUSES = ['NONE', 'ALLOCATED'];
const REWARD_STATUSES = ['NONE', 'GRANTED'];
const LIMIT_STATUSES = ['NOT_EVALUATED', 'APPROVED', 'REJECTED'];
const REVENUE_STATUSES = ['NONE', 'RETAINED'];
const PRINCIPAL_TYPES = ['CUSTOMER', 'AGENT'];
const DIRECTIONS = ['INCOMING', 'OUTGOING', 'BOTH'];

function badRequest(message: string): BadRequestException {
  return new BadRequestException(`COMMERCIAL_DECISION_INVALID: ${message}`);
}

function nonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function optionalNonEmptyString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  return nonEmptyString(value, field, maxLength);
}

function parseNonNegativeBigInt(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw badRequest(`${field} must be a non-negative integer`);
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  throw badRequest(`${field} must be a non-negative integer (string or number)`);
}

function assertDecisionObject(section: unknown, field: string, allowedStatuses: readonly string[], extra: (obj: Record<string, unknown>) => void = () => undefined): Record<string, unknown> {
  if (section === null || section === undefined || typeof section !== 'object' || Array.isArray(section)) {
    throw badRequest(`${field} must be a JSON object`);
  }
  const obj = section as Record<string, unknown>;
  const status = obj.status;
  if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
    throw badRequest(`${field}.status must be one of ${allowedStatuses.join('/')}`);
  }
  if (obj.ruleRefs !== undefined && obj.ruleRefs !== null && !Array.isArray(obj.ruleRefs)) {
    throw badRequest(`${field}.ruleRefs must be an array when present`);
  }
  extra(obj);
  return obj;
}

/** Canonical deterministic JSON used for the request fingerprint (sorted keys, stable shape). */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(input: RecordCommercialDecisionInput): string {
  const fingerprint = {
    product: input.product,
    direction: input.direction ?? null,
    channel: input.channel ?? null,
    principalType: input.principalType,
    principalId: input.principalId,
    currency: input.currency,
    principalAmountMinor: parseNonNegativeBigInt(input.principalAmountMinor, 'principalAmountMinor'),
    transactionReference: input.transactionReference,
    decisionStatus: input.decisionStatus ?? 'FINAL',
    feeDecision: input.feeDecision,
    commissionDecision: input.commissionDecision,
    rewardDecision: input.rewardDecision,
    limitDecision: input.limitDecision,
    revenueDecision: input.revenueDecision ?? null,
    configurationVersion: input.configurationVersion ?? null,
    supersedesSnapshotId: input.supersedesSnapshotId ?? null,
    snapshotSchemaVersion: 1,
  };
  return createHash('sha256').update(canonicalJson(fingerprint)).digest('hex');
}

function isRetryableSerialization(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const msg = String((error as { message?: string } | null)?.message ?? '');
  return (
    code === '40001' ||
    code === '40P01' ||
    msg.includes('could not serialize') ||
    msg.includes('deadlock detected') ||
    msg.includes('concurrent update')
  );
}

@Injectable()
export class CommercialDecisionSnapshotService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Foundation creation path with its own SERIALIZABLE boundary + retry.
   * Future flow wiring MUST use recordDecisionWithManager() inside the flow's existing boundary
   * instead of this wrapper (no second transaction boundary allowed).
   */
  async recordDecision(input: RecordCommercialDecisionInput): Promise<RecordCommercialDecisionResult> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.recordDecisionWithManager(manager, input),
        );
      } catch (error) {
        if (attempt < MAX_SERIALIZATION_ATTEMPTS && isRetryableSerialization(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Idempotent snapshot insert intended to run inside an EXISTING SERIALIZABLE transaction
   * (flow wiring) — or inside the standalone SERIALIZABLE wrapper above.
   *
   * Replay semantics: same idempotencyKey + identical decision fingerprint → returns the
   * existing row with replayed=true. Same key + different fingerprint → 409 conflict.
   */
  async recordDecisionWithManager(
    manager: EntityManager,
    input: RecordCommercialDecisionInput,
  ): Promise<RecordCommercialDecisionResult> {
    const idempotencyKey = nonEmptyString(input.idempotencyKey, 'idempotencyKey', 255);
    const product = nonEmptyString(input.product, 'product', 80);
    const transactionReference = nonEmptyString(input.transactionReference, 'transactionReference', 255);
    const createdBy = nonEmptyString(input.createdBy, 'createdBy', 80);
    const principalType = nonEmptyString(input.principalType, 'principalType', 20);
    if (!PRINCIPAL_TYPES.includes(principalType)) {
      throw badRequest(`principalType must be one of ${PRINCIPAL_TYPES.join('/')}`);
    }
    const principalId = nonEmptyString(input.principalId, 'principalId', 64);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principalId)) {
      throw badRequest('principalId must be a UUID');
    }
    const currency = nonEmptyString(input.currency, 'currency', 3);
    if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('currency must be a 3-letter uppercase ISO code');
    const principalAmountMinor = parseNonNegativeBigInt(input.principalAmountMinor, 'principalAmountMinor');

    const direction = optionalNonEmptyString(input.direction, 'direction', 20);
    if (direction !== null && !DIRECTIONS.includes(direction)) {
      throw badRequest(`direction must be one of ${DIRECTIONS.join('/')} or null`);
    }
    const channel = optionalNonEmptyString(input.channel, 'channel', 30);
    const correlationId = optionalNonEmptyString(input.correlationId, 'correlationId', 160);
    const journalId = optionalNonEmptyString(input.journalId, 'journalId', 64);
    if (journalId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(journalId)) {
      throw badRequest('journalId must be a UUID or null');
    }
    const configurationVersion = optionalNonEmptyString(input.configurationVersion, 'configurationVersion', 80);
    const supersedesSnapshotId = optionalNonEmptyString(input.supersedesSnapshotId, 'supersedesSnapshotId', 64);
    const supersededReason = optionalNonEmptyString(input.supersededReason, 'supersededReason', 255);
    if (supersedesSnapshotId !== null && supersededReason === null) {
      throw badRequest('supersededReason is required when supersedesSnapshotId is set');
    }

    const decisionStatus: CommercialDecisionInputStatus = input.decisionStatus === 'PENDING' ? 'PENDING' : 'FINAL';
    const decidedAt = input.decidedAt !== undefined ? new Date(input.decidedAt) : new Date();
    if (Number.isNaN(decidedAt.getTime())) throw badRequest('decidedAt must be a valid date');
    let finalizedAt: Date | null = null;
    if (decisionStatus === 'FINAL') {
      finalizedAt = input.finalizedAt !== undefined && input.finalizedAt !== null ? new Date(input.finalizedAt) : new Date();
      if (Number.isNaN(finalizedAt.getTime())) throw badRequest('finalizedAt must be a valid date');
    }

    assertDecisionObject(input.feeDecision, 'feeDecision', FEE_STATUSES, (fee) => {
      for (const field of ['amountMinor', 'feeMinor', 'vatMinor', 'totalMinor']) {
        const v = fee[field];
        if (v !== undefined && v !== null) parseNonNegativeBigInt(v, `feeDecision.${field}`);
      }
    });
    assertDecisionObject(input.commissionDecision, 'commissionDecision', COMMISSION_STATUSES, (commission) => {
      if (commission.allocations !== undefined && commission.allocations !== null && !Array.isArray(commission.allocations)) {
        throw badRequest('commissionDecision.allocations must be an array when present');
      }
      if (commission.status === 'ALLOCATED' && (!Array.isArray(commission.allocations) || commission.allocations.length === 0)) {
        throw badRequest('commissionDecision.allocations must be non-empty when status is ALLOCATED');
      }
    });
    assertDecisionObject(input.rewardDecision, 'rewardDecision', REWARD_STATUSES, (reward) => {
      if (reward.grants !== undefined && reward.grants !== null && !Array.isArray(reward.grants)) {
        throw badRequest('rewardDecision.grants must be an array when present');
      }
      if (reward.status === 'GRANTED' && (!Array.isArray(reward.grants) || reward.grants.length === 0)) {
        throw badRequest('rewardDecision.grants must be non-empty when status is GRANTED');
      }
    });
    assertDecisionObject(input.limitDecision, 'limitDecision', LIMIT_STATUSES, (limit) => {
      if (limit.reservationIds !== undefined && limit.reservationIds !== null && !Array.isArray(limit.reservationIds)) {
        throw badRequest('limitDecision.reservationIds must be an array when present');
      }
      if (limit.usageIds !== undefined && limit.usageIds !== null && !Array.isArray(limit.usageIds)) {
        throw badRequest('limitDecision.usageIds must be an array when present');
      }
      if (limit.status === 'REJECTED' && typeof limit.failureCode !== 'string') {
        throw badRequest('limitDecision.failureCode must be provided when status is REJECTED');
      }
    });
    if (input.revenueDecision !== undefined && input.revenueDecision !== null) {
      assertDecisionObject(input.revenueDecision, 'revenueDecision', REVENUE_STATUSES);
    }

    const requestHash = hashRequest(input);

    const existing: Array<Record<string, unknown>> = await manager.query(
      `SELECT id, idempotency_key, request_hash, product, direction, channel, principal_type, principal_id,
              currency, principal_amount_minor, transaction_reference, correlation_id, journal_id,
              decision_status, finalized_at, decided_at, fee_decision, commission_decision, reward_decision,
              limit_decision, revenue_decision, configuration_version, snapshot_schema_version,
              supersedes_snapshot_id, superseded_reason, created_by, created_at, updated_at, version
         FROM commercial_decision_snapshots
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.length > 0) {
      const prior = existing[0]!;
      if (prior.request_hash !== requestHash) {
        throw new ConflictException(
          'COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT: idempotencyKey already recorded a different commercial decision',
        );
      }
      return { snapshot: prior, replayed: true };
    }

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.insertSnapshotRow(manager, {
        idempotencyKey,
        requestHash,
        product,
        direction,
        channel,
        principalType,
        principalId,
        currency,
        principalAmountMinor,
        transactionReference,
        correlationId,
        journalId,
        decisionStatus,
        finalizedAt,
        decidedAt,
        feeDecision: input.feeDecision,
        commissionDecision: input.commissionDecision,
        rewardDecision: input.rewardDecision,
        limitDecision: input.limitDecision,
        revenueDecision: input.revenueDecision ?? null,
        configurationVersion,
        supersedesSnapshotId,
        supersededReason,
        createdBy,
      });
    } catch (error) {
      // Defense-in-depth for callers that pass a non-SERIALIZABLE manager: a concurrent insert of
      // the same idempotency key surfaces as 23505 instead of a serialization failure. Re-fetch
      // and apply replay semantics instead of surfacing a raw constraint error.
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: string })?.message ?? '');
      if (code === '23505' && message.includes('uq_commercial_decision_reference')) {
        throw new ConflictException(
          'COMMERCIAL_DECISION_REFERENCE_CONFLICT: an original (non-compensating) snapshot already exists for this product + transaction_reference; corrections must supersede it',
        );
      }
      if (code === '23505' && message.includes('uq_commercial_decision_idempotency')) {
        const retryRows: Array<Record<string, unknown>> = await manager.query(
          `SELECT id, idempotency_key, request_hash, product, direction, channel, principal_type, principal_id,
                  currency, principal_amount_minor, transaction_reference, correlation_id, journal_id,
                  decision_status, finalized_at, decided_at, fee_decision, commission_decision, reward_decision,
                  limit_decision, revenue_decision, configuration_version, snapshot_schema_version,
                  supersedes_snapshot_id, superseded_reason, created_by, created_at, updated_at, version
             FROM commercial_decision_snapshots WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (retryRows.length > 0) {
          const prior = retryRows[0]!;
          if (prior.request_hash !== requestHash) {
            throw new ConflictException(
              'COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT: idempotencyKey already recorded a different commercial decision',
            );
          }
          return { snapshot: prior, replayed: true };
        }
      }
      throw error;
    }
    return { snapshot: rows[0]!, replayed: false };
  }

  private async insertSnapshotRow(
    manager: EntityManager,
    row: {
      idempotencyKey: string;
      requestHash: string;
      product: string;
      direction: string | null;
      channel: string | null;
      principalType: string;
      principalId: string;
      currency: string;
      principalAmountMinor: string;
      transactionReference: string;
      correlationId: string | null;
      journalId: string | null;
      decisionStatus: CommercialDecisionInputStatus;
      finalizedAt: Date | null;
      decidedAt: Date;
      feeDecision: FeeDecisionSnapshot;
      commissionDecision: CommissionDecisionSnapshot;
      rewardDecision: RewardDecisionSnapshot;
      limitDecision: LimitDecisionSnapshot;
      revenueDecision: RevenueDecisionSnapshot | null;
      configurationVersion: string | null;
      supersedesSnapshotId: string | null;
      supersededReason: string | null;
      createdBy: string;
    },
  ): Promise<Array<Record<string, unknown>>> {
    return manager.query(
      `INSERT INTO commercial_decision_snapshots (
         idempotency_key, request_hash, product, direction, channel, principal_type, principal_id,
         currency, principal_amount_minor, transaction_reference, correlation_id, journal_id,
         decision_status, finalized_at, decided_at, fee_decision, commission_decision, reward_decision,
         limit_decision, revenue_decision, configuration_version, snapshot_schema_version,
         supersedes_snapshot_id, superseded_reason, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,1,$22,$23,$24)
       RETURNING id, idempotency_key, request_hash, product, direction, channel, principal_type, principal_id,
              currency, principal_amount_minor, transaction_reference, correlation_id, journal_id,
              decision_status, finalized_at, decided_at, fee_decision, commission_decision, reward_decision,
              limit_decision, revenue_decision, configuration_version, snapshot_schema_version,
              supersedes_snapshot_id, superseded_reason, created_by, created_at, updated_at, version`,
      [
        row.idempotencyKey,
        row.requestHash,
        row.product,
        row.direction,
        row.channel,
        row.principalType,
        row.principalId,
        row.currency,
        row.principalAmountMinor,
        row.transactionReference,
        row.correlationId,
        row.journalId,
        row.decisionStatus,
        row.finalizedAt,
        row.decidedAt,
        JSON.stringify(row.feeDecision),
        JSON.stringify(row.commissionDecision),
        JSON.stringify(row.rewardDecision),
        JSON.stringify(row.limitDecision),
        row.revenueDecision === null ? null : JSON.stringify(row.revenueDecision),
        row.configurationVersion,
        row.supersedesSnapshotId,
        row.supersededReason,
        row.createdBy,
      ],
    );
  }

  /** Safe projection: operational evidence only. request_hash stays internal. No secrets exist in the schema. */
  static toSafeProjection(row: Record<string, unknown>): Record<string, unknown> {
    const projection: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'request_hash') continue; // internal fingerprint — never exposed
      projection[key] = value;
    }
    return projection;
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, idempotency_key, product, direction, channel, principal_type, principal_id, currency,
              principal_amount_minor, transaction_reference, correlation_id, journal_id, decision_status,
              finalized_at, decided_at, fee_decision, commission_decision, reward_decision, limit_decision,
              revenue_decision, configuration_version, snapshot_schema_version, supersedes_snapshot_id,
              superseded_reason, created_by, created_at, updated_at, version
         FROM commercial_decision_snapshots WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('COMMERCIAL_DECISION_SNAPSHOT_NOT_FOUND');
    return CommercialDecisionSnapshotService.toSafeProjection(rows[0]!);
  }

  /**
   * Current decision for (product, transactionReference): the most recently recorded row,
   * including any compensating correction (corrections are NEW rows via supersedes_snapshot_id;
   * the original stays immutable and retrievable by id).
   */
  async findByReference(product: string, transactionReference: string): Promise<Record<string, unknown> | null> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, idempotency_key, product, direction, channel, principal_type, principal_id, currency,
              principal_amount_minor, transaction_reference, correlation_id, journal_id, decision_status,
              finalized_at, decided_at, fee_decision, commission_decision, reward_decision, limit_decision,
              revenue_decision, configuration_version, snapshot_schema_version, supersedes_snapshot_id,
              superseded_reason, created_by, created_at, updated_at, version
         FROM commercial_decision_snapshots
        WHERE product = $1 AND transaction_reference = $2
        ORDER BY decided_at DESC, created_at DESC, id DESC
        LIMIT 1`,
      [product, transactionReference],
    );
    return rows.length > 0 ? CommercialDecisionSnapshotService.toSafeProjection(rows[0]!) : null;
  }

  /**
   * Read-only workforce listing with deterministic pagination (decided_at DESC, id DESC).
   */
  async list(query: CommercialDecisionListQuery): Promise<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    data: Array<Record<string, unknown>>;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (condition: string, value: unknown) => {
      params.push(value);
      conditions.push(condition.replace('?', `$${params.length}`));
    };
    if (query.product) add('product = ?', nonEmptyString(query.product, 'product', 80));
    if (query.principalType) {
      const pt = nonEmptyString(query.principalType, 'principalType', 20);
      if (!PRINCIPAL_TYPES.includes(pt)) throw badRequest(`principalType must be one of ${PRINCIPAL_TYPES.join('/')}`);
      add('principal_type = ?', pt);
    }
    if (query.principalId) add('principal_id = ?', nonEmptyString(query.principalId, 'principalId', 64));
    if (query.decisionStatus) {
      const ds = nonEmptyString(query.decisionStatus, 'decisionStatus', 20);
      if (!['PENDING', 'FINAL'].includes(ds)) throw badRequest('decisionStatus must be PENDING or FINAL');
      add('decision_status = ?', ds);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let page = 1;
    let take = DEFAULT_PAGE_LIMIT;
    if (query.page !== undefined) {
      page = Number.parseInt(String(query.page), 10);
      if (!Number.isSafeInteger(page) || page < 1) throw badRequest('page must be a positive integer');
    }
    if (query.limit !== undefined) {
      take = Number.parseInt(String(query.limit), 10);
      if (!Number.isSafeInteger(take) || take < 1 || take > MAX_PAGE_LIMIT) {
        throw badRequest(`limit must be between 1 and ${MAX_PAGE_LIMIT}`);
      }
    }
    const offset = (page - 1) * take;

    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS total FROM commercial_decision_snapshots ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const dataRows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, idempotency_key, product, direction, channel, principal_type, principal_id, currency,
              principal_amount_minor, transaction_reference, correlation_id, journal_id, decision_status,
              finalized_at, decided_at, fee_decision, commission_decision, reward_decision, limit_decision,
              revenue_decision, configuration_version, snapshot_schema_version, supersedes_snapshot_id,
              superseded_reason, created_by, created_at, updated_at, version
         FROM commercial_decision_snapshots ${whereSql}
        ORDER BY decided_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, take, offset],
    );
    return {
      page,
      limit: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
      data: dataRows.map((row) => CommercialDecisionSnapshotService.toSafeProjection(row)),
    };
  }
}
