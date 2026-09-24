import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { WalletOwnerType } from '../src/wallet/wallet.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * F-1 / F-2 — the owner-aware wallet-account money-safety invariant.
 *
 * This is the regression suite for a deliberate change to a database-level
 * financial control, so it exercises the trigger directly with raw SQL rather
 * than through a service: the point is to prove the DATABASE refuses bad
 * combinations even if application code is wrong or bypassed.
 *
 * `AGENT_FLOAT_TEST_UNIT` is a TEST-ONLY classification registered by the test
 * itself. It is not a production value: production stays fail-closed until
 * Finance registers an approved classification.
 */
describe('F-1/F-2 owner-aware wallet-account invariant (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;

  const AGENT_UNIT = 'AGENT_FLOAT_TEST_UNIT';

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('agentinvariant');
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /** Registers the Finance-approved test classification. */
  async function registerAgentClassification(
    unit = AGENT_UNIT,
    accountType = 'LIABILITY',
    normalBalance = 'CREDIT',
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO agent_float_accounting_classifications
         (accounting_unit, account_type, normal_balance, approved_by, note)
       VALUES ($1, $2, $3, 'finance-test', 'test-only classification')`,
      [unit, accountType, normalBalance],
    );
  }

  async function makeLedgerAccount(options: {
    accountingUnit?: string;
    accountType?: string;
    normalBalance?: string;
    currency?: string;
    allowNegative?: boolean;
  } = {}): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ledger_accounts
         (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance)
       VALUES ($1, $2, 'test account', $3, $4, $5, $6, $7)`,
      [
        id,
        `INV-${id.slice(0, 8)}`,
        options.accountType ?? 'LIABILITY',
        options.normalBalance ?? 'CREDIT',
        options.currency ?? 'NGN',
        options.accountingUnit ?? 'CUSTOMER_FUNDS',
        options.allowNegative ?? false,
      ],
    );
    return id;
  }

  async function insertWalletAccount(options: {
    ownerType: string;
    ledgerAccountId: string;
    currency?: string;
  }): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, owner_type, currency, ledger_account_id, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [id, randomUUID(), options.ownerType, options.currency ?? 'NGN', options.ledgerAccountId],
    );
    return id;
  }

  describe('CUSTOMER branch — semantically unchanged', () => {
    it('1. accepts the historical valid customer combination', async () => {
      const ledgerAccountId = await makeLedgerAccount();
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.CUSTOMER, ledgerAccountId }),
      ).resolves.toBeTruthy();
    });

    it('2. rejects a customer wallet on a non-CUSTOMER_FUNDS unit', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.CUSTOMER, ledgerAccountId }),
      ).rejects.toThrow(/customer-funds liability account/);
    });

    it('3. rejects a customer wallet whose account allows a negative balance', async () => {
      const ledgerAccountId = await makeLedgerAccount({ allowNegative: true });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.CUSTOMER, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });

    it('4. rejects a currency mismatch', async () => {
      const ledgerAccountId = await makeLedgerAccount({ currency: 'USD' });
      await expect(
        insertWalletAccount({
          ownerType: WalletOwnerType.CUSTOMER,
          ledgerAccountId,
          currency: 'NGN',
        }),
      ).rejects.toThrow(/liability account/);
    });

    it('5. rejects a non-liability account', async () => {
      const ledgerAccountId = await makeLedgerAccount({
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
      });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.CUSTOMER, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });

    it('6. rejects the wrong normal balance', async () => {
      const ledgerAccountId = await makeLedgerAccount({ normalBalance: 'DEBIT' });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.CUSTOMER, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });
  });

  describe('AGENT branch', () => {
    it('7. accepts a Finance-approved agent classification', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).resolves.toBeTruthy();
    });

    it('8. rejects agent + CUSTOMER_FUNDS unless Finance explicitly approves it', async () => {
      await registerAgentClassification();
      const customerFundsAccount = await makeLedgerAccount({ accountingUnit: 'CUSTOMER_FUNDS' });
      await expect(
        insertWalletAccount({
          ownerType: WalletOwnerType.AGENT,
          ledgerAccountId: customerFundsAccount,
        }),
      ).rejects.toThrow(/approved active agent-float classification/);

      // Only if Finance deliberately registers CUSTOMER_FUNDS does it become
      // valid. The production architecture never defaults to this.
      await dataSource.query(
        `UPDATE agent_float_accounting_classifications SET is_active = FALSE WHERE accounting_unit = $1`,
        [AGENT_UNIT],
      );
      await registerAgentClassification('CUSTOMER_FUNDS');
      const second = await makeLedgerAccount({ accountingUnit: 'CUSTOMER_FUNDS' });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId: second }),
      ).resolves.toBeTruthy();
    });

    it('9. rejects an arbitrary or unregistered agent accounting unit', async () => {
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: 'MADE_UP_UNIT' });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/approved active agent-float classification/);
    });

    it('9b. fails closed when Finance has registered nothing at all', async () => {
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/approved active agent-float classification/);
    });

    it('9c. rejects a classification that Finance has deactivated', async () => {
      await registerAgentClassification();
      await dataSource.query(
        `UPDATE agent_float_accounting_classifications SET is_active = FALSE`,
      );
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/approved active agent-float classification/);
    });

    it('10. rejects an agent account that allows a negative balance', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({
        accountingUnit: AGENT_UNIT,
        allowNegative: true,
      });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });

    it('11. rejects a currency mismatch', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({
        accountingUnit: AGENT_UNIT,
        currency: 'USD',
      });
      await expect(
        insertWalletAccount({
          ownerType: WalletOwnerType.AGENT,
          ledgerAccountId,
          currency: 'NGN',
        }),
      ).rejects.toThrow(/liability account/);
    });

    it('12. rejects a non-liability agent account', async () => {
      await registerAgentClassification(AGENT_UNIT, 'ASSET', 'DEBIT');
      const ledgerAccountId = await makeLedgerAccount({
        accountingUnit: AGENT_UNIT,
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
      });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });

    it('13. rejects the wrong normal balance', async () => {
      await registerAgentClassification(AGENT_UNIT, 'LIABILITY', 'DEBIT');
      const ledgerAccountId = await makeLedgerAccount({
        accountingUnit: AGENT_UNIT,
        normalBalance: 'DEBIT',
      });
      await expect(
        insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId }),
      ).rejects.toThrow(/liability account/);
    });

    it('rejects an unsupported owner type outright', async () => {
      const ledgerAccountId = await makeLedgerAccount();
      // Defence in depth: the BEFORE-INSERT trigger fires first and rejects the
      // unknown owner type; the chk_wallet_accounts_owner_type CHECK would
      // reject it too. Either message proves the row cannot be written.
      await expect(
        insertWalletAccount({ ownerType: 'AGGREGATOR', ledgerAccountId }),
      ).rejects.toThrow(/unsupported owner_type|chk_wallet_accounts_owner_type/);
    });

    it('the CHECK constraint also refuses an unknown owner type', async () => {
      // Proven independently of the trigger by disabling it for one statement.
      await dataSource.query(`ALTER TABLE wallet_accounts DISABLE TRIGGER wallet_account_ledger_account_is_valid`);
      try {
        const ledgerAccountId = await makeLedgerAccount();
        await expect(
          insertWalletAccount({ ownerType: 'AGGREGATOR', ledgerAccountId }),
        ).rejects.toThrow(/chk_wallet_accounts_owner_type/);
      } finally {
        await dataSource.query(`ALTER TABLE wallet_accounts ENABLE TRIGGER wallet_account_ledger_account_is_valid`);
      }
    });
  });

  describe('owner consistency on reclassification', () => {
    it('14. a customer wallet account cannot be rebound as an agent account', async () => {
      const ledgerAccountId = await makeLedgerAccount();
      const walletId = await insertWalletAccount({
        ownerType: WalletOwnerType.CUSTOMER,
        ledgerAccountId,
      });

      await expect(
        dataSource.query(`UPDATE wallet_accounts SET owner_type = 'AGENT' WHERE id = $1`, [
          walletId,
        ]),
      ).rejects.toThrow(/approved active agent-float classification/);
    });

    it('15. an agent wallet account cannot be rebound as a customer account', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      const walletId = await insertWalletAccount({
        ownerType: WalletOwnerType.AGENT,
        ledgerAccountId,
      });

      await expect(
        dataSource.query(`UPDATE wallet_accounts SET owner_type = 'CUSTOMER' WHERE id = $1`, [
          walletId,
        ]),
      ).rejects.toThrow(/customer-funds liability account/);
    });

    it('the invariant is re-evaluated on UPDATE, not only INSERT', async () => {
      await registerAgentClassification();
      const good = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      const bad = await makeLedgerAccount({ accountingUnit: 'MADE_UP_UNIT' });
      const walletId = await insertWalletAccount({
        ownerType: WalletOwnerType.AGENT,
        ledgerAccountId: good,
      });

      await expect(
        dataSource.query(`UPDATE wallet_accounts SET ledger_account_id = $2 WHERE id = $1`, [
          walletId,
          bad,
        ]),
      ).rejects.toThrow(/approved active agent-float classification/);
    });
  });

  describe('financial conservation', () => {
    it('the invariant work creates no journal, line or balance', async () => {
      await registerAgentClassification();
      const ledgerAccountId = await makeLedgerAccount({ accountingUnit: AGENT_UNIT });
      await insertWalletAccount({ ownerType: WalletOwnerType.AGENT, ledgerAccountId });

      const journals = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ledger_journals`),
        'journals',
      );
      const lines = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ledger_lines`),
        'lines',
      );
      expect(journals.count).toBe(0);
      expect(lines.count).toBe(0);
      expect(BigInt((await ledger.getAccountBalance(ledgerAccountId)).balanceMinor)).toBe(0n);
    });
  });
});
