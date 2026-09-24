import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1A01 Stage 1 — canonical Agent identity (ADR-0093 §8).
 *
 * Creates the `agents` aggregate root: a first-class participant identity that
 * is NOT a Customer and is not derived from one. `agents.id` is the canonical
 * Agent identity.
 *
 * DELIBERATE STAGE 1 BOUNDARY. This migration is purely additive and creates
 * exactly one table. It does NOT:
 *   - create or alter `wallet_accounts` or `ledger_accounts`;
 *   - add an `owner_type` discriminator to `wallet_accounts` (ADR-0093 §6.4 —
 *     that belongs to Stage 2);
 *   - create an agent wallet or an agent financial-account binding;
 *   - create any Agent MonieNaija number or receiving-number registry;
 *   - create an Agent credential, PIN, session or authorization principal;
 *   - touch any customer table, constraint, index or row.
 *
 * Stage 2 (wallet/binding) is blocked on Finance decisions F-1 (accounting
 * unit) and F-2 (liability classification); Stage 3 (posting) on F-3/F-4;
 * Stage 4 (number) on the number-allocation strategy. None of those values is
 * inferred or defaulted here.
 *
 * `operator_customer_id` is the optional, non-authoritative Customer trace of
 * ADR-0093 §8.5: nullable so an Agent can exist without a Customer, and NOT
 * unique so one Customer may operate multiple Agents. `ON DELETE RESTRICT`
 * stops a customer row disappearing beneath a live trace; it grants the Agent
 * nothing and never drives Agent status.
 *
 * Status values are those established by `docs/AUTHORITATIVE-V1-PRODUCT-SCOPE.md`
 * §11.2. No status transition, approval workflow or Agent class is created.
 */
export class CreateAgentIdentity1785753600056 implements MigrationInterface {
  name = 'CreateAgentIdentity1785753600056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(160) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        operator_customer_id UUID,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT uq_agents_reference UNIQUE (reference),
        CONSTRAINT chk_agents_reference CHECK (reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'),
        CONSTRAINT chk_agents_status CHECK (
          status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')
        ),
        CONSTRAINT chk_agents_version CHECK (version > 0),
        CONSTRAINT fk_agents_operator_customer
          FOREIGN KEY (operator_customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_agents_status ON agents (status)`);
    await queryRunner.query(
      `CREATE INDEX idx_agents_operator_customer ON agents (operator_customer_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE agents`);
  }
}
