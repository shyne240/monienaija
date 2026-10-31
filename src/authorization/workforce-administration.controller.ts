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
import { AssignWorkforceRoleDto } from './dto/assign-workforce-role.dto';
import { ConsumeWorkforceBootstrapDto } from './dto/consume-workforce-bootstrap.dto';
import { DecidePrivilegedApprovalDto } from './dto/decide-privileged-approval.dto';
import { EstablishWorkforceSessionDto } from './dto/establish-workforce-session.dto';
import { RequestPrivilegedApprovalDto } from './dto/request-privileged-approval.dto';
import { RevokeWorkforceRoleDto } from './dto/revoke-workforce-role.dto';
import { RevokeWorkforceSessionDto } from './dto/revoke-workforce-session.dto';
import {
  ADMINISTRATOR_OPERATIONAL_ROLE_KEYS,
  A2FinanceRoleAdministrationService,
} from './finance-role-administration.service';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { A2_WORKFORCE_CONFIG, A2WorkforceOidcService } from './workforce-oidc.service';
import type { A2WorkforceConfigurationV1, A2MakerCheckerRuleV1 } from './workforce-authentication.types';
import { A2WorkforceSessionService } from './workforce-session.service';
import { AGENT_FUNDING_ACTIONS, governedAction } from './governed-action.registry';
import { ApprovalRejectionDto } from './approval-decision.dto';
interface R extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId: string };
}
/**
 * V1-ADMIN-AUTHORIZATION-RUNTIME-01: maps the legacy `A2_MAKER_CHECKER_RULES_JSON` action names
 * this controller already governs to their `authorization_functions` catalogue codes (Foundation-01
 * seed), where one exists. Added ALONGSIDE (never instead of) the existing `requiredRoles:
 * rule.initiatingRoles/approvingRoles` checks below — maker/checker role separation remains
 * governed by the untouched legacy config; this is a genuinely additional, catalogue-sourced
 * authority gate. Actions with no catalogue function defined (e.g. FINANCE_CONTROL_POLICY_ACTIVATE,
 * which belongs to the out-of-scope B1/B2F commercial-accounting maker/checker module) are
 * intentionally absent here and fall back to the legacy-only check — never invent a code for them.
 */
const ACTION_FUNCTION_CODES: Readonly<Record<string, string>> = {
  FINANCE_ROLE_ASSIGN: 'workforce.role.assign',
  FINANCE_ROLE_REVOKE: 'workforce.role.revoke',
};
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
  @Post('sessions') async establish(@Body() b: EstablishWorkforceSessionDto, @Req() r: R) {
    await this.limits.consume(
      this.rateRule('workforce-authentication'),
      [r.ip, 'configured-issuer'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.sessions.establish(await this.oidc.validate(b.idToken));
  }
  @Delete('sessions/:id') async revokeSession(
    @Param('id') id: string,
    @Body() b: RevokeWorkforceSessionDto,
    @Req() r: R,
  ) {
    return this.sessions.revoke(id, this.principal(r), b.reason);
  }
  @Post('bootstrap') async bootstrap(@Body() b: ConsumeWorkforceBootstrapDto, @Req() r: R) {
    const p = this.principal(r);
    await this.limits.consume(
      this.rateRule('workforce-bootstrap'),
      [p.principalId, p.sessionId ?? 'none'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.roles.consumeBootstrap(b.statement, p);
  }
  @Post('roles') async assign(@Body() b: AssignWorkforceRoleDto, @Req() r: R) {
    const p = this.principal(r);
    // V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01: the six operational roles never
    // touch the legacy FINANCE_ROLE_ASSIGN maker/checker-rule gate below — ADMINISTRATOR holds no
    // `initiatingRoles` entry there and must not gain one, since that rule also governs the three
    // Finance roles and ADMINISTRATOR's own (SUPER_ADMIN-only) assignment. Direct-EXECUTE catalogue
    // function check only; the service layer re-validates role membership independently.
    if (ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(b.roleKey)) {
      await this.auth.requireFunction(p, 'workforce.role.assign_operational', 'A2_FINANCE_ROLE_ASSIGNMENT', [
        'OPERATOR',
        'PRIVILEGED',
      ]);
    } else {
      await this.authorize(p, 'FINANCE_ROLE_ASSIGN', 'A2_FINANCE_ROLE_ASSIGNMENT');
    }
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
    @Body() b: RevokeWorkforceRoleDto,
    @Req() r: R,
  ) {
    const p = this.principal(r);
    if (ADMINISTRATOR_OPERATIONAL_ROLE_KEYS.has(roleKey)) {
      await this.auth.requireFunction(p, 'workforce.role.revoke_operational', 'A2_FINANCE_ROLE_ASSIGNMENT', [
        'OPERATOR',
        'PRIVILEGED',
      ]);
    } else {
      await this.authorize(p, 'FINANCE_ROLE_REVOKE', 'A2_FINANCE_ROLE_ASSIGNMENT');
    }
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
    @Body() b: RequestPrivilegedApprovalDto,
    @Req() r: R,
  ) {
    const principal = this.principal(r),
      rule = this.rule(b.action),
      initiatingFunctionCodes = this.initiatingFunctionCodes(b.action);
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
        ...(initiatingFunctionCodes.length ? { requiredFunctions: initiatingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
    });
  }
  @Post('approvals/:id/approve') async approve(
    @Param('id') approvalId: string,
    @Body() b: DecidePrivilegedApprovalDto,
    @Req() r: R,
  ) {
    const principal = this.principal(r),
      approval = await this.approvals.getApproval(approvalId);
    if (!approval) throw new ForbiddenException('Approval not found');
    const rule = this.rule(approval.actionType);
    const approvingFunctionCodes = this.approvingFunctionCodes(approval.actionType);
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: approval.resourceType,
        action: approval.actionType,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.approvingRoles,
        ...(approvingFunctionCodes.length ? { requiredFunctions: approvingFunctionCodes } : {}),
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
    // Never spread client input after authenticated identity or route-bound identifiers.
    return this.approvals.approve({ approvalId, principal, comment: b.comment });
  }
  /**
   * Maker-checker rejection surface (same decide() machinery as approve, with the established
   * separation-of-duties / MFA / approval-scope controls applied to the checker side). Without
   * this route a FINANCE_CONTROLLER had no rejection path for a pending governed change.
   */
  @Post('approvals/:id/reject') async reject(
    @Param('id') approvalId: string,
    @Body() b: ApprovalRejectionDto,
    @Req() r: R,
  ) {
    const principal = this.principal(r),
      approval = await this.approvals.getApproval(approvalId);
    if (!approval) throw new ForbiddenException('Approval not found');
    if (Object.values(AGENT_FUNDING_ACTIONS).some((action) => action.action === approval.actionType)) {
      throw new ForbiddenException(
        'Reject agent funding requests through the dedicated funding-request rejection endpoint so approval and request state change atomically',
      );
    }
    const rule = this.rule(approval.actionType);
    const approvingFunctionCodes = this.approvingFunctionCodes(approval.actionType);
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: approval.resourceType,
        action: approval.actionType,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.approvingRoles,
        ...(approvingFunctionCodes.length ? { requiredFunctions: approvingFunctionCodes } : {}),
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
    return this.approvals.reject({
      approvalId,
      principal,
      comment: b.comment ?? b.reason,
    });
  }
  private principal(r: R) {
    if (!r.authorizationPrincipal) throw new ForbiddenException('Workforce principal missing');
    return r.authorizationPrincipal;
  }
  /**
   * Maker/checker rule resolution. `A2_MAKER_CHECKER_RULES_JSON` keeps precedence for the
   * legacy actions it defines; for actions that environment file never carried (the governed
   * commercial-rule and journal-reversal actions) the registered governed-action catalogue
   * supplies the same policy the domain execution surfaces enforce — so the decide step can
   * never be bypassed just because an action is not in the legacy environment registry. An
   * unknown action still fails closed exactly as before.
   */
  private rule(action: string): A2MakerCheckerRuleV1 {
    const legacy = this.config.makerCheckerRules.find((item) => item.action === action);
    if (legacy) return legacy;
    const governed = governedAction(action);
    if (governed) {
      return {
        action: governed.action,
        initiatingRoles: governed.initiatingRoles,
        approvingRoles: governed.approvingRoles,
        minimumApprovals: governed.minimumApprovals,
        // Self-approval-prohibited implies a distinct maker and checker.
        separationRequired: governed.selfApprovalProhibited,
        selfApprovalProhibited: governed.selfApprovalProhibited,
        mfaRequired: governed.mfaRequired,
        minimumAssurance: governed.minimumAssurance,
        materialityRequired: false,
      };
    }
    throw new ForbiddenException(`Maker/checker policy missing: ${action}`);
  }
  /** Per-side catalogue function codes: initiation leg. */
  private initiatingFunctionCodes(action: string): readonly string[] {
    const governed = governedAction(action);
    if (governed) return governed.initiatingFunctionCodes;
    const code = ACTION_FUNCTION_CODES[action];
    return code ? [code] : [];
  }
  /**
   * Per-side catalogue function codes: approval leg. Governed actions carry explicit
   * `approvingFunctionCodes` (e.g. none for LEDGER_JOURNAL_REVERSAL — its checker-side authority
   * is the approving role + `approvalScope`); legacy actions keep the established lookup.
   */
  private approvingFunctionCodes(action: string): readonly string[] {
    const governed = governedAction(action);
    if (governed) return governed.approvingFunctionCodes;
    const code = ACTION_FUNCTION_CODES[action];
    return code ? [code] : [];
  }
  private rateRule(category: string) {
    const rule = this.config.rateLimits.find((item) => item.category === category);
    if (!rule) throw new ForbiddenException(`Rate-limit policy missing: ${category}`);
    return rule;
  }
  private async authorize(p: AuthorizationPrincipal, action: string, resourceType: string) {
    const rule = this.rule(action);
    const initiatingFunctionCodes = this.initiatingFunctionCodes(action);
    const d = await this.auth.authorize(
      p,
      {
        resourceType,
        action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: rule.initiatingRoles,
        ...(initiatingFunctionCodes.length ? { requiredFunctions: initiatingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!d.allowed) throw new ForbiddenException(`Authorization denied: ${d.reason}`);
  }
}
