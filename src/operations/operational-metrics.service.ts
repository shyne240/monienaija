/**
 * ARENA 3D Group 17 — operational metrics: the signals that exist in code but reached nobody.
 *
 * ## The gap this closes
 *
 * Groups 14 and 15 built real observability primitives and then nothing consumed them:
 *
 *  - `WorkerLeaseService.health()` computes `pending`, `deadLettered`, `stalled` and
 *    `oldestPendingAgeSeconds` — **no caller existed**.
 *  - `WorkerLeaseService.deadLetters()` lists poison events — **no caller existed**.
 *  - `WorkerScheduler.report()` classifies workers as healthy/stale/failing — served on
 *    `/internal/workers` for a human to look at, but exported as no metric.
 *
 * A signal that is computable but never collected is not observability; it is dead code with a comment
 * claiming otherwise. This service is the collection point.
 *
 * ## Why the database is the authority, not the process
 *
 * Queue depth, dead letters and stalled leases are read from PostgreSQL. They are *fleet-wide* facts: any
 * instance querying them sees the same queue. Worker tick health is the opposite — it is **process-local**,
 * and the metric names say so (`worker_tick_*` carries the worker name, and the aggregate is explicitly
 * per-process). Mixing the two without labelling would let a dashboard average away a dead instance.
 *
 * ## Deliberately not implemented
 *
 * No exporter registry, no push gateway, no cardinality management, no retention. This produces a snapshot
 * on request; who scrapes it, how often, and where it is stored is deployment (documented in the runbook).
 */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { WorkerLeaseService } from '../operations/worker-lease.service';
import { WorkerSupervisorService } from '../operations/worker-supervisor.service';

/** One metric sample. `labels` are always low-cardinality and never contain identifiers. */
export interface MetricSample {
  name: string;
  type: 'gauge' | 'counter';
  help: string;
  value: number;
  labels?: Record<string, string>;
}

export interface SnapshotResult {
  generatedAt: string;
  samples: MetricSample[];
  /**
   * Signals that could not be collected. Present rather than thrown: a metrics endpoint that 500s because
   * the database is briefly unavailable removes the one signal an operator needs during an incident.
   */
  unavailable: Array<{ signal: string; reason: string }>;
}

@Injectable()
export class OperationalMetricsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly leases: WorkerLeaseService,
    private readonly supervisor: WorkerSupervisorService,
  ) {}

  /**
   * Collects a snapshot.
   *
   * Each source is collected independently so one failure degrades one signal rather than the whole
   * endpoint. `unavailable` names what was missed — an absent metric and a zero metric are very different
   * things, and conflating them is how "no dead letters" and "cannot read the dead-letter table" become
   * indistinguishable on a dashboard.
   */
  async snapshot(): Promise<SnapshotResult> {
    const samples: MetricSample[] = [];
    const unavailable: Array<{ signal: string; reason: string }> = [];

    try {
      const health = await this.leases.health(this.dataSource.manager);
      samples.push(
        {
          name: 'outbox_pending',
          type: 'gauge',
          help: 'Outbox events awaiting delivery.',
          value: health.pending,
        },
        {
          name: 'outbox_dead_lettered',
          type: 'gauge',
          help: 'Outbox events that exhausted their delivery ceiling and will not be retried.',
          value: health.deadLettered,
        },
        {
          name: 'outbox_stalled_leases',
          type: 'gauge',
          help: 'Claimed events whose lease expired — the signature of a crashed worker.',
          value: health.stalled,
        },
        {
          name: 'outbox_oldest_pending_age_seconds',
          type: 'gauge',
          help: 'Age of the oldest pending event. Negative/absent means the queue is empty.',
          value: health.oldestPendingAgeSeconds ?? 0,
        },
      );
    } catch {
      unavailable.push({ signal: 'outbox', reason: 'outbox queue state could not be read' });
    }

    const report = this.supervisor.report();
    for (const worker of report.workers) {
      const labels = { worker: worker.name };
      samples.push(
        {
          name: 'worker_enabled',
          type: 'gauge',
          help: 'Whether this process has the worker enabled by configuration (1) or not (0).',
          value: worker.enabled ? 1 : 0,
          labels,
        },
        {
          name: 'worker_activity_observed',
          type: 'gauge',
          help: 'Whether any tick has been observed in this process. 0 means nothing was measured.',
          value: worker.activityObserved ? 1 : 0,
          labels,
        },
        {
          name: 'worker_consecutive_failures',
          type: 'gauge',
          help: 'Current failure streak for this worker in this process.',
          value: worker.consecutiveFailures,
          labels,
        },
        {
          name: 'worker_last_duration_ms',
          type: 'gauge',
          help: 'Duration of the most recent completed tick, in milliseconds.',
          value: worker.lastDurationMs ?? 0,
          labels,
        },
        {
          name: 'worker_ticks_completed_total',
          type: 'counter',
          help: 'Ticks completed without error since process start.',
          value: worker.totalCompleted,
          labels,
        },
        {
          name: 'worker_ticks_failed_total',
          type: 'counter',
          help: 'Ticks that threw since process start.',
          value: worker.totalFailed,
          labels,
        },
      );
    }

    // A single gauge for "is this process's supervision healthy" would be ambiguous, so the three states are
    // exported as separate one-hot gauges. `indeterminate` is exported truthfully rather than hidden.
    for (const state of ['ok', 'degraded', 'indeterminate'] as const) {
      samples.push({
        name: 'worker_supervision_status',
        type: 'gauge',
        help: '1 for the current supervision status of this process, 0 for the others.',
        value: report.status === state ? 1 : 0,
        labels: { status: state },
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      samples,
      unavailable,
    };
  }

  /**
   * Prometheus text exposition (format version 0.0.4).
   *
   * Hand-written rather than pulled from a client library: the surface is a handful of gauges and counters
   * with no histograms, and a dependency whose main value is histogram buckets and a registry would add a
   * lifecycle (registration, duplicate-name protection) that has no caller here.
   *
   * `HELP`/`TYPE` are emitted once per metric name, then all series for that name. Label values are escaped
   * — a worker name containing a quote or backslash would otherwise produce a corrupt exposition that a
   * scraper rejects wholesale, taking every other metric down with it.
   */
  async prometheus(): Promise<string> {
    const { samples } = await this.snapshot();
    const grouped = new Map<string, MetricSample[]>();
    for (const sample of samples) {
      const existing = grouped.get(sample.name);
      if (existing) existing.push(sample);
      else grouped.set(sample.name, [sample]);
    }

    const lines: string[] = [];
    for (const [name, group] of grouped) {
      const first = group[0];
      if (!first) continue;
      lines.push(`# HELP ${name} ${first.help}`);
      lines.push(`# TYPE ${name} ${first.type}`);
      for (const sample of group) {
        lines.push(`${name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string> | undefined): string {
  if (!labels) return '';
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(value);
}
