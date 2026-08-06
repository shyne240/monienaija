import type { DataSource, EntityManager } from 'typeorm';

import { CustomerFinancialAccountDiscrepancyType } from '../src/reconciliation/customer-financial-account-reconciliation.types';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const BINDING_ID = '00000000-0000-4000-8000-000000000005';

class BindingReconciliationQueryFixture {
  readonly queries: string[] = [];
  mode: 'CONSISTENT' | 'DRIFTED' = 'CONSISTENT';

  query(sql: string): Promise<unknown[]> {
    this.queries.push(sql);
    if (sql.startsWith('SET TRANSACTION')) {
      return Promise.resolve([]);
    }
    if (sql.includes('A3T07 binding population counts')) {
      return Promise.resolve([
        {
          bindings_checked: '1',
          active_bindings_checked: '1',
          customer_wallets_checked: '1',
          financial_wallets_checked: '1',
        },
      ]);
    }
    if (sql.includes('A3T07 active binding duplicate scopes')) {
      return Promise.resolve(
        this.mode === 'DRIFTED'
          ? [
              {
                duplicate_dimension: 'CUSTOMER_CURRENCY',
                scope_value: null,
                customer_id: CUSTOMER_ID,
                currency: 'NGN',
                occurrence_count: '2',
              },
            ]
          : [],
      );
    }
    if (sql.includes('A3T07 active binding source integrity')) {
      return Promise.resolve(
        this.mode === 'DRIFTED' ? [this.driftedSourceRow(), this.missingSourceRow()] : [],
      );
    }
    if (sql.includes('A3T07 customer wallet coverage')) {
      return Promise.resolve(
        this.mode === 'DRIFTED'
          ? [
              {
                customer_wallet_id: CUSTOMER_WALLET_ID,
                customer_id: CUSTOMER_ID,
                currency: 'NGN',
                ownership_exists: false,
                ownership_customer_matches: false,
                active_binding_exists: false,
              },
              {
                customer_wallet_id: '00000000-0000-4000-8000-000000000006',
                customer_id: CUSTOMER_ID,
                currency: 'NGN',
                ownership_exists: true,
                ownership_customer_matches: false,
                active_binding_exists: false,
              },
            ]
          : [],
      );
    }
    if (sql.includes('A3T07 unbound financial wallet coverage')) {
      return Promise.resolve(
        this.mode === 'DRIFTED'
          ? [
              {
                wallet_account_id: WALLET_ACCOUNT_ID,
                currency: 'NGN',
                wallet_status: 'ACTIVE',
                ledger_account_id: LEDGER_ACCOUNT_ID,
                ledger_account_exists: true,
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  }

  private missingSourceRow(): Record<string, unknown> {
    return {
      binding_id: '00000000-0000-4000-8000-000000000007',
      customer_id: CUSTOMER_ID,
      customer_wallet_id: CUSTOMER_WALLET_ID,
      wallet_account_id: WALLET_ACCOUNT_ID,
      ledger_account_id: LEDGER_ACCOUNT_ID,
      binding_currency: 'NGN',
      binding_accounting_unit: 'CUSTOMER_FUNDS',
      source_customer_version: '1',
      source_customer_wallet_version: '2',
      customer_exists: true,
      customer_status: 'ACTIVE',
      customer_deleted: false,
      customer_version: '1',
      customer_wallet_exists: true,
      customer_wallet_customer_matches: true,
      customer_wallet_status: 'ACTIVE',
      customer_wallet_currency: 'NGN',
      customer_wallet_deleted: false,
      customer_wallet_version: '2',
      wallet_account_exists: true,
      wallet_customer_matches: true,
      wallet_status: 'ACTIVE',
      wallet_currency: 'NGN',
      wallet_ledger_matches: true,
      ledger_account_exists: false,
    };
  }

  private driftedSourceRow(): Record<string, unknown> {
    return {
      binding_id: BINDING_ID,
      customer_id: CUSTOMER_ID,
      customer_wallet_id: CUSTOMER_WALLET_ID,
      wallet_account_id: WALLET_ACCOUNT_ID,
      ledger_account_id: LEDGER_ACCOUNT_ID,
      binding_currency: 'NGN',
      binding_accounting_unit: 'CUSTOMER_FUNDS',
      source_customer_version: '1',
      source_customer_wallet_version: '1',
      customer_exists: true,
      customer_status: 'SUSPENDED',
      customer_deleted: false,
      customer_version: '2',
      customer_wallet_exists: true,
      customer_wallet_customer_matches: true,
      customer_wallet_status: 'SUSPENDED',
      customer_wallet_currency: 'USD',
      customer_wallet_deleted: false,
      customer_wallet_version: '2',
      wallet_account_exists: true,
      wallet_customer_matches: false,
      wallet_status: 'ACTIVE',
      wallet_currency: 'NGN',
      wallet_ledger_matches: true,
      ledger_account_exists: true,
      ledger_currency: 'USD',
      ledger_accounting_unit: 'SETTLEMENT',
      ledger_account_type: 'ASSET',
      ledger_normal_balance: 'DEBIT',
      ledger_allow_negative_balance: true,
      ledger_is_active: false,
    };
  }
}

class BindingReconciliationDataSource {
  constructor(readonly fixture: BindingReconciliationQueryFixture) {}

  transaction<T>(
    isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (isolationLevel !== 'REPEATABLE READ') {
      throw new Error(`Unexpected isolation level ${isolationLevel}`);
    }
    return callback(this.fixture as unknown as EntityManager);
  }
}

describe('A3 binding reconciliation and drift detection', () => {
  it('passes a consistent binding census without performing repair', async () => {
    const fixture = new BindingReconciliationQueryFixture();
    const service = new ReconciliationService(
      new BindingReconciliationDataSource(fixture) as unknown as DataSource,
    );

    const report = await service.getBindingReconciliation();

    expect(report.status).toBe(VerificationStatus.PASS);
    expect(report.repairPerformed).toBe(false);
    expect(report.discrepancies).toEqual([]);
    expect(report.summary).toMatchObject({
      bindingsChecked: 1,
      activeBindingsChecked: 1,
      customerWalletsChecked: 1,
      financialWalletsChecked: 1,
      discrepancies: 0,
    });
    expect(fixture.queries).toContain('SET TRANSACTION READ ONLY');
    expect(fixture.queries.every((query) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(query))).toBe(true);
  });

  it('detects duplicate, orphaned, missing, unbound, ownership, and source drift classes', async () => {
    const fixture = new BindingReconciliationQueryFixture();
    fixture.mode = 'DRIFTED';
    const service = new ReconciliationService(
      new BindingReconciliationDataSource(fixture) as unknown as DataSource,
    );

    const report = await service.getBindingReconciliation();
    const types = report.discrepancies.map((discrepancy) => discrepancy.type);

    expect(report.status).toBe(VerificationStatus.ERROR);
    expect(report.repairPerformed).toBe(false);
    expect(types).toEqual(
      expect.arrayContaining([
        CustomerFinancialAccountDiscrepancyType.DUPLICATE_ACTIVE_BINDING,
        CustomerFinancialAccountDiscrepancyType.ORPHANED_BINDING,
        CustomerFinancialAccountDiscrepancyType.MISSING_LEDGER_ACCOUNT,
        CustomerFinancialAccountDiscrepancyType.ACCOUNT_OWNERSHIP_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.ORPHANED_CUSTOMER_WALLET,
        CustomerFinancialAccountDiscrepancyType.CUSTOMER_OWNERSHIP_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.MISSING_ACTIVE_BINDING,
        CustomerFinancialAccountDiscrepancyType.UNBOUND_FINANCIAL_WALLET,
        CustomerFinancialAccountDiscrepancyType.CURRENCY_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.ACCOUNTING_UNIT_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.ACCOUNT_TYPE_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.NORMAL_BALANCE_MISMATCH,
        CustomerFinancialAccountDiscrepancyType.NEGATIVE_BALANCE_ALLOWED,
        CustomerFinancialAccountDiscrepancyType.INACTIVE_LEDGER_ACCOUNT,
        CustomerFinancialAccountDiscrepancyType.STALE_BINDING,
        CustomerFinancialAccountDiscrepancyType.LIFECYCLE_MISMATCH,
      ]),
    );
    expect(
      report.discrepancies.every((discrepancy) => discrepancy.recoveryState !== undefined),
    ).toBe(true);
    expect(report.discrepancies.every((discrepancy) => discrepancy.owner !== undefined)).toBe(true);
    expect(fixture.queries.every((query) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(query))).toBe(true);
  });

  it('includes binding reconciliation in the existing financial reconciliation gate', async () => {
    const fixture = new BindingReconciliationQueryFixture();
    const service = new ReconciliationService(
      new BindingReconciliationDataSource(fixture) as unknown as DataSource,
    );

    const report = await service.runReconciliation();

    expect(report.binding.status).toBe(VerificationStatus.PASS);
    expect(
      report.checks.find((check) => check.name === 'customer_financial_account_binding_integrity'),
    ).toMatchObject({ status: VerificationStatus.PASS });
  });
});
