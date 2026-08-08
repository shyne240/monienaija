import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalOperations1785753600026 implements MigrationInterface {
  name = 'CreateExternalOperations1785753600026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE external_operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operation_version INTEGER NOT NULL DEFAULT 1,
        partner_key VARCHAR(64) NOT NULL,
        capability_key VARCHAR(160) NOT NULL,
        operation_type VARCHAR(80) NOT NULL,
        resource_type VARCHAR(40) NOT NULL,
        resource_id UUID NOT NULL,
        internal_command_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        wallet_account_id UUID NOT NULL,
        ledger_account_id UUID NOT NULL,
        target_mapping_reference VARCHAR(180) NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        internal_idempotency_scope VARCHAR(120) NOT NULL,
        internal_idempotency_key VARCHAR(255) NOT NULL,
        provider_idempotency_scope VARCHAR(120) NOT NULL,
        provider_idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        request_id VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        trace_id VARCHAR(255),
        causation_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT uq_external_operations_internal_command_id UNIQUE (internal_command_id),
        CONSTRAINT uq_external_operations_internal_idempotency
          UNIQUE (internal_idempotency_scope, internal_idempotency_key),
        CONSTRAINT uq_external_operations_provider_idempotency
          UNIQUE (provider_idempotency_scope, provider_idempotency_key),
        CONSTRAINT fk_external_operations_resource
          FOREIGN KEY (resource_id) REFERENCES withdrawals(id) ON DELETE RESTRICT,
        CONSTRAINT fk_external_operations_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_external_operations_wallet_account
          FOREIGN KEY (wallet_account_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_external_operations_ledger_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT chk_external_operations_operation_version CHECK (operation_version = 1),
        CONSTRAINT chk_external_operations_partner CHECK (partner_key = 'NIBSS_NIP'),
        CONSTRAINT chk_external_operations_capability
          CHECK (capability_key = 'external.wallet.withdrawal.settlement'),
        CONSTRAINT chk_external_operations_operation_type
          CHECK (operation_type = 'OUTBOUND_BANK_SETTLEMENT'),
        CONSTRAINT chk_external_operations_resource_type CHECK (resource_type = 'WITHDRAWAL'),
        CONSTRAINT chk_external_operations_amount CHECK (amount_minor > 0),
        CONSTRAINT chk_external_operations_currency CHECK (currency = 'NGN'),
        CONSTRAINT chk_external_operations_accounting_unit CHECK (accounting_unit = 'CUSTOMER_FUNDS'),
        CONSTRAINT chk_external_operations_target_mapping_reference
          CHECK (target_mapping_reference ~ '^a6-target:[a-f0-9]{64}$'),
        CONSTRAINT chk_external_operations_request_hash
          CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_operations_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operations_resource
        ON external_operations (resource_type, resource_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operations_customer_created
        ON external_operations (customer_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operations_correlation
        ON external_operations (correlation_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_external_operation_identity()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.operation_version IS DISTINCT FROM NEW.operation_version
           OR OLD.partner_key IS DISTINCT FROM NEW.partner_key
           OR OLD.capability_key IS DISTINCT FROM NEW.capability_key
           OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
           OR OLD.resource_type IS DISTINCT FROM NEW.resource_type
           OR OLD.resource_id IS DISTINCT FROM NEW.resource_id
           OR OLD.internal_command_id IS DISTINCT FROM NEW.internal_command_id
           OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
           OR OLD.wallet_account_id IS DISTINCT FROM NEW.wallet_account_id
           OR OLD.ledger_account_id IS DISTINCT FROM NEW.ledger_account_id
           OR OLD.target_mapping_reference IS DISTINCT FROM NEW.target_mapping_reference
           OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor
           OR OLD.currency IS DISTINCT FROM NEW.currency
           OR OLD.accounting_unit IS DISTINCT FROM NEW.accounting_unit
           OR OLD.internal_idempotency_scope IS DISTINCT FROM NEW.internal_idempotency_scope
           OR OLD.internal_idempotency_key IS DISTINCT FROM NEW.internal_idempotency_key
           OR OLD.provider_idempotency_scope IS DISTINCT FROM NEW.provider_idempotency_scope
           OR OLD.provider_idempotency_key IS DISTINCT FROM NEW.provider_idempotency_key
           OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
           OR OLD.request_id IS DISTINCT FROM NEW.request_id
           OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
           OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
           OR OLD.causation_id IS DISTINCT FROM NEW.causation_id
        THEN
          RAISE EXCEPTION 'External operation identity and correlation are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER external_operations_enforce_identity
      BEFORE UPDATE ON external_operations
      FOR EACH ROW EXECUTE FUNCTION enforce_external_operation_identity()
    `);

    await queryRunner.query(`
      CREATE TABLE external_operation_references (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_operation_id UUID NOT NULL,
        partner_key VARCHAR(64) NOT NULL,
        reference_type VARCHAR(32) NOT NULL,
        reference_value VARCHAR(255) NOT NULL,
        namespace VARCHAR(120) NOT NULL,
        source VARCHAR(32) NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_external_operation_references_partner_value
          UNIQUE (partner_key, reference_type, reference_value),
        CONSTRAINT uq_external_operation_references_operation_value
          UNIQUE (external_operation_id, reference_type, reference_value),
        CONSTRAINT fk_external_operation_references_operation
          FOREIGN KEY (external_operation_id) REFERENCES external_operations(id) ON DELETE RESTRICT,
        CONSTRAINT chk_external_operation_references_partner CHECK (partner_key = 'NIBSS_NIP'),
        CONSTRAINT chk_external_operation_references_type CHECK (
          reference_type IN (
            'REQUEST', 'OPERATION', 'TRANSACTION', 'SETTLEMENT',
            'CALLBACK', 'STATEMENT_ROW', 'PROVIDER_IDEMPOTENCY'
          )
        ),
        CONSTRAINT chk_external_operation_references_source CHECK (
          source IN ('REQUEST', 'ACKNOWLEDGEMENT', 'STATUS_QUERY', 'CALLBACK', 'STATEMENT', 'REPORT')
        ),
        CONSTRAINT chk_external_operation_references_value
          CHECK (reference_value ~ '^[\\x20-\\x7E]{1,255}$'),
        CONSTRAINT chk_external_operation_references_namespace
          CHECK (namespace ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operation_references_operation
        ON external_operation_references (external_operation_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_external_operation_reference_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.external_operation_id IS DISTINCT FROM NEW.external_operation_id
           OR OLD.partner_key IS DISTINCT FROM NEW.partner_key
           OR OLD.reference_type IS DISTINCT FROM NEW.reference_type
           OR OLD.reference_value IS DISTINCT FROM NEW.reference_value
           OR OLD.namespace IS DISTINCT FROM NEW.namespace
           OR OLD.source IS DISTINCT FROM NEW.source
           OR OLD.observed_at IS DISTINCT FROM NEW.observed_at
        THEN
          RAISE EXCEPTION 'External provider reference facts are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER external_operation_references_reject_mutation
      BEFORE UPDATE ON external_operation_references
      FOR EACH ROW EXECUTE FUNCTION reject_external_operation_reference_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS external_operation_references_reject_mutation ON external_operation_references`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS reject_external_operation_reference_mutation()`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operation_references_operation`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_operation_references`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS external_operations_enforce_identity ON external_operations`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_external_operation_identity()`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operations_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operations_customer_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operations_resource`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_operations`);
  }
}
