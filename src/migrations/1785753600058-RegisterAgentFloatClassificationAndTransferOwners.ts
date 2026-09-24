import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F-3 — shared conservation pool + owner-aware transfer representation.
 *
 * TWO ADDITIVE CHANGES, NO LEDGER REDESIGN.
 *
 * 1. Registers the Finance-approved Agent float classification in the
 *    F-1/F-2 registry as `CUSTOMER_FUNDS` / `LIABILITY` / `CREDIT`.
 *
 *    READ THIS CAREFULLY, BECAUSE THE NAME IS MISLEADING:
 *
 *      `CUSTOMER_FUNDS` is the LEDGER CONSERVATION POOL — the boundary within
 *      which debits must equal credits. `reconciliation.service.ts` proves
 *      conservation per `(currency, accounting_unit)` dimension, so the unit
 *      is a settlement boundary, not an ownership label.
 *
 *      It does NOT mean "Agent is a Customer" and it does NOT mean agent
 *      e-float is customer money in the ownership sense. OWNERSHIP is carried
 *      entirely by `wallet_accounts.owner_type` and the Agent binding chain
 *      Agent -> AgentWallet -> WalletAccount -> LedgerAccount established by
 *      F-1/F-2. Customer and Agent remain independent financial participants
 *      with independent identity, wallets, balances and histories.
 *
 *      Placing both owner types in one conservation pool is what allows a
 *      future Customer->Agent movement to post as ONE balanced journal while
 *      per-pool conservation continues to hold.
 *
 *    The classification stays REGISTERED, not assumed: the owner-aware
 *    database trigger from F-1/F-2 still reads this registry, and the
 *    application still fails closed unless `AGENT_FLOAT_ACCOUNTING` is
 *    configured. Neither fail-closed control is removed or bypassed.
 *
 * 2. Adds explicit owner-type discriminators to `transfers` so one transfer
 *    record can REPRESENT customer->customer, customer->agent, agent->customer
 *    and agent->agent. Both default to `CUSTOMER`, so every existing transfer
 *    row is correct the instant the columns appear and no backfill runs.
 *
 * THIS MIGRATION IMPLEMENTS NO TRANSACTION FLOW. It creates no journal, no
 * ledger line and no balance, and it does not enable agent transfer execution.
 */
export class RegisterAgentFloatClassificationAndTransferOwners1785753600058
  implements MigrationInterface
{
  name = 'RegisterAgentFloatClassificationAndTransferOwners1785753600058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Finance-approved Agent float classification: shared conservation pool.
    await queryRunner.query(`
      INSERT INTO agent_float_accounting_classifications
        (accounting_unit, account_type, normal_balance, is_active, approved_by, note)
      VALUES (
        'CUSTOMER_FUNDS',
        'LIABILITY',
        'CREDIT',
        TRUE,
        'finance-f3-decision',
        'F-3: Agent e-float shares the CUSTOMER_FUNDS conservation pool so cross-owner movement posts as one balanced journal. Pool membership is NOT ownership; ownership is wallet_accounts.owner_type plus the Agent financial binding.'
      )
    `);

    // 2. Owner-type discriminators on the transfer representation.
    await queryRunner.query(
      `ALTER TABLE transfers
         ADD COLUMN source_owner_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER',
         ADD COLUMN destination_owner_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER'`,
    );
    await queryRunner.query(
      `ALTER TABLE transfers
         ADD CONSTRAINT chk_transfers_source_owner_type
           CHECK (source_owner_type IN ('CUSTOMER', 'AGENT')),
         ADD CONSTRAINT chk_transfers_destination_owner_type
           CHECK (destination_owner_type IN ('CUSTOMER', 'AGENT'))`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transfers_owner_types
         ON transfers (source_owner_type, destination_owner_type)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_transfers_owner_types`);
    await queryRunner.query(
      `ALTER TABLE transfers
         DROP CONSTRAINT chk_transfers_destination_owner_type,
         DROP CONSTRAINT chk_transfers_source_owner_type`,
    );
    await queryRunner.query(
      `ALTER TABLE transfers
         DROP COLUMN destination_owner_type,
         DROP COLUMN source_owner_type`,
    );
    await queryRunner.query(
      `DELETE FROM agent_float_accounting_classifications
        WHERE accounting_unit = 'CUSTOMER_FUNDS' AND approved_by = 'finance-f3-decision'`,
    );
  }
}
