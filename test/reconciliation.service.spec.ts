import type { DataSource, EntityManager } from 'typeorm';

import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

class ReconciliationQueryFixture {
  readonly queries: string[] = [];

  query(sql: string): Promise<unknown[]> {
    this.queries.push(sql);
    if (sql.startsWith('SET TRANSACTION')) {
      return Promise.resolve([]);
    }
    if (sql.includes('wallet_balances')) {
      return Promise.resolve([
        {
          wallets_checked: '2',
          missing_accounts: '0',
          currency_mismatches: '0',
          negative_balances: '0',
          violations: '0',
        },
      ]);
    }
    if (sql.includes('wallet_liability_account_ownership')) {
      return Promise.resolve([{ wallets_checked: '2', violations: '0' }]);
    }
    if (sql.includes('journals_checked')) {
      return Promise.resolve([{ journals_checked: '1', violations: '0' }]);
    }
    if (sql.includes('completed_transfers')) {
      return Promise.resolve([{ completed_transfers: '1', violations: '0' }]);
    }
    if (sql.includes("WHERE status = 'FAILED'")) {
      return Promise.resolve([{ failed_transfers: '0', violations: '0' }]);
    }
    if (sql.includes('account_id') && sql.includes('entry_count')) {
      return Promise.resolve([
        {
          account_id: ACCOUNT_ID,
          account_code: 'CASH-NGN',
          account_name: 'Synthetic cash',
          account_type: 'ASSET',
          currency: 'NGN',
          accounting_unit: 'CUSTOMER_FUNDS',
          entry_count: '1',
          total_debits_minor: '100',
          total_credits_minor: '0',
          balance_minor: '100',
          first_activity_at: '2026-08-03T00:00:00.000Z',
          last_activity_at: '2026-08-03T00:00:00.000Z',
        },
        {
          account_id: '00000000-0000-4000-8000-000000000002',
          account_code: 'WALLET-NGN',
          account_name: 'Customer wallet',
          account_type: 'LIABILITY',
          currency: 'NGN',
          accounting_unit: 'CUSTOMER_FUNDS',
          entry_count: '1',
          total_debits_minor: '0',
          total_credits_minor: '100',
          balance_minor: '100',
          first_activity_at: '2026-08-03T00:00:00.000Z',
          last_activity_at: '2026-08-03T00:00:00.000Z',
        },
      ]);
    }
    if (sql.includes('WHERE a.account_type = $1')) {
      return Promise.resolve([
        {
          account_type: 'ASSET',
          currency: 'NGN',
          accounting_unit: 'CUSTOMER_FUNDS',
          total_balance_minor: '100',
        },
      ]);
    }
    if (sql.includes('total_lines')) {
      return Promise.resolve([
        {
          total_journals: '1',
          invalid_journals: '0',
          total_lines: '2',
          orphan_lines: '0',
        },
      ]);
    }
    if (sql.includes('total_debits_minor') && sql.includes('GROUP BY currency')) {
      return Promise.resolve([
        {
          currency: 'NGN',
          accounting_unit: 'CUSTOMER_FUNDS',
          total_debits_minor: '100',
          total_credits_minor: '100',
        },
      ]);
    }
    if (sql.includes('accounting_unit') && sql.includes('violations')) {
      return Promise.resolve([{ violations: '0' }]);
    }
    if (sql.includes('currency') && sql.includes('violations')) {
      return Promise.resolve([{ violations: '0' }]);
    }
    return Promise.resolve([{ violations: '0' }]);
  }
}

class ReconciliationDataSource {
  constructor(readonly fixture: ReconciliationQueryFixture) {}

  transaction<T>(
    _isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return callback(this.fixture as unknown as EntityManager);
  }
}

describe('ReconciliationService', () => {
  it('produces a PASS report from independent reconciliation queries', async () => {
    const fixture = new ReconciliationQueryFixture();
    const service = new ReconciliationService(
      new ReconciliationDataSource(fixture) as unknown as DataSource,
    );

    const report = await service.runReconciliation();

    expect(report.status).toBe(VerificationStatus.PASS);
    expect(report.checks).toHaveLength(10);
    expect(report.checks.every((check) => check.status === VerificationStatus.PASS)).toBe(true);
    expect(fixture.queries.some((query) => query.includes('ledger_journals'))).toBe(true);
    expect(fixture.queries.some((query) => query.includes('transfers'))).toBe(true);
  });

  it('calculates a balanced trial balance and finance totals', async () => {
    const fixture = new ReconciliationQueryFixture();
    const service = new ReconciliationService(
      new ReconciliationDataSource(fixture) as unknown as DataSource,
    );

    const trialBalance = await service.getTrialBalance();

    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.dimensions).toEqual([
      {
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        totalDebitsMinor: '100',
        totalCreditsMinor: '100',
        balanced: true,
      },
    ]);
  });
});
