import { Controller, Get, Query, Req } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from './audit.service';
import { DiagnosticsService } from './diagnostics.service';
import { MetricsService } from './metrics.service';
import { OutboxService } from './outbox.service';
import { OutboxEventStatus } from './operations.enums';

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
  ) {
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
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, 'internal-operations', [
      'SUPPORT',
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
  }
}
