import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Acceptance for migration `1785753600601`.
 *
 * The rules asserted here are the ones that make the financial architecture real rather than stated.
 * Each is enforced by the database, so it holds for code that has not been written yet:
 *
 * - an operation reference can never be rewritten, so retrying an uncertain submission cannot become
 *   a second transfer;
 * - a recorded provider transaction reference is immutable, so two attempts cannot be made to look
 *   like one;
 * - verified inbound amounts are immutable, so history cannot be restated;
 * - financial records cannot be deleted at all;
 * - at most one UNKNOWN virtual-account reservation may exist per wallet, so ambiguity is resolved by
 *   enquiry rather than by resubmitting.
 */
describe('banking operation records (real PostgreSQL)', () => {
  let db: DataSource;
  let institutionId: string;
  let walletId: string;

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkops001');
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Banking operation records fixture','PARTNER','fixture')`,
      [institutionId, `BKOPS-${suffix}`, `BKOPS_${suffix}`],
    );
    // The wallet is required by the reservation table's foreign key; the schema under test is what
    // matters, so the fixture creates the minimum parent rows the real chain demands. A wallet needs
    // a ledger account, which needs a unique code — the real chain enforces both.
    const ledgerAccountId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Banking operation records fixture','LIABILITY','CREDIT','NGN')`,
      [ledgerAccountId, `OPS_FIXTURE_${suffix}`],
    );
    walletId = randomUUID();
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [walletId, `cust-${suffix}`, ledgerAccountId],
    );
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  function outbound(
    over: { state?: string; resolvedAt?: string | null; txRef?: string | null } = {},
  ) {
    const id = randomUUID();
    const reference = `OP-${id.slice(0, 20)}`;
    return {
      id,
      reference,
      insert: () =>
        db.query(
          `INSERT INTO banking_outbound_operations
            (id,institution_id,provider_key,environment,operation_reference,wallet_id,currency,
             amount_minor,destination_bank_code,destination_account_number,state,
             provider_transaction_reference,resolved_at)
           VALUES($1,$2,'MONNIFY','sandbox',$3,$4,'NGN',150000,'058','0123456789',$5,$6,$7)`,
          [
            id,
            institutionId,
            reference,
            walletId,
            over.state ?? 'CREATED',
            over.txRef ?? null,
            over.resolvedAt ?? null,
          ],
        ),
    };
  }

  it('creates the three record tables', async () => {
    for (const table of [
      'banking_virtual_account_reservations',
      'banking_inbound_payments',
      'banking_outbound_operations',
    ]) {
      const [row] = await db.query<Array<{ present: string }>>(
        `SELECT 'yes' AS present FROM information_schema.tables
          WHERE table_schema='public' AND table_name=$1`,
        [table],
      );
      expect(row?.present).toBe('yes');
    }
  });

  it('does not seed any operation record', async () => {
    const [row] = await db.query<Array<{ c: string }>>(
      'SELECT count(*)::text AS c FROM banking_outbound_operations',
    );
    expect(row!.c).toBe('0');
  });

  it('REFUSES to rewrite an operation reference, so a retry cannot become a second transfer', async () => {
    const op = outbound();
    await op.insert();
    await expect(
      db.query(
        `UPDATE banking_outbound_operations SET operation_reference='OP-DIFFERENT-000001' WHERE id=$1`,
        [op.id],
      ),
    ).rejects.toThrow(/immutable/i);
    const [row] = await db.query<Array<{ operation_reference: string }>>(
      'SELECT operation_reference FROM banking_outbound_operations WHERE id=$1',
      [op.id],
    );
    expect(row!.operation_reference).toBe(op.reference);
  });

  it('REFUSES to rewrite a recorded provider transaction reference', async () => {
    const op = outbound({ txRef: 'MNFY|TX|0001' });
    await op.insert();
    await expect(
      db.query(
        `UPDATE banking_outbound_operations SET provider_transaction_reference='MNFY|TX|0002' WHERE id=$1`,
        [op.id],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('allows the provider reference to be recorded once from null', async () => {
    const op = outbound();
    await op.insert();
    await db.query(
      `UPDATE banking_outbound_operations SET provider_transaction_reference='MNFY|TX|0003' WHERE id=$1`,
      [op.id],
    );
    const [row] = await db.query<Array<{ provider_transaction_reference: string }>>(
      'SELECT provider_transaction_reference FROM banking_outbound_operations WHERE id=$1',
      [op.id],
    );
    expect(row!.provider_transaction_reference).toBe('MNFY|TX|0003');
  });

  it('permits an uncertain operation to move to review — the recovery path must stay open', async () => {
    const op = outbound({ state: 'UNKNOWN' });
    await op.insert();
    // A human investigating an unknown transfer must be able to take ownership of it. What they may
    // not do is assert an outcome: SUCCESSFUL requires a resolved_at and evidence, and that is
    // checked below.
    await db.query(`UPDATE banking_outbound_operations SET state='MANUAL_REVIEW' WHERE id=$1`, [
      op.id,
    ]);
    const [row] = await db.query<Array<{ state: string }>>(
      'SELECT state FROM banking_outbound_operations WHERE id=$1',
      [op.id],
    );
    expect(row!.state).toBe('MANUAL_REVIEW');
  });

  it('refuses a resolved state with no resolution timestamp', async () => {
    const op = outbound({ state: 'SUCCESSFUL', resolvedAt: null });
    await expect(op.insert()).rejects.toThrow();
  });

  it('refuses an uncertain record that claims to be resolved', async () => {
    const op = outbound({ state: 'UNKNOWN', resolvedAt: new Date().toISOString() });
    await expect(op.insert()).rejects.toThrow();
  });

  it('REFUSES to delete an outbound operation', async () => {
    const op = outbound();
    await op.insert();
    await expect(
      db.query('DELETE FROM banking_outbound_operations WHERE id=$1', [op.id]),
    ).rejects.toThrow(/never deleted/i);
  });

  function inbound(over: { gross?: number; fee?: number; credited?: number } = {}) {
    const id = randomUUID();
    const gross = over.gross ?? 78000;
    const fee = over.fee ?? 400;
    return {
      id,
      insert: () =>
        db.query(
          `INSERT INTO banking_inbound_payments
            (id,institution_id,provider_key,environment,provider_transaction_reference,currency,
             gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state)
           VALUES($1,$2,'MONNIFY','sandbox',$3,'NGN',$4,$5,$6,'VERIFIED')`,
          [id, institutionId, `MNFY|${id.slice(0, 18)}`, gross, fee, over.credited ?? gross - fee],
        ),
    };
  }

  it('refuses an inbound payment whose credited amount does not equal gross minus fee', async () => {
    // The invariant is a CHECK, not a convention: a mismatch here is exactly how fee reconciliation
    // loses money silently.
    const record = inbound({ gross: 78000, fee: 400, credited: 77000 });
    await expect(record.insert()).rejects.toThrow();
  });

  it('accepts a consistent inbound payment and refuses to restate its amount', async () => {
    const record = inbound();
    await record.insert();
    await expect(
      db.query(
        `UPDATE banking_inbound_payments SET gross_amount_minor=90000,credited_amount_minor=89600 WHERE id=$1`,
        [record.id],
      ),
    ).rejects.toThrow(/immutable/i);
    // Posting to the ledger is a legitimate forward transition and must remain possible.
    const ledgerId = randomUUID();
    await db.query(`UPDATE banking_inbound_payments SET ledger_transaction_id=$2 WHERE id=$1`, [
      record.id,
      ledgerId,
    ]);
    const [row] = await db.query<Array<{ ledger_transaction_id: string }>>(
      'SELECT ledger_transaction_id FROM banking_inbound_payments WHERE id=$1',
      [record.id],
    );
    expect(row!.ledger_transaction_id).toBe(ledgerId);
  });

  it('deduplicates a replayed provider reference instead of crediting twice', async () => {
    const reference = `MNFY|DUP|${randomUUID().slice(0, 12)}`;
    const insert = (id: string) =>
      db.query(
        `INSERT INTO banking_inbound_payments
          (id,institution_id,provider_key,environment,provider_transaction_reference,currency,
           gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state)
         VALUES($1,$2,'MONNIFY','sandbox',$3,'NGN',100000,0,100000,'VERIFIED')`,
        [id, institutionId, reference],
      );
    await insert(randomUUID());
    await expect(insert(randomUUID())).rejects.toThrow();
  });

  it('REFUSES to delete a verified inbound payment', async () => {
    const record = inbound();
    await record.insert();
    await expect(
      db.query('DELETE FROM banking_inbound_payments WHERE id=$1', [record.id]),
    ).rejects.toThrow(/never deleted/i);
  });

  function reservation(over: { outcome?: string; reference?: string } = {}) {
    const id = randomUUID();
    return {
      id,
      insert: () =>
        db.query(
          `INSERT INTO banking_virtual_account_reservations
            (id,institution_id,wallet_id,provider_key,environment,account_reference,currency,
             outcome,request_fingerprint)
           VALUES($1,$2,$3,'MONNIFY','sandbox',$4,'NGN',$5,$6)`,
          [
            id,
            institutionId,
            walletId,
            over.reference ?? `VA-${id.slice(0, 20)}`,
            over.outcome ?? 'REQUESTED',
            'c'.repeat(64),
          ],
        ),
    };
  }

  it('permits at most one UNKNOWN reservation per wallet, so ambiguity is enquired not resubmitted', async () => {
    const first = reservation({ outcome: 'UNKNOWN' });
    await first.insert();
    const second = reservation({ outcome: 'UNKNOWN' });
    await expect(second.insert()).rejects.toThrow();
    // A REQUESTED attempt for the same wallet is still allowed: only the ambiguous state is exclusive.
    const third = reservation({ outcome: 'REQUESTED' });
    await third.insert();
  });

  it('keeps UNKNOWN distinct from REJECTED — they mean different things to a customer', async () => {
    const [row] = await db.query<Array<{ definition: string }>>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='banking_virtual_account_reservations'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%UNKNOWN%'`,
    );
    expect(row?.definition).toContain('UNKNOWN');
    expect(row?.definition).toContain('REJECTED');
  });

  it('grants runtime role insert/update but never delete', async () => {
    for (const table of [
      'banking_outbound_operations',
      'banking_inbound_payments',
      'banking_virtual_account_reservations',
    ]) {
      const [row] = await db.query<Array<{ can_delete: boolean; can_insert: boolean }>>(
        `SELECT has_table_privilege('monienaija_runtime',$1,'DELETE') AS can_delete,
                has_table_privilege('monienaija_runtime',$1,'INSERT') AS can_insert`,
        [table],
      );
      expect(row?.can_delete).toBe(false);
      expect(row?.can_insert).toBe(true);
    }
  });
});
