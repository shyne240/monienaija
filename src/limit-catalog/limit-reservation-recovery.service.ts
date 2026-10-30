import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';

/**
 * V1-LIMIT-05 — Safe recovery boundary for RESERVED limit reservations.
 *
 * ORPHAN ANALYSIS (why there is NO automatic reaper):
 *  - In every wired V1 flow (W→W, Cash→Wallet, Wallet→Cash, C2C init, C2C claim,
 *    Customer Funding approve, Agent Funding, Agent Defunding) the reservation lifecycle
 *    (reserve → commit | release) executes INSIDE the same SERIALIZABLE transaction as the
 *    financial ledger posting (LimitEnforcementService.enforceWithManager +
 *    commitReservationsWithManager / releaseReservationsWithManager on the flow's own manager).
 *  - Therefore a crash/rollback can never leave a RESERVED row behind: either the whole
 *    transaction commits (reservations COMMITTED alongside the journal) or the whole
 *    transaction rolls back (no reservation row persists at all).
 *  - There is NO background job, async financial processor, or external-provider leg in V1
 *    that could hold a reservation open across process boundaries.
 *  - Consequently a stale timestamp alone is NEVER proof of orphaning, and the repository
 *    contains no authoritative cross-product correlation-terminal-state table that could
 *    prove it. Automatic reaping is BLOCKED as a product/operational decision — see
 *    docs/V1-LIMIT-05-VERIFICATION-REPORT.md §9-11.
 *
 * WHAT THIS SERVICE PROVIDES INSTEAD (safe operational/manual boundary):
 *  - A workforce-only (PRIVILEGED) explicit release of a SINGLE reservation identified by id,
 *    after a human operator has investigated it via the read-only diagnostics endpoints.
 *  - RELEASED is the only transition performed. COMMITTED rows are immutable (409).
 *    RELEASED rows are idempotently acknowledged. No DELETE, no historical rewrite,
 *    no financial ledger mutation — only the reservation row and its limit_usages reserved
 *    counters are touched (mirroring releaseWithManager semantics).
 *  - SERIALIZABLE + SELECT ... FOR UPDATE row locking makes concurrent releases safe:
 *    exactly one caller performs the release; the other observes RELEASED and acknowledges.
 *  - Every release is written to the audit trail (entityType limit_reservation).
 */

export interface ManualReleaseInput {
  reservationId: string;
  actor: string;
  reason: string;
  correlationId?: string | null;
}

export interface ManualReleaseResult {
  reservationId: string;
  outcome: 'RELEASED' | 'ALREADY_RELEASED';
  status: string;
  principalType: string;
  principalId: string;
  limitProfileCode: string;
  product: string;
  dimension: string;
  currency: string;
  amountMinor: string | null;
  count: number | null;
  limitUsageId: string | null;
  releasedAt: Date | null;
  auditEventId: string | null;
}

@Injectable()
export class LimitReservationRecoveryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async releaseManually(input: ManualReleaseInput): Promise<ManualReleaseResult> {
    const reservationId = (input.reservationId ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservationId)) {
      throw new BadRequestException('reservationId must be a UUID');
    }
    const actor = (input.actor ?? '').trim();
    if (!actor) throw new BadRequestException('actor is required');
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException('reason is required (minimum 10 characters) for manual reservation release');
    if (reason.length > 1000) throw new BadRequestException('reason exceeds 1000 characters');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const rows: Array<{
            id: string;
            status: string;
            principal_type: string;
            principal_id: string;
            limit_profile_code: string;
            product: string;
            dimension: string;
            currency: string;
            amount_minor: string | null;
            count: number | null;
            limit_usage_id: string | null;
            released_at: Date | null;
            correlation_id: string | null;
          }> = await manager.query(
            `SELECT id, status, principal_type, principal_id, limit_profile_code, product, dimension, currency,
                    amount_minor::text AS amount_minor, count, limit_usage_id, released_at, correlation_id
               FROM limit_reservations
              WHERE id = $1
              FOR UPDATE`,
            [reservationId],
          );
          const row = rows[0];
          if (!row) throw new NotFoundException(`Limit reservation ${reservationId} was not found`);

          if (row.status === 'COMMITTED') {
            throw new ConflictException('COMMITTED reservations are immutable and cannot be released');
          }

          if (row.status === 'RELEASED') {
            // Idempotent acknowledgement — never decrement twice.
            return this.result(row, 'ALREADY_RELEASED', null);
          }

          // status === 'RESERVED' — the only releasable state.
          if (row.limit_usage_id) {
            const usageRows: Array<{ id: string; reserved_amount_minor: string; reserved_count: number }> = await manager.query(
              `SELECT id, reserved_amount_minor::text AS reserved_amount_minor, reserved_count
                 FROM limit_usages
                WHERE id = $1
                FOR UPDATE`,
              [row.limit_usage_id],
            );
            const usage = usageRows[0];
            if (!usage) throw new ConflictException(`Limit usage ${row.limit_usage_id} for reservation ${reservationId} was not found`);

            if (row.amount_minor !== null && row.amount_minor !== undefined) {
              const amt = BigInt(row.amount_minor);
              const reserved = BigInt(usage.reserved_amount_minor);
              if (reserved < amt) throw new ConflictException('Reserved amount underflow on manual release — refusing to mutate usage');
              await manager.query(
                `UPDATE limit_usages SET reserved_amount_minor = reserved_amount_minor - $2, updated_at = NOW() WHERE id = $1`,
                [usage.id, amt.toString()],
              );
            }
            if (row.count !== null && row.count !== undefined) {
              if (usage.reserved_count < row.count) throw new ConflictException('Reserved count underflow on manual release — refusing to mutate usage');
              await manager.query(
                `UPDATE limit_usages SET reserved_count = reserved_count - $2, updated_at = NOW() WHERE id = $1`,
                [usage.id, row.count],
              );
            }
          }

          const updated: Array<{ released_at: Date }> = await manager.query(
            `UPDATE limit_reservations SET status = 'RELEASED', released_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND status = 'RESERVED'
              RETURNING released_at`,
            [reservationId],
          );

          const audit = await this.auditService.record(manager, {
            entityType: 'limit_reservation',
            entityId: reservationId,
            action: 'MANUAL_RELEASE',
            actor,
            correlationId: input.correlationId ?? row.correlation_id ?? undefined,
            previousValues: { status: 'RESERVED' },
            newValues: { status: 'RELEASED', reason },
          });

          return this.result({ ...row, released_at: updated[0]?.released_at ?? new Date() }, 'RELEASED', audit.id);
        });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === '40001' || code === '40P01') {
          if (attempt < 4) {
            await new Promise((res) => setTimeout(res, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
            continue;
          }
          // V1-INFRA-03: bounded retry budget exhausted with a genuine PostgreSQL
          // serialization failure/deadlock still occurring. Surface the structured,
          // client-retryable conflict below instead of the raw QueryFailedError.
          throw this.transactionContentionExhaustedException();
        }
        throw e;
      }
    }
    throw this.transactionContentionExhaustedException();
  }

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance.
  private transactionContentionExhaustedException(): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const message = 'Manual reservation release could not be completed after retries';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
  }

  private result(
    row: {
      id: string;
      status: string;
      principal_type: string;
      principal_id: string;
      limit_profile_code: string;
      product: string;
      dimension: string;
      currency: string;
      amount_minor: string | null;
      count: number | null;
      limit_usage_id: string | null;
      released_at: Date | null;
    },
    outcome: 'RELEASED' | 'ALREADY_RELEASED',
    auditEventId: string | null,
  ): ManualReleaseResult {
    return {
      reservationId: row.id,
      outcome,
      status: 'RELEASED',
      principalType: row.principal_type,
      principalId: row.principal_id,
      limitProfileCode: row.limit_profile_code,
      product: row.product,
      dimension: row.dimension,
      currency: row.currency,
      amountMinor: row.amount_minor,
      count: row.count,
      limitUsageId: row.limit_usage_id,
      releasedAt: row.released_at,
      auditEventId,
    };
  }
}
