import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KycReconciliationReview1785753600106 implements MigrationInterface {
  name = 'KycReconciliationReview1785753600106';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE kyc_reconciliation_cases DROP CONSTRAINT kyc_reconciliation_cases_status_check',
    );
    await q.query(
      "ALTER TABLE kyc_reconciliation_cases ADD CONSTRAINT kyc_reconciliation_cases_status_check CHECK (status IN ('OPEN','NO_ACTION','REVIEW','TERMINAL'))",
    );
    await q.query(`CREATE TABLE kyc_reconciliation_reviews (
      id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES kyc_reconciliation_cases(id),
      request_id uuid NOT NULL, actor_id uuid NOT NULL, action varchar(16) NOT NULL CHECK(action IN ('REVIEW','TERMINAL')),
      reason_code varchar(32) NOT NULL CHECK(reason_code IN ('PROVIDER_UNAVAILABLE','OUTCOME_UNPROVEN','MANUAL_INVESTIGATION')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(case_id, request_id)
    )`);
    await q.query('ALTER TABLE kyc_private_audit DROP CONSTRAINT kyc_private_audit_action_check');
    await q.query(
      `ALTER TABLE kyc_private_audit ADD CONSTRAINT kyc_private_audit_action_check CHECK (action IN ('CONSENT_GRANTED','CONSENT_WITHDRAWN','ATTEMPT_RESERVED','ATTEMPT_FINISHED','OWNERSHIP_CONFLICT','RECONCILIATION_OPENED','RECONCILIATION_CLOSED','OWNERSHIP_REVIEWED','RECONCILIATION_REVIEW','RECONCILIATION_TERMINAL'))`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT (EXISTS (SELECT 1 FROM kyc_reconciliation_reviews) OR EXISTS (SELECT 1 FROM kyc_reconciliation_cases WHERE status IN ('REVIEW','TERMINAL'))) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove reconciliation history');
    await q.query('DROP TABLE kyc_reconciliation_reviews');
    await q.query(
      'ALTER TABLE kyc_reconciliation_cases DROP CONSTRAINT kyc_reconciliation_cases_status_check',
    );
    await q.query(
      "ALTER TABLE kyc_reconciliation_cases ADD CONSTRAINT kyc_reconciliation_cases_status_check CHECK (status IN ('OPEN','NO_ACTION'))",
    );
    await q.query('ALTER TABLE kyc_private_audit DROP CONSTRAINT kyc_private_audit_action_check');
    await q.query(
      `ALTER TABLE kyc_private_audit ADD CONSTRAINT kyc_private_audit_action_check CHECK (action IN ('CONSENT_GRANTED','CONSENT_WITHDRAWN','ATTEMPT_RESERVED','ATTEMPT_FINISHED','OWNERSHIP_CONFLICT','RECONCILIATION_OPENED','RECONCILIATION_CLOSED','OWNERSHIP_REVIEWED'))`,
    );
  }
}
