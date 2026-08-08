import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalSettlementTables1785753600029 implements MigrationInterface {
  name = 'CreateExternalSettlementTables1785753600029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE external_settlements (
        id UUID PRIMARY KEY,
        external_operation_id UUID NOT NULL,
        external_operation_reference VARCHAR(200) NOT NULL,
        partner_key VARCHAR(64) NOT NULL,
        capability_key VARCHAR(160) NOT NULL,
        operation_type VARCHAR(80) NOT NULL,
        customer_id UUID NOT NULL,
        wallet_account_id UUID NOT NULL,
        customer_ledger_account_id UUID NOT NULL,
        settlement_asset_ledger_account_id UUID NOT NULL,
        decision VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        lifecycle_state VARCHAR(32) NOT NULL,
        journal_id UUID NULL,
        reversal_journal_id UUID NULL,
        evidence_type VARCHAR(32) NOT NULL,
        evidence_value VARCHAR(255) NOT NULL,
        evidence_namespace VARCHAR(120) NOT NULL,
        evidence_source VARCHAR(24) NOT NULL,
        evidence_hash CHAR(64) NOT NULL,
        idempotency_scope VARCHAR(120) NOT NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        request_id VARCHAR(255) NOT NULL,
        owner_principal VARCHAR(160) NOT NULL,
        posted_at TIMESTAMPTZ NULL,
        reversal_posted_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_external_settlements_operation_id UNIQUE (external_operation_id),
        CONSTRAINT uq_external_settlements_idempotency UNIQUE (idempotency_scope, idempotency_key),
        CONSTRAINT uq_external_settlements_journal_id UNIQUE (journal_id),
        CONSTRAINT chk_external_settlements_partner CHECK (partner_key = 'NIBSS_NIP'),
        CONSTRAINT chk_external_settlements_capability
          CHECK (capability_key = 'external.wallet.withdrawal.settlement'),
        CONSTRAINT chk_external_settlements_operation_type
          CHECK (operation_type = 'OUTBOUND_BANK_SETTLEMENT'),
        CONSTRAINT chk_external_settlements_decision
          CHECK (decision IN ('SETTLE', 'REJECT')),
        CONSTRAINT chk_external_settlements_status_value
          CHECK (status IN ('POSTED', 'REVERSED')),
        CONSTRAINT chk_external_settlements_currency CHECK (currency = 'NGN'),
        CONSTRAINT chk_external_settlements_accounting_unit
          CHECK (accounting_unit = 'CUSTOMER_FUNDS'),
        CONSTRAINT chk_external_settlements_amount CHECK (amount_minor > 0),
        CONSTRAINT chk_external_settlements_request_hash
          CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_settlements_idempotency_key
          CHECK (idempotency_key ~ '^a6-settlement:[a-f0-9]{64}$'),
        CONSTRAINT chk_external_settlements_evidence_hash
          CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_settlements_evidence_value
          CHECK (evidence_value ~ '^[\\x20-\\x7E]{1,255}$'),
        CONSTRAINT chk_external_settlements_evidence_type
          CHECK (evidence_type IN ('OPERATION', 'TRANSACTION', 'SETTLEMENT')),
        CONSTRAINT chk_external_settlements_evidence_namespace
          CHECK (evidence_namespace ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'),
        CONSTRAINT chk_external_settlements_evidence_source
          CHECK (evidence_source IN ('ACKNOWLEDGEMENT', 'STATUS_QUERY', 'CALLBACK', 'STATEMENT', 'REPORT')),
        CONSTRAINT chk_external_settlements_owner_principal
          CHECK (owner_principal ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_settlements_lifecycle_state
          CHECK (lifecycle_state IN ('PENDING_VERIFICATION', 'SETTLED', 'FAILED', 'CANCELLED', 'REJECTED', 'COMPENSATED')),
        CONSTRAINT chk_external_settlements_posted_journal
          CHECK (decision <> 'SETTLE' OR (journal_id IS NOT NULL AND posted_at IS NOT NULL AND reversal_journal_id IS NULL)),
        CONSTRAINT chk_external_settlements_reversal_metadata
          CHECK (reversal_journal_id IS NULL OR reversal_posted_at IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_settlements_customer
        ON external_settlements (customer_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_settlements_correlation
        ON external_settlements (correlation_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_settlements_status
        ON external_settlements (status, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_settlements_partner
        ON external_settlements (partner_key, capability_key, created_at, id)
    `);

    await queryRunner.query(`
      CREATE TABLE external_suspense_entries (
        id UUID PRIMARY KEY,
        external_operation_id UUID NOT NULL,
        external_operation_reference VARCHAR(200) NOT NULL,
        customer_id UUID NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        reason VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL,
        owner VARCHAR(120) NOT NULL,
        owner_principal VARCHAR(160) NOT NULL,
        evidence_hash CHAR(64) NOT NULL,
        lifecycle_state VARCHAR(32) NOT NULL,
        rejection_code VARCHAR(80) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        request_id VARCHAR(255) NOT NULL,
        reversal_journal_id UUID NULL,
        settlement_id UUID NULL,
        cleared_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_external_suspense_status
          CHECK (status IN ('OPEN', 'HELD', 'CLEARED')),
        CONSTRAINT chk_external_suspense_currency CHECK (currency = 'NGN'),
        CONSTRAINT chk_external_suspense_accounting_unit
          CHECK (accounting_unit = 'CUSTOMER_FUNDS'),
        CONSTRAINT chk_external_suspense_amount CHECK (amount_minor > 0),
        CONSTRAINT chk_external_suspense_reason
          CHECK (reason IN (
            'EVIDENCE_REFERENCE_MISSING',
            'SETTLEMENT_AMOUNT_MISMATCH',
            'SETTLEMENT_CURRENCY_MISMATCH',
            'SETTLEMENT_ACCOUNTING_UNIT_MISMATCH',
            'INTERNAL_ACCOUNT_MISMATCH',
            'SETTLEMENT_ACCOUNT_UNAVAILABLE',
            'STALE_OPERATION_VERSION',
            'SETTLEMENT_KEY_INVALID',
            'DUPLICATE_SETTLEMENT',
            'INVALID_SETTLEMENT_STATE',
            'PARTNER_DISABLED',
            'EXTERNAL_OPERATION_NOT_FOUND',
            'COMPENSATING_NOT_PERMITTED'
          )),
        CONSTRAINT chk_external_suspense_evidence_hash
          CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_suspense_owner
          CHECK (owner ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'),
        CONSTRAINT chk_external_suspense_owner_principal
          CHECK (owner_principal ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_suspense_cleared_metadata
          CHECK (status <> 'CLEARED' OR cleared_at IS NOT NULL),
        CONSTRAINT chk_external_suspense_lifecycle_state
          CHECK (lifecycle_state IN ('PENDING_VERIFICATION', 'UNKNOWN', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_suspense_operation
        ON external_suspense_entries (external_operation_id, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_suspense_customer
        ON external_suspense_entries (customer_id, status, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_suspense_owner
        ON external_suspense_entries (owner, status, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_suspense_evidence
        ON external_suspense_entries (evidence_hash, created_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_suspense_status
        ON external_suspense_entries (status, created_at, id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_suspense_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_suspense_evidence`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_suspense_owner`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_suspense_customer`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_suspense_operation`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_suspense_entries`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_settlements_partner`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_settlements_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_settlements_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_settlements_customer`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_settlements`);
  }
}
