import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Internal persistence only. Callers must independently perform authorization and ledger checks. */
export interface NewFinancialAuthorization {
  id: string;
  customerId: string;
  sessionId: string;
  pinAuditId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  amountMinor: string;
  currency: string;
  requestHash: string;
  principalId: string;
  institution: string;
}

export interface NewFinancialCommitment {
  id: string;
  authorizationId: string;
  withdrawalId: string;
  externalOperationId: string;
  reservationJournalId: string;
  reserveAccountId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface FinancialCommitmentRecord {
  id: string;
  authorization_id: string;
  withdrawal_id: string;
  external_operation_id: string;
  reservation_journal_id: string;
  reserve_account_id: string;
  idempotency_key: string;
  request_hash: string;
  state: 'RESERVED' | 'SETTLED' | 'RELEASED';
  resolution_journal_id: string | null;
}

@Injectable()
export class FinancialCommitmentRepository {
  async insertAuthorization(
    manager: EntityManager,
    value: NewFinancialAuthorization,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO financial_authorizations
       (id, customer_id, session_id, pin_audit_id, wallet_account_id, ledger_account_id,
        amount_minor, currency, request_hash, principal_type, principal_id, institution)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CUSTOMER',$10,$11)`,
      [
        value.id,
        value.customerId,
        value.sessionId,
        value.pinAuditId,
        value.walletAccountId,
        value.ledgerAccountId,
        value.amountMinor,
        value.currency,
        value.requestHash,
        value.principalId,
        value.institution,
      ],
    );
  }

  async insertReserved(manager: EntityManager, value: NewFinancialCommitment): Promise<void> {
    await manager.query(
      `INSERT INTO financial_commitments
       (id,authorization_id,withdrawal_id,external_operation_id,reservation_journal_id,
        reserve_account_id,idempotency_key,request_hash,state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED')`,
      [
        value.id,
        value.authorizationId,
        value.withdrawalId,
        value.externalOperationId,
        value.reservationJournalId,
        value.reserveAccountId,
        value.idempotencyKey,
        value.requestHash,
      ],
    );
  }

  async lockByOperation(
    manager: EntityManager,
    operationId: string,
  ): Promise<FinancialCommitmentRecord | null> {
    const rows = await manager.query<FinancialCommitmentRecord[]>(
      'SELECT * FROM financial_commitments WHERE external_operation_id=$1 FOR UPDATE',
      [operationId],
    );
    return rows[0] ?? null;
  }

  async resolve(
    manager: EntityManager,
    id: string,
    state: 'SETTLED' | 'RELEASED',
    journalId: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ id: string }>>(
      `WITH changed AS (UPDATE financial_commitments SET state=$2, resolution_journal_id=$3, resolved_at=clock_timestamp()
       WHERE id=$1 AND state='RESERVED' RETURNING id) SELECT id FROM changed`,
      [id, state, journalId],
    );
    if (rows.length !== 1) throw new Error('Financial commitment is not reserved');
  }
}
