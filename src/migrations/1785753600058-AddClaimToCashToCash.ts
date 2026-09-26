import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaimToCashToCash1785753600058 implements MigrationInterface {
  name = 'AddClaimToCashToCash1785753600058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Allow CLAIMED status
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_status`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT chk_cash_to_cash_status CHECK (status IN ('UNCLAIMED', 'CLAIMED'))`);

    // Add claim-specific columns
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN claimed_at TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN claimant_customer_id UUID`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN claim_journal_id UUID`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN claim_idempotency_key VARCHAR(255)`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN claim_reference VARCHAR(255)`);

    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT fk_cash_to_cash_claimant FOREIGN KEY (claimant_customer_id) REFERENCES customers(id) ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT fk_cash_to_cash_claim_journal FOREIGN KEY (claim_journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT`);

    await queryRunner.query(`CREATE UNIQUE INDEX uq_cash_to_cash_claim_journal ON cash_to_cash_transfers (claim_journal_id) WHERE claim_journal_id IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_cash_to_cash_claim_idempotency ON cash_to_cash_transfers (claimant_customer_id, claim_idempotency_key) WHERE claim_idempotency_key IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_cash_to_cash_claimant ON cash_to_cash_transfers (claimant_customer_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cash_to_cash_claimant`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cash_to_cash_claim_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cash_to_cash_claim_journal`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT fk_cash_to_cash_claim_journal`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT fk_cash_to_cash_claimant`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN claim_reference`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN claim_idempotency_key`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN claim_journal_id`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN claimant_customer_id`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN claimed_at`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_status`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT chk_cash_to_cash_status CHECK (status = 'UNCLAIMED')`);
  }
}
