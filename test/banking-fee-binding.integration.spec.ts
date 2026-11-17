import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { BankingFeeBindingService } from '../src/banking/banking-fee-binding.service';
import { FeeEngine } from '../src/fee/fee.engine';
import { createIntegrationDataSource } from './support/pg-harness';

/**
 * Fee and authorization binding (real PostgreSQL).
 *
 * The property under test is narrow and serious: once a customer has authorized an amount, no later
 * change — to the fee rule, the product, the provider's price — may alter what they are charged.
 *
 * These tests therefore care most about the refusals. There is no default fee, no repricing on replay,
 * and no way to edit a binding afterwards. A test policy is used throughout, because no production fee
 * values exist and inventing them would be exactly the defect this suite is meant to prevent.
 */
describe('banking fee binding (real PostgreSQL)', () => {
  let db: DataSource;
  let service: BankingFeeBindingService;
  let institutionId: string;
  let walletId: string;

  const PRODUCT = 'BANK_TRANSFER_OUT';

  beforeAll(async () => {
    db = await createIntegrationDataSource('bkfee');
    service = new BankingFeeBindingService(new FeeEngine());
    institutionId = randomUUID();
    const suffix = institutionId.replace(/-/g, '').slice(0, 8).toUpperCase();
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Fee binding fixture','PARTNER','fixture')`,
      [institutionId, `BKFEE-${suffix}`, `BKFEE_${suffix}`],
    );
    const ledgerAccountId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Fee fixture','LIABILITY','CREDIT','NGN')`,
      [ledgerAccountId, `FEE_FIXTURE_${suffix}`],
    );
    walletId = randomUUID();
    await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER')`,
      [walletId, `cust-${suffix}`, ledgerAccountId],
    );
  }, 120_000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  /** Controlled test policy: 1.5% with a 100 floor, 7.5% VAT. Not a production fee. */
  async function seedRule(
    over: Partial<{
      productCode: string;
      flatFeeMinor: string;
      percentageBps: number;
      minimumFeeMinor: string;
      maximumFeeMinor: string | null;
      vatBps: number;
      effectiveFrom: string;
      effectiveTo: string | null;
      isActive: boolean;
    }> = {},
  ): Promise<string> {
    const productCode = over.productCode ?? PRODUCT;
    const existing = await db.query<Array<{ code: string }>>(
      'SELECT code FROM products WHERE code=$1',
      [productCode],
    );
    if (!existing[0]) {
      await db.query(
        `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
         VALUES ($1,'Bank transfer outbound','CUSTOMER','NGN',true,'ACTIVE','fixture')`,
        [productCode],
      );
    }
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO fee_rules
         (product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,maximum_fee_minor,
          vat_bps,effective_from,effective_to,is_active,created_by)
       VALUES ($1,'NGN',$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now() - interval '1 hour'),$8,$9,'fixture')
       RETURNING id`,
      [
        productCode,
        over.flatFeeMinor ?? '0',
        over.percentageBps ?? 150,
        over.minimumFeeMinor ?? '100',
        over.maximumFeeMinor ?? null,
        over.vatBps ?? 750,
        over.effectiveFrom ?? null,
        over.effectiveTo ?? null,
        over.isActive ?? true,
      ],
    );
    return rows[0]!.id;
  }

  function input(over: Partial<Parameters<BankingFeeBindingService['bindInTransaction']>[1]> = {}) {
    return {
      externalOperationId: randomUUID(),
      institutionId,
      walletId,
      currency: 'NGN',
      beneficiaryAmountMinor: '100000',
      productCode: PRODUCT,
      ...over,
    };
  }

  const bind = (i: ReturnType<typeof input>) =>
    db.transaction((m) => service.bindInTransaction(m, i));

  it('binds beneficiary, fee, tax and debit so that debit = beneficiary + fee + tax', async () => {
    await seedRule({ flatFeeMinor: '0', percentageBps: 150, minimumFeeMinor: '100', vatBps: 750 });
    const view = await bind(input({ beneficiaryAmountMinor: '100000' }));
    // 1.5% of 100000 = 1500; VAT 7.5% of 1500 = 112.5 -> the engine's rounding decides the minor
    // units, and the invariant must hold regardless of which way it rounded.
    const expectedDebit = (
      BigInt(view.beneficiaryAmountMinor) +
      BigInt(view.serviceFeeMinor) +
      BigInt(view.taxMinor)
    ).toString();
    expect(view.customerDebitMinor).toBe(expectedDebit);
    expect(view.beneficiaryAmountMinor).toBe('100000');
    expect(view.pricingSource).toBe('APPROVED_RULE');
  });

  it('refuses when no approved rule is in force, rather than charging nothing', async () => {
    // A product with no rule at all: the honest answer is a refusal, not a free transfer.
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('UNPRICED_TRANSFER','Unpriced','CUSTOMER','NGN',true,'ACTIVE','fixture')`,
    );
    await expect(bind(input({ productCode: 'UNPRICED_TRANSFER' }))).rejects.toThrow(
      /No approved fee rule/i,
    );
  });

  it('ignores a rule that is not yet effective or already expired', async () => {
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('FUTURE_PRICED','Future','CUSTOMER','NGN',true,'ACTIVE','fixture')`,
    );
    await db.query(
      `INSERT INTO fee_rules (product_code,currency,flat_fee_minor,percentage_bps,vat_bps,
                              effective_from,is_active,created_by)
       VALUES ('FUTURE_PRICED','NGN',0,100,750, now() + interval '1 day', true,'fixture')`,
    );
    // A rule that starts tomorrow must not price a transfer today.
    await expect(bind(input({ productCode: 'FUTURE_PRICED' }))).rejects.toThrow(
      /No approved fee rule/i,
    );
  });

  it('refuses a rule belonging to a disabled product', async () => {
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('DISABLED_PRODUCT','Disabled','CUSTOMER','NGN',false,'ACTIVE','fixture')`,
    );
    await db.query(
      `INSERT INTO fee_rules (product_code,currency,flat_fee_minor,percentage_bps,vat_bps,
                              effective_from,is_active,created_by)
       VALUES ('DISABLED_PRODUCT','NGN',0,100,750, now() - interval '1 hour', true,'fixture')`,
    );
    await expect(bind(input({ productCode: 'DISABLED_PRODUCT' }))).rejects.toThrow(/not active/i);
  });

  it('returns the SAME binding on replay and never reprices', async () => {
    // A dedicated product: `uq_fee_rules_identity` allows one rule per (product, currency,
    // effective_from), which is the constraint that makes "the rule in force" unambiguous.
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('REPLAY_PRICED','Replay','CUSTOMER','NGN',true,'ACTIVE','fixture')`,
    );
    await seedRule({ productCode: 'REPLAY_PRICED', percentageBps: 150 });
    const base = input({ beneficiaryAmountMinor: '200000', productCode: 'REPLAY_PRICED' });
    const first = await bind(base);
    // Change the rule underneath: a replay must still return the original pricing.
    await db.query(
      `UPDATE fee_rules SET percentage_bps=900, version=version+1 WHERE product_code='REPLAY_PRICED'`,
    );
    const replay = await bind(base);
    expect(replay.id).toBe(first.id);
    expect(replay.serviceFeeMinor).toBe(first.serviceFeeMinor);
    expect(replay.customerDebitMinor).toBe(first.customerDebitMinor);
  });

  it('refuses a replay that asks to price a different amount for the same operation', async () => {
    await seedRule({ percentageBps: 150 });
    const base = input({ beneficiaryAmountMinor: '50000' });
    await bind(base);
    await expect(bind({ ...base, beneficiaryAmountMinor: '90000' })).rejects.toThrow(
      /different amount/i,
    );
  });

  it('makes the binding immutable: no update, no delete', async () => {
    await seedRule({ percentageBps: 150 });
    const view = await bind(input());
    await expect(
      db.query('UPDATE banking_operation_fee_bindings SET service_fee_minor=0 WHERE id=$1', [
        view.id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query('DELETE FROM banking_operation_fee_bindings WHERE id=$1', [view.id]),
    ).rejects.toThrow(/never deleted/i);
  });

  it('cannot be written with arithmetic that does not add up', async () => {
    await seedRule({ percentageBps: 150 });
    const view = await bind(input({ beneficiaryAmountMinor: '123456' }));
    // Directly attempt a row whose debit does not equal its components.
    await expect(
      db.query(
        `INSERT INTO banking_operation_fee_bindings
           (external_operation_id,institution_id,wallet_id,currency,beneficiary_amount_minor,
            customer_debit_minor,service_fee_minor,tax_minor,settlement_amount_minor,
            rule_snapshot,pricing_source)
         VALUES ($1,$2,$3,'NGN',1000,9999,0,0,1000,'{"flatFeeMinor":"0","percentageBps":"0","vatBps":"0"}','APPROVED_RULE')`,
        [randomUUID(), institutionId, walletId],
      ),
    ).rejects.toThrow(/chk_banking_fee_binding_arithmetic|check constraint/i);
    expect(view.id).toBeTruthy();
  });

  it('keeps the provider fee distinct from what the customer pays', async () => {
    await seedRule({ percentageBps: 150 });
    const view = await bind(input({ beneficiaryAmountMinor: '100000', providerFeeMinor: '250' }));
    const rows = await db.query<
      Array<{ provider_fee_minor: string; customer_debit_minor: string }>
    >(
      `SELECT provider_fee_minor::text, customer_debit_minor::text
         FROM banking_operation_fee_bindings WHERE id=$1`,
      [view.id],
    );
    // The provider's charge is our cost, not an addition to the customer's debit.
    expect(rows[0]!.provider_fee_minor).toBe('250');
    expect(rows[0]!.customer_debit_minor).toBe(view.customerDebitMinor);
  });
});
