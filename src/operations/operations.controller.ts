import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import { limitProfileAuditEntityId } from '../limit-catalog/limit-audit-identity';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from './audit.service';
import { DiagnosticsService } from './diagnostics.service';
import { MetricsService } from './metrics.service';
import { OutboxService } from './outbox.service';
import { OutboxEventStatus } from './operations.enums';
import { AlertingService } from './alerting.service';
import { IntegrityMonitoringService } from './integrity-monitoring.service';
import { OperationsCentreService } from './operations-centre.service';
import { OperationalMetricsService } from './operational-metrics.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { WorkerSupervisorService } from './worker-supervisor.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-ADMIN-AUTHORIZATION-READ-SURFACE-01: `metrics`/`diagnostics`/`outbox` previously had NO
 * authorization check inside this controller at all — they relied entirely on
 * RoutePolicyRegistry's generic `/internal/*` catch-all policy, which RuntimeAccessGuard does
 * not enforce for WORKFORCE_SESSION-mode routes (see route-policy-registry.ts /
 * runtime-access.guard.ts and the READ-SURFACE-01 report §9). That meant any authenticated
 * workforce/SUPPORT bearer session — regardless of catalogue role — could reach these three
 * endpoints with zero further check, a materially wider gap than the admin-agent/customer/
 * aggregator controllers (which at least deny AGENT/CUSTOMER/AGGREGATOR at the controller
 * level). Each now calls `AuthorizationService.requireFunction()` against its approved catalogue
 * function (`metrics.view`/`diagnostics.view`/`outbox.view` — all IMPLEMENTED, assignable: true
 * in authorization-catalogue.seed.ts), restricting access to SUPER_ADMIN / FINANCE_AUDITOR /
 * OPERATIONS (the only three catalogue roles that hold these functions).
 *
 * `audit` is intentionally NOT migrated here: a real SUPPORT workforce session is proven, by a
 * pre-existing named test (a22-admin-foundation.integration.spec.ts, "11. Audit reads via
 * workforce and no sensitive fields"), to rely on this exact endpoint today, and SUPPORT is not
 * a catalogue-governed principal type (see the READ-SURFACE-01 report §10 SUPPORT audit).
 * Migrating `audit` would silently remove a capability SUPPORT is shown to actually use, which
 * is explicitly out of this task's authority to decide. Left exactly as it was (no check beyond
 * authentication), documented as a remaining gap.
 */
@Controller('internal')
export class OperationsController {
  constructor(
    private readonly auditService: AuditService,
    private readonly diagnosticsService: DiagnosticsService,
    private readonly metricsService: MetricsService,
    private readonly outboxService: OutboxService,
    private readonly auth: AuthorizationService,
    private readonly workerSupervisor: WorkerSupervisorService,
    private readonly operationalMetrics: OperationalMetricsService,
    private readonly reconciliation: ReconciliationService,
    private readonly integrity: IntegrityMonitoringService,
    private readonly alerting: AlertingService,
    private readonly operationsCentre: OperationsCentreService,
  ) {}

  @Get('metrics')
  async getMetrics(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'metrics.view');
    return this.metricsService.getMetrics();
  }

  @Get('diagnostics')
  async getDiagnostics(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    return this.diagnosticsService.getDiagnostics();
  }

  /**
   * Group 15 — background worker supervision for this instance.
   *
   * Behind `diagnostics.view`, reusing the existing function rather than introducing a new catalogue
   * permission: this is the same class of operational detail as `/internal/diagnostics`, and inventing a
   * permission would require a seed change and a role assignment decision that is the product owner's.
   *
   * The payload states its own scope. It is **process-local**: it says what this instance has observed, and
   * does not claim that work is progressing fleet-wide.
   */
  /**
   * Group 17 — queue and worker metrics with `unavailable` named explicitly.
   *
   * A zero and an unreadable signal are different facts; the payload keeps them distinguishable.
   */
  @Get('operational-metrics')
  async getOperationalMetrics(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'metrics.view');
    return this.operationalMetrics.snapshot();
  }

  /**
   * Group 17 — Prometheus text exposition.
   *
   * Same `metrics.view` permission as the JSON view rather than an unauthenticated scrape path. Adding an
   * anonymous `/metrics` route would be a new public surface, and whether a scraper can reach it without a
   * credential is a deployment decision that is not this group's to make.
   */
  @Get('metrics/prometheus')
  async getPrometheusMetrics(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'metrics.view');
    return this.operationalMetrics.prometheus();
  }

  /**
   * Group 18 — run the integrity checks, record a snapshot, and report drift.
   *
   * Recording is deliberate rather than incidental: a check that is only evaluated when someone looks is
   * unmeasured between looks, and "when did this last pass?" becomes unanswerable. `regressionDetected` is
   * the field an alert should key on — a system that has been failing for a week must not page on every run,
   * but a check that just broke must.
   */
  @Get('integrity')
  async getIntegrity(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    const startedAt = performance.now();
    const report = await this.reconciliation.runReconciliation();
    return this.integrity.record(report, {
      durationMs: performance.now() - startedAt,
      observer: 'internal-integrity-endpoint',
    });
  }

  /** Group 18 — snapshot history, newest first. */
  @Get('integrity/history')
  async getIntegrityHistory(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    await this.requireFunction(req, 'diagnostics.view');
    const parsed = limit === undefined ? 50 : Number(limit);
    return this.integrity.history(Number.isFinite(parsed) ? parsed : 50);
  }

  /**
   * Group 18 — for each check, when it last passed.
   *
   * Answers "how long has this been broken?", which a stateless report cannot answer at all.
   */
  @Get('integrity/last-passes')
  async getIntegrityLastPasses(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    return this.integrity.lastPasses();
  }

  /**
   * Group 19 — evaluate the alert rules **without dispatching**.
   *
   * Read-only on purpose: an operator inspecting alert state must not page anyone. `satisfied` and `skipped`
   * are both reported so "no alerts" is distinguishable from "nothing was evaluated".
   */
  @Get('alerts')
  async getAlerts(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    const evaluation = await this.alerting.evaluate();
    return {
      ...evaluation,
      // Stated in the payload: this endpoint evaluates, it does not deliver.
      deliveryConfigured: this.alerting.deliveryConfigured,
      channel: this.alerting.channelName,
      dispatch: false,
    };
  }

  /**
   * Group 19 — conditions currently suppressed as repeats.
   *
   * Silence is ambiguous without this: "no alert" and "alert suppressed as an ongoing condition" look
   * identical from the outside.
   */
  @Get('alerts/active')
  async getActiveAlerts(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    return {
      channel: this.alerting.channelName,
      deliveryConfigured: this.alerting.deliveryConfigured,
      conditions: this.alerting.activeState(),
    };
  }

  /**
   * Group 20 — the operations centre: everything needing attention, ranked.
   *
   * Read-only. `clear: true` means "measured and clear", never "not measured" — an unreadable source sets
   * `partial` and appears in `unavailable`. No remediation is offered here; those are audited write paths
   * with their own authority decision.
   */
  @Get('operations-centre')
  async getOperationsCentre(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    return this.operationsCentre.view();
  }

  @Get('workers')
  async getWorkers(@Req() req: AuthenticatedRequest) {
    await this.requireFunction(req, 'diagnostics.view');
    return this.workerSupervisor.report();
  }

  // Not migrated — see class-level comment: SUPPORT is a proven, tested consumer of this exact
  // route and is not a catalogue-governed principal type. Left on authentication-only (the
  // pre-existing behaviour), per the explicit SUPPORT audit-only instruction.
  // Provider configuration audit metadata (`NOTIFICATION_PROVIDER_CONFIG` / `NOTIFICATION_TEST_SEND`)
  // is restricted unless the caller holds `notification.provider.view`.
  @Get('audit')
  async getAudit(
    @Req() req?: AuthenticatedRequest,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('correlationId') correlationId?: string,
    @Query('limit') limit?: string,
    @Query('limitProfileCode') limitProfileCode?: string,
  ) {
    if (limitProfileCode !== undefined) {
      if (typeof limitProfileCode !== 'string')
        throw new BadRequestException('Invalid limit profile code');
      const normalized = limitProfileCode.trim().toUpperCase();
      if (!/^[A-Z0-9_]{3,80}$/.test(normalized))
        throw new BadRequestException('Invalid limit profile code');
      if (entityId || (entityType && entityType !== 'LIMIT_PROFILE'))
        throw new BadRequestException(
          'Limit profile code cannot be combined with another entity ID or type',
        );
      entityType = 'LIMIT_PROFILE';
      entityId = limitProfileAuditEntityId(normalized);
    }
    const policy = {
      resourceType: 'notification-provider-config-audit',
      action: 'notification.provider.view',
      allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'] as const,
      requiredFunctions: ['notification.provider.view'],
      customerAccess: 'NONE' as const,
    };
    const resource = { type: 'notification-provider-config-audit' };
    const normalizedEntityType = entityType?.trim().toUpperCase();
    const targetsProviderAudit =
      normalizedEntityType === 'NOTIFICATION_PROVIDER_CONFIG' ||
      normalizedEntityType === 'NOTIFICATION_TEST_SEND' ||
      normalizedEntityType === 'NOTIFICATION_TEST_SEND_QUOTA';
    const preDecision = this.auth.evaluate(req?.authorizationPrincipal, policy, resource);
    const decision =
      targetsProviderAudit || preDecision.allowed
        ? await this.auth.authorize(req?.authorizationPrincipal, policy, resource)
        : preDecision;

    const auditQuery = {
      entityType,
      entityId,
      correlationId,
      limit: limit ? Number(limit) : undefined,
    };
    return decision.allowed
      ? this.auditService.listWithNotificationProviderOversight(auditQuery)
      : this.auditService.list(auditQuery);
  }

  @Get('outbox')
  async getOutbox(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: OutboxEventStatus,
    @Query('limit') limit?: string,
  ) {
    await this.requireFunction(req, 'outbox.view');
    return this.outboxService.list({ status, limit: limit ? Number(limit) : undefined });
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      functionCode,
      'internal-operations',
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
  }
}
