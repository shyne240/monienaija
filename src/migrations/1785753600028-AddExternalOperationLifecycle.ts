import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalOperationLifecycle1785753600028 implements MigrationInterface {
  name = 'AddExternalOperationLifecycle1785753600028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE external_operations
        ADD COLUMN lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'CREATED',
        ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
        ADD COLUMN next_retry_at TIMESTAMPTZ,
        ADD COLUMN last_attempt_at TIMESTAMPTZ,
        ADD COLUMN provider_status VARCHAR(80),
        ADD COLUMN failure_code VARCHAR(80),
        ADD COLUMN failure_message VARCHAR(255),
        ADD COLUMN failure_status_code INTEGER,
        ADD COLUMN recovery_reference VARCHAR(180),
        ADD COLUMN submitting_at TIMESTAMPTZ,
        ADD COLUMN pending_at TIMESTAMPTZ,
        ADD COLUMN pending_verification_at TIMESTAMPTZ,
        ADD COLUMN unknown_at TIMESTAMPTZ,
        ADD COLUMN manual_review_at TIMESTAMPTZ,
        ADD COLUMN failed_at TIMESTAMPTZ,
        ADD COLUMN cancelled_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE external_operations
        ADD CONSTRAINT chk_external_operations_lifecycle_state CHECK (
          lifecycle_state IN (
            'CREATED', 'SUBMITTING', 'PENDING_PROVIDER', 'PENDING_VERIFICATION',
            'UNKNOWN', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED'
          )
        ),
        ADD CONSTRAINT chk_external_operations_attempts CHECK (
          attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts
        ),
        ADD CONSTRAINT chk_external_operations_lifecycle_recovery_reference CHECK (
          lifecycle_state NOT IN ('UNKNOWN', 'MANUAL_REVIEW')
          OR recovery_reference IS NOT NULL
        ),
        ADD CONSTRAINT chk_external_operations_lifecycle_failure_details CHECK (
          lifecycle_state <> 'FAILED'
          OR (failure_code IS NOT NULL AND failure_message IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operations_lifecycle
        ON external_operations (lifecycle_state, updated_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_operations_recovery
        ON external_operations (recovery_reference, lifecycle_state, id)
       WHERE recovery_reference IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_external_operation_lifecycle()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.lifecycle_state = 'CREATED'
           AND NEW.lifecycle_state NOT IN ('SUBMITTING', 'FAILED', 'CANCELLED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from CREATED to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state = 'SUBMITTING'
           AND NEW.lifecycle_state NOT IN ('PENDING_PROVIDER', 'PENDING_VERIFICATION', 'UNKNOWN', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from SUBMITTING to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state = 'PENDING_PROVIDER'
           AND NEW.lifecycle_state NOT IN ('PENDING_VERIFICATION', 'UNKNOWN', 'MANUAL_REVIEW', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from PENDING_PROVIDER to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state = 'PENDING_VERIFICATION'
           AND NEW.lifecycle_state NOT IN ('SUBMITTING', 'UNKNOWN', 'MANUAL_REVIEW', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from PENDING_VERIFICATION to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state = 'UNKNOWN'
           AND NEW.lifecycle_state NOT IN ('PENDING_VERIFICATION', 'MANUAL_REVIEW', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from UNKNOWN to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state = 'MANUAL_REVIEW'
           AND NEW.lifecycle_state NOT IN ('PENDING_VERIFICATION', 'FAILED')
        THEN
          RAISE EXCEPTION 'Invalid external operation transition from MANUAL_REVIEW to %', NEW.lifecycle_state
            USING ERRCODE = '23514';
        ELSIF OLD.lifecycle_state IN ('FAILED', 'CANCELLED')
           AND NEW.lifecycle_state <> OLD.lifecycle_state
        THEN
          RAISE EXCEPTION 'Terminal external operation state % cannot transition to %', OLD.lifecycle_state, NEW.lifecycle_state
            USING ERRCODE = '55000';
        END IF;

        IF NEW.lifecycle_state IN ('UNKNOWN', 'MANUAL_REVIEW')
           AND NEW.recovery_reference IS NULL
        THEN
          RAISE EXCEPTION 'Uncertain external operation state requires a recovery reference'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.lifecycle_state = 'FAILED'
           AND (NEW.failure_code IS NULL OR NEW.failure_message IS NULL)
        THEN
          RAISE EXCEPTION 'Failed external operation requires failure details'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.attempt_count < OLD.attempt_count OR NEW.attempt_count > NEW.max_attempts THEN
          RAISE EXCEPTION 'External operation attempt count is invalid'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER external_operations_enforce_lifecycle
      BEFORE UPDATE ON external_operations
      FOR EACH ROW EXECUTE FUNCTION enforce_external_operation_lifecycle()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS external_operations_enforce_lifecycle ON external_operations`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_external_operation_lifecycle()`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operations_recovery`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_operations_lifecycle`);
    await queryRunner.query(`
      ALTER TABLE external_operations
        DROP CONSTRAINT IF EXISTS chk_external_operations_lifecycle_failure_details,
        DROP CONSTRAINT IF EXISTS chk_external_operations_lifecycle_recovery_reference,
        DROP CONSTRAINT IF EXISTS chk_external_operations_attempts,
        DROP CONSTRAINT IF EXISTS chk_external_operations_lifecycle_state,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS failed_at,
        DROP COLUMN IF EXISTS manual_review_at,
        DROP COLUMN IF EXISTS unknown_at,
        DROP COLUMN IF EXISTS pending_verification_at,
        DROP COLUMN IF EXISTS pending_at,
        DROP COLUMN IF EXISTS submitting_at,
        DROP COLUMN IF EXISTS recovery_reference,
        DROP COLUMN IF EXISTS failure_status_code,
        DROP COLUMN IF EXISTS failure_message,
        DROP COLUMN IF EXISTS failure_code,
        DROP COLUMN IF EXISTS provider_status,
        DROP COLUMN IF EXISTS last_attempt_at,
        DROP COLUMN IF EXISTS next_retry_at,
        DROP COLUMN IF EXISTS max_attempts,
        DROP COLUMN IF EXISTS attempt_count,
        DROP COLUMN IF EXISTS lifecycle_state
    `);
  }
}
