/**
 * ARENA 3D Group 19 — alert evaluation, deduplication and flapping suppression.
 *
 * ## Why the suppression logic is the substance of this group
 *
 * Deciding *what* is wrong is the easy half. The hard half — and the half that determines whether an alerting
 * system survives its first month — is not repeating itself until it is ignored.
 *
 * Two mechanisms, both deliberately conservative:
 *
 * 1. **Deduplication by condition, not by occurrence.** An alert's `dedupeKey` identifies the *condition*
 *    (`worker.stale:banking-dispatch`), not the observation. The same condition re-observed is one alert
 *    with a repeat count, not two alerts.
 * 2. **Flapping suppression.** A condition that clears and returns within `flapWindowMs` is the same
 *    incident. Alerting on every transition of a check that oscillates produces a stream nobody reads and
 *    trains operators to ignore the channel — which then also hides the real incident.
 *
 * ## What it does not do
 *
 * No delivery guarantee, no retry of failed delivery, no escalation policy, no on-call rotation, no
 * acknowledgement workflow. Those belong to whatever paging product an operator eventually selects, and
 * inventing a half-version here would be worse than the seam.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { IntegrityMonitoringService } from './integrity-monitoring.service';
import { WorkerLeaseService } from './worker-lease.service';
import { WorkerSupervisorService } from './worker-supervisor.service';
import {
  ALERT_RULES,
  type Alert,
  type AlertChannel,
  type AlertEvaluation,
  type AlertRuleId,
  type AlertSeverity,
  type AlertUrgency,
} from './alerting.types';

/** DI tokens for the two interface-typed optional dependencies. */
export const ALERT_CHANNEL = 'ARENA3D_ALERT_CHANNEL';
export const ALERT_TUNING = 'ARENA3D_ALERT_TUNING';

/** Default channel: records the alert and delivers nothing. The honest default for an unconfigured system. */
export class NoneAlertChannel implements AlertChannel {
  readonly name = 'none';
  readonly configured = false;

  deliver(): Promise<{ delivered: boolean; reason?: string }> {
    return Promise.resolve({
      delivered: false,
      reason: 'no alert channel is configured; the alert was evaluated and recorded only',
    });
  }
}

export interface AlertTuning {
  /** Backlog age beyond which the outbox is considered a problem. Not a guess: configured, no default. */
  outboxBacklogAgeSeconds?: number;
  /** Backlog depth beyond which the outbox is a problem. Configured, no default. */
  outboxBacklogDepth?: number;
  /** How long an integrity failure may persist before it is escalated as stale. */
  integrityStaleFailureSeconds?: number;
  /** Window within which a cleared condition that returns is treated as the same incident. */
  flapWindowMs?: number;
}

interface SuppressionRecord {
  dedupeKey: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Set when the condition was observed as cleared. Used for flap detection. */
  clearedAt: number | null;
  suppressed: number;
  lastAlert: Alert;
}

export interface AlertStateView {
  dedupeKey: string;
  ruleId: AlertRuleId;
  firstSeenAt: string;
  lastSeenAt: string;
  suppressedRepeats: number;
  summary: string;
}

export interface DispatchResult {
  evaluation: AlertEvaluation;
  /** Alerts that passed suppression and were offered to the channel. */
  dispatched: Array<{ alert: Alert; delivered: boolean; reason?: string }>;
  /** Conditions re-observed and therefore not re-sent. */
  suppressed: Array<{ dedupeKey: string; repeats: number }>;
}

@Injectable()
export class AlertingService {
  private readonly channel: AlertChannel;
  private readonly tuning: AlertTuning;
  private readonly suppressions = new Map<string, SuppressionRecord>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly leases: WorkerLeaseService,
    private readonly supervisor: WorkerSupervisorService,
    private readonly integrity: IntegrityMonitoringService,
    /*
     * `channel` and `tuning` are interfaces, so they carry no runtime token and Nest would try to resolve
     * them as providers (`Object`), which fails. `@Inject` with a string token is what makes the optional
     * injection resolvable: a deployment that provides `ALERT_CHANNEL` gets a real channel, and one that does
     * not falls back to the dark default under `@Optional()`.
     */
    @Optional() @Inject(ALERT_CHANNEL) channel?: AlertChannel,
    @Optional() @Inject(ALERT_TUNING) tuning?: AlertTuning,
  ) {
    this.channel = channel ?? new NoneAlertChannel();
    this.tuning = tuning ?? {};
  }

  /**
   * Evaluates every rule.
   *
   * Each source is attempted independently: a database problem must not silence worker alerts, because those
   * are usually the ones that explain the database problem.
   */
  async evaluate(): Promise<AlertEvaluation> {
    const alerts: Alert[] = [];
    const satisfied: AlertRuleId[] = [];
    const skipped: Array<{ ruleId: AlertRuleId; reason: string }> = [];
    const observedAt = new Date().toISOString();

    // --- Outbox rules (Group 14 / 17) ---
    try {
      const health = await this.leases.health(this.dataSource.manager);

      if (health.deadLettered > 0) {
        alerts.push({
          ruleId: ALERT_RULES.OUTBOX_DEAD_LETTERS,
          // Severity from magnitude, urgency from newness: dead letters present at all is a real signal, but
          // a stable backlog is not a page.
          severity: health.deadLettered >= 10 ? 'CRITICAL' : 'WARNING',
          urgency: 'ROUTINE',
          summary: `${health.deadLettered} outbox event(s) exhausted their delivery ceiling`,
          dedupeKey: `${ALERT_RULES.OUTBOX_DEAD_LETTERS}`,
          context: { deadLettered: health.deadLettered },
          observedAt,
        });
      } else {
        satisfied.push(ALERT_RULES.OUTBOX_DEAD_LETTERS);
      }

      if (health.stalled > 0) {
        alerts.push({
          ruleId: ALERT_RULES.OUTBOX_STALLED_LEASES,
          severity: 'CRITICAL',
          // Stalled leases mean a worker is dying mid-delivery *right now*. Work is not lost — the lease
          // expires and the row is reclaimable — but it is being repeated, so this interrupts.
          urgency: 'IMMEDIATE',
          summary: `${health.stalled} claimed outbox event(s) have an expired lease`,
          dedupeKey: `${ALERT_RULES.OUTBOX_STALLED_LEASES}`,
          context: { stalled: health.stalled },
          observedAt,
        });
      } else {
        satisfied.push(ALERT_RULES.OUTBOX_STALLED_LEASES);
      }

      const backlogAlerts = this.evaluateBacklog(health, observedAt);
      if (backlogAlerts) alerts.push(backlogAlerts);
      else satisfied.push(ALERT_RULES.OUTBOX_BACKLOG);
    } catch {
      skipped.push({
        ruleId: ALERT_RULES.OUTBOX_DEAD_LETTERS,
        reason: 'outbox state could not be read',
      });
      skipped.push({
        ruleId: ALERT_RULES.OUTBOX_STALLED_LEASES,
        reason: 'outbox state could not be read',
      });
      skipped.push({
        ruleId: ALERT_RULES.OUTBOX_BACKLOG,
        reason: 'outbox state could not be read',
      });
    }

    // --- Worker rules (Group 15 / 17) ---
    const report = this.supervisor.report();
    if (report.status === 'indeterminate') {
      alerts.push({
        ruleId: ALERT_RULES.WORKER_SUPERVISION_INDETERMINATE,
        severity: 'WARNING',
        urgency: 'ROUTINE',
        summary: 'worker supervision measured nothing in this process',
        dedupeKey: `${ALERT_RULES.WORKER_SUPERVISION_INDETERMINATE}`,
        context: {
          disabled: report.disabled.length,
          neverObserved: report.neverObserved.length,
        },
        observedAt,
      });
    } else {
      satisfied.push(ALERT_RULES.WORKER_SUPERVISION_INDETERMINATE);
    }

    for (const worker of report.workers) {
      if (worker.state === 'FAILING') {
        alerts.push({
          ruleId: ALERT_RULES.WORKER_FAILING,
          severity: 'WARNING',
          urgency: worker.consecutiveFailures >= 3 ? 'IMMEDIATE' : 'ROUTINE',
          summary: `worker ${worker.name} has failed ${worker.consecutiveFailures} consecutive tick(s)`,
          dedupeKey: `${ALERT_RULES.WORKER_FAILING}:${worker.name}`,
          context: {
            worker: worker.name,
            consecutiveFailures: worker.consecutiveFailures,
            lastError: worker.lastError,
          },
          observedAt,
        });
      }
      if (worker.state === 'STALE') {
        alerts.push({
          ruleId: ALERT_RULES.WORKER_STALE,
          severity: 'CRITICAL',
          urgency: 'IMMEDIATE',
          summary: `worker ${worker.name} has not completed a tick within its grace window`,
          dedupeKey: `${ALERT_RULES.WORKER_STALE}:${worker.name}`,
          context: {
            worker: worker.name,
            pollIntervalMs: worker.pollIntervalMs,
            lastCompletedAt: worker.lastCompletedAt,
          },
          observedAt,
        });
      }
    }

    // --- Integrity rules (Group 18) ---
    try {
      const passes = await this.integrity.lastPasses();
      const staleAfter = this.tuning.integrityStaleFailureSeconds;
      let staleEmitted = false;
      for (const entry of passes) {
        if (entry.lastStatus === 'PASS') continue;
        if (staleAfter !== undefined && entry.lastPassedAt !== null) {
          const failingForMs = Date.now() - new Date(entry.lastPassedAt).getTime();
          if (failingForMs > staleAfter * 1000) {
            staleEmitted = true;
            alerts.push({
              ruleId: ALERT_RULES.INTEGRITY_STALE_FAILURE,
              severity: 'CRITICAL',
              // A long-standing failure is severe but is not a new incident; interrupting every pass for it is
              // exactly what trains operators to ignore the channel.
              urgency: 'ROUTINE',
              summary: `integrity check ${entry.checkName} has been failing beyond tolerance`,
              dedupeKey: `${ALERT_RULES.INTEGRITY_STALE_FAILURE}:${entry.checkName}`,
              context: {
                check: entry.checkName,
                lastStatus: entry.lastStatus,
                lastPassedAt: entry.lastPassedAt,
              },
              observedAt,
            });
          }
        }
      }
      if (!staleEmitted) satisfied.push(ALERT_RULES.INTEGRITY_STALE_FAILURE);
      // A regression alert is produced by the integrity endpoint itself, which has the drift comparison; this
      // service does not re-run reconciliation on a timer, because doing so would make alerting a second
      // caller of a read-only scan with its own cost and its own failure modes.
      skipped.push({
        ruleId: ALERT_RULES.INTEGRITY_REGRESSION,
        reason: 'regressions are reported by /internal/integrity at the point of evaluation',
      });
    } catch {
      skipped.push({
        ruleId: ALERT_RULES.INTEGRITY_STALE_FAILURE,
        reason: 'integrity history could not be read',
      });
    }

    return { evaluatedAt: observedAt, alerts, satisfied, skipped };
  }

  /**
   * Evaluates, applies suppression, and offers survivors to the channel.
   *
   * Suppression runs here rather than in `evaluate()` so the evaluation stays a pure description of the
   * current state — useful for inspection — while dispatch has the side effects.
   */
  async dispatch(): Promise<DispatchResult> {
    const evaluation = await this.evaluate();
    const now = Date.now();
    const flapWindowMs = this.tuning.flapWindowMs ?? 5 * 60 * 1000;

    const activeKeys = new Set(evaluation.alerts.map((alert) => alert.dedupeKey));

    // Mark conditions that have cleared. Kept for the flap window rather than deleted, so a quick return is
    // recognised as the same incident.
    for (const [key, record] of this.suppressions) {
      if (!activeKeys.has(key) && record.clearedAt === null) {
        record.clearedAt = now;
      }
    }

    const dispatched: DispatchResult['dispatched'] = [];
    const suppressed: DispatchResult['suppressed'] = [];

    for (const alert of evaluation.alerts) {
      const existing = this.suppressions.get(alert.dedupeKey);
      if (existing && existing.clearedAt === null) {
        // Same condition, still active: count the repeat, do not re-send.
        existing.lastSeenAt = now;
        existing.suppressed += 1;
        suppressed.push({ dedupeKey: alert.dedupeKey, repeats: existing.suppressed });
        continue;
      }
      if (existing && existing.clearedAt !== null && now - existing.clearedAt < flapWindowMs) {
        // Cleared and returned inside the flap window: the same incident, not a new one.
        existing.clearedAt = null;
        existing.lastSeenAt = now;
        existing.suppressed += 1;
        suppressed.push({ dedupeKey: alert.dedupeKey, repeats: existing.suppressed });
        continue;
      }

      const record: SuppressionRecord = {
        dedupeKey: alert.dedupeKey,
        firstSeenAt: now,
        lastSeenAt: now,
        clearedAt: null,
        suppressed: 0,
        lastAlert: alert,
      };
      this.suppressions.set(alert.dedupeKey, record);

      const outcome = await this.channel.deliver(alert);
      dispatched.push({
        alert,
        delivered: outcome.delivered,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      });
    }

    // Drop records whose flap window has fully elapsed, so the map does not grow without bound.
    for (const [key, record] of this.suppressions) {
      if (record.clearedAt !== null && now - record.clearedAt >= flapWindowMs) {
        this.suppressions.delete(key);
      }
    }

    return { evaluation, dispatched, suppressed };
  }

  /** Whether the configured channel can reach a human. `false` means alerts are recorded only. */
  get deliveryConfigured(): boolean {
    return this.channel.configured;
  }

  get channelName(): string {
    return this.channel.name;
  }

  /**
   * Currently suppressed conditions.
   *
   * Exposed because silence is ambiguous: "no alert" and "alert suppressed as a repeat" must be
   * distinguishable, or an operator cannot tell whether the system is quiet or muted.
   */
  activeState(): AlertStateView[] {
    return [...this.suppressions.values()]
      .filter((record) => record.clearedAt === null)
      .map((record) => ({
        dedupeKey: record.dedupeKey,
        ruleId: record.lastAlert.ruleId,
        firstSeenAt: new Date(record.firstSeenAt).toISOString(),
        lastSeenAt: new Date(record.lastSeenAt).toISOString(),
        suppressedRepeats: record.suppressed,
        summary: record.lastAlert.summary,
      }));
  }

  private evaluateBacklog(
    health: { pending: number; oldestPendingAgeSeconds: number | null },
    observedAt: string,
  ): Alert | null {
    const depthLimit = this.tuning.outboxBacklogDepth;
    const ageLimit = this.tuning.outboxBacklogAgeSeconds;
    // Both thresholds are configuration. With neither set the rule is satisfied, and the runbook says so:
    // inventing a backlog threshold would be inventing an operational policy nobody agreed to.
    if (depthLimit === undefined && ageLimit === undefined) return null;

    const overDepth = depthLimit !== undefined && health.pending > depthLimit;
    const overAge =
      ageLimit !== undefined &&
      health.oldestPendingAgeSeconds !== null &&
      health.oldestPendingAgeSeconds > ageLimit;
    if (!overDepth && !overAge) return null;

    return {
      ruleId: ALERT_RULES.OUTBOX_BACKLOG,
      severity: 'WARNING',
      urgency: 'ROUTINE',
      summary: 'outbox backlog exceeds the configured tolerance',
      dedupeKey: `${ALERT_RULES.OUTBOX_BACKLOG}`,
      context: {
        pending: health.pending,
        oldestPendingAgeSeconds: health.oldestPendingAgeSeconds,
        depthLimit: depthLimit ?? null,
        ageLimit: ageLimit ?? null,
      },
      observedAt,
    };
  }
}

/** Severity ordering helper, exported so a caller can sort or filter without restating the order. */
export function severityRank(severity: AlertSeverity): number {
  return severity === 'CRITICAL' ? 3 : severity === 'WARNING' ? 2 : 1;
}

/** Urgency ordering helper. */
export function urgencyRank(urgency: AlertUrgency): number {
  return urgency === 'IMMEDIATE' ? 3 : urgency === 'ROUTINE' ? 2 : 1;
}
