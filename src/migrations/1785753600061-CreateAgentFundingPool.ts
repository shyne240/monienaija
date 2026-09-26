import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentFundingPool1785753600061 implements MigrationInterface {
  name = 'CreateAgentFundingPool1785753600061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Internal accounting source for V1 Agent funding/defunding.
    // This is NOT a CBN/NIBSS regulatory account, bank account, or settlement account.
    // It is an internal platform funding pool representing the counterparty to Agent wallet movements.
    // V1 treats the pool as an internal CUSTOMER_FUNDS liability that may temporarily go negative
    // (allow_negative_balance TRUE) to permit funding without requiring prior external cash in the test harness.
    // Real external treasury integration belongs to later B3 work and is documented as out-of-scope for A19.
    await queryRunner.query(`
      INSERT INTO ledger_accounts (
        id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active
      ) VALUES (
        gen_random_uuid(),
        'AGENT_FUNDING_POOL-NGN',
        'Agent Funding Pool NGN',
        'LIABILITY',
        'CREDIT',
        'NGN',
        'CUSTOMER_FUNDS',
        TRUE,
        TRUE
      ) ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM ledger_accounts WHERE code = 'AGENT_FUNDING_POOL-NGN'`);
  }
}
