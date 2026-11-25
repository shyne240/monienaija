import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separates "who submitted this application" from "what created the row".
 *
 * `created_by` cannot answer the approval question. Workforce drafts are created through the public
 * applicant endpoint, which attributes the row to the application itself
 * (`agent-application:<id>`) because the console has no field to declare a submitter. So every
 * pre-existing row is unattributed with respect to review, and independence cannot be inferred from
 * it without guessing.
 *
 * `submitted_by` is the workforce principal that submitted (or, for genuine public applicants, the
 * public applicant principal). It is written on submission and is immutable thereafter, so an
 * approver can always be compared against the person whose submission is being decided.
 *
 * Deliberately NO backfill: inferring a submitter for historical rows would invent exactly the
 * evidence the guard exists to check. Historical rows stay NULL and are handled explicitly.
 */
export class AgentApplicationSubmitterAttribution1785753600806 implements MigrationInterface {
  name = 'AgentApplicationSubmitterAttribution1785753600806';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_applications ADD COLUMN submitted_by varchar(160)`);
    await q.query(
      `CREATE INDEX idx_agent_applications_submitted_by ON agent_applications (submitted_by)`,
    );
    // Immutability: whichever principal submitted the application is the one an approver must
    // differ from. Rewriting it after the fact would launder a self-approval.
    await q.query(
      `CREATE FUNCTION reject_agent_application_submitter_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
           RAISE EXCEPTION 'agent application submitter attribution is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await q.query(
      `CREATE TRIGGER agent_application_submitter_immutable
       BEFORE UPDATE ON agent_applications FOR EACH ROW
       EXECUTE FUNCTION reject_agent_application_submitter_mutation()`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard Agent application submitter attribution'));
  }
}
