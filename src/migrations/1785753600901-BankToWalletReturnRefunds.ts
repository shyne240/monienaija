import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable execution record for a governed Bank→Wallet RETURN decision.
 *
 * The decision itself stays in `bank_to_wallet_resolutions`; this table records the provider
 * instruction and its authoritative outcome. One exception can have exactly one refund record,
 * one MonieNaija return reference and — once disclosed by the provider — one Monnify refund
 * reference. The original inbound transaction is never replaced by this row.
 */
export class BankToWalletReturnRefunds1785753600901 implements MigrationInterface {
  name = 'BankToWalletReturnRefunds1785753600901';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE bank_to_wallet_return_refunds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        exception_id uuid NOT NULL UNIQUE REFERENCES bank_to_wallet_exceptions(id) ON DELETE RESTRICT,
        approval_id uuid NOT NULL UNIQUE REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        business_reference varchar(128) NOT NULL,
        original_provider_reference varchar(160) NOT NULL,
        return_reference varchar(128) NOT NULL,
        refund_reference varchar(160),
        amount_minor numeric(20,0) NOT NULL CHECK (amount_minor > 0),
        currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        state varchar(20) NOT NULL DEFAULT 'APPROVED'
          CHECK (state IN ('APPROVED','SUBMITTING','SUBMITTED','PENDING','RETURNED','FAILED','UNKNOWN')),
        provider_status varchar(64),
        last_failure_code varchar(64),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        submitted_at timestamptz,
        last_checked_at timestamptz,
        resolved_at timestamptz,
        evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT uq_b2w_return_reference UNIQUE (institution_id, return_reference),
        CONSTRAINT uq_b2w_refund_reference UNIQUE (refund_reference),
        CONSTRAINT chk_b2w_return_terminal_resolved
          CHECK (state NOT IN ('RETURNED','FAILED') OR resolved_at IS NOT NULL)
      )
    `);
    await q.query(
      `CREATE INDEX idx_b2w_return_state ON bank_to_wallet_return_refunds(institution_id, state)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS bank_to_wallet_return_refunds');
  }
}
