import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpiryToCashToCash1785753600059 implements MigrationInterface {
  name = 'AddExpiryToCashToCash1785753600059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add expiry columns — nullable first to allow backfill
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN expires_at TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD COLUMN expired_at TIMESTAMPTZ`);

    // Backfill existing rows: stable expiry = created_at + configurable default (7 days).
    // Documented assumption: default 604800 seconds (7 days) is NOT a regulatory requirement,
    // chosen as narrowest deterministic default and can be changed via CASH_TO_CASH_EXPIRY_SECONDS.
    // Transfer's expiry timestamp is stable once created; later config changes do not retroactively mutate.
    await queryRunner.query(`
      UPDATE cash_to_cash_transfers
         SET expires_at = created_at + INTERVAL '7 days'
       WHERE expires_at IS NULL
    `);

    // Enforce NOT NULL after backfill
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ALTER COLUMN expires_at SET NOT NULL`);

    // Expand status check to allow EXPIRED
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_status`);
    await queryRunner.query(
      `ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT chk_cash_to_cash_status CHECK (status IN ('UNCLAIMED', 'CLAIMED', 'EXPIRED'))`,
    );

    // Enforce expired_at semantics: EXPIRED must have expired_at, others must not
    await queryRunner.query(`
      ALTER TABLE cash_to_cash_transfers
        ADD CONSTRAINT chk_cash_to_cash_expired_at CHECK (
          (status = 'EXPIRED' AND expired_at IS NOT NULL)
          OR
          (status != 'EXPIRED' AND expired_at IS NULL)
        )
    `);

    // Index for expiry sweep: status + expires_at, partial on UNCLAIMED for efficiency
    await queryRunner.query(`
      CREATE INDEX idx_cash_to_cash_expiry
        ON cash_to_cash_transfers (status, expires_at)
    `);
    // Additional index on expired_at for audit/reporting if needed
    await queryRunner.query(`
      CREATE INDEX idx_cash_to_cash_expired_at
        ON cash_to_cash_transfers (expired_at) WHERE expired_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cash_to_cash_expired_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cash_to_cash_expiry`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_expired_at`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_status`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT chk_cash_to_cash_status CHECK (status IN ('UNCLAIMED', 'CLAIMED'))`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN expired_at`);
    await queryRunner.query(`ALTER TABLE cash_to_cash_transfers DROP COLUMN expires_at`);
  }
}
