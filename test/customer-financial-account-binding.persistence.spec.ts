import { getMetadataArgsStorage } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { CreateCustomerFinancialAccountBindings1785753600021 } from '../src/migrations/1785753600021-CreateCustomerFinancialAccountBindings';

type MigrationQueryRunner = {
  queries: string[];
  query(sql: string): Promise<unknown[]>;
};

class RecordingQueryRunner implements MigrationQueryRunner {
  readonly queries: string[] = [];

  query(sql: string): Promise<unknown[]> {
    this.queries.push(sql);
    return Promise.resolve([]);
  }
}

function normalizedSql(queries: string[]): string {
  return queries.join('\n').replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('Customer financial account binding persistence', () => {
  it('applies and reverts the binding migration without changing financial source tables', async () => {
    const migration = new CreateCustomerFinancialAccountBindings1785753600021();
    const upRunner = new RecordingQueryRunner();

    await migration.up(upRunner as unknown as QueryRunner);

    const upSql = normalizedSql(upRunner.queries);
    expect(upSql).toContain('create table customer_financial_account_bindings');
    expect(upSql).toContain('uq_customer_wallets_id_customer unique (id, customer_id)');
    expect(upSql).toContain('uq_wallet_accounts_id_ledger_account unique (id, ledger_account_id)');
    expect(upSql).toContain(
      'create unique index uq_customer_financial_account_bindings_active_customer_currency',
    );
    expect(upSql).toContain("where state = 'active'");
    expect(upSql).toContain(
      'fk_customer_financial_account_bindings_customer_wallet foreign key (customer_wallet_id, customer_id)',
    );
    expect(upSql).toContain(
      'fk_customer_financial_account_bindings_wallet_account foreign key (wallet_account_id, ledger_account_id)',
    );
    expect(upSql).toContain(
      'create or replace function assert_customer_financial_account_binding()',
    );
    expect(upSql).toContain('create trigger customer_financial_account_bindings_are_consistent');
    expect(upSql).not.toMatch(/create table ledger_(journals|lines)/);
    expect(upSql).not.toMatch(/(insert|update|delete)\s+ledger_(accounts|journals|lines)/);
    expect(upSql).not.toMatch(/(amount_minor|balance_minor)/);

    const downRunner = new RecordingQueryRunner();
    await migration.down(downRunner as unknown as QueryRunner);

    const downSql = normalizedSql(downRunner.queries);
    expect(downSql).toContain(
      'drop trigger if exists customer_financial_account_bindings_are_consistent',
    );
    expect(downSql).toContain(
      'drop function if exists assert_customer_financial_account_binding()',
    );
    expect(downSql).toContain('drop table if exists customer_financial_account_bindings');
    expect(downSql).toContain(
      'alter table wallet_accounts drop constraint if exists uq_wallet_accounts_id_ledger_account',
    );
    expect(downSql).toContain(
      'alter table customer_wallets drop constraint if exists uq_customer_wallets_id_customer',
    );
    expect(downRunner.queries[0]).toContain('DROP TRIGGER');
    expect(downRunner.queries[downRunner.queries.length - 1]).toContain('customer_wallets');
  });

  it('declares the binding columns, source relations, checks, and uniqueness guards', () => {
    const storage = getMetadataArgsStorage();
    const bindingColumns = storage.columns
      .filter((column) => column.target === CustomerFinancialAccountBinding)
      .map((column) => column.propertyName);
    const bindingRelations = storage.relations
      .filter((relation) => relation.target === CustomerFinancialAccountBinding)
      .map((relation) => relation.propertyName);
    const bindingUniqueNames = storage.uniques
      .filter((unique) => unique.target === CustomerFinancialAccountBinding)
      .map((unique) => unique.name);
    const bindingIndexes = storage.indices.filter(
      (index) => index.target === CustomerFinancialAccountBinding,
    );
    const bindingChecks = storage.checks
      .filter((check) => check.target === CustomerFinancialAccountBinding)
      .map((check) => check.name);

    expect(bindingColumns).toEqual(
      expect.arrayContaining([
        'id',
        'customerId',
        'customerWalletId',
        'walletAccountId',
        'ledgerAccountId',
        'currency',
        'accountingUnit',
        'state',
        'sourceCustomerVersion',
        'sourceCustomerWalletVersion',
        'version',
        'createdBy',
        'updatedBy',
        'lastCorrelationId',
        'lastRequestId',
        'closedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
    expect(bindingRelations).toEqual(
      expect.arrayContaining(['customer', 'customerWallet', 'walletAccount', 'ledgerAccount']),
    );
    expect(bindingUniqueNames).toEqual(
      expect.arrayContaining([
        'uq_customer_financial_account_bindings_customer_wallet',
        'uq_customer_financial_account_bindings_wallet_account',
        'uq_customer_financial_account_bindings_ledger_account',
      ]),
    );
    const activeCustomerCurrencyIndex = bindingIndexes.find(
      (index) => index.name === 'uq_customer_financial_account_bindings_active_customer_currency',
    );
    expect(activeCustomerCurrencyIndex?.unique).toBe(true);
    expect(activeCustomerCurrencyIndex?.where).toBe("state = 'ACTIVE'");
    expect(bindingIndexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'uq_customer_financial_account_bindings_active_customer_currency',
        'idx_customer_financial_account_bindings_customer_state',
        'idx_customer_financial_account_bindings_state_updated',
      ]),
    );
    expect(bindingChecks).toEqual(
      expect.arrayContaining([
        'chk_customer_financial_account_bindings_state',
        'chk_customer_financial_account_bindings_currency',
        'chk_customer_financial_account_bindings_accounting_unit',
        'chk_customer_financial_account_bindings_source_customer_version',
        'chk_customer_financial_account_bindings_source_wallet_version',
        'chk_customer_financial_account_bindings_version',
        'chk_customer_financial_account_bindings_closed_at',
      ]),
    );
  });

  it('keeps composite source relationships and active uniqueness visible in entity metadata', () => {
    const storage = getMetadataArgsStorage();
    const customerWalletUniqueNames = storage.uniques
      .filter((unique) => unique.target === CustomerWallet)
      .map((unique) => unique.name);
    const walletAccountUniqueNames = storage.uniques
      .filter((unique) => unique.target === WalletAccount)
      .map((unique) => unique.name);
    const bindingStateValues = Object.values(CustomerFinancialAccountBindingState);

    expect(customerWalletUniqueNames).toContain('uq_customer_wallets_id_customer');
    expect(walletAccountUniqueNames).toContain('uq_wallet_accounts_id_ledger_account');
    expect(bindingStateValues).toEqual([
      'PENDING',
      'ACTIVE',
      'SUSPENDED',
      'REPAIR_REQUIRED',
      'CLOSED',
    ]);
    expect(
      storage.indices.some(
        (index) =>
          index.target === CustomerFinancialAccountBinding &&
          index.name === 'uq_customer_financial_account_bindings_active_customer_currency' &&
          index.unique === true,
      ),
    ).toBe(true);
  });
});
