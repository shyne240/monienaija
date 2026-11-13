import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { FinancialCommitmentRepository } from '../src/financial-commitment/financial-commitment.repository';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('financial commitment schema (real PostgreSQL)', () => {
  let db: DataSource;
  const repository = new FinancialCommitmentRepository();
  beforeAll(async () => {
    db = await createIntegrationDataSource('fincommit');
  }, 180000);
  afterAll(async () => {
    if (db) await destroyIntegrationDataSource(db);
  });

  it('runs the migration chain and provisions a segregated non-overdraft liability', async () => {
    const rows = await db.query<
      Array<{
        account_type: string;
        normal_balance: string;
        allow_negative_balance: boolean;
        accounting_unit: string;
      }>
    >(
      `SELECT account_type,normal_balance,allow_negative_balance,accounting_unit
       FROM ledger_accounts WHERE code='PAYMENT-WITHDRAWAL_RESERVE-NGN'`,
    );
    expect(rows).toEqual([
      {
        account_type: 'LIABILITY',
        normal_balance: 'CREDIT',
        allow_negative_balance: false,
        accounting_unit: 'CUSTOMER_FUNDS',
      },
    ]);
    const migrations = await db.query<Array<{ name: string }>>(
      `SELECT name FROM typeorm_migrations WHERE name='CreateFinancialCommitments1785753600140'`,
    );
    expect(migrations).toHaveLength(1);
  });

  it('rejects a caller-supplied authorization reference without genuine bound evidence', async () => {
    await expect(
      db.transaction((manager) =>
        repository.insertAuthorization(manager, {
          id: randomUUID(),
          customerId: randomUUID(),
          sessionId: randomUUID(),
          pinAuditId: randomUUID(),
          walletAccountId: randomUUID(),
          ledgerAccountId: randomUUID(),
          amountMinor: '1000',
          currency: 'NGN',
          requestHash: 'a'.repeat(64),
          principalId: randomUUID(),
          institution: 'MONIENAIJA',
        }),
      ),
    ).rejects.toThrow('Financial authorization evidence is not bound');
    expect(await db.query('SELECT id FROM financial_authorizations')).toHaveLength(0);
  });

  it('rejects a fabricated reservation or operation', async () => {
    await expect(
      db.transaction((manager) =>
        repository.insertReserved(manager, {
          id: randomUUID(),
          authorizationId: randomUUID(),
          withdrawalId: randomUUID(),
          externalOperationId: randomUUID(),
          reservationJournalId: randomUUID(),
          reserveAccountId: randomUUID(),
          idempotencyKey: 'fabricated',
          requestHash: 'b'.repeat(64),
        }),
      ),
    ).rejects.toThrow('Financial commitment does not match');
    expect(await db.query('SELECT id FROM financial_commitments')).toHaveLength(0);
  });
});
