import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';

/**
 * ARENA 3D Group 22 — fraud and risk signal evaluation.
 *
 * ## What this service is, and what it deliberately is not
 *
 * It *detects*. It does not *block*. Detection and financial authority are separated on purpose: every
 * blocking mechanism in this system (limits, capability policy, balances, authorization) is authoritative
 * and already enforced; a heuristic that also refused money would create a second, unaccountable authority
 * over customer funds whose behaviour changes when a threshold is tuned. So a finding here is a durable
 * record that something looked unusual, plus a route to human review — nothing more.
 *
 * ## Findings are deduplicated at the source
 *
 * An evaluator that runs on a schedule re-observes the same condition every run. Writing a row per run
 * fills the review queue with N copies of one problem and trains reviewers to ignore it. Group 20 fixed
 * that class of bug by filtering duplicates at the aggregation layer; here it is fixed at the source:
 * `dedupe_key` is unique, and a repeat observation updates the existing open finding's observation instead
 * of inserting a second one. That has a second benefit — `observed_count` rising on a stable finding shows
 * an escalating pattern, where duplicate rows would hide it.
 *
 * ## Thresholds come from the database, never from this file
 *
 * Every window, count and amount is read from `fraud_signal_rules`. The constants below are only *bounds*
 * on what the evaluator will compute, plus a documented fallback set used when no rule is configured. What
 * the correct number is for Nigerian retail transfers is a business and compliance decision; baking in a
 * plausible-looking value would dress an invented policy as an implemented one.
 */

/** A configured rule, as evaluated. */
export interface FraudSignalRule {
  readonly id: string;
  readonly ruleKey: string;
  readonly signalType: FraudSignalType;
  readonly windowMinutes: number | null;
  readonly thresholdCount: number | null;
  readonly thresholdAmountMinor: number | null;
  readonly escalation: 'OBSERVE' | 'REVIEW_QUEUE';
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export type FraudSignalType =
  | 'VELOCITY_COUNT'
  | 'VELOCITY_AMOUNT'
  | 'DUPLICATE_SHAPE'
  | 'ROUND_AMOUNT'
  | 'NEW_DESTINATION';

export interface FraudFinding {
  readonly id: string;
  readonly ruleKey: string;
  readonly signalType: FraudSignalType;
  readonly customerId: string | null;
  readonly walletId: string | null;
  readonly subjectReference: string | null;
  readonly observedCount: number | null;
  readonly observedAmountMinor: number | null;
  readonly thresholdCount: number | null;
  readonly thresholdAmountMinor: number | null;
  readonly currency: string | null;
  readonly detail: string | null;
  readonly severity: string;
  readonly status: string;
  readonly detectedAt: string;
}

export interface DetectionSummary {
  readonly runId: string;
  readonly rulesEvaluated: number;
  readonly subjectsEvaluated: number;
  readonly findingsWritten: number;
  readonly status: 'PASS' | 'ERROR';
  readonly errorDetail: string | null;
}

/**
 * The transaction facts the evaluator reasons over. Read from the committed transfer table rather than
 * from request objects, so a signal can never be derived from a submission that later fails.
 */
interface TransactionFact {
  readonly id: string;
  readonly customerId: string | null;
  readonly sourceWalletId: string;
  readonly destinationWalletId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

/**
 * Raw database row shapes.
 *
 * Declared explicitly rather than as `Record<string, unknown>`: stringifying an `unknown` is exactly how a
 * `[object Object]` leaks into an audit record or a stored detail. Naming the column type makes the
 * conversion checkable.
 */
interface RuleRow {
  readonly id: string;
  readonly rule_key: string;
  readonly signal_type: string;
  readonly window_minutes: number | null;
  readonly threshold_count: number | null;
  readonly threshold_amount_minor: string | number | null;
  readonly escalation: string;
  readonly severity: string;
}

interface FactRow {
  readonly id: string;
  readonly source_customer_id: string | null;
  readonly source_wallet_id: string;
  readonly destination_wallet_id: string | null;
  readonly amount_minor: string | number;
  readonly currency: string;
  readonly occurred_at: Date | string;
}

interface FindingRow {
  readonly id: string;
  readonly rule_key: string;
  readonly signal_type: string;
  readonly customer_id: string | null;
  readonly wallet_id: string | null;
  readonly subject_reference: string | null;
  readonly observed_count: number | null;
  readonly observed_amount_minor: string | number | null;
  readonly threshold_count: number | null;
  readonly threshold_amount_minor: string | number | null;
  readonly currency: string | null;
  readonly detail: string | null;
  readonly severity: string;
  readonly status: string;
  readonly detected_at: Date | string;
}

interface RunRow {
  readonly started_at: Date | string | null;
  readonly status: string | null;
}

/** Upper bound on facts loaded per evaluation. Bounded so one run cannot exhaust memory. */
const MAX_FACTS_PER_RUN = 5000;

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Runs one detection pass over recent completed transfers.
   *
   * Every run is recorded in `fraud_evaluation_runs`, including runs that find nothing and runs that fail.
   * An evaluator that stops running must be visible as *not looking*, not as an absence of fraud — the
   * same distinction Group 18 established for integrity checks.
   */
  async runDetection(options: { evaluator: string; now?: Date }): Promise<DetectionSummary> {
    const evaluator = options.evaluator;
    const now = options.now ?? new Date();

    // The run row is opened first, outside the evaluation transaction, so a crash mid-evaluation leaves a
    // RUNNING row behind rather than no evidence at all.
    const runId = await this.openRun(evaluator);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const rules = await this.loadActiveRules(manager, now);
        if (rules.length === 0) {
          return { rulesEvaluated: 0, subjectsEvaluated: 0, findingsWritten: 0 };
        }
        const facts = await this.loadFacts(manager, rules, now);
        const subjects = new Set<string>();
        let findingsWritten = 0;

        for (const rule of rules) {
          for (const subject of this.groupBySubject(rule, facts)) {
            subjects.add(this.subjectKey(subject.customerId, subject.walletId));
            const outcome = await this.evaluateSubject(manager, rule, subject, now);
            findingsWritten += outcome;
          }
        }

        return { rulesEvaluated: rules.length, subjectsEvaluated: subjects.size, findingsWritten };
      });

      await this.completeRun(runId, { ...result, status: 'PASS', errorDetail: null });
      return {
        runId,
        ...result,
        status: 'PASS',
        errorDetail: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      /*
       * A failed evaluation is recorded, not swallowed, and the run is marked ERROR. If this stayed silent
       * the operator would see "no findings" and conclude there were none, when the truth is that detection
       * did not run.
       */
      await this.completeRun(runId, {
        rulesEvaluated: 0,
        subjectsEvaluated: 0,
        findingsWritten: 0,
        status: 'ERROR',
        errorDetail: message.slice(0, 500),
      });
      this.logger.error(`Fraud detection run ${runId} failed: ${message}`);
      return {
        runId,
        rulesEvaluated: 0,
        subjectsEvaluated: 0,
        findingsWritten: 0,
        status: 'ERROR',
        errorDetail: message.slice(0, 500),
      };
    }
  }

  /**
   * Open findings for a customer, newest first.
   *
   * This is the read that a decision-time caller would use to see whether a customer is under scrutiny.
   * It is deliberately a separate call: wiring it into the transfer path as an automatic refusal would
   * hand a heuristic the power to stop money, which is exactly the authority this group does not grant.
   */
  async openFindings(customerId: string, limit = 50): Promise<FraudFinding[]> {
    const rows: unknown = await this.dataSource.query(
      `SELECT id, rule_key, signal_type, customer_id, wallet_id, subject_reference, observed_count,
              observed_amount_minor, threshold_count, threshold_amount_minor, currency, detail, severity,
              status, detected_at
         FROM fraud_signal_findings
        WHERE customer_id = $1
          AND status IN ('OPEN', 'UNDER_REVIEW')
        ORDER BY detected_at DESC
        LIMIT $2`,
      [customerId, Math.min(Math.max(limit, 1), 200)],
    );
    return this.rowsOf<FindingRow>(rows).map((row) => this.toFinding(row));
  }

  /** Every rule currently in force at `now`. */
  async activeRules(now = new Date()): Promise<FraudSignalRule[]> {
    return this.loadActiveRules(this.dataSource.manager, now);
  }

  /**
   * When detection last ran successfully, and whether it is still trustworthy.
   *
   * Returns `lastPassAt: null` when detection has never completed, which the caller must treat as
   * "unverified", not as "clean".
   */
  async detectionPosture(now = new Date()): Promise<{
    lastPassAt: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
    secondsSinceLastPass: number | null;
    openFindings: number;
  }> {
    const rows: unknown = await this.dataSource.query(
      `SELECT started_at, completed_at, status
         FROM fraud_evaluation_runs
        ORDER BY started_at DESC
        LIMIT 1`,
    );
    const latest = this.rowsOf<RunRow>(rows)[0];

    const passRows: unknown = await this.dataSource.query(
      `SELECT max(completed_at) AS last_pass
         FROM fraud_evaluation_runs
        WHERE status = 'PASS'`,
    );
    const lastPassValue = this.rowsOf<{ last_pass: Date | string | null }>(passRows)[0]?.last_pass;
    const lastPassAt = lastPassValue ? new Date(lastPassValue) : null;

    const countRows: unknown = await this.dataSource.query(
      `SELECT count(*)::int AS n
         FROM fraud_signal_findings
        WHERE status IN ('OPEN', 'UNDER_REVIEW')`,
    );
    const openFindings = Number(this.rowsOf<{ n: number }>(countRows)[0]?.n ?? 0);

    return {
      lastPassAt: lastPassAt ? lastPassAt.toISOString() : null,
      lastRunAt: latest?.started_at ? new Date(latest.started_at).toISOString() : null,
      lastStatus: latest?.status ?? null,
      secondsSinceLastPass: lastPassAt
        ? Math.max(0, Math.floor((now.getTime() - lastPassAt.getTime()) / 1000))
        : null,
      openFindings,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------------------------

  private async loadActiveRules(manager: EntityManager, now: Date): Promise<FraudSignalRule[]> {
    const result: unknown = await manager.query(
      `SELECT id, rule_key, signal_type, window_minutes, threshold_count, threshold_amount_minor,
              escalation, severity
         FROM fraud_signal_rules
        WHERE is_active
          AND effective_from <= $1
          AND (effective_to IS NULL OR effective_to > $1)
        ORDER BY rule_key`,
      [now],
    );
    return this.rowsOf<RuleRow>(result).map((row) => ({
      id: String(row.id),
      ruleKey: String(row.rule_key),
      signalType: row.signal_type as FraudSignalType,
      windowMinutes: row.window_minutes === null ? null : Number(row.window_minutes),
      thresholdCount: row.threshold_count === null ? null : Number(row.threshold_count),
      thresholdAmountMinor:
        row.threshold_amount_minor === null ? null : Number(row.threshold_amount_minor),
      escalation: row.escalation as 'OBSERVE' | 'REVIEW_QUEUE',
      severity: row.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    }));
  }

  /**
   * Loads committed transfer facts covering the widest configured window.
   *
   * Only completed transfers are considered: a failed or pending transfer is not money that moved, and
   * counting it would let a customer trigger velocity rules with transactions that never happened.
   */
  private async loadFacts(
    manager: EntityManager,
    rules: readonly FraudSignalRule[],
    now: Date,
  ): Promise<TransactionFact[]> {
    const windows = rules
      .map((rule) => rule.windowMinutes)
      .filter((value): value is number => typeof value === 'number' && value > 0);
    // No windowed rule means nothing to look back over.
    if (windows.length === 0) return [];

    const widest = Math.max(...windows);
    const since = new Date(now.getTime() - widest * 60_000);

    const result: unknown = await manager.query(
      `SELECT id, source_customer_id, source_wallet_id, destination_wallet_id, amount_minor, currency,
              COALESCE(completed_at, created_at) AS occurred_at
         FROM transfers
        WHERE status = 'COMPLETED'
          AND COALESCE(completed_at, created_at) >= $1
          AND COALESCE(completed_at, created_at) <= $2
        ORDER BY occurred_at DESC
        LIMIT $3`,
      [since, now, MAX_FACTS_PER_RUN],
    );

    return this.rowsOf<FactRow>(result).map((row) => ({
      id: row.id,
      customerId: row.source_customer_id,
      sourceWalletId: row.source_wallet_id,
      destinationWalletId: row.destination_wallet_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      occurredAt: new Date(row.occurred_at),
    }));
  }

  /**
   * Splits facts into the units the rule measures.
   *
   * Velocity is per customer: a customer splitting activity across wallets is exactly the pattern a
   * per-wallet rule would miss.
   */
  private groupBySubject(
    rule: FraudSignalRule,
    facts: readonly TransactionFact[],
  ): Array<{ customerId: string | null; walletId: string | null; facts: TransactionFact[] }> {
    const windowMs = (rule.windowMinutes ?? 0) * 60_000;
    const groups = new Map<string, TransactionFact[]>();
    for (const fact of facts) {
      const key = fact.customerId ?? fact.sourceWalletId;
      const bucket = groups.get(key);
      if (bucket) bucket.push(fact);
      else groups.set(key, [fact]);
    }
    const out: Array<{
      customerId: string | null;
      walletId: string | null;
      facts: TransactionFact[];
    }> = [];
    for (const bucket of groups.values()) {
      const newest = bucket[0];
      if (!newest) continue;
      // Anchor each subject's window on its own most recent fact, so a subject active an hour ago is not
      // measured against a window that ends now and therefore contains nothing.
      const anchor = newest.occurredAt.getTime();
      const inWindow =
        windowMs > 0
          ? bucket.filter((fact) => anchor - fact.occurredAt.getTime() <= windowMs)
          : bucket;
      out.push({
        customerId: newest.customerId,
        walletId: newest.sourceWalletId,
        facts: inWindow,
      });
    }
    return out;
  }

  /** Returns the number of findings written (0 or 1). */
  private async evaluateSubject(
    manager: EntityManager,
    rule: FraudSignalRule,
    subject: { customerId: string | null; walletId: string | null; facts: TransactionFact[] },
    now: Date,
  ): Promise<number> {
    const observation = this.observe(rule, subject.facts);
    if (!observation) return 0;

    const dedupeKey = [
      rule.id,
      subject.customerId ?? subject.walletId ?? 'unknown',
      observation.bucket,
    ].join(':');

    /*
     * Upsert on the dedupe key rather than insert-and-hope.
     *
     * A repeat observation of an already-open finding refreshes the observed values so escalation is
     * visible, but it must not open a second finding. `WHERE ... status IN ('OPEN','UNDER_REVIEW')` keeps a
     * dismissed finding dismissed: re-raising a finding a human already dismissed, from the same rule and
     * the same bucket, would override that judgement without review.
     */
    // `xmax = 0` distinguishes a genuine insert from the DO UPDATE branch. Without it a refresh of an
    // already-open finding is counted as a new finding, and the run summary claims more fraud was found
    // than exists.
    const result: unknown = await manager.query(
      `INSERT INTO fraud_signal_findings (
         rule_id, rule_key, signal_type, customer_id, wallet_id, subject_reference, observed_count,
         observed_amount_minor, threshold_count, threshold_amount_minor, currency, detail, severity, status,
         dedupe_key, detected_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPEN',$14,$15)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET observed_count = EXCLUDED.observed_count,
             observed_amount_minor = EXCLUDED.observed_amount_minor,
             detail = EXCLUDED.detail
         WHERE fraud_signal_findings.status IN ('OPEN', 'UNDER_REVIEW')
       RETURNING id, (xmax = 0) AS inserted`,
      [
        rule.id,
        rule.ruleKey,
        rule.signalType,
        subject.customerId,
        subject.walletId,
        observation.subjectReference,
        observation.observedCount,
        observation.observedAmountMinor,
        rule.thresholdCount,
        rule.thresholdAmountMinor,
        observation.currency,
        observation.detail,
        rule.severity,
        dedupeKey,
        now,
      ],
    );

    const row = this.rowsOf<{ id: string; inserted: boolean }>(result)[0];
    if (!row) return 0;

    // A refresh of an already-open finding is not a new finding. It is still audited, because the observed
    // values changing on a live finding is itself information.
    const isNew = row.inserted === true;

    await this.auditService.record(manager, {
      entityType: 'FRAUD_SIGNAL_FINDING',
      entityId: String(row.id),
      action: isNew ? 'FRAUD_SIGNAL_RAISED' : 'FRAUD_SIGNAL_REOBSERVED',
      actor: 'fraud-detection',
      newValues: {
        ruleKey: rule.ruleKey,
        signalType: rule.signalType,
        customerId: subject.customerId,
        walletId: subject.walletId,
        observedCount: observation.observedCount,
        observedAmountMinor: observation.observedAmountMinor,
        thresholdCount: rule.thresholdCount,
        thresholdAmountMinor: rule.thresholdAmountMinor,
        severity: rule.severity,
        escalation: rule.escalation,
      },
    });

    return isNew ? 1 : 0;
  }

  /**
   * Decides whether the facts trip the rule, and describes what was seen.
   *
   * Returns null when the rule does not fire. Comparison is strictly greater-than: a threshold of 100,000
   * means 100,000 is allowed, so a limit and a fraud threshold with the same number do not disagree by one.
   */
  private observe(
    rule: FraudSignalRule,
    facts: readonly TransactionFact[],
  ): {
    bucket: string;
    subjectReference: string | null;
    observedCount: number | null;
    observedAmountMinor: number | null;
    currency: string | null;
    detail: string;
  } | null {
    const first = facts[0];
    if (!first) return null;

    switch (rule.signalType) {
      case 'VELOCITY_COUNT': {
        if (rule.thresholdCount === null) return null;
        if (facts.length <= rule.thresholdCount) return null;
        return {
          bucket: String(rule.windowMinutes ?? 0),
          subjectReference: null,
          observedCount: facts.length,
          observedAmountMinor: facts.reduce((sum, fact) => sum + fact.amountMinor, 0),
          currency: first.currency,
          detail:
            `${facts.length} transfers in ${rule.windowMinutes ?? 0} minutes exceeds the configured ` +
            `threshold of ${rule.thresholdCount}`,
        };
      }
      case 'VELOCITY_AMOUNT': {
        if (rule.thresholdAmountMinor === null) return null;
        const total = facts.reduce((sum, fact) => sum + fact.amountMinor, 0);
        if (total <= rule.thresholdAmountMinor) return null;
        return {
          bucket: String(rule.windowMinutes ?? 0),
          subjectReference: null,
          observedCount: facts.length,
          observedAmountMinor: total,
          currency: first.currency,
          detail:
            `${total} minor units moved in ${rule.windowMinutes ?? 0} minutes exceeds the configured ` +
            `threshold of ${rule.thresholdAmountMinor}`,
        };
      }
      case 'DUPLICATE_SHAPE': {
        /*
         * Same amount to the same destination more than once inside the window.
         *
         * This is the double-submission and small-batch-fraud pattern. It is keyed on amount *and*
         * destination: two identical amounts to different people is a normal payday, the same amount to the
         * same person twice in minutes is not.
         */
        const shapes = new Map<string, TransactionFact[]>();
        for (const fact of facts) {
          const key = `${fact.amountMinor}:${fact.destinationWalletId ?? 'none'}`;
          const bucket = shapes.get(key);
          if (bucket) bucket.push(fact);
          else shapes.set(key, [fact]);
        }
        for (const [shape, bucket] of shapes) {
          const limit = rule.thresholdCount ?? 1;
          const exemplar = bucket[0];
          if (bucket.length <= limit || !exemplar) continue;
          return {
            bucket: shape,
            subjectReference: exemplar.id,
            observedCount: bucket.length,
            observedAmountMinor: exemplar.amountMinor,
            currency: exemplar.currency,
            detail:
              `${bucket.length} transfers of the same amount to the same destination within ` +
              `${rule.windowMinutes ?? 0} minutes`,
          };
        }
        return null;
      }
      case 'ROUND_AMOUNT': {
        /*
         * Large round amounts. Deliberately not a judgement: round amounts correlate with both structured
         * layering *and* ordinary salary and rent payments, so this fires as an observation for a human,
         * never as a block. "Round" is defined as a whole multiple of 10,000 minor units (100 naira), which
         * is a structural definition rather than a risk threshold.
         */
        const threshold = rule.thresholdAmountMinor;
        if (threshold === null) return null;
        const roundOnes = facts.filter((fact) => fact.amountMinor % 10_000 === 0);
        const qualifying = roundOnes.filter((fact) => fact.amountMinor >= threshold);
        const exemplar = qualifying[0];
        if (qualifying.length <= (rule.thresholdCount ?? 0) || !exemplar) return null;
        return {
          bucket: 'round',
          subjectReference: exemplar.id,
          observedCount: qualifying.length,
          observedAmountMinor: qualifying.reduce((sum, fact) => sum + fact.amountMinor, 0),
          currency: exemplar.currency,
          detail: `${qualifying.length} transfers of round amounts at or above ${rule.thresholdAmountMinor}`,
        };
      }
      case 'NEW_DESTINATION': {
        /*
         * Not implemented, and reported as such rather than approximated.
         *
         * Deciding that a destination is "new" requires a durable first-seen history per source, which means
         * storing a long-lived relationship graph. Writing an approximation here (for example, "no earlier
         * transfer in this window") would fire on every quiet customer's first payment of the day and be
         * actively harmful. The rule type exists so the decision can be made deliberately; until then a
         * rule of this type never fires.
         */
        return null;
      }
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Run ledger
  // ---------------------------------------------------------------------------------------------

  private async openRun(evaluator: string): Promise<string> {
    const result: unknown = await this.dataSource.query(
      `INSERT INTO fraud_evaluation_runs (evaluator, status)
       VALUES ($1, 'RUNNING')
       RETURNING id`,
      [evaluator.slice(0, 160)],
    );
    const id = this.rowsOf<{ id: string }>(result)[0]?.id;
    if (!id) throw new Error('fraud_evaluation_runs insert returned no id');
    return String(id);
  }

  private async completeRun(
    runId: string,
    outcome: {
      rulesEvaluated: number;
      subjectsEvaluated: number;
      findingsWritten: number;
      status: 'PASS' | 'ERROR';
      errorDetail: string | null;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE fraud_evaluation_runs
          SET completed_at = now(),
              rules_evaluated = $2,
              subjects_evaluated = $3,
              findings_written = $4,
              status = $5,
              error_detail = $6
        WHERE id = $1`,
      [
        runId,
        outcome.rulesEvaluated,
        outcome.subjectsEvaluated,
        outcome.findingsWritten,
        outcome.status,
        outcome.errorDetail,
      ],
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private subjectKey(customerId: string | null, walletId: string | null): string {
    return customerId ?? walletId ?? 'unknown';
  }

  /** Unwraps a TypeORM `query()` result into plain rows. */
  private rowsOf<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
    return result as T[];
  }

  private toFinding(row: FindingRow): FraudFinding {
    return {
      id: row.id,
      ruleKey: row.rule_key,
      signalType: row.signal_type as FraudSignalType,
      customerId: row.customer_id,
      walletId: row.wallet_id,
      subjectReference: row.subject_reference,
      observedCount: row.observed_count,
      observedAmountMinor:
        row.observed_amount_minor === null ? null : Number(row.observed_amount_minor),
      thresholdCount: row.threshold_count,
      thresholdAmountMinor:
        row.threshold_amount_minor === null ? null : Number(row.threshold_amount_minor),
      currency: row.currency,
      detail: row.detail,
      severity: row.severity,
      status: row.status,
      detectedAt: new Date(row.detected_at).toISOString(),
    };
  }
}
