/**
 * ARENA 3D Group 19 — alerting contract.
 *
 * ## What this is, and what it deliberately is not
 *
 * This is the **decision layer**: what is worth telling a human about, how urgently, and — critically — how
 * a resolved condition stops alerting. Delivery is behind a seam with a dark default, exactly like the SMS
 * and email providers in this repository: no vendor is selected, no credential is invented, and no alert is
 * claimed to have reached anyone.
 *
 * ## Severity is not urgency
 *
 * Severity says how bad the condition is. Urgency says whether it should interrupt someone now.
 *
 * A `dead-lettered` count of 40 is `CRITICAL` severity but may be `ROUTINE` urgency if it is 40 events all
 * failing against a provider that has been down for a week and is already being worked. Conversely a single
 * newly-broken ledger invariant is `CRITICAL` severity *and* `IMMEDIATE` urgency even though the count is 1.
 *
 * Collapsing the two is why paging systems get muted.
 */

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/**
 * Whether a human should be interrupted.
 *
 * `IMMEDIATE` — wake someone. Something broke that was working.
 * `ROUTINE` — route to a queue. Something is wrong but not newly wrong, or is expected.
 * `INFO` — record only.
 */
export type AlertUrgency = 'IMMEDIATE' | 'ROUTINE' | 'INFO';

/** The conditions this system knows how to evaluate. Identifier-stable; dashboards key on these. */
export const ALERT_RULES = {
  /** Group 18: an integrity check moved from non-failing to failing. */
  INTEGRITY_REGRESSION: 'integrity.regression',
  /** Group 18: an integrity check has been failing for longer than the configured tolerance. */
  INTEGRITY_STALE_FAILURE: 'integrity.stale-failure',
  /** Group 14: events exhausted their delivery ceiling. */
  OUTBOX_DEAD_LETTERS: 'outbox.dead-letters',
  /** Group 14: claimed events whose lease expired — a worker is dying mid-delivery. */
  OUTBOX_STALLED_LEASES: 'outbox.stalled-leases',
  /** Group 17: the outbox backlog has grown beyond tolerance. */
  OUTBOX_BACKLOG: 'outbox.backlog',
  /** Group 15: a worker's last tick threw. */
  WORKER_FAILING: 'worker.failing',
  /** Group 15: a worker's expected tick did not arrive. */
  WORKER_STALE: 'worker.stale',
  /** Group 17: supervision measured nothing at all in this process. */
  WORKER_SUPERVISION_INDETERMINATE: 'worker.supervision-indeterminate',
  /** Group 17: a metrics source could not be read. */
  METRICS_SOURCE_UNAVAILABLE: 'metrics.source-unavailable',
} as const;

export type AlertRuleId = (typeof ALERT_RULES)[keyof typeof ALERT_RULES];

export interface Alert {
  ruleId: AlertRuleId;
  severity: AlertSeverity;
  urgency: AlertUrgency;
  /** One line an operator can act on. Contains no identifiers and no secrets. */
  summary: string;
  /** Stable key identifying *this condition*, used to deduplicate repeats. */
  dedupeKey: string;
  /** Structured context. Bounded and free of secrets — see `sanitiseAlertContext`. */
  context: Record<string, string | number | boolean | null>;
  /** When the condition was first observed in this run. */
  observedAt: string;
}

/** Result of one evaluation pass. */
export interface AlertEvaluation {
  evaluatedAt: string;
  alerts: Alert[];
  /**
   * Rules that were checked and found healthy. Named explicitly so a missing rule is distinguishable from a
   * satisfied one — an alerting system that reports "no alerts" when it evaluated nothing is the same trap
   * as a supervisor reporting healthy when it measured nothing.
   */
  satisfied: AlertRuleId[];
  /** Rules that could not be evaluated, with the reason. Never silently dropped. */
  skipped: Array<{ ruleId: AlertRuleId; reason: string }>;
}

/**
 * Delivery seam.
 *
 * `NoneAlertChannel` is the default and is the only channel that exists without an explicit selection.
 * Recording the alert without delivering it is the honest behaviour: an unconfigured deployment should not
 * appear to have paged anyone.
 */
export interface AlertChannel {
  readonly name: string;
  /** Whether this channel can actually reach a human. `false` means alerts are recorded only. */
  readonly configured: boolean;
  deliver(alert: Alert): Promise<{ delivered: boolean; reason?: string }>;
}
