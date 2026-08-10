import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthorizationPrincipal } from './authorization.types';
import { AuthorizationService } from './authorization.service';
import { A2FinanceRoleAdministrationService } from './finance-role-administration.service';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { A2_WORKFORCE_CONFIG, A2WorkforceOidcService } from './workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';
import { A2WorkforceSessionService } from './workforce-session.service';
interface R extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId: string };
}
@Controller('internal/a2/workforce')
export class A2WorkforceAdministrationController {
  constructor(
    private readonly oidc: A2WorkforceOidcService,
    private readonly sessions: A2WorkforceSessionService,
    private readonly roles: A2FinanceRoleAdministrationService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auth: AuthorizationService,
    private readonly limits: A2SecurityRateLimitService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}
  @Post('sessions') async establish(@Body() b: { idToken: string }, @Req() r: R) {
    await this.limits.consume(
      this.rateRule('workforce-authentication'),
      [r.ip, 'configured-issuer'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.sessions.establish(await this.oidc.validate(b.idToken));
  }
  @Delete('sessions/:id') async revokeSession(
    @Param('id') id: string,
    @Body() b: { reason: string },
    @Req() r: R,
  ) {
    return this.sessions.revoke(id, this.principal(r), b.reason);
  }
  @Post('bootstrap') async bootstrap(@Body() b: { statement: string }, @Req() r: R) {
    const p = this.principal(r);
    await this.limits.consume(
      this.rateRule('workforce-bootstrap'),
      [p.principalId, p.sessionId ?? 'none'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.roles.consumeBootstrap(b.statement, p);
  }
  @Post('roles') async assign(
    @Body()
    b: {
      targetPrincipalId: string;
      roleKey: string;
      effectiveFrom: string;
      effectiveTo: string;
      approvalIds?: string[];
      expectedVersion?: number;
    },
    @Req() r: R,
  ) {
    const p = this.principal(r);
    await this.authorize(p, 'FINANCE_ROLE_ASSIGN', 'A2_FINANCE_ROLE_ASSIGNMENT');
    await this.limits.consume(
      this.rateRule('finance-role-administration'),
      [p.principalId, p.sessionId ?? 'none', 'FINANCE_ROLE_ASSIGN'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.roles.assign({
      ...b,
      principal: p,
      correlationId: r.requestContext?.correlationId ?? 'unknown',
    });
  }
  @Delete('roles/:principalId/:roleKey') async revoke(
    @Param('principalId') targetPrincipalId: string,
    @Param('roleKey') roleKey: string,
    @Body()
    b: {
      effectiveFrom: string;
      effectiveTo: string;
      approvalIds: string[];
      expectedVersion?: number;
    },
    @Req() r: R,
  ) {
    const p = this.principal(r);
    await this.authorize(p, 'FINANCE_ROLE_REVOKE', 'A2_FINANCE_ROLE_ASSIGNMENT');
    await this.limits.consume(
      this.rateRule('finance-role-administration'),
      [p.principalId, p.sessionId ?? 'none', 'FINANCE_ROLE_REVOKE'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.roles.revoke({
      ...b,
      targetPrincipalId,
      roleKey,
      principal: p,
      correlationId: r.requestContext?.correlationId ?? 'unknown',
    });
  }
  @Post('approvals/request') async requestApproval(
    @Body()
    b: {
      action: string;
      resource: { type: string; id?: string };
      actionFingerprint: string;
      reason: string;
      approvalScope?: string;
    },
    @Req() r: R,
  ) {
    const principal = this.principal(r),
      rule = this.rule(b.action);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [principal.principalId, b.action],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.approvals.request({
      resource: b.resource,
      actionFingerprint: b.actionFingerprint,
      reason: b.reason,
      approvalScope: b.approvalScope,
      principal,
      policy: {
        resourceType: b.resource.type,
        action: b.action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.initiatingRoles,
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
    });
  }
  @Post('approvals/:id/approve') async approve(
    @Param('id') approvalId: string,
    @Body() b: { comment?: string },
    @Req() r: R,
  ) {
    const principal = this.principal(r),
      approval = await this.approvals.getApproval(approvalId);
    if (!approval) throw new ForbiddenException('Approval not found');
    const rule = this.rule(approval.actionType);
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: approval.resourceType,
        action: approval.actionType,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.approvingRoles,
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: approval.resourceType, id: approval.resourceId ?? undefined },
    );
    if (!decision.allowed)
      throw new ForbiddenException(`Approval authorization denied: ${decision.reason}`);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [principal.principalId, principal.sessionId ?? 'none', approval.actionType],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.approvals.approve({ approvalId, principal, ...b });
  }
  private principal(r: R) {
    if (!r.authorizationPrincipal) throw new ForbiddenException('Workforce principal missing');
    return r.authorizationPrincipal;
  }
  private rule(action: string) {
    const rule = this.config.makerCheckerRules.find((item) => item.action === action);
    if (!rule) throw new ForbiddenException(`Maker/checker policy missing: ${action}`);
    return rule;
  }
  private rateRule(category: string) {
    const rule = this.config.rateLimits.find((item) => item.category === category);
    if (!rule) throw new ForbiddenException(`Rate-limit policy missing: ${category}`);
    return rule;
  }
  private async authorize(p: AuthorizationPrincipal, action: string, resourceType: string) {
    const rule = this.rule(action);
    const d = await this.auth.authorize(
      p,
      {
        resourceType,
        action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.initiatingRoles,
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!d.allowed) throw new ForbiddenException(`Authorization denied: ${d.reason}`);
  }
}
