import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransfers1785753600001 implements MigrationInterface {
  name = 'CreateTransfers1785753600001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transfers (
        id UUID PRIMARY KEY,
        source_wallet_id UUID NOT NULL,
        destination_wallet_id UUID NOT NULL,
        journal_id UUID,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        reference VARCHAR(255),
        narration VARCHAR(255),
        failure_code VARCHAR(64),
        failure_message VARCHAR(255),
        failure_status_code SMALLINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT uq_transfers_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT chk_transfers_wallets_different CHECK (source_wallet_id <> destination_wallet_id),
        CONSTRAINT chk_transfers_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_transfers_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_transfers_status CHECK (status IN ('COMPLETED', 'FAILED')),
        CONSTRAINT chk_transfers_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_transfers_completion_has_journal CHECK (
          status = 'FAILED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)
        ),
        CONSTRAINT fk_transfers_source_wallet
          FOREIGN KEY (source_wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transfers_destination_wallet
          FOREIGN KEY (destination_wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transfers_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_transfers_journal_id
         ON transfers (journal_id)
       WHERE journal_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transfers_source_created
         ON transfers (source_wallet_id, created_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transfers_destination_created
         ON transfers (destination_wallet_id, created_at, id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transfers`);
  }
}
