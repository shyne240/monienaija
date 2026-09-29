import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — migration-based provisioning (DP-30=B) with
 * registry-based governance evidence (DP-31=A) for the four accounting families the approved
 * human decisions require:
 *
 *   FINANCE-FEE_REVENUE-NGN          REVENUE   CREDIT-normal  DP-01=B (pooled fee revenue) / DP-02=A
 *   FINANCE-VAT_PAYABLE-NGN          LIABILITY CREDIT-normal  DP-03=B (VAT-bearing shape; rate unset)
 *   FINANCE-COMMISSION_EXPENSE-NGN   EXPENSE   DEBIT-normal   DP-05 configurable treatments (A/B)
 *   FINANCE-COMMISSION_PAYABLE-NGN   LIABILITY CREDIT-normal  DP-05 option A (expense + payable)
 *
 * Conventions (no invented semantics):
 *  - codes follow the existing FINANCE-<ROLE>-<CURRENCY> pattern set by the AR-control precedent
 *    ('FINANCE-ACCOUNTS_RECEIVABLE-NGN', migration-seeded families 0002/0057/0061);
 *  - account_type/normal_balance match the ledger's own normalBalanceFor rules (REVENUE/EXPENSE
 *    types pre-exist but were uninstantiated — this migration instantiates the required families);
 *  - NO existing settlement/clearing/suspense/unclaimed/wallet account is repurposed (A5 contract);
 *  - allow_negative_balance stays FALSE (accounts only receive credits against matching debits);
 *  - the CONTRA_REVENUE treatment (D-GL-004 option C) is provisioned NOTHING: a contra-capable
 *    family is not creatable under the ledger's normal-balance contract — the treatment fails
 *    closed at runtime with its precise blocker instead of inventing accounting;
 *  - no VAT rate or fee/commission rate exists anywhere in this migration (config-only plumbing).
 *
 * Registry rows (commercial_accounting_registry) carry the approval/evidence identity:
 * evidence_source = the human-decision task id; decision_references = the resolved DPs.
 * Provisioning is deterministic: account + evidence land in ONE migration transaction.
 */
export class ProvisionV1CommercialAccountingFamilies1785753600076 implements MigrationInterface {
  name = 'ProvisionV1CommercialAccountingFamilies1785753600076';

  private static readonly EVIDENCE_SOURCE =
    'HUMAN-DECISIONS@V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS commercial_accounting_registry (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        family_code varchar(64) NOT NULL,
        account_code varchar(100) NOT NULL,
        account_type varchar(20) NOT NULL,
        normal_balance varchar(6) NOT NULL,
        currency varchar(3) NOT NULL,
        accounting_unit varchar(64) NOT NULL,
        purpose text NOT NULL,
        decision_references text[] NOT NULL DEFAULT ARRAY[]::text[],
        evidence_source varchar(255) NOT NULL,
        provisioned_by varchar(255) NOT NULL,
        provisioned_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_commercial_accounting_registry_family UNIQUE (family_code),
        CONSTRAINT uq_commercial_accounting_registry_account_code UNIQUE (account_code)
      )
    `);

    const families: Array<{
      role: string;
      code: string;
      name: string;
      accountType: string;
      normalBalance: string;
      purpose: string;
      decisions: string[];
    }> = [
      {
        role: 'FEE_REVENUE',
        code: 'FINANCE-FEE_REVENUE-NGN',
        name: 'Finance Fee Revenue NGN (pooled)',
        accountType: 'REVENUE',
        normalBalance: 'CREDIT',
        purpose:
          'Pooled V1 fee-revenue account (DP-01=B). One family for ALL fee-bearing products; ' +
          'product identity is carried by commercial-decision snapshot and accounting-journal ' +
          'metadata — never by separate per-product accounts. Recognized at transaction completion (DP-02=A).',
        decisions: ['DP-01=B(pooled)', 'DP-02=A(at-completion)'],
      },
      {
        role: 'VAT_PAYABLE',
        code: 'FINANCE-VAT_PAYABLE-NGN',
        name: 'Finance VAT Payable NGN',
        accountType: 'LIABILITY',
        normalBalance: 'CREDIT',
        purpose:
          'VAT payable for VAT-bearing V1 fees (DP-03=B). Treatment is runtime configuration ' +
          '(EXCLUSIVE_ADD_ON/INCLUSIVE_IN_FEE); the rate is NEVER provisioned here — it comes ' +
          'from authoritative fee-rule configuration; absence fails closed.',
        decisions: ['DP-03=B(vat-bearing,rate-unset)'],
      },
      {
        role: 'COMMISSION_EXPENSE',
        code: 'FINANCE-COMMISSION_EXPENSE-NGN',
        name: 'Finance Commission Expense NGN',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
        purpose:
          'Commission expense for configurable commission accounting (DP-05). Debited under both ' +
          'supported treatments: EXPENSE_PAYABLE (vs payable) and AGENT_WALLET_NETTING (vs agent wallet).',
        decisions: ['DP-05=configurable(expense_payable|agent_wallet_netting)'],
      },
      {
        role: 'COMMISSION_PAYABLE',
        code: 'FINANCE-COMMISSION_PAYABLE-NGN',
        name: 'Finance Commission Payable NGN',
        accountType: 'LIABILITY',
        normalBalance: 'CREDIT',
        purpose:
          'Standing commission payable for the EXPENSE_PAYABLE treatment (DP-05 option A) with ' +
          'ACCRUE_NOW_SETTLE_LATER timing (DP-07). Settlement execution remains V2 scope; nothing ' +
          'here pays out automatically.',
        decisions: ['DP-05=A-arm(expense+payable)', 'DP-07=ACCRUE_NOW_SETTLE_LATER'],
      },
    ];

    for (const family of families) {
      await queryRunner.query(
        `INSERT INTO ledger_accounts (
          id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE
        ) ON CONFLICT (code) DO NOTHING`,
        [family.code, family.name, family.accountType, family.normalBalance],
      );

      await queryRunner.query(
        `INSERT INTO commercial_accounting_registry (
          family_code, account_code, account_type, normal_balance, currency, accounting_unit,
          purpose, decision_references, evidence_source, provisioned_by
        ) VALUES (
          $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', $5, $6::text[], $7, $8
        ) ON CONFLICT (family_code) DO NOTHING`,
        [
          family.role,
          family.code,
          family.accountType,
          family.normalBalance,
          family.purpose,
          family.decisions,
          ProvisionV1CommercialAccountingFamilies1785753600076.EVIDENCE_SOURCE,
          '1785753600076-ProvisionV1CommercialAccountingFamilies',
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM commercial_accounting_registry WHERE family_code IN ('FEE_REVENUE', 'VAT_PAYABLE', 'COMMISSION_EXPENSE', 'COMMISSION_PAYABLE')`,
    );
    await queryRunner.query(
      `DELETE FROM ledger_accounts WHERE code IN ('FINANCE-FEE_REVENUE-NGN', 'FINANCE-VAT_PAYABLE-NGN', 'FINANCE-COMMISSION_EXPENSE-NGN', 'FINANCE-COMMISSION_PAYABLE-NGN')`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS commercial_accounting_registry`);
  }
}
