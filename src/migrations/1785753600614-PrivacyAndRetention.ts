import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 27 — privacy and retention: erasure requests and retention policy.
 *
 * ## What did not exist
 *
 * Nothing in this codebase could answer a data-subject request. Searching for "retention", "erasure",
 * "anonymise", "right to" and "data subject" returned only unrelated hits: a maturity metric, redaction
 * helpers, and one controller field. `customers` has a `softDelete` timestamp, which is a *hiding* mechanism,
 * not an erasure one — the personal data is all still there.
 *
 * ## Why this is a request workflow and not a delete
 *
 * Erasure of a financial-services customer is legally constrained in a way that makes a synchronous "delete
 * everything" both wrong and dangerous:
 *
 * - **Ledger records must survive.** `ledger_journals`, `ledger_lines`, `transfers` and their triggers enforce
 *   immutability precisely so that the record of money movement cannot be edited. An erasure routine that
 *   reached into them would either fail its own triggers or, worse, succeed because someone had relaxed them.
 * - **Regulatory retention periods are not mine to invent.** An AML record has a statutory minimum retention
 *   in most jurisdictions. Deciding that a Nigerian customer's KYC evidence may be deleted after 30 days is a
 *   legal decision with criminal-liability consequences, and a plausible-looking default is worse than none.
 * - **Erasure must be auditable.** "We deleted their data" is not verifiable after the fact unless the *fact*
 *   of erasure, who authorized it, and what categories were covered are recorded — necessarily without
 *   retaining the data itself.
 *
 * So this group builds the **request and decision machinery**, the **retention policy register** (unseeded),
 * and an **executor that anonymises only what policy permits** — never the ledger.
 *
 * ## Held vs erased is a first-class outcome
 *
 * A request that is refused because a statutory retention period still applies is a legitimate, common
 * answer and must be distinguishable from inaction. `HELD_UNDER_RETENTION` is therefore an explicit status
 * with the basis recorded, not a silent no-op.
 */

export const ERASURE_STATUS = [
  'RECEIVED',
  'VERIFYING',
  'APPROVED',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'HELD_UNDER_RETENTION',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ErasureStatus = (typeof ERASURE_STATUS)[number];

/** Categories of personal data, each with its own retention rule. */
export const PERSONAL_DATA_CATEGORIES = [
  'PROFILE_IDENTITY',
  'CONTACT_METHODS',
  'ADDRESSES',
  'BENEFICIARY_DETAILS',
  'AUTHENTICATION_CREDENTIALS',
  'NOTIFICATION_HISTORY',
  'RISK_FACTORS',
] as const;

export type PersonalDataCategory = (typeof PERSONAL_DATA_CATEGORIES)[number];

export class PrivacyAndRetention1785753600614 implements MigrationInterface {
  name = 'PrivacyAndRetention1785753600614';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. Retention policy register.
     * ---------------------------------------------------------------------------------------------
     * Unseeded, deliberately. Which categories may be erased, after how long, and under which statutory basis
     * is a legal decision per jurisdiction. A seeded row would present an invented policy as an implemented
     * one and — worse — would let an erasure executor start deleting real data on the strength of a number
     * this codebase made up.
     */
    await q.query(`CREATE TABLE privacy_retention_policies (
      category varchar(40) PRIMARY KEY CHECK (category IN (
        'PROFILE_IDENTITY', 'CONTACT_METHODS', 'ADDRESSES', 'BENEFICIARY_DETAILS',
        'AUTHENTICATION_CREDENTIALS', 'NOTIFICATION_HISTORY', 'RISK_FACTORS'
      )),
      -- Whether this category may ever be erased for a customer who asks. Some categories cannot, and saying so
      -- in the register is how the executor knows to report "held" instead of silently skipping.
      erasable boolean NOT NULL DEFAULT false,
      -- Minimum age of the data before erasure is permitted, in days. Null means "no statutory minimum
      -- recorded"; the executor then refuses to erase and reports the gap rather than guessing zero.
      minimum_age_days integer CHECK (minimum_age_days IS NULL OR minimum_age_days >= 0),
      -- The statutory or contractual basis. Required, because "why are we keeping this" is the question a
      -- regulator asks and an unexplained retention is indistinguishable from hoarding.
      legal_basis varchar(300) NOT NULL,
      configured_by varchar(160) NOT NULL,
      configured_at timestamptz NOT NULL DEFAULT now(),
      notes varchar(500),
      CHECK (length(btrim(legal_basis)) > 0)
    )`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Erasure requests.
     * ---------------------------------------------------------------------------------------------
     */
    await q.query(`CREATE TABLE privacy_erasure_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reference varchar(64) NOT NULL,
      customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
      -- Who asked and how they were identified. A request from an unverified claimant must not be able to
      -- erase a customer's data: that would be a denial-of-service against the customer.
      requested_by_type varchar(20) NOT NULL CHECK (requested_by_type IN ('CUSTOMER', 'SUPPORT', 'OPERATOR')),
      requested_by_id varchar(160) NOT NULL,
      -- How identity was established before the request may proceed. Free text, because the acceptable evidence
      -- is a policy decision; recording that it happened is what matters.
      identity_verification varchar(500),
      verified_by varchar(160),
      verified_at timestamptz,
      -- Which categories were requested. An empty array is refused: "erase everything" is not a request this
      -- system will guess at, because it cannot know what the law allows.
      requested_categories text[] NOT NULL CHECK (array_length(requested_categories, 1) > 0),
      status varchar(30) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
        'RECEIVED', 'VERIFYING', 'APPROVED', 'PARTIALLY_COMPLETED',
        'COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN'
      )),
      -- The refusal or hold reason. Required whenever the request does not complete, so "why is my data still
      -- here" has an answer that is not a shrug.
      decision_basis varchar(1000),
      decided_by varchar(160),
      decided_at timestamptz,
      -- What was actually erased, as opposed to what was requested. The distinction is the whole point of
      -- reporting partial completion.
      erased_categories text[],
      -- Categories that could not be erased, with the reason. Recorded per category because the answers differ
      -- (one is under statutory retention, another was never erasable).
      held_categories jsonb,
      executed_at timestamptz,
      executed_by varchar(160),
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      CHECK (length(btrim(reference)) > 0),
      -- Verification is a named act with a time, or it did not happen.
      CHECK (
        (verified_by IS NULL AND verified_at IS NULL)
        OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
      ),
      -- A decision is a named act with a basis, or it did not happen.
      CHECK (
        (decided_by IS NULL AND decided_at IS NULL AND decision_basis IS NULL)
        OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_basis IS NOT NULL)
      ),
      CHECK (decision_basis IS NULL OR length(btrim(decision_basis)) > 0),
      -- Only categories the policy register knows about may be requested. A typo must not create a request
      -- that silently matches nothing.
      CHECK (requested_categories <@ ARRAY[
        'PROFILE_IDENTITY', 'CONTACT_METHODS', 'ADDRESSES', 'BENEFICIARY_DETAILS',
        'AUTHENTICATION_CREDENTIALS', 'NOTIFICATION_HISTORY', 'RISK_FACTORS'
      ]::text[]),
      -- A terminal state must have a decision behind it.
      CHECK (status NOT IN ('APPROVED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED')
             OR decided_by IS NOT NULL),
      -- Completion means something was actually erased.
      CHECK (status NOT IN ('COMPLETED', 'PARTIALLY_COMPLETED') OR erased_categories IS NOT NULL),
      -- A hold must say what was held and why.
      CHECK (status <> 'HELD_UNDER_RETENTION' OR held_categories IS NOT NULL),
      -- Closure only from a terminal state.
      --
      -- PARTIALLY_COMPLETED is deliberately NOT terminal: it means "what could be erased was erased, and the
      -- remaining categories are still held". The customer's request is not finished, so closing it would end
      -- the tracking of the part still owed to them. It closes when the held categories are resolved.
      CHECK ((status IN ('COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN'))
             = (closed_at IS NOT NULL))
    )`);

    await q.query(`CREATE UNIQUE INDEX uq_privacy_erasure_requests_reference
      ON privacy_erasure_requests (reference)`);
    /*
     * One live request per customer. Two concurrent erasure requests for the same person would each erase a
     * subset and each report partial completion, and neither would be the record of what happened.
     */
    await q.query(`CREATE UNIQUE INDEX uq_privacy_erasure_requests_live
      ON privacy_erasure_requests (customer_id)
      WHERE status NOT IN ('COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN')`);

    await q.query(`CREATE INDEX idx_privacy_erasure_requests_open
      ON privacy_erasure_requests (opened_at)
      WHERE status NOT IN ('COMPLETED', 'HELD_UNDER_RETENTION', 'REJECTED', 'WITHDRAWN')`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 3. Erasure audit trail.
     * ---------------------------------------------------------------------------------------------
     * What was done, per request, per category, per table. Recorded **without** the erased values: an erasure
     * log that kept a copy of what it erased would defeat the erasure.
     */
    await q.query(`CREATE TABLE privacy_erasure_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id uuid NOT NULL REFERENCES privacy_erasure_requests (id) ON DELETE RESTRICT,
      category varchar(40) NOT NULL,
      -- The table and the operation, never the value. 'customer_profiles:ANONYMISED'.
      target varchar(160) NOT NULL,
      rows_affected integer NOT NULL CHECK (rows_affected >= 0),
      outcome varchar(20) NOT NULL CHECK (outcome IN ('ERASED', 'HELD', 'SKIPPED')),
      -- Why it was held or skipped. Required for anything that did not erase, so a partial erasure is
      -- explainable.
      reason varchar(500),
      performed_by varchar(160) NOT NULL,
      performed_at timestamptz NOT NULL DEFAULT now(),
      CHECK (outcome = 'ERASED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`);

    await q.query(`CREATE INDEX idx_privacy_erasure_actions_request
      ON privacy_erasure_actions (request_id, performed_at)`);

    await q.query(`CREATE OR REPLACE FUNCTION reject_privacy_erasure_action_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'privacy_erasure_actions is append-only; the record of an erasure is evidence';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER privacy_erasure_actions_immutable
      BEFORE UPDATE OR DELETE ON privacy_erasure_actions
      FOR EACH ROW EXECUTE FUNCTION reject_privacy_erasure_action_mutation()`);

    /*
     * The request itself: the claim must not change. A request that could be edited after approval would let
     * the requested category list be widened after the fact, making the approval meaningless.
     */
    await q.query(`CREATE OR REPLACE FUNCTION enforce_erasure_request_claim_immutable() RETURNS trigger AS $$
      BEGIN
        IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
          OR NEW.requested_categories IS DISTINCT FROM OLD.requested_categories
          OR NEW.requested_by_type IS DISTINCT FROM OLD.requested_by_type
          OR NEW.requested_by_id IS DISTINCT FROM OLD.requested_by_id
          OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
        THEN
          RAISE EXCEPTION 'an erasure request claim is immutable; raise a new request instead';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER privacy_erasure_requests_claim_immutable
      BEFORE UPDATE ON privacy_erasure_requests
      FOR EACH ROW EXECUTE FUNCTION enforce_erasure_request_claim_immutable()`);

    await q.query(`CREATE OR REPLACE FUNCTION reject_erasure_request_delete() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'privacy_erasure_requests cannot be deleted; a request and its outcome are evidence';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER privacy_erasure_requests_no_delete
      BEFORE DELETE ON privacy_erasure_requests
      FOR EACH ROW EXECUTE FUNCTION reject_erasure_request_delete()`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while any request exists.
     *
     * A completed erasure request is the *only* evidence that personal data was removed and why. Dropping it
     * would leave the system unable to explain, to a regulator or to the data subject, what was done.
     */
    const rows = (await q.query(
      `SELECT count(*)::int AS n FROM privacy_erasure_requests`,
    )) as Array<{ n: number }>;
    const requests = rows[0]?.n ?? 0;
    if (requests > 0) {
      throw new Error(
        `Refusing to roll back PrivacyAndRetention1785753600614: ${requests} erasure request(s) exist. ` +
          'They are the only evidence of what personal data was removed, and on what basis.',
      );
    }

    await q.query(
      `DROP TRIGGER IF EXISTS privacy_erasure_requests_no_delete ON privacy_erasure_requests`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS privacy_erasure_requests_claim_immutable ON privacy_erasure_requests`,
    );
    await q.query(`DROP FUNCTION IF EXISTS reject_erasure_request_delete()`);
    await q.query(`DROP FUNCTION IF EXISTS enforce_erasure_request_claim_immutable()`);
    await q.query(
      `DROP TRIGGER IF EXISTS privacy_erasure_actions_immutable ON privacy_erasure_actions`,
    );
    await q.query(`DROP FUNCTION IF EXISTS reject_privacy_erasure_action_mutation()`);
    await q.query(`DROP TABLE IF EXISTS privacy_erasure_actions`);
    await q.query(`DROP TABLE IF EXISTS privacy_erasure_requests`);
    await q.query(`DROP TABLE IF EXISTS privacy_retention_policies`);
  }
}
