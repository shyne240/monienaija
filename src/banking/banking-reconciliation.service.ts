import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

/**
 * Reconciliation.
 *
 * The design constraint is unusual for software and completely ordinary for money: this service has
 * **no ability to change a financial record**. It observes what the provider reports, compares it to
 * what we hold, and raises exceptions. It never posts, never adjusts, and never "fixes" a difference.
 *
 * That is not an oversight of scope. A reconciliation process with write access to balances is how
 * unexplained differences become explained ones by fiat. Here the only outcomes are:
 *
 * - agreement (recorded as an observation, no exception);
 * - a difference (recorded as an observation plus one open exception per subject and kind);
 * - inability to check (recorded as `UNVERIFIABLE`, which is an exception, not a pass).
 *
 * The last one matters most. A provider capability that does not exist — Monnify's settlement
 * verification, for instance — must surface as a loud exception rather than being skipped, because a
 * reconciliation that silently covers less than it claims is worse than none at all.
 */

export type ExceptionKind =
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'MISSING_AT_PROVIDER'
  | 'MISSING_INTERNALLY'
  | 'DUPLICATE_AT_PROVIDER'
  | 'UNVERIFIABLE';

export interface SubjectCheck {
  subjectType: 'INBOUND_PAYMENT' | 'OUTBOUND_OPERATION' | 'VIRTUAL_ACCOUNT' | 'SETTLEMENT';
  subjectReference: string;
  /** What our records say. `null` when we hold nothing for this subject. */
  internal: { amountMinor: string | null; state: string | null } | null;
  /** What the provider says. `null` when the provider has no record. */
  provider: { amountMinor: string | null; status: string | null; reference: string | null } | null;
  /** Set when the check could not be performed at all. */
  unverifiableReason?: string;
}

@Injectable()
export class BankingReconciliationService {
  private readonly logger = new Logger(BankingReconciliationService.name);

  constructor(private readonly db: DataSource) {}

  async startRun(input: {
    institutionId: string;
    providerKey: string;
    environment: 'sandbox' | 'production';
  }): Promise<string> {
    const rows = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO banking_reconciliation_runs(institution_id,provider_key,environment)
       VALUES($1,$2,$3) RETURNING id`,
      [input.institutionId, input.providerKey, input.environment],
    );
    return rows[0]!.id;
  }

  async completeRun(
    runId: string,
    state: 'COMPLETED' | 'FAILED' | 'ABANDONED',
    failureCode?: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE banking_reconciliation_runs
          SET state=$2,completed_at=clock_timestamp(),failure_code=$3
        WHERE id=$1 AND state='RUNNING'`,
      [runId, state, failureCode?.slice(0, 64) ?? null],
    );
  }

  /**
   * Records one subject check and raises an exception if the evidence disagrees.
   *
   * Returns the exception id when one was raised, so a caller can report how many problems a run
   * found rather than how many subjects it looked at.
   */
  async observe(
    runId: string,
    institutionId: string,
    check: SubjectCheck,
  ): Promise<{ observationId: string; exceptionId: string | null; kind: ExceptionKind | null }> {
    const run = await this.db.query<Array<{ provider_key: string; environment: string }>>(
      'SELECT provider_key,environment FROM banking_reconciliation_runs WHERE id=$1',
      [runId],
    );
    const meta = run[0];
    if (!meta) throw new Error('Reconciliation run not found');

    const observationRows = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO banking_provider_observations
        (institution_id,run_id,provider_key,environment,subject_type,subject_reference,
         provider_status,provider_amount_minor,provider_reference)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        institutionId,
        runId,
        meta.provider_key,
        meta.environment,
        check.subjectType,
        check.subjectReference,
        check.provider?.status ?? null,
        check.provider?.amountMinor ?? null,
        check.provider?.reference ?? null,
      ],
    );
    const observationId = observationRows[0]!.id;

    const kind = this.classify(check);
    if (!kind) {
      // The observation still counts toward the run. Counting only subjects that raised a problem
      // would make a run that checked a thousand clean records look like a run that checked none.
      await this.db.query(
        `UPDATE banking_reconciliation_runs SET observations=observations+1 WHERE id=$1`,
        [runId],
      );
      return { observationId, exceptionId: null, kind: null };
    }

    const detail = this.describe(check, kind);
    const severity =
      kind === 'UNVERIFIABLE' ? 'REVIEW' : kind === 'AMOUNT_MISMATCH' ? 'CRITICAL' : 'REVIEW';

    // One open exception per subject and kind. `ON CONFLICT DO NOTHING` relies on the partial unique
    // index, so repeated runs observe the difference again without duplicating the question.
    const inserted = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO banking_reconciliation_exceptions
        (institution_id,run_id,observation_id,subject_type,subject_reference,kind,
         internal_amount_minor,provider_amount_minor,detail,severity)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (institution_id,subject_type,subject_reference,kind)
         WHERE state <> 'RESOLVED' DO NOTHING
       RETURNING id`,
      [
        institutionId,
        runId,
        observationId,
        check.subjectType,
        check.subjectReference,
        kind,
        check.internal?.amountMinor ?? null,
        check.provider?.amountMinor ?? null,
        detail,
        severity,
      ],
    );

    await this.db.query(
      `UPDATE banking_reconciliation_runs
          SET observations=observations+1,
              exceptions_raised=exceptions_raised+CASE WHEN $2 THEN 1 ELSE 0 END
        WHERE id=$1`,
      [runId, inserted.length > 0],
    );

    if (inserted[0]) {
      this.logger.warn(
        `Reconciliation exception ${kind} for ${check.subjectType} ${check.subjectReference}`,
      );
    }
    return { observationId, exceptionId: inserted[0]?.id ?? null, kind };
  }

  /**
   * Classifies the difference.
   *
   * Order matters: an unverifiable check is reported as such before any comparison, because comparing
   * against missing evidence would manufacture a mismatch.
   */
  private classify(check: SubjectCheck): ExceptionKind | null {
    if (check.unverifiableReason) return 'UNVERIFIABLE';
    if (!check.provider) return 'MISSING_AT_PROVIDER';
    if (!check.internal) return 'MISSING_INTERNALLY';
    if (
      check.internal.amountMinor !== null &&
      check.provider.amountMinor !== null &&
      check.internal.amountMinor !== check.provider.amountMinor
    ) {
      return 'AMOUNT_MISMATCH';
    }
    if (
      check.internal.state !== null &&
      check.provider.status !== null &&
      check.internal.state !== check.provider.status
    ) {
      return 'STATUS_MISMATCH';
    }
    return null;
  }

  private describe(check: SubjectCheck, kind: ExceptionKind): string {
    if (kind === 'UNVERIFIABLE') {
      return `Could not verify: ${check.unverifiableReason ?? 'unknown reason'}`.slice(0, 500);
    }
    if (kind === 'MISSING_AT_PROVIDER') {
      return 'Provider has no record of this subject; not assumed to have failed'.slice(0, 500);
    }
    if (kind === 'MISSING_INTERNALLY') {
      return 'Provider reports a subject we hold no record of'.slice(0, 500);
    }
    if (kind === 'AMOUNT_MISMATCH') {
      return `Internal ${check.internal?.amountMinor ?? '?'} versus provider ${check.provider?.amountMinor ?? '?'}`.slice(
        0,
        500,
      );
    }
    return `Internal state ${check.internal?.state ?? '?'} versus provider status ${check.provider?.status ?? '?'}`.slice(
      0,
      500,
    );
  }

  /**
   * Resolves an exception with a reason.
   *
   * There is no `adjust()`, no `markMatched()` that changes money, and no ability to alter the amounts
   * that raised the exception. `ACCEPTED_DIFFERENCE` records a human's decision to live with a known
   * difference; it does not make the difference disappear from the ledger, because the ledger was
   * never touched.
   */
  async resolve(
    exceptionId: string,
    resolution: 'MATCHED' | 'ACCEPTED_DIFFERENCE' | 'ESCALATED',
    resolvedBy: string,
    note: string,
  ): Promise<void> {
    if (note.trim().length < 3) throw new Error('A resolution note is required');
    if (resolution === 'ESCALATED') {
      await this.db.query(
        `UPDATE banking_reconciliation_exceptions
            SET state='INVESTIGATING',resolved_by=$2,resolution_note=$3
          WHERE id=$1 AND state IN ('OPEN','INVESTIGATING')`,
        [exceptionId, resolvedBy, note.slice(0, 500)],
      );
      return;
    }
    await this.db.query(
      `UPDATE banking_reconciliation_exceptions
          SET state='RESOLVED',resolution=$2,resolved_by=$3,resolved_at=clock_timestamp(),
              resolution_note=$4
        WHERE id=$1 AND state IN ('OPEN','INVESTIGATING')`,
      [exceptionId, resolution, resolvedBy, note.slice(0, 500)],
    );
  }

  /** The exception worklist, ordered so the worst problems are seen first. */
  async openExceptions(institutionId: string, limit = 100) {
    return this.db.query<
      Array<{
        id: string;
        kind: ExceptionKind;
        subject_type: string;
        subject_reference: string;
        severity: string;
        detail: string;
        created_at: Date;
      }>
    >(
      `SELECT id,kind,subject_type,subject_reference,severity,detail,created_at
         FROM banking_reconciliation_exceptions
        WHERE institution_id=$1 AND state <> 'RESOLVED'
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END,
                 created_at
        LIMIT $2`,
      [institutionId, Math.min(Math.max(limit, 1), 500)],
    );
  }
}
