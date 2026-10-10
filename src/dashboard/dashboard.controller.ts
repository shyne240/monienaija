import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal, AuthorizationPrincipalType } from '../authorization/authorization.types';
import { DashboardService } from './dashboard.service';
import { DashboardWidgetDataService, resolvePeriod } from './dashboard-widget-data.service';
import { findWidgetDefinition } from './dashboard-widget-registry';
import { AssignTemplateDto } from './dto/assign-template.dto';

interface R extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId: string };
}

const WORKFORCE_PRINCIPAL_TYPES: readonly AuthorizationPrincipalType[] = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];

@Controller('internal/a2/workforce/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetDataService: DashboardWidgetDataService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('templates')
  async listTemplates(@Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.view');
    return this.dashboardService.listTemplates();
  }

  @Get('templates/:key')
  async getTemplate(@Param('key') key: string, @Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.view');
    return this.dashboardService.getTemplate(key);
  }

  @Get('assignments')
  async listAssignments(@Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.view');
    return this.dashboardService.listAssignments();
  }

  @Get('roles')
  async listRoles(@Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.view');
    return this.dashboardService.listEligibleRoles();
  }

  @Get('widget-registry')
  async getWidgetRegistry(@Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.view');
    return this.dashboardService.widgetRegistry;
  }

  @Put('assignments/:roleKey')
  async assignTemplate(@Param('roleKey') roleKey: string, @Body() body: AssignTemplateDto, @Req() req: R) {
    await this.requireFunction(req, 'workforce.dashboard.assign');
    if (!body?.templateKey || typeof body.templateKey !== 'string') {
      throw new BadRequestException('templateKey is required.');
    }
    const principal = this.principalOf(req);
    return this.dashboardService.assignTemplate({
      roleKey,
      templateKey: body.templateKey,
      reason: body.reason,
      actorPrincipalId: principal.principalId,
      correlationId: req.requestContext?.correlationId,
    });
  }

  /**
   * Self-service: returns the caller's OWN resolved dashboard, derived entirely from their own
   * session roles/scopes (never an arbitrary parameter). No dedicated function grant is required
   * — this is the same self-access pattern as viewing one's own profile — but it still requires
   * an authenticated workforce session (enforced generically by RuntimeAccessGuard for every
   * route under /internal/a2/workforce/).
   */
  @Get('my-dashboard')
  async myDashboard(@Req() req: R) {
    const principal = this.principalOf(req);
    return this.dashboardService.resolveMyDashboard(principal.roles, principal.scopes);
  }

  /**
   * Generic widget-data proxy. Every widget declares its own `requiredFunctions` in
   * DASHBOARD_WIDGET_REGISTRY; this independently re-validates them here via
   * AuthorizationService.requireFunction, regardless of what `my-dashboard` already returned —
   * defense in depth against a tampered/stale client-side widget list.
   */
  @Get('widgets/:widgetKey')
  async widgetData(
    @Param('widgetKey') widgetKey: string,
    @Query('period') period: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('compare') compare: string | undefined,
    @Req() req: R,
  ) {
    const def = findWidgetDefinition(widgetKey);
    if (!def) {
      throw new NotFoundException(`Unknown widget '${widgetKey}'.`);
    }
    if (def.fetchMode !== 'proxy') {
      throw new BadRequestException(`Widget '${widgetKey}' is not served via the proxy endpoint.`);
    }
    for (const fn of def.requiredFunctions) {
      await this.requireFunction(req, fn, 'dashboard-widget');
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;

    switch (widgetKey) {
      case 'transaction-summary':
        return this.widgetDataService.transactionSummary(resolvePeriod(period, from, to), compare === 'true');
      case 'transaction-trend':
        return this.widgetDataService.transactionTrend(resolvePeriod(period, from, to));
      case 'recent-transactions':
        return this.widgetDataService.recentTransactions(parsedLimit);
      case 'ledger-summary':
        return this.widgetDataService.ledgerSummary();
      case 'reconciliation-status':
        return this.widgetDataService.reconciliationStatus();
      case 'audit-trail':
        return this.widgetDataService.auditTrail(parsedLimit);
      case 'workforce-overview':
        return this.widgetDataService.workforceOverview();
      case 'agent-lifecycle-summary':
        return this.widgetDataService.agentLifecycleSummary();
      case 'kyc-queue-summary':
        return this.widgetDataService.kycQueueSummary();
      case 'compliance-case-summary':
        return this.widgetDataService.complianceCaseSummary();
      case 'fraud-case-summary':
        return this.widgetDataService.fraudCaseSummary();
      default:
        throw new NotFoundException(`Widget '${widgetKey}' has no registered data handler.`);
    }
  }

  private principalOf(req: R): AuthorizationPrincipal {
    if (!req.authorizationPrincipal) {
      throw new ForbiddenException('No authenticated workforce session.');
    }
    return req.authorizationPrincipal;
  }

  private requireFunction(req: R, functionCode: string, resourceType = 'dashboard-configuration'): Promise<string> {
    return this.auth.requireFunction(req.authorizationPrincipal, functionCode, resourceType, WORKFORCE_PRINCIPAL_TYPES);
  }
}
