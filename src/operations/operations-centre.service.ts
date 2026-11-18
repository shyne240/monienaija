/**
 * ARENA 3D Group 20 — the operations centre: one view of what needs attention.
 *
 * ## Why this exists
 *
 * By Group 19 this system could answer many specific questions — queue depth, dead letters, worker health,
 * integrity drift, alert conditions — but each behind its own endpoint. An operator starting a shift had to
 * know which of a dozen endpoints to call, in what order, and how to combine the answers. That is not an
 * operations centre; it is a filing cabinet.
 *
 * This service aggregates **the signals built in Groups 14–19** into a single ranked list of things needing
 * attention, plus a clear statement of what could not be determined.
 *
 * ## The design rule
 *
 * **Nothing here decides anything new.** Every item is derived from a service that already owns the verdict:
 *
 *  - integrity verdicts come from `IntegrityMonitoringService` (Group 18), including its drift comparison;
 *  - worker states come from `WorkerSupervisorService` (Group 15);
 *  - queue signals come from `WorkerLeaseService` (Group 14);
 *  - conditions come from `AlertingService` (Group 19), which already deduplicates and classifies urgency.
 *
 * Re-deriving any of these here would create a second source of truth that can disagree with the endpoint an
 * operator is also looking at. The centre ranks and presents; it does not adjudicate.
 *
 * ## It is a read surface, and says so
 *
 * No mutation, no remediation, no acknowledge, no "resolve". Those require an audited write path with its own
 * authority decision (Groups 21–22), and offering a button that half-works would be worse than offering none.
 */
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { EmergencyAccessReviewService } from '../authorization/emergency-access-review.service';
import type { FraudDetectionService } from '../fraud/fraud-detection.service';
import { AlertingService } from './alerting.service';
import type { Alert, AlertUrgency } from './alerting.types';
import { IntegrityMonitoringService } from './integrity-monitoring.service';
import { WorkerLeaseService } from './worker-lease.service';
import { WorkerSupervisorService } from './worker-supervisor.service';

/** One thing an operator may need to act on. */
export interface AttentionItem {
  /** Stable identifier for this item, so repeated polls do not look like new items. */
  id: string;
  /** Which subsystem produced it. Fixed set; dashboards and filters key on this. */
  area: 'INTEGRITY' | 'QUEUE' | 'WORKER' | 'SUPERVISION' | 'SECURITY' | 'FRAUD';
  urgency: AlertUrgency;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  summary: string;
  /** Bounded context. No identifiers, no secrets. */
  context: Record<string, string | number | boolean | null>;
}

/** A subsystem that could not be read. Distinct from "healthy". */
export interface UnavailableArea {
  area: AttentionItem['area'];
  reason: string;
}

export interface OperationsCentreView {
  generatedAt: string;
  /**
   * True only when every source was read and nothing needs attention. A `true` here means "measured and
   * clear" — never "not measured".
   */
  clear: boolean;
  /** When the whole picture could not be determined because at least one source failed. */
  partial: boolean;
  items: AttentionItem[];
  unavailable: UnavailableArea[];
  counts: { immediate: number; routine: number; info: number };
  /** Explicit statement of what this view does and does not do. */
  scope: string;
}

const URGENCY_ORDER: Record<AlertUrgency, number> = { IMMEDIATE: 3, ROUTINE: 2, INFO: 1 };
const SEVERITY_ORDER: Record<Alert['severity'], number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };

@Injectable()
export class OperationsCentreService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly leases: WorkerLeaseService,
    private readonly supervisor: WorkerSupervisorService,
    private readonly integrity: IntegrityMonitoringService,
    private readonly alerting: AlertingService,
    /*
     * Group 21. Optional because the operations centre must remain constructible without the authorization
     * module (its unit tests and the read-surface wiring both do this), and because an unreviewed emergency
     * access is an additional signal rather than a precondition for the centre working at all.
     */
    @Optional() private readonly emergencyReviews?: EmergencyAccessReviewService,
    /*
     * Group 22. Optional for the same reason: the centre must stay constructible without the fraud module,
     * and fraud findings are an additional signal rather than a precondition for the centre working.
     */
    @Optional() private readonly fraud?: FraudDetectionService,
  ) {}

  async view(): Promise<OperationsCentreView> {
    const items: AttentionItem[] = [];
    const unavailable: UnavailableArea[] = [];

    // --- Integrity: when each check last passed, and what is failing now (Group 18) ---
    try {
      const passes = await this.integrity.lastPasses();
      for (const entry of passes) {
        if (entry.lastStatus === 'PASS') continue;
        items.push({
          id: `integrity:${entry.checkName}`,
          area: 'INTEGRITY',
          // A failing integrity check is never `INFO`: it means the books may not add up.
          urgency: entry.lastPassedAt === null ? 'IMMEDIATE' : 'ROUTINE',
          severity: entry.lastStatus === 'ERROR' ? 'CRITICAL' : 'WARNING',
          summary: `integrity check ${entry.checkName} is ${entry.lastStatus}`,
          context: {
            check: entry.checkName,
            lastStatus: entry.lastStatus,
            lastPassedAt: entry.lastPassedAt,
          },
        });
      }
    } catch {
      unavailable.push({ area: 'INTEGRITY', reason: 'integrity history could not be read' });
    }

    // --- Queue: depth, dead letters, stalled leases (Group 14) ---
    try {
      const health = await this.leases.health(this.dataSource.manager);
      if (health.deadLettered > 0) {
        items.push({
          id: 'queue:dead-letters',
          area: 'QUEUE',
          urgency: 'ROUTINE',
          severity: health.deadLettered >= 10 ? 'CRITICAL' : 'WARNING',
          summary: `${health.deadLettered} outbox event(s) exhausted their delivery ceiling`,
          context: { deadLettered: health.deadLettered },
        });
      }
      if (health.stalled > 0) {
        items.push({
          id: 'queue:stalled-leases',
          area: 'QUEUE',
          urgency: 'IMMEDIATE',
          severity: 'CRITICAL',
          summary: `${health.stalled} claimed outbox event(s) have an expired lease`,
          context: { stalled: health.stalled },
        });
      }
    } catch {
      unavailable.push({ area: 'QUEUE', reason: 'outbox queue state could not be read' });
    }

    // --- Workers: state per worker (Group 15) ---
    const report = this.supervisor.report();
    for (const worker of report.workers) {
      if (worker.state === 'FAILING' || worker.state === 'STALE') {
        items.push({
          id: `worker:${worker.name}:${worker.state}`,
          area: 'WORKER',
          urgency: worker.state === 'STALE' ? 'IMMEDIATE' : 'ROUTINE',
          severity: worker.state === 'STALE' ? 'CRITICAL' : 'WARNING',
          summary: `worker ${worker.name} is ${worker.state.toLowerCase()}`,
          context: {
            worker: worker.name,
            state: worker.state,
            consecutiveFailures: worker.consecutiveFailures,
            lastCompletedAt: worker.lastCompletedAt,
          },
        });
      }
    }
    if (report.status === 'indeterminate') {
      items.push({
        id: 'supervision:indeterminate',
        area: 'SUPERVISION',
        urgency: 'ROUTINE',
        severity: 'WARNING',
        summary: 'no worker was observed in this process — nothing has been measured',
        context: {
          disabled: report.disabled.length,
          neverObserved: report.neverObserved.length,
        },
      });
    }

    // --- Security: emergency access owing a post-incident review (Group 21) ---
    if (this.emergencyReviews) {
      try {
        const posture = await this.emergencyReviews.posture();
        if (posture.pending > 0) {
          const oldest = posture.oldestAwaitingSeconds;
          items.push({
            id: 'security:emergency-review-owed',
            area: 'SECURITY',
            /*
             * Urgency escalates with age, not with count.
             *
             * One unreviewed emergency access forgotten for a week is a worse signal than five reviewed
             * promptly — an un-reviewed break-glass window is how a temporary emergency grant becomes a
             * permanent one. After 24 hours it interrupts.
             */
            urgency: oldest !== null && oldest >= 86_400 ? 'IMMEDIATE' : 'ROUTINE',
            severity: 'WARNING',
            summary: `${posture.pending} emergency access window(s) owe a post-incident review`,
            context: { pending: posture.pending, oldestAwaitingSeconds: oldest },
          });
        }
      } catch {
        unavailable.push({
          area: 'SECURITY',
          reason: 'emergency access review state could not be read',
        });
      }
    }

    // --- Fraud (Group 22): open findings, and whether detection is actually running ---
    if (this.fraud) {
      try {
        const posture = await this.fraud.detectionPosture();
        /*
         * Detection that has never passed is reported as unavailable, not as clean.
         *
         * This is the Group 18 distinction applied to fraud: "no findings" and "we did not look" look
         * identical in a findings count, and only the second one is dangerous. A deployment with no rules
         * configured, or an evaluator that stopped, would otherwise report a quiet fraud posture forever.
         */
        if (posture.lastPassAt === null) {
          unavailable.push({
            area: 'FRAUD',
            reason:
              posture.lastStatus === 'ERROR'
                ? 'fraud detection last ran and failed'
                : 'fraud detection has never completed',
          });
        } else {
          if (posture.openFindings > 0) {
            items.push({
              id: 'fraud:open-findings',
              area: 'FRAUD',
              urgency: posture.openFindings >= 10 ? 'IMMEDIATE' : 'ROUTINE',
              severity: 'WARNING',
              summary: `${posture.openFindings} unreviewed fraud finding(s)`,
              context: {
                openFindings: posture.openFindings,
                secondsSinceLastPass: posture.secondsSinceLastPass,
              },
            });
          }
          /*
           * Staleness is reported separately from volume. An evaluator that last passed days ago is a
           * detection outage even when it found nothing, and burying that inside the findings item would
           * make "no findings" look like good news.
           */
          if (posture.secondsSinceLastPass !== null && posture.secondsSinceLastPass >= 86_400) {
            items.push({
              id: 'fraud:detection-stale',
              area: 'FRAUD',
              urgency: 'IMMEDIATE',
              severity: 'WARNING',
              summary: 'fraud detection has not completed in over 24 hours',
              context: { secondsSinceLastPass: posture.secondsSinceLastPass },
            });
          }
        }
      } catch {
        unavailable.push({
          area: 'FRAUD',
          reason: 'fraud detection state could not be read',
        });
      }
    }

    // --- Alerts (Group 19): the ranked conditions, minus anything already represented above ---
    const evaluation = await this.alerting.evaluate();
    const represented = new Set(items.map((item) => item.id));
    for (const alert of evaluation.alerts) {
      const id = `alert:${alert.dedupeKey}`;
      if (represented.has(id)) continue;
      // Deduplicate by *condition* against the area-specific items, so a dead-letter backlog does not appear
      // twice under two different names.
      if (
        alert.ruleId === 'outbox.dead-letters' &&
        items.some((item) => item.id === 'queue:dead-letters')
      ) {
        continue;
      }
      if (
        alert.ruleId === 'outbox.stalled-leases' &&
        items.some((item) => item.id === 'queue:stalled-leases')
      ) {
        continue;
      }
      // The supervisor's own indeterminate item and the alert for the same condition are the same problem.
      if (
        alert.ruleId === 'worker.supervision-indeterminate' &&
        items.some((item) => item.id === 'supervision:indeterminate')
      ) {
        continue;
      }
      // A worker already listed individually must not also appear as a generic alert for the same worker.
      if (alert.ruleId === 'worker.failing' || alert.ruleId === 'worker.stale') {
        const worker = String(alert.context.worker ?? '');
        if (worker && items.some((item) => item.id.startsWith(`worker:${worker}:`))) continue;
      }
      items.push({
        id,
        area: 'SUPERVISION',
        urgency: alert.urgency,
        severity: alert.severity,
        summary: alert.summary,
        context: alert.context,
      });
    }
    for (const entry of evaluation.skipped) {
      // One entry per skipped *rule*, each naming the rule. The previous version pushed a separate
      // `{ area: 'SUPERVISION' }` per rule, which made a single unreadable subsystem look like several
      // distinct problems in the `unavailable` list.
      const index = unavailable.findIndex((item) => item.area === 'SUPERVISION');
      const reason = `${entry.ruleId}: ${entry.reason}`;
      if (index === -1) {
        unavailable.push({ area: 'SUPERVISION', reason });
      } else {
        const current = unavailable[index];
        if (current) current.reason = `${current.reason}; ${reason}`;
      }
    }

    items.sort(
      (left, right) =>
        URGENCY_ORDER[right.urgency] - URGENCY_ORDER[left.urgency] ||
        SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] ||
        left.id.localeCompare(right.id),
    );

    const counts = {
      immediate: items.filter((item) => item.urgency === 'IMMEDIATE').length,
      routine: items.filter((item) => item.urgency === 'ROUTINE').length,
      info: items.filter((item) => item.urgency === 'INFO').length,
    };

    return {
      generatedAt: new Date().toISOString(),
      /*
       * `clear` requires both an empty list **and** no unavailable areas.
       *
       * A view that reports "clear" while a source was unreadable is the same failure as a supervisor
       * reporting healthy when it measured nothing — it converts an unmeasured system into an
       * apparently-checked one, which is worse than reporting nothing at all.
       */
      clear: items.length === 0 && unavailable.length === 0,
      partial: unavailable.length > 0,
      items,
      unavailable,
      counts,
      scope:
        'Read-only aggregation of integrity, queue, worker and alert state in this process. It ranks ' +
        'existing verdicts and never re-derives them. No remediation, acknowledgement or resolution is ' +
        'offered here.',
    };
  }
}
