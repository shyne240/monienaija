import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * V1-LIMIT-05 — Workforce-only read-only diagnostics over limit_usages / limit_reservations.
 *
 * SAFETY PROPERTIES (financial):
 *  - SELECT-only: no INSERT/UPDATE/DELETE anywhere in this service → no ledger mutation,
 *    no balance mutation, no reservation mutation, no duplicate commit/release possible.
 *  - SAFE PROJECTION: `request_hash` (internal hash of the originating request payload)
 *    is deliberately excluded; no secrets, no raw credentials, no idempotency internals
 *    beyond the operator-supplied idempotency key itself (a correlation reference).
 *  - Deterministic ordering + cursor-free offset pagination (created_at/reserved_at DESC, id DESC).
 *
 * Stale-threshold (diagnostics only): a RESERVED reservation older than the configured
 * threshold is FLAGGED for operator attention. It is never auto-released — see
 * LimitReservationRecoveryService and docs/V1-LIMIT-05-VERIFICATION-REPORT.md (automatic
 * reaping is blocked; stale age alone is NOT proof of orphaning).
 */

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 50;

/** Operational default; override via LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES. Diagnostic flag only. */
export const DEFAULT_STALE_THRESHOLD_MINUTES = 30;

export function getStaleThresholdMinutes(): number {
  const raw = process.env.LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STALE_THRESHOLD_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_STALE_THRESHOLD_MINUTES;
  return parsed;
}

export interface UsageDiagnosticsQuery {
  limitProfileCode?: string;
  principalType?: string;
  principalId?: string;
  product?: string;
  dimension?: string;
  currency?: string;
  windowKey?: string;
  windowType?: string;
  /** ISO timestamp; matches usages whose window_start >= from */
  windowFrom?: string;
  /** ISO timestamp; matches usages whose window_start < to */
  windowTo?: string;
  page?: number;
  limit?: number;
}

export interface ReservationDiagnosticsQuery {
  status?: string;
  limitProfileCode?: string;
  principalType?: string;
  principalId?: string;
  product?: string;
  dimension?: string;
  currency?: string;
  windowKey?: string;
  idempotencyKey?: string;
  correlationId?: string;
  /** ISO timestamp; matches reservations reserved_at >= from */
  reservedFrom?: string;
  /** ISO timestamp; matches reservations reserved_at < to */
  reservedTo?: string;
  /** true → RESERVED only AND reserved_at older than the configured stale threshold */
  stale?: boolean;
  page?: number;
  limit?: number;
}

function normalizeEnum(v: string | undefined, name: string, maxLength: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = v.trim().toUpperCase();
  if (t.length === 0) return undefined;
  if (t.length > maxLength) throw new BadRequestException(`${name} exceeds ${maxLength} characters`);
  if (!/^[A-Z0-9_-]+$/.test(t)) throw new BadRequestException(`${name} contains invalid characters`);
  return t;
}

function normalizeId(v: string | undefined, name: string, maxLength: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.length > maxLength) throw new BadRequestException(`${name} exceeds ${maxLength} characters`);
  return t;
}

function parseIso(v: string | undefined, name: string): Date | undefined {
  if (v === undefined || v === null || v.trim() === '') return undefined;
  const d = new Date(v.trim());
  if (isNaN(d.getTime())) throw new BadRequestException(`${name} must be a valid ISO-8601 timestamp`);
  return d;
}

function parsePaging(page: string | number | undefined, limit: string | number | undefined): { offset: number; take: number; page: number } {
  let p = 1;
  let l = DEFAULT_PAGE_LIMIT;
  if (page !== undefined) {
    p = typeof page === 'number' ? page : Number.parseInt(String(page), 10);
    if (!Number.isSafeInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
  }
  if (limit !== undefined) {
    l = typeof limit === 'number' ? limit : Number.parseInt(String(limit), 10);
    if (!Number.isSafeInteger(l) || l < 1 || l > MAX_PAGE_LIMIT) throw new BadRequestException(`limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  return { offset: (p - 1) * l, take: l, page: p };
}

@Injectable()
export class LimitDiagnosticsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Read-only listing of limit_usages. Answers: "what usage has this principal consumed?"
   * and "which windows are active?" for a profile/product/dimension/currency/window key.
   */
  async listUsages(query: UsageDiagnosticsQuery): Promise<{ page: number; limit: number; total: number; totalPages: number; data: Array<Record<string, unknown>> }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    const profileCode = normalizeEnum(query.limitProfileCode, 'limitProfileCode', 80);
    if (profileCode) add('limit_profile_code = ?', profileCode);
    const principalType = normalizeEnum(query.principalType, 'principalType', 20);
    if (principalType) add('principal_type = ?', principalType);
    const principalId = normalizeId(query.principalId, 'principalId', 64);
    if (principalId) add('principal_id::text = ?', principalId);
    const product = normalizeEnum(query.product, 'product', 80);
    if (product) add('upper(product) = ?', product);
    const dimension = normalizeEnum(query.dimension, 'dimension', 40);
    if (dimension) add('dimension = ?', dimension);
    const currency = normalizeEnum(query.currency, 'currency', 3);
    if (currency) add('currency = ?', currency);
    const windowKey = normalizeId(query.windowKey, 'windowKey', 80);
    if (windowKey) add('window_key = ?', windowKey);
    const windowType = normalizeEnum(query.windowType, 'windowType', 20);
    if (windowType) add('window_type = ?', windowType);
    const windowFrom = parseIso(query.windowFrom, 'windowFrom');
    if (windowFrom) add('window_start >= ?', windowFrom);
    const windowTo = parseIso(query.windowTo, 'windowTo');
    if (windowTo) add('window_start < ?', windowTo);

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { offset, take, page } = parsePaging(query.page, query.limit);

    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS total FROM limit_usages ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? '0');

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, principal_type, principal_id, limit_profile_code, limit_rule_id, product, direction, channel,
              dimension, currency, window_type, window_key, window_start, window_end,
              used_amount_minor::text AS used_amount_minor, used_count,
              reserved_amount_minor::text AS reserved_amount_minor, reserved_count,
              created_at, updated_at
         FROM limit_usages
         ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, take, offset],
    );

    return {
      page,
      limit: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
      data: rows.map((r) => ({
        id: r.id,
        principalType: r.principal_type,
        principalId: r.principal_id,
        limitProfileCode: r.limit_profile_code,
        limitRuleId: r.limit_rule_id,
        product: r.product,
        direction: r.direction,
        channel: r.channel,
        dimension: r.dimension,
        currency: r.currency,
        windowType: r.window_type,
        windowKey: r.window_key,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        usedAmountMinor: r.used_amount_minor,
        usedCount: r.used_count,
        reservedAmountMinor: r.reserved_amount_minor,
        reservedCount: r.reserved_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  /**
   * Read-only listing of limit_reservations. Answers: "what reservations exist, which are
   * still RESERVED, when were they created, and which transaction/correlation reference is
   * associated?" SAFE PROJECTION: request_hash is never returned.
   */
  async listReservations(query: ReservationDiagnosticsQuery): Promise<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    staleThresholdMinutes: number;
    data: Array<Record<string, unknown>>;
  }> {
    const staleThresholdMinutes = getStaleThresholdMinutes();
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    const status = normalizeEnum(query.status, 'status', 20);
    if (status) {
      if (!['RESERVED', 'COMMITTED', 'RELEASED'].includes(status)) throw new BadRequestException('status must be RESERVED, COMMITTED or RELEASED');
      add('status = ?', status);
    }
    const profileCode = normalizeEnum(query.limitProfileCode, 'limitProfileCode', 80);
    if (profileCode) add('limit_profile_code = ?', profileCode);
    const principalType = normalizeEnum(query.principalType, 'principalType', 20);
    if (principalType) add('principal_type = ?', principalType);
    const principalId = normalizeId(query.principalId, 'principalId', 64);
    if (principalId) add('principal_id::text = ?', principalId);
    const product = normalizeEnum(query.product, 'product', 80);
    if (product) add('upper(product) = ?', product);
    const dimension = normalizeEnum(query.dimension, 'dimension', 40);
    if (dimension) add('dimension = ?', dimension);
    const currency = normalizeEnum(query.currency, 'currency', 3);
    if (currency) add('currency = ?', currency);
    const windowKey = normalizeId(query.windowKey, 'windowKey', 80);
    if (windowKey) add('window_key = ?', windowKey);
    const idempotencyKey = normalizeId(query.idempotencyKey, 'idempotencyKey', 255);
    if (idempotencyKey) add('idempotency_key = ?', idempotencyKey);
    const correlationId = normalizeId(query.correlationId, 'correlationId', 160);
    if (correlationId) add('correlation_id = ?', correlationId);
    const reservedFrom = parseIso(query.reservedFrom, 'reservedFrom');
    if (reservedFrom) add('reserved_at >= ?', reservedFrom);
    const reservedTo = parseIso(query.reservedTo, 'reservedTo');
    if (reservedTo) add('reserved_at < ?', reservedTo);
    if (query.stale === true) {
      // Diagnostic flag only — stale age is NOT proof of orphaning; no automatic action is taken.
      where.push(`status = 'RESERVED'`);
      add(`reserved_at < NOW() - ?::int * INTERVAL '1 minute'`, staleThresholdMinutes);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { offset, take, page } = parsePaging(query.page, query.limit);

    const countRows: Array<{ total: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS total FROM limit_reservations ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? '0');

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, idempotency_key, correlation_id, principal_type, principal_id, limit_profile_code, limit_rule_id,
              product, direction, channel, dimension, currency, window_type, window_key, window_start, window_end,
              amount_minor::text AS amount_minor, count, status, limit_usage_id,
              reserved_at, committed_at, released_at, created_at, updated_at, version
         FROM limit_reservations
         ${whereSql}
        ORDER BY reserved_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, take, offset],
    );

    return {
      page,
      limit: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
      staleThresholdMinutes,
      data: rows.map((r) => ({
        id: r.id,
        idempotencyKey: r.idempotency_key,
        correlationId: r.correlation_id,
        principalType: r.principal_type,
        principalId: r.principal_id,
        limitProfileCode: r.limit_profile_code,
        limitRuleId: r.limit_rule_id,
        product: r.product,
        direction: r.direction,
        channel: r.channel,
        dimension: r.dimension,
        currency: r.currency,
        windowType: r.window_type,
        windowKey: r.window_key,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        amountMinor: r.amount_minor,
        count: r.count,
        status: r.status,
        limitUsageId: r.limit_usage_id,
        reservedAt: r.reserved_at,
        committedAt: r.committed_at,
        releasedAt: r.released_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        version: r.version,
        ageSeconds: r.status === 'RESERVED' && r.reserved_at ? Math.max(0, Math.floor((Date.now() - new Date(r.reserved_at as string).getTime()) / 1000)) : null,
        stale: r.status === 'RESERVED' && r.reserved_at ? new Date(r.reserved_at as string).getTime() < Date.now() - staleThresholdMinutes * 60000 : false,
      })),
    };
  }
}
