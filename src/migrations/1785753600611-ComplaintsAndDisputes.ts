import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 24 — complaints and transaction disputes.
 *
 * ## What already exists, and why it is not a disputes register
 *
 * `SupportService` is a real helpdesk: tickets with reference, category, priority, assignment, threaded
 * messages, status transitions and audit. `support_tickets.related_transfer_id` even lets a ticket point at
 * the transaction it is about.
 *
 * A complaint about a *specific transaction* asking for *money back* is a different object with different
 * obligations, and the distinction is the whole of this group:
 *
 * - A ticket is a conversation. A dispute is a **claim with a decidable outcome** against an identified
 *   transaction, for a stated amount, under a stated grounds.
 * - A ticket can be closed by whoever is handling it. A dispute outcome that *upholds* a claim is a
 *   financial decision and must be separated from the person who investigated it.
 * - A ticket has no notion of a decision that was **refused**, and no notion of the claimant being told.
 *   Both matter: a dispute resolved in the customer's favour but never communicated is a dispute that will
 *   be escalated to a regulator.
 *
 * There was no chargeback, no redress, and no complaint concept anywhere in the codebase — the searches for
 * "complaint", "redress" and "chargeback" returned nothing outside commercial-governance constants. This
 * migration adds the missing object rather than overloading the helpdesk.
 *
 * ## A dispute never moves money
 *
 * This is the most important constraint in the group. A dispute records a **claim** and a **decision**. When
 * a decision is `UPHELD_IN_FULL` or `UPHELD_IN_PART`, it does not credit anyone and does not touch a
 * journal. It records that a named adjudicator concluded the customer should be made whole for a stated
 * amount, and points at the governed financial path that must then execute it — `LedgerReversalGovernance`
 * for a reversal, or the existing approval machinery for any other remedy.
 *
 * The schema therefore has **no reference to a journal, a wallet or an account for crediting**. There is no
 * column a well-meaning future implementation could write to make money move from here. That is deliberate:
 * the alternative is a second, unaudited path to customer funds that bypasses the reversal governance,
 * approvals and ledger triggers the rest of the system relies on.
 *
 * ## Separation of duties is structural, not advisory
 *
 * `decided_by` must differ from `investigated_by` and from `raised_by` when a claim is upheld. Upheld means
 * money is owed; the person who investigated the claim should not be the person who validates their own
 * conclusion, and the claimant plainly cannot approve their own claim. Enforced by CHECK, so a service bug
 * or a direct SQL write cannot collapse the two roles.
 */

/** Grounds a claim can be made on. */
export const DISPUTE_GROUNDS = [
  'NOT_RECEIVED',
  'WRONG_AMOUNT',
  'DUPLICATE_DEBIT',
  'UNAUTHORISED',
  'WRONG_RECIPIENT',
  'FAILED_NOT_REFUNDED',
  'FEE_DISPUTE',
  'OTHER',
] as const;

export type DisputeGrounds = (typeof DISPUTE_GROUNDS)[number];

/** What the adjudicator concluded. */
export const DISPUTE_OUTCOMES = [
  'UPHELD_IN_FULL',
  'UPHELD_IN_PART',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export class ComplaintsAndDisputes1785753600611 implements MigrationInterface {
  name = 'ComplaintsAndDisputes1785753600611';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. The dispute.
     * ---------------------------------------------------------------------------------------------
     */
    await q.query(`CREATE TABLE transaction_disputes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Human-facing reference, unique and lowercase like every other reference in this system.
      reference varchar(64) NOT NULL,
      -- Who is complaining, and about what. The transaction reference is not a foreign key to transfers
      -- on purpose: a dispute must be recordable against a transaction the bank can see in a channel that
      -- this database does not own (a card scheme, an upstream provider), and a hard foreign key would make
      -- exactly those cases impossible to record. 'transaction_reference' is the string the customer quotes.
      customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
      transaction_reference varchar(160) NOT NULL,
      -- Where the disputed money is. Bounded to the channels this system actually settles or can represent.
      channel varchar(30) NOT NULL CHECK (channel IN (
        'INTERNAL_TRANSFER', 'EXTERNAL_TRANSFER', 'CARD', 'CASH', 'AGENT', 'FEE', 'OTHER'
      )),
      grounds varchar(30) NOT NULL CHECK (grounds IN (
        'NOT_RECEIVED', 'WRONG_AMOUNT', 'DUPLICATE_DEBIT', 'UNAUTHORISED',
        'WRONG_RECIPIENT', 'FAILED_NOT_REFUNDED', 'FEE_DISPUTE', 'OTHER'
      )),
      -- What the customer says they are owed, and in what currency. Claimed, not agreed: the adjudicator may
      -- award less. Never negative, because a negative claim is a payment request in disguise.
      claimed_amount_minor bigint NOT NULL CHECK (claimed_amount_minor > 0),
      currency varchar(3) NOT NULL,
      -- Free-text statement. Bounded; this is the customer's account of events, and it is evidence.
      statement varchar(4000) NOT NULL,
      -- Who recorded it. A dispute may be raised by the customer directly or entered by support on their
      -- behalf, and both must be distinguishable when reviewing why a claim exists.
      raised_by_type varchar(20) NOT NULL CHECK (raised_by_type IN ('CUSTOMER', 'SUPPORT', 'OPERATOR', 'SERVICE')),
      raised_by_id varchar(160) NOT NULL,
      -- Workflow. DELIBERATELY separate from the outcome: a dispute can be under review for weeks and that is
      -- not an outcome, and an outcome does not by itself close a dispute that still owes the customer a
      -- written decision.
      status varchar(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'INVESTIGATING', 'DECIDED', 'CLOSED', 'WITHDRAWN')),
      investigated_by varchar(160),
      investigated_at timestamptz,
      -- The investigation must produce findings, and findings must be substantive. A disposition with no
      -- recorded reasoning is not reviewable by a regulator, a supervisor or the customer.
      investigation_findings varchar(4000),
      decided_by varchar(160),
      decided_at timestamptz,
      outcome varchar(20) CHECK (outcome IN (
        'UPHELD_IN_FULL', 'UPHELD_IN_PART', 'REJECTED', 'WITHDRAWN'
      )),
      -- What was actually awarded, which may be less than claimed (partial) or zero (rejected).
      awarded_amount_minor bigint CHECK (awarded_amount_minor IS NULL OR awarded_amount_minor >= 0),
      decision_rationale varchar(4000),
      -- Whether the claimant was TOLD. A decision the customer never received is not a resolved dispute; it
      -- is the thing that becomes a regulatory complaint.
      customer_informed_at timestamptz,
      customer_informed_by varchar(160),
      -- Points at the governed financial path that must execute any award. Never a journal, wallet or
      -- account: this table records what is owed, never what was paid, because paying is a different
      -- authority with its own approvals and ledger controls.
      remedy_execution_reference varchar(200),
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      CHECK (length(btrim(reference)) > 0),
      CHECK (length(btrim(statement)) > 0),
      CHECK (length(btrim(transaction_reference)) > 0),

      -- An investigation is a named act with a time and a finding, or it did not happen.
      CHECK (
        (investigated_by IS NULL AND investigated_at IS NULL AND investigation_findings IS NULL)
        OR (investigated_by IS NOT NULL AND investigated_at IS NOT NULL AND investigation_findings IS NOT NULL)
      ),
      -- A decision is a named act, with reasoning and an amount, or it did not happen. 'awarded_amount_minor'
      -- is required whenever an outcome exists so "upheld, amount unspecified" cannot be recorded — that
      -- state would need a human to reconstruct from memory what was agreed.
      CHECK (
        (outcome IS NULL AND decided_by IS NULL AND decided_at IS NULL
          AND awarded_amount_minor IS NULL AND decision_rationale IS NULL)
        OR (outcome IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
            AND awarded_amount_minor IS NOT NULL AND decision_rationale IS NOT NULL)
      ),
      -- The award must be consistent with the outcome. This is the constraint that stops a typo turning a
      -- rejection into a payout, or a full uphold into a token amount.
      CHECK (
        outcome IS NULL
        OR (outcome = 'REJECTED' AND awarded_amount_minor = 0)
        OR (outcome = 'WITHDRAWN' AND awarded_amount_minor = 0)
        OR (outcome = 'UPHELD_IN_FULL' AND awarded_amount_minor = claimed_amount_minor)
        OR (outcome = 'UPHELD_IN_PART' AND awarded_amount_minor > 0
            AND awarded_amount_minor < claimed_amount_minor)
      ),
      -- Separation of duties, for upheld claims only. A rejected claim cannot be appealed against the
      -- adjudicator on this basis, and a decision that owes nothing does not need two people; a decision that
      -- owes money does.
      CHECK (
        outcome IS NULL
        OR outcome NOT IN ('UPHELD_IN_FULL', 'UPHELD_IN_PART')
        OR (decided_by <> raised_by_id AND (investigated_by IS NULL OR decided_by <> investigated_by))
      ),
      -- An investigation must describe something. Whitespace is not a finding.
      CHECK (investigation_findings IS NULL OR length(btrim(investigation_findings)) > 0),
      CHECK (decision_rationale IS NULL OR length(btrim(decision_rationale)) > 0),
      -- A decision cannot precede the investigation that produced it, and neither can precede the claim.
      CHECK (investigated_at IS NULL OR investigated_at >= opened_at),
      CHECK (decided_at IS NULL OR decided_at >= opened_at),
      CHECK (decided_at IS NULL OR investigated_at IS NULL OR decided_at >= investigated_at),
      -- Informing the customer cannot precede deciding.
      CHECK (customer_informed_at IS NULL OR decided_at IS NULL OR customer_informed_at >= decided_at),
      CHECK ((customer_informed_at IS NULL) = (customer_informed_by IS NULL)),
      -- A closed dispute must have been decided or withdrawn; closing an undecided claim would lose it.
      CHECK (status <> 'CLOSED' OR outcome IS NOT NULL),
      CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
      CHECK (closed_at IS NULL OR closed_at >= opened_at),
      -- DECIDED and beyond require an outcome; earlier states must not have one.
      CHECK (status IN ('OPEN', 'INVESTIGATING', 'WITHDRAWN') OR outcome IS NOT NULL)
    )`);

    await q.query(
      `CREATE UNIQUE INDEX uq_transaction_disputes_reference ON transaction_disputes (reference)`,
    );
    await q.query(`CREATE UNIQUE INDEX uq_transaction_disputes_customer_transaction
      ON transaction_disputes (customer_id, transaction_reference, grounds)`);
    /*
     * The operational query: undecided disputes, oldest first. Partial so it stays small as history grows —
     * an old decided dispute is read by reference, not by scan.
     */
    await q.query(`CREATE INDEX idx_transaction_disputes_open
      ON transaction_disputes (opened_at) WHERE status IN ('OPEN', 'INVESTIGATING')`);
    /*
     * "Has this customer disputed this transaction before" is asked on every new claim. Without this it is a
     * scan.
     */
    await q.query(`CREATE INDEX idx_transaction_disputes_customer
      ON transaction_disputes (customer_id, opened_at DESC)`);

    await q.query(`CREATE OR REPLACE FUNCTION reject_dispute_delete() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'transaction_disputes cannot be deleted; a claim and its decision are evidence';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER transaction_disputes_no_delete
      BEFORE DELETE ON transaction_disputes
      FOR EACH ROW EXECUTE FUNCTION reject_dispute_delete()`);

    /*
     * The claim is immutable; only progress is writable.
     *
     * What the customer claimed, for how much, on what grounds, and who raised it must never change after
     * the fact. Otherwise the award constraints above could be satisfied by editing the claim instead of
     * honouring it — a full uphold of 1 naira because someone rewrote the claim from 100,000.
     */
    await q.query(`CREATE OR REPLACE FUNCTION enforce_dispute_claim_immutable() RETURNS trigger AS $$
      BEGIN
        IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
          OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
          OR NEW.channel IS DISTINCT FROM OLD.channel
          OR NEW.grounds IS DISTINCT FROM OLD.grounds
          OR NEW.claimed_amount_minor IS DISTINCT FROM OLD.claimed_amount_minor
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.statement IS DISTINCT FROM OLD.statement
          OR NEW.raised_by_type IS DISTINCT FROM OLD.raised_by_type
          OR NEW.raised_by_id IS DISTINCT FROM OLD.raised_by_id
          OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
        THEN
          RAISE EXCEPTION 'a dispute claim is immutable; only investigation, decision and status may change';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER transaction_disputes_claim_immutable
      BEFORE UPDATE ON transaction_disputes
      FOR EACH ROW EXECUTE FUNCTION enforce_dispute_claim_immutable()`);

    /*
     * A decision is final.
     *
     * Re-deciding a dispute would let an outcome be reversed without anyone knowing, and the amount owed is
     * the whole point of the record. A decision that was *wrong* is corrected by a new dispute or by the
     * governance path for an erroneous reversal — not by overwriting the evidence.
     */
    await q.query(`CREATE OR REPLACE FUNCTION enforce_dispute_decision_final() RETURNS trigger AS $$
      BEGIN
        IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
          RAISE EXCEPTION 'a dispute outcome is final; raise a new dispute rather than re-deciding';
        END IF;
        IF OLD.awarded_amount_minor IS NOT NULL
          AND NEW.awarded_amount_minor IS DISTINCT FROM OLD.awarded_amount_minor THEN
          RAISE EXCEPTION 'an awarded amount is final; the award cannot be restated';
        END IF;
        IF OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
          RAISE EXCEPTION 'the adjudicator of a dispute cannot be reassigned after the decision';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER transaction_disputes_decision_final
      BEFORE UPDATE ON transaction_disputes
      FOR EACH ROW EXECUTE FUNCTION enforce_dispute_decision_final()`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Correspondence.
     * ---------------------------------------------------------------------------------------------
     * Every contact with the claimant about this dispute, so "we told them on the 3rd" is a fact rather than a
     * recollection. Append-only for the same reason the audit trail is.
     */
    await q.query(`CREATE TABLE transaction_dispute_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      dispute_id uuid NOT NULL REFERENCES transaction_disputes (id) ON DELETE RESTRICT,
      event_type varchar(30) NOT NULL CHECK (event_type IN (
        'RAISED', 'ACKNOWLEDGED', 'INFORMATION_REQUESTED', 'INFORMATION_RECEIVED',
        'INVESTIGATION_RECORDED', 'DECIDED', 'CUSTOMER_INFORMED', 'CLOSED', 'NOTE'
      )),
      detail varchar(2000) NOT NULL,
      actor varchar(160) NOT NULL,
      -- Whether this event was communicated to the customer. Not every internal note is, and conflating the
      -- two is how a bank convinces itself it informed someone who never heard anything.
      communicated_to_customer boolean NOT NULL DEFAULT false,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      CHECK (length(btrim(detail)) > 0)
    )`);

    await q.query(`CREATE INDEX idx_transaction_dispute_events_dispute
      ON transaction_dispute_events (dispute_id, occurred_at DESC)`);

    await q.query(`CREATE OR REPLACE FUNCTION reject_dispute_event_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'transaction_dispute_events is append-only';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER transaction_dispute_events_immutable
      BEFORE UPDATE OR DELETE ON transaction_dispute_events
      FOR EACH ROW EXECUTE FUNCTION reject_dispute_event_mutation()`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while any dispute exists — the same reasoning as every previous group's rollback: a claim, its
     * investigation and its decision are the record of what the bank concluded it owed a customer, and no
     * other table can reconstruct it.
     */
    const rows = (await q.query(`SELECT count(*)::int AS n FROM transaction_disputes`)) as Array<{
      n: number;
    }>;
    const disputes = rows[0]?.n ?? 0;
    if (disputes > 0) {
      throw new Error(
        `Refusing to roll back ComplaintsAndDisputes1785753600611: ${disputes} dispute(s) exist. ` +
          'A claim, its investigation and its decision are the only record of what the bank concluded it owed.',
      );
    }

    await q.query(
      `DROP TRIGGER IF EXISTS transaction_dispute_events_immutable ON transaction_dispute_events`,
    );
    await q.query(`DROP FUNCTION IF EXISTS reject_dispute_event_mutation()`);
    await q.query(`DROP TABLE IF EXISTS transaction_dispute_events`);
    await q.query(
      `DROP TRIGGER IF EXISTS transaction_disputes_decision_final ON transaction_disputes`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS transaction_disputes_claim_immutable ON transaction_disputes`,
    );
    await q.query(`DROP TRIGGER IF EXISTS transaction_disputes_no_delete ON transaction_disputes`);
    await q.query(`DROP FUNCTION IF EXISTS enforce_dispute_decision_final()`);
    await q.query(`DROP FUNCTION IF EXISTS enforce_dispute_claim_immutable()`);
    await q.query(`DROP FUNCTION IF EXISTS reject_dispute_delete()`);
    await q.query(`DROP TABLE IF EXISTS transaction_disputes`);
  }
}
