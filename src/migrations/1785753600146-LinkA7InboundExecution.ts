import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The receipt, journal and credited A7 transition must originate in the same transaction. */
export class LinkA7InboundExecution1785753600146 implements MigrationInterface {
  name = 'LinkA7InboundExecution1785753600146';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE a7_product_lifecycles DROP CONSTRAINT a7_product_lifecycles_state_check,
      DROP CONSTRAINT a7_product_lifecycles_execution_receipt_id_check,
      ADD CONSTRAINT a7_lifecycle_state_check CHECK (state IN ('LIFECYCLE_PENDING','LIFECYCLE_ADMITTED','LIFECYCLE_UNKNOWN','LIFECYCLE_MANUAL_REVIEW','LIFECYCLE_CANCELLED','LIFECYCLE_CREDITED')),
      ADD CONSTRAINT a7_lifecycle_receipt_state_check CHECK ((state='LIFECYCLE_CREDITED') = (execution_receipt_id IS NOT NULL)),
      ADD CONSTRAINT a7_lifecycle_receipt_unique UNIQUE(execution_receipt_id)`);
    await q.query(`CREATE OR REPLACE FUNCTION guard_a7_product_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'A7 lifecycle cannot be deleted'; END IF;
        IF TG_OP='INSERT' THEN
          IF NEW.state <> 'LIFECYCLE_PENDING' OR NEW.version <> 1 OR NEW.execution_receipt_id IS NOT NULL THEN
            RAISE EXCEPTION 'A7 lifecycle must begin pending'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.id<>OLD.id OR NEW.command_id<>OLD.command_id OR NEW.lifecycle_reference<>OLD.lifecycle_reference OR
           NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR
           NOT ((OLD.state='LIFECYCLE_PENDING' AND NEW.state IN ('LIFECYCLE_ADMITTED','LIFECYCLE_CANCELLED') AND NEW.execution_receipt_id IS NULL) OR
                (OLD.state='LIFECYCLE_ADMITTED' AND NEW.state='LIFECYCLE_UNKNOWN' AND NEW.execution_receipt_id IS NULL) OR
                (OLD.state='LIFECYCLE_UNKNOWN' AND NEW.state='LIFECYCLE_MANUAL_REVIEW' AND NEW.execution_receipt_id IS NULL) OR
                (OLD.state='LIFECYCLE_ADMITTED' AND NEW.state='LIFECYCLE_CREDITED' AND EXISTS (
                   SELECT 1 FROM a7_product_commands c JOIN inbound_funding_observations o ON o.id=c.inbound_observation_id
                   JOIN inbound_funding_receipts r ON r.id=NEW.execution_receipt_id
                   JOIN virtual_accounts v ON v.id=c.virtual_account_id AND v.wallet_id=c.wallet_account_id AND v.provider=o.provider_key AND v.bank_code=o.bank_code AND v.account_number=o.account_number
                   JOIN ledger_journals j ON j.id=r.journal_id
                   WHERE c.id=OLD.command_id AND c.operation_type='INBOUND_FUNDING'
                     AND r.status='CREDITED' AND r.virtual_account_id=c.virtual_account_id
                     AND r.wallet_account_id=c.wallet_account_id AND r.amount_minor=c.intended_amount_minor
                     AND r.currency='NGN' AND r.provider_key=o.provider_key
                     AND r.provider_reference_hash=o.provider_reference_hash AND r.evidence_hash=o.evidence_hash
                     AND r.xmin::text::bigint=(txid_current() % 4294967296)
                     AND j.xmin::text::bigint=(txid_current() % 4294967296)))) OR
           NOT EXISTS (SELECT 1 FROM a7_product_lifecycle_transitions t WHERE t.lifecycle_id=OLD.id
             AND t.from_state=OLD.state AND t.to_state=NEW.state AND t.from_version=OLD.version AND t.to_version=NEW.version
             AND t.xmin::text::bigint=(txid_current() % 4294967296))
        THEN RAISE EXCEPTION 'Invalid A7 lifecycle transition'; END IF;
        RETURN NEW;
      END $$`);
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove A7 execution evidence'));
  }
}
