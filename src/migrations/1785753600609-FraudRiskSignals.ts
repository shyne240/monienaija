import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 22 — fraud and risk signals.
 *
 * ## What already exists, and what it does not cover
 *
 * Risk is not absent from this system. `CustomerRiskProfileService` records a versioned risk profile with
 * factors, history and a due date; `CapabilityPolicyService.evaluateRisk` consumes that profile and can
 * DENY, or route to PENDING_REVIEW, when the level is CRITICAL, HIGH, expired or missing. That is real
 * enforcement, and this migration does not duplicate or replace it.
 *
 * It is also **entirely slow-moving**. It answers "is this customer, in general, risky?" It cannot answer
 * "is this particular transaction unusual?" Three things therefore did not exist at all:
 *
 * 1. **No velocity detection.** `LimitDimension.DAILY_COUNT` and `DAILY_AMOUNT` bound a customer against a
 *    *fixed, pre-approved* threshold. A threshold is a ceiling, not a signal: five transfers of 10,000 sit
 *    comfortably under a 100,000 daily limit and are invisible, even though the pattern is what matters.
 * 2. **No duplicate detection.** A double-submitted transfer, or the same amount to the same destination
 *    twice in a short window, is the single most common retail fraud and error pattern. Idempotency keys
 *    catch a *retried request*; they do not catch two genuinely distinct requests with the same shape.
 * 3. **No structured record of what was escalated.** `ComplianceCaseCategory.FRAUD` exists, so a human could
 *    open a case by hand, but nothing recorded that an automated rule fired, what it saw, or why it was or
 *    was not escalated. The v1 duplicate pattern — from the earlier ledger domain — shows how an
 *    earlier-copied implementation deals with the same problem; in this migration no default is assumed.
 *
 * ## Why a derived-value table and not a transaction-blocking rule
 *
 * Every signal here is written to a table and *evaluated*; a signal does not by itself refuse a transfer.
 * That is deliberate. Velocity and duplicate rules have false positives — a customer legitimately moving
 * salary through in three parts, an institution bulk-paying staff — and a rule that hard-blocks on a
 * heuristic creates a support burden and an incentive to game the threshold. The blocking authorities in
 * this system remain what they were: limits (fixed, approved), capability policy (risk profile), balances,
 * and authorization. **This table adds a detection surface; it does not add a money-moving authority.**
 *
 * ## Thresholds are configuration, never code
 *
 * The columns below are *shape*, not *values*. No window length, count or amount is baked into this schema
 * or into the service defaults in the sense of being a policy the product owner has agreed. Defaults exist
 * so the system runs, are documented as defaults, and are overridable — deciding what the right number is
 * for Nigerian retail transfers is a business decision with regulatory consequences (see the known gaps in
 * the group write-up), and inventing a credible-looking threshold would be worse than having none.
 */
export class FraudRiskSignals1785753600609 implements MigrationInterface {
  name = 'FraudRiskSignals1785753600609';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. Signal rule configuration.
     * ---------------------------------------------------------------------------------------------
     * Rules are rows, not constants, so a change of threshold is an auditable insert with a named actor
     * rather than a code change and redeploy. `is_active` plus `effective_from`/`effective_to` lets a rule
     * be retired without deleting the history of what fired under it.
     */
    await q.query(`CREATE TABLE fraud_signal_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Stable machine key, e.g. VELOCITY_COUNT_WINDOW. Unique while active so two live rules cannot
      -- silently both claim the same key and produce contradictory findings.
      rule_key varchar(80) NOT NULL,
      signal_type varchar(40) NOT NULL CHECK (signal_type IN (
        'VELOCITY_COUNT', 'VELOCITY_AMOUNT', 'DUPLICATE_SHAPE', 'ROUND_AMOUNT', 'NEW_DESTINATION'
      )),
      -- Observation window in minutes. Null only for signal types that do not use a window (DUPLICATE_SHAPE
      -- uses it as the look-back, so it is required there too; the column stays nullable for future types).
      window_minutes integer CHECK (window_minutes IS NULL OR window_minutes > 0),
      -- Count or amount threshold, whichever the signal type uses. Both nullable so a rule states only the
      -- dimension it actually measures, rather than filling an unused column with a misleading zero.
      threshold_count integer CHECK (threshold_count IS NULL OR threshold_count > 0),
      threshold_amount_minor bigint CHECK (threshold_amount_minor IS NULL OR threshold_amount_minor > 0),
      -- What firing this rule does. OBSERVE writes a finding and nothing else; REVIEW_QUEUE also raises a
      -- compliance case. There is deliberately NO blocking verdict value: this table cannot stop money,
      -- because that authority belongs to limits, policy, authorization and balances.
      escalation varchar(20) NOT NULL DEFAULT 'OBSERVE'
        CHECK (escalation IN ('OBSERVE', 'REVIEW_QUEUE')),
      severity varchar(16) NOT NULL DEFAULT 'MEDIUM'
        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      effective_from timestamptz NOT NULL DEFAULT now(),
      effective_to timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      created_by varchar(160) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (effective_to IS NULL OR effective_to > effective_from),
      -- A rule must measure something; a rule with neither threshold is inert and would silently never fire.
      CHECK (threshold_count IS NOT NULL OR threshold_amount_minor IS NOT NULL)
    )`);

    /*
     * Uniqueness of an active key. A partial unique index rather than a table constraint because retired
     * rules (is_active = false) must remain queryable for historical findings without blocking a new rule
     * that reuses the key.
     */
    await q.query(`CREATE UNIQUE INDEX idx_fraud_signal_rules_active_key
      ON fraud_signal_rules (rule_key) WHERE is_active`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Findings — one row per rule per subject per evaluation window.
     * ---------------------------------------------------------------------------------------------
     */
    await q.query(`CREATE TABLE fraud_signal_findings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id uuid NOT NULL REFERENCES fraud_signal_rules (id),
      -- Frozen copies of the rule's identity and configuration at firing time. If a threshold is later
      -- raised, the finding must still explain what the rule said when it fired; joining to the live rule
      -- would rewrite history and make a past escalation look unjustified.
      rule_key varchar(80) NOT NULL,
      signal_type varchar(40) NOT NULL,
      -- The subject of the finding. Customer is the retail unit; wallet is included because the same
      -- customer may hold instrument-specific exposure and a finding on one wallet is actionable alone.
      customer_id uuid,
      wallet_id uuid,
      -- The specific transaction that tripped the rule, where there is one. Nullable because a velocity
      -- signal may fire on the aggregate rather than on a single identifiable transaction.
      subject_reference varchar(160),
      observed_count integer CHECK (observed_count IS NULL OR observed_count >= 0),
      observed_amount_minor bigint CHECK (observed_amount_minor IS NULL OR observed_amount_minor >= 0),
      threshold_count integer,
      threshold_amount_minor bigint,
      currency varchar(3),
      -- Bounded, redacted explanation. Never a raw row dump: this table is read by investigators and
      -- exported to the operations centre, and a transfer row carries wallet and customer identifiers.
      detail varchar(500),
      severity varchar(16) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      -- Disposition of the finding. OPEN means nobody has looked. A finding is not an accusation and
      -- DISMISSED is a legitimate outcome, so dismissal requires a reason (constraint below).
      status varchar(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'DISMISSED')),
      -- Set when escalation is REVIEW_QUEUE and the case reference was established. Nullable because the
      -- case write happens after the finding and may legitimately fail; the finding must survive that.
      compliance_case_reference varchar(160),
      dismissed_reason varchar(300),
      reviewed_by varchar(160),
      reviewed_at timestamptz,
      detected_at timestamptz NOT NULL DEFAULT now(),
      -- One finding per rule per subject reference per detection window. Without this, re-running the
      -- evaluator on a schedule produces a new row every run for the same underlying condition, and the
      -- queue fills with duplicates of one problem — the same duplication failure corrected in Group 20's
      -- operations centre, fixed here at the source instead of filtered later.
      dedupe_key varchar(200) NOT NULL,
      -- Dismissal must say why. A silent dismissal destroys the only record of why an alert was wrong,
      -- and that record is what makes tuning the threshold possible later.
      CHECK (status <> 'DISMISSED' OR (dismissed_reason IS NOT NULL AND length(btrim(dismissed_reason)) > 0)),
      -- Reviewing is a named act: a status that implies someone looked must record who and when.
      CHECK (status IN ('OPEN') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
    )`);

    await q.query(`CREATE UNIQUE INDEX idx_fraud_signal_findings_dedupe
      ON fraud_signal_findings (dedupe_key)`);
    /*
     * The investigative query: open findings newest first. Partial so the index stays small as historical
     * findings accumulate — resolved findings are read by reference, not by scan.
     */
    await q.query(`CREATE INDEX idx_fraud_signal_findings_open
      ON fraud_signal_findings (detected_at DESC) WHERE status IN ('OPEN', 'UNDER_REVIEW')`);
    /*
     * Per-customer lookup. This is the query that makes a finding usable at decision time; without it,
     * "does this customer have open fraud findings" is a table scan on the hot path.
     */
    await q.query(`CREATE INDEX idx_fraud_signal_findings_customer
      ON fraud_signal_findings (customer_id, detected_at DESC) WHERE customer_id IS NOT NULL`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 3. Evaluation ledger — when the detector last ran, and over what.
     * ---------------------------------------------------------------------------------------------
     * Group 18 established that a check which silently stops running is indistinguishable from a check
     * that passes. The same failure applies here: if the velocity evaluator stops, the absence of findings
     * looks exactly like an absence of fraud. This table is how "we detected nothing" is distinguished
     * from "we were not looking".
     */
    await q.query(`CREATE TABLE fraud_evaluation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      -- Who or what ran it. A scheduled evaluator, an on-demand operator, or a test.
      evaluator varchar(160) NOT NULL,
      rules_evaluated integer NOT NULL DEFAULT 0 CHECK (rules_evaluated >= 0),
      subjects_evaluated integer NOT NULL DEFAULT 0 CHECK (subjects_evaluated >= 0),
      findings_written integer NOT NULL DEFAULT 0 CHECK (findings_written >= 0),
      -- ERROR means the run did not complete, and the columns above describe partial work only.
      status varchar(16) NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('RUNNING', 'PASS', 'ERROR')),
      error_detail varchar(500),
      CHECK (status <> 'ERROR' OR error_detail IS NOT NULL)
    )`);

    await q.query(`CREATE INDEX idx_fraud_evaluation_runs_recent
      ON fraud_evaluation_runs (started_at DESC)`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 4. Append-only enforcement.
     * ---------------------------------------------------------------------------------------------
     * Findings are evidence. A finding that fired must not be silently rewritten after the fact; the
     * disposition columns are the supported way to move it forward, and even those must pass through the
     * service, which records an audit row. DELETE is blocked outright: the record that a rule fired is
     * exactly what an investigation, or a regulator, asks for.
     */
    await q.query(`CREATE OR REPLACE FUNCTION reject_fraud_finding_delete() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'fraud_signal_findings is append-only; dispositions are updated, findings are not deleted';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER fraud_signal_findings_no_delete
      BEFORE DELETE ON fraud_signal_findings
      FOR EACH ROW EXECUTE FUNCTION reject_fraud_finding_delete()`);

    /*
     * Immutable identity of a finding. What fired, against whom, with what observed values. Only
     * disposition columns (status, review, dismissal, case reference) may change after insert, because
     * those describe what humans did about it rather than what was observed.
     */
    await q.query(`CREATE OR REPLACE FUNCTION enforce_fraud_finding_immutable_observation() RETURNS trigger AS $$
      BEGIN
        IF NEW.rule_id IS DISTINCT FROM OLD.rule_id
          OR NEW.rule_key IS DISTINCT FROM OLD.rule_key
          OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
          OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
          OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
          OR NEW.subject_reference IS DISTINCT FROM OLD.subject_reference
          OR NEW.observed_count IS DISTINCT FROM OLD.observed_count
          OR NEW.observed_amount_minor IS DISTINCT FROM OLD.observed_amount_minor
          OR NEW.threshold_count IS DISTINCT FROM OLD.threshold_count
          OR NEW.threshold_amount_minor IS DISTINCT FROM OLD.threshold_amount_minor
          OR NEW.detail IS DISTINCT FROM OLD.detail
          OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
          OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
        THEN
          RAISE EXCEPTION 'fraud_signal_findings observation columns are immutable; only disposition may change';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER fraud_signal_findings_immutable_observation
      BEFORE UPDATE ON fraud_signal_findings
      FOR EACH ROW EXECUTE FUNCTION enforce_fraud_finding_immutable_observation()`);

    /*
     * A dismissed or escalated finding cannot silently return to OPEN. Reopening is a real investigative
     * event and must be a new finding, so the record of the original disposition stands.
     */
    await q.query(`CREATE OR REPLACE FUNCTION enforce_fraud_finding_status_progress() RETURNS trigger AS $$
      BEGIN
        IF OLD.status IN ('DISMISSED', 'ESCALATED') AND NEW.status = 'OPEN' THEN
          RAISE EXCEPTION 'a resolved fraud finding cannot be reopened; raise a new finding instead';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER fraud_signal_findings_status_progress
      BEFORE UPDATE ON fraud_signal_findings
      FOR EACH ROW EXECUTE FUNCTION enforce_fraud_finding_status_progress()`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while findings exist.
     *
     * Same reasoning as Group 21's break-glass rollback: dropping this schema destroys the record that
     * specific transactions tripped specific rules. That record is the evidence an investigation or a
     * regulator would ask for, and it cannot be reconstructed from the transfers themselves — the
     * thresholds in force at the time are exactly what is lost.
     */
    const rows = (await q.query(`SELECT count(*)::int AS n FROM fraud_signal_findings`)) as Array<{
      n: number;
    }>;
    const findings = rows[0]?.n ?? 0;
    if (findings > 0) {
      throw new Error(
        `Refusing to roll back FraudRiskSignals1785753600609: ${findings} fraud finding(s) exist. ` +
          'Dropping this schema would destroy the record of which transactions tripped which rules, ' +
          'and the thresholds in force at the time cannot be reconstructed from the transfers.',
      );
    }

    await q.query(
      `DROP TRIGGER IF EXISTS fraud_signal_findings_status_progress ON fraud_signal_findings`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS fraud_signal_findings_immutable_observation ON fraud_signal_findings`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS fraud_signal_findings_no_delete ON fraud_signal_findings`,
    );
    await q.query(`DROP FUNCTION IF EXISTS enforce_fraud_finding_status_progress()`);
    await q.query(`DROP FUNCTION IF EXISTS enforce_fraud_finding_immutable_observation()`);
    await q.query(`DROP FUNCTION IF EXISTS reject_fraud_finding_delete()`);

    await q.query(`DROP TABLE IF EXISTS fraud_evaluation_runs`);
    await q.query(`DROP TABLE IF EXISTS fraud_signal_findings`);
    await q.query(`DROP TABLE IF EXISTS fraud_signal_rules`);
  }
}
