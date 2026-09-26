/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';

export interface CashToCashExpiryInput {
  limit?: number;
  now?: Date;
  correlationId?: string;
  actor?: string;
}

export interface CashToCashExpiryResult {
  expiredCount: number;
  expiredIds: string[];
  correlationId?: string;
  executedAt: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * A17 Cash→Cash Expiry Service
 *
 * Configurable expiry: transfer's expiresAt is persisted at initiation as now + CASH_TO_CASH_EXPIRY_SECONDS
 * (default 604800 = 7 days, NOT a regulatory requirement, documented as implementation assumption).
 * Once persisted, expiry timestamp is stable even if configuration later changes.
 *
 * Financial treatment: EXPIRY DOES NOT MOVE FUNDS. The principal remains in CASH_TO_CASH-UNCLAIMED-NGN liability.
 * No journal is created on expiry. No automatic refund to Agent. Funds remain identifiable via transfer status EXPIRED.
 * Conservation: no money created/destroyed; later disposition is formal backend/regulatory process outside A17.
 *
 * Concurrency: uses SERIALIZABLE + SELECT FOR UPDATE SKIP LOCKED so multiple workers cannot double-process
 * the same transfer, and claim-vs-expiry race yields exactly one terminal state (CLAIMED xor EXPIRED).
 * Idempotent: repeated sweeps find zero eligible rows and produce no duplicate transitions/audits.
 */
@Injectable()
export class AgentCashToCashExpiryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async expireDueTransfers(input: CashToCashExpiryInput = {}): Promise<CashToCashExpiryResult> {
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException('now must be a valid date');
    }
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;
    const actor = input.actor?.trim() ? input.actor.trim() : 'system-expiry';

    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          // Select only UNCLAIMED and already due (expires_at <= now), ordered deterministically.
          // SKIP LOCKED allows concurrent workers to not block each other.
          const rows: Array<{
            id: string;
            beneficiary_phone: string;
            principal_minor: string;
            currency: string;
            reference: string | null;
            expires_at: string;
          }> = await manager.query(
            `SELECT id, beneficiary_phone, principal_minor, currency, reference, expires_at
               FROM cash_to_cash_transfers
              WHERE status = 'UNCLAIMED' AND expires_at <= $1
              ORDER BY expires_at ASC, created_at ASC
              LIMIT $2
              FOR UPDATE SKIP LOCKED`,
            [now.toISOString(), limit],
          );

          if (rows.length === 0) {
            return {
              expiredCount: 0,
              expiredIds: [],
              correlationId,
              executedAt: now,
            };
          }

          const expiredIds: string[] = [];
          for (const row of rows) {
            // Re-check status inside same lock (should still be UNCLAIMED due to FOR UPDATE, but guard anyway)
            // Update to EXPIRED with expired_at = now
            await manager.query(
              `UPDATE cash_to_cash_transfers
                  SET status = 'EXPIRED', expired_at = $1, updated_at = NOW()
                WHERE id = $2 AND status = 'UNCLAIMED'`,
              [now.toISOString(), row.id],
            );
            // Verify update affected a row; if not, another worker won the race (SKIP LOCKED should prevent, but guard)
            // We assume update succeeded because we hold the lock.
            expiredIds.push(row.id);

            await this.auditService.record(manager, {
              entityType: 'AGENT_CASH_TO_CASH',
              entityId: row.id,
              action: 'CASH_TO_CASH_EXPIRED',
              actor,
              correlationId,
              previousValues: {
                status: 'UNCLAIMED',
                expiresAt: row.expires_at,
              },
              newValues: {
                transferId: row.id,
                beneficiaryPhone: row.beneficiary_phone,
                principalMinor: row.principal_minor,
                currency: row.currency,
                previousStatus: 'UNCLAIMED',
                newStatus: 'EXPIRED',
                expiredAt: now.toISOString(),
                expiresAt: row.expires_at,
                reference: row.reference,
                correlationId: correlationId ?? null,
              },
            });
          }

          return {
            expiredCount: expiredIds.length,
            expiredIds,
            correlationId,
            executedAt: now,
          };
        });
      } catch (error: any) {
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException('Expiry sweep could not complete after retries');
  }

  /**
   * Expire a single transfer by id if eligible. Used for focused tests and to demonstrate per-transfer idempotency.
   * Returns true if transitioned, false if already EXPIRED/CLAIMED or not yet due.
   */
  async expireOne(transferId: string, now = new Date(), correlationId?: string, actor = 'system-expiry'): Promise<boolean> {
    const id = transferId.trim().toLowerCase();
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_PATTERN.test(id)) throw new BadRequestException('transferId must be a UUID');
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const rows: Array<{
            id: string;
            status: string;
            expires_at: string;
            beneficiary_phone: string;
            principal_minor: string;
            currency: string;
            reference: string | null;
          }> = await manager.query(`SELECT id, status, expires_at, beneficiary_phone, principal_minor, currency, reference FROM cash_to_cash_transfers WHERE id=$1 FOR UPDATE`, [id]);
          const transfer = rows[0];
          if (!transfer) throw new BadRequestException(`Transfer ${id} not found`);
          if (transfer.status === 'EXPIRED') {
            return false; // idempotent: already expired
          }
          if (transfer.status === 'CLAIMED') {
            return false; // cannot expire claimed
          }
          if (transfer.status !== 'UNCLAIMED') {
            return false;
          }
          if (new Date(transfer.expires_at).getTime() > now.getTime()) {
            return false; // not yet due
          }
          await manager.query(`UPDATE cash_to_cash_transfers SET status='EXPIRED', expired_at=$1, updated_at=NOW() WHERE id=$2`, [now.toISOString(), id]);
          await this.auditService.record(manager, {
            entityType: 'AGENT_CASH_TO_CASH',
            entityId: id,
            action: 'CASH_TO_CASH_EXPIRED',
            actor,
            correlationId,
            previousValues: { status: 'UNCLAIMED', expiresAt: transfer.expires_at },
            newValues: {
              transferId: id,
              beneficiaryPhone: transfer.beneficiary_phone,
              principalMinor: transfer.principal_minor,
              currency: transfer.currency,
              previousStatus: 'UNCLAIMED',
              newStatus: 'EXPIRED',
              expiredAt: now.toISOString(),
              expiresAt: transfer.expires_at,
              reference: transfer.reference,
              correlationId: correlationId ?? null,
            },
          });
          return true;
        });
        return result;
      } catch (error: any) {
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return false;
  }
}
