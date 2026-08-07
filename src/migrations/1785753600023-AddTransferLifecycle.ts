import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransferLifecycle1785753600023 implements MigrationInterface {
  name = 'AddTransferLifecycle1785753600023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD COLUMN command_id UUID,
        ADD COLUMN command_type VARCHAR(80),
        ADD COLUMN command_version INTEGER,
        ADD COLUMN capability VARCHAR(128),
        ADD COLUMN action VARCHAR(64),
        ADD COLUMN command_scope VARCHAR(80),
        ADD COLUMN source_customer_id UUID,
        ADD COLUMN destination_customer_id UUID,
        ADD COLUMN source_customer_wallet_id UUID,
        ADD COLUMN destination_customer_wallet_id UUID,
        ADD COLUMN source_binding_id UUID,
        ADD COLUMN destination_binding_id UUID,
        ADD COLUMN source_binding_version INTEGER,
        ADD COLUMN destination_binding_version INTEGER,
        ADD COLUMN source_ledger_account_id UUID,
        ADD COLUMN destination_ledger_account_id UUID,
        ADD COLUMN authorization_context_reference VARCHAR(180),
        ADD COLUMN policy_decision_reference VARCHAR(180),
        ADD COLUMN policy_version VARCHAR(160),
        ADD COLUMN policy_profile_reference VARCHAR(160),
        ADD COLUMN policy_profile_version INTEGER,
        ADD COLUMN policy_snapshot_reference VARCHAR(180),
        ADD COLUMN policy_input_hash CHAR(64),
        ADD COLUMN idempotency_scope VARCHAR(120),
        ADD COLUMN accounting_unit VARCHAR(64),
        ADD COLUMN request_id VARCHAR(255),
        ADD COLUMN correlation_id VARCHAR(255),
        ADD COLUMN trace_id VARCHAR(255),
        ADD COLUMN causation_id VARCHAR(255),
        ADD COLUMN requested_at TIMESTAMPTZ,
        ADD COLUMN recovery_reference VARCHAR(180),
        ADD COLUMN state_reason VARCHAR(255),
        ADD COLUMN pending_at TIMESTAMPTZ,
        ADD COLUMN processing_at TIMESTAMPTZ,
        ADD COLUMN pending_recovery_at TIMESTAMPTZ,
        ADD COLUMN unknown_at TIMESTAMPTZ,
        ADD COLUMN cancelled_at TIMESTAMPTZ,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN version INTEGER NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE transfers
        DROP CONSTRAINT IF EXISTS uq_transfers_idempotency_key,
        DROP CONSTRAINT IF EXISTS chk_transfers_status,
        DROP CONSTRAINT IF EXISTS chk_transfers_completion_has_journal
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_transfers_idempotency_key
        ON transfers (idempotency_key)
       WHERE idempotency_scope IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_transfers_scoped_idempotency_key
        ON transfers (idempotency_scope, idempotency_key)
       WHERE idempotency_scope IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD CONSTRAINT chk_transfers_status CHECK (
          status IN (
            'PENDING', 'PROCESSING', 'PENDING_RECOVERY', 'UNKNOWN',
            'COMPLETED', 'FAILED', 'CANCELLED'
          )
        ),
        ADD CONSTRAINT chk_transfers_completion_has_journal CHECK (
          status <> 'COMPLETED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)
        ),
        ADD CONSTRAINT chk_transfers_recovery_has_reference CHECK (
          status NOT IN ('UNKNOWN', 'PENDING_RECOVERY') OR recovery_reference IS NOT NULL
        ),
        ADD CONSTRAINT chk_transfers_version CHECK (version > 0),
        ADD CONSTRAINT chk_transfers_policy_input_hash CHECK (
          policy_input_hash IS NULL OR policy_input_hash ~ '^[a-f0-9]{64}$'
        ),
        ADD CONSTRAINT chk_transfers_a5_metadata CHECK (
          command_id IS NULL OR (
            command_type = 'INTERNAL_TRANSFER'
            AND command_version = 1
            AND capability = 'wallet.transfer'
            AND action = 'create'
            AND command_scope = 'INTERNAL_CUSTOMER_TO_CUSTOMER'
            AND source_customer_id IS NOT NULL
            AND destination_customer_id IS NOT NULL
            AND source_customer_id <> destination_customer_id
            AND source_customer_wallet_id IS NOT NULL
            AND destination_customer_wallet_id IS NOT NULL
            AND source_binding_id IS NOT NULL
            AND destination_binding_id IS NOT NULL
            AND source_binding_version > 0
            AND destination_binding_version > 0
            AND source_ledger_account_id IS NOT NULL
            AND destination_ledger_account_id IS NOT NULL
            AND source_wallet_id <> destination_wallet_id
            AND source_ledger_account_id <> destination_ledger_account_id
            AND authorization_context_reference IS NOT NULL
            AND policy_decision_reference IS NOT NULL
            AND policy_version IS NOT NULL
            AND policy_profile_reference IS NOT NULL
            AND policy_profile_version > 0
            AND policy_snapshot_reference IS NOT NULL
            AND policy_input_hash IS NOT NULL
            AND idempotency_scope = 'wallet.transfer.create.v1'
            AND accounting_unit = 'CUSTOMER_FUNDS'
            AND request_id IS NOT NULL
            AND correlation_id IS NOT NULL
            AND requested_at IS NOT NULL
          )
        )
    `);

    await queryRunner.query(`
      ALTER TABLE transfers
        ADD CONSTRAINT fk_transfers_source_customer
          FOREIGN KEY (source_customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_destination_customer
          FOREIGN KEY (destination_customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_source_customer_wallet
          FOREIGN KEY (source_customer_wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_destination_customer_wallet
          FOREIGN KEY (destination_customer_wallet_id) REFERENCES customer_wallets(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_source_binding
          FOREIGN KEY (source_binding_id) REFERENCES customer_financial_account_bindings(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_destination_binding
          FOREIGN KEY (destination_binding_id) REFERENCES customer_financial_account_bindings(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_source_ledger_account
          FOREIGN KEY (source_ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_transfers_destination_ledger_account
          FOREIGN KEY (destination_ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_transfers_command_id
        ON transfers (command_id)
       WHERE command_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_transfers_source_customer_created
        ON transfers (source_customer_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_transfers_destination_customer_created
        ON transfers (destination_customer_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_transfers_correlation_created
        ON transfers (correlation_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_transfers_status_updated
        ON transfers (status, updated_at, id)
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_transfer_lifecycle_contract()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        -- Existing pre-A5 rows remain compatibility records. Only rows with
        -- command_id participate in the A5 lifecycle and identity contract.
        IF OLD.command_id IS NULL THEN
          IF NEW.command_id IS NOT NULL THEN
            RAISE EXCEPTION 'Legacy transfers cannot be adopted into the A5 lifecycle in place'
              USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW.command_id IS DISTINCT FROM OLD.command_id
           OR NEW.command_type IS DISTINCT FROM OLD.command_type
           OR NEW.command_version IS DISTINCT FROM OLD.command_version
           OR NEW.capability IS DISTINCT FROM OLD.capability
           OR NEW.action IS DISTINCT FROM OLD.action
           OR NEW.command_scope IS DISTINCT FROM OLD.command_scope
           OR NEW.source_customer_id IS DISTINCT FROM OLD.source_customer_id
           OR NEW.destination_customer_id IS DISTINCT FROM OLD.destination_customer_id
           OR NEW.source_customer_wallet_id IS DISTINCT FROM OLD.source_customer_wallet_id
           OR NEW.destination_customer_wallet_id IS DISTINCT FROM OLD.destination_customer_wallet_id
           OR NEW.source_binding_id IS DISTINCT FROM OLD.source_binding_id
           OR NEW.destination_binding_id IS DISTINCT FROM OLD.destination_binding_id
           OR NEW.source_binding_version IS DISTINCT FROM OLD.source_binding_version
           OR NEW.destination_binding_version IS DISTINCT FROM OLD.destination_binding_version
           OR NEW.source_wallet_id IS DISTINCT FROM OLD.source_wallet_id
           OR NEW.destination_wallet_id IS DISTINCT FROM OLD.destination_wallet_id
           OR NEW.source_ledger_account_id IS DISTINCT FROM OLD.source_ledger_account_id
           OR NEW.destination_ledger_account_id IS DISTINCT FROM OLD.destination_ledger_account_id
           OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.accounting_unit IS DISTINCT FROM OLD.accounting_unit
           OR NEW.idempotency_scope IS DISTINCT FROM OLD.idempotency_scope
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
           OR NEW.request_id IS DISTINCT FROM OLD.request_id
           OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
           OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
           OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
           OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
           OR NEW.reference IS DISTINCT FROM OLD.reference
           OR NEW.narration IS DISTINCT FROM OLD.narration
           OR NEW.authorization_context_reference IS DISTINCT FROM OLD.authorization_context_reference
           OR NEW.policy_decision_reference IS DISTINCT FROM OLD.policy_decision_reference
           OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
           OR NEW.policy_profile_reference IS DISTINCT FROM OLD.policy_profile_reference
           OR NEW.policy_profile_version IS DISTINCT FROM OLD.policy_profile_version
           OR NEW.policy_snapshot_reference IS DISTINCT FROM OLD.policy_snapshot_reference
           OR NEW.policy_input_hash IS DISTINCT FROM OLD.policy_input_hash
        THEN
          RAISE EXCEPTION 'A5 transfer command identity and correlation metadata are immutable'
            USING ERRCODE = '55000';
        END IF;

        IF OLD.status = 'PENDING'
           AND NEW.status NOT IN ('PROCESSING', 'PENDING_RECOVERY', 'UNKNOWN', 'FAILED', 'CANCELLED')
        THEN
          RAISE EXCEPTION 'Invalid A5 transfer transition from PENDING to %', NEW.status
            USING ERRCODE = '23514';
        ELSIF OLD.status = 'PROCESSING'
           AND NEW.status NOT IN ('COMPLETED', 'PENDING_RECOVERY', 'UNKNOWN', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid A5 transfer transition from PROCESSING to %', NEW.status
            USING ERRCODE = '23514';
        ELSIF OLD.status = 'PENDING_RECOVERY'
           AND NEW.status NOT IN ('PROCESSING', 'COMPLETED', 'UNKNOWN', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid A5 transfer transition from PENDING_RECOVERY to %', NEW.status
            USING ERRCODE = '23514';
        ELSIF OLD.status = 'UNKNOWN'
           AND NEW.status NOT IN ('PENDING_RECOVERY', 'COMPLETED', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid A5 transfer transition from UNKNOWN to %', NEW.status
            USING ERRCODE = '23514';
        ELSIF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND NEW.status <> OLD.status
        THEN
          RAISE EXCEPTION 'Terminal A5 transfer state % cannot transition to %', OLD.status, NEW.status
            USING ERRCODE = '55000';
        END IF;

        IF NEW.status = 'PROCESSING' AND NEW.journal_id IS NOT NULL THEN
          RAISE EXCEPTION 'A processing A5 transfer cannot have a journal reference'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'FAILED' AND (NEW.journal_id IS NOT NULL OR NEW.failure_code IS NULL)
        THEN
          RAISE EXCEPTION 'A failed A5 transfer must have no journal and must have a failure code'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'CANCELLED' AND NEW.journal_id IS NOT NULL THEN
          RAISE EXCEPTION 'A cancelled A5 transfer cannot have a journal reference'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'COMPLETED'
           AND (NEW.journal_id IS NULL OR NEW.completed_at IS NULL)
        THEN
          RAISE EXCEPTION 'A completed A5 transfer requires a journal and completion time'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.status IN ('UNKNOWN', 'PENDING_RECOVERY')
           AND NEW.recovery_reference IS NULL
        THEN
          RAISE EXCEPTION 'An uncertain A5 transfer requires a recovery reference'
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER transfers_enforce_lifecycle_contract
      BEFORE UPDATE ON transfers
      FOR EACH ROW EXECUTE FUNCTION enforce_transfer_lifecycle_contract()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS transfers_enforce_lifecycle_contract ON transfers`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_transfer_lifecycle_contract()`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_transfers_status_updated`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transfers_correlation_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_transfers_scoped_idempotency_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_transfers_idempotency_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transfers_destination_customer_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transfers_source_customer_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_transfers_command_id`);

    await queryRunner.query(`
      ALTER TABLE transfers
        DROP CONSTRAINT IF EXISTS fk_transfers_destination_ledger_account,
        DROP CONSTRAINT IF EXISTS fk_transfers_source_ledger_account,
        DROP CONSTRAINT IF EXISTS fk_transfers_destination_binding,
        DROP CONSTRAINT IF EXISTS fk_transfers_source_binding,
        DROP CONSTRAINT IF EXISTS fk_transfers_destination_customer_wallet,
        DROP CONSTRAINT IF EXISTS fk_transfers_source_customer_wallet,
        DROP CONSTRAINT IF EXISTS fk_transfers_destination_customer,
        DROP CONSTRAINT IF EXISTS fk_transfers_source_customer,
        DROP CONSTRAINT IF EXISTS chk_transfers_a5_metadata,
        DROP CONSTRAINT IF EXISTS chk_transfers_policy_input_hash,
        DROP CONSTRAINT IF EXISTS chk_transfers_version,
        DROP CONSTRAINT IF EXISTS chk_transfers_recovery_has_reference,
        DROP CONSTRAINT IF EXISTS chk_transfers_completion_has_journal,
        DROP CONSTRAINT IF EXISTS chk_transfers_status
    `);
    await queryRunner.query(`
      ALTER TABLE transfers
        ADD CONSTRAINT uq_transfers_idempotency_key UNIQUE (idempotency_key),
        ADD CONSTRAINT chk_transfers_status CHECK (status IN ('COMPLETED', 'FAILED')),
        ADD CONSTRAINT chk_transfers_completion_has_journal CHECK (
          status = 'FAILED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      ALTER TABLE transfers
        DROP COLUMN IF EXISTS version,
        DROP COLUMN IF EXISTS updated_at,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS unknown_at,
        DROP COLUMN IF EXISTS pending_recovery_at,
        DROP COLUMN IF EXISTS processing_at,
        DROP COLUMN IF EXISTS pending_at,
        DROP COLUMN IF EXISTS state_reason,
        DROP COLUMN IF EXISTS recovery_reference,
        DROP COLUMN IF EXISTS requested_at,
        DROP COLUMN IF EXISTS causation_id,
        DROP COLUMN IF EXISTS trace_id,
        DROP COLUMN IF EXISTS correlation_id,
        DROP COLUMN IF EXISTS request_id,
        DROP COLUMN IF EXISTS idempotency_scope,
        DROP COLUMN IF EXISTS accounting_unit,
        DROP COLUMN IF EXISTS policy_input_hash,
        DROP COLUMN IF EXISTS policy_snapshot_reference,
        DROP COLUMN IF EXISTS policy_profile_version,
        DROP COLUMN IF EXISTS policy_profile_reference,
        DROP COLUMN IF EXISTS policy_version,
        DROP COLUMN IF EXISTS policy_decision_reference,
        DROP COLUMN IF EXISTS authorization_context_reference,
        DROP COLUMN IF EXISTS destination_ledger_account_id,
        DROP COLUMN IF EXISTS source_ledger_account_id,
        DROP COLUMN IF EXISTS destination_binding_version,
        DROP COLUMN IF EXISTS source_binding_version,
        DROP COLUMN IF EXISTS destination_binding_id,
        DROP COLUMN IF EXISTS source_binding_id,
        DROP COLUMN IF EXISTS destination_customer_wallet_id,
        DROP COLUMN IF EXISTS source_customer_wallet_id,
        DROP COLUMN IF EXISTS destination_customer_id,
        DROP COLUMN IF EXISTS source_customer_id,
        DROP COLUMN IF EXISTS command_scope,
        DROP COLUMN IF EXISTS action,
        DROP COLUMN IF EXISTS capability,
        DROP COLUMN IF EXISTS command_version,
        DROP COLUMN IF EXISTS command_type,
        DROP COLUMN IF EXISTS command_id
    `);
  }
}
