import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RoleFunctionAccessType } from '../authorization-catalogue/authorization-catalogue.enums';
import { AuthorizationCatalogueRuntimeService } from '../authorization-catalogue/authorization-catalogue-runtime.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { AuthorizationService } from './authorization.service';
import { AssignWorkforceRoleDto } from './dto/assign-workforce-role.dto';
import { ConsumeWorkforceBootstrapDto } from './dto/consume-workforce-bootstrap.dto';
import { DecidePrivilegedApprovalDto } from './dto/decide-privileged-approval.dto';
import { EstablishWorkforceSessionDto } from './dto/establish-workforce-session.dto';
import { ListPrivilegedApprovalsDto } from './dto/list-privileged-approvals.dto';
import { PrepareRoleChangeApprovalDto } from './dto/prepare-role-change-approval.dto';
import { RequestPrivilegedApprovalDto } from './dto/request-privileged-approval.dto';
import { RevokeWorkforceRoleDto } from './dto/revoke-workforce-role.dto';
import { RevokeWorkforceSessionDto } from './dto/revoke-workforce-session.dto';
import {
  ADMINISTRATOR_OPERATIONAL_ROLE_KEYS,
  A2FinanceRoleAdministrationService,
  financeRoleAssignmentReference,
} from './finance-role-administration.service';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { A2_WORKFORCE_CONFIG, A2WorkforceOidcService } from './workforce-oidc.service';
import type {
  A2WorkforceConfigurationV1,
  A2MakerCheckerRuleV1,
} from './workforce-authentication.types';
import { A2WorkforceSessionService } from './workforce-session.service';
import { AGENT_FUNDING_ACTIONS, governedAction } from './governed-action.registry';
import type { PrivilegedActionApprovalView } from './privileged-action-approval.types';
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
    @Optional() private readonly catalogueRuntime?: AuthorizationCatalogueRuntimeService,
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
      await this.auth.requireFunction(
        p,
        'workforce.role.assign_operational',
        'A2_FINANCE_ROLE_ASSIGNMENT',
        ['OPERATOR', 'PRIVILEGED'],
      );
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
      await this.auth.requireFunction(
        p,
        'workforce.role.revoke_operational',
        'A2_FINANCE_ROLE_ASSIGNMENT',
        ['OPERATOR', 'PRIVILEGED'],
      );
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
  /**
   * Prepares the governed approval for a role change (Arena B9, configurable workforce roles).
   *
   * Before this route the only way to obtain the approval a Finance-role or custom-role change
   * consumes was to compute the service's SHA-256 fingerprint out of band and POST it by hand,
   * which is why the Admin Web asked operators to paste approval IDs they could not have derived.
   * This route performs exactly the authorization the assignment route performs, then creates the
   * approval with the server-computed fingerprint and the assignment reference as its resource, so
   * the approval a checker decides is provably the one the assignment will verify.
   */
  @Post('roles/approval-requests') async prepareRoleChangeApproval(
    @Body() b: PrepareRoleChangeApprovalDto,
    @Req() r: R,
  ) {
    const p = this.principal(r),
      action = b.operation === 'REVOKE' ? 'FINANCE_ROLE_REVOKE' : 'FINANCE_ROLE_ASSIGN';
    await this.authorize(p, action, 'A2_FINANCE_ROLE_ASSIGNMENT');
    await this.limits.consume(
      this.rateRule('finance-role-administration'),
      [p.principalId, p.sessionId ?? 'none', `${action}_APPROVAL_REQUEST`],
      r.requestContext?.correlationId ?? 'unknown',
    );
    const command = {
      targetPrincipalId: b.targetPrincipalId,
      roleKey: b.roleKey,
      effectiveFrom: b.effectiveFrom,
      effectiveTo: b.effectiveTo,
      ...(b.expectedVersion === undefined ? {} : { expectedVersion: b.expectedVersion }),
    };
    const actionFingerprint = this.roles.fingerprint(action, command as never);
    const resourceId = financeRoleAssignmentReference(
      b.targetPrincipalId,
      b.roleKey,
      this.config.environment,
    );
    const rule = this.rule(action);
    const initiatingFunctionCodes = this.initiatingFunctionCodes(action);
    const decision = await this.approvals.request({
      principal: p,
      policy: {
        resourceType: 'A2_FINANCE_ROLE_ASSIGNMENT',
        action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        ...this.roleRequirement(rule.initiatingRoles),
        ...(initiatingFunctionCodes.length ? { requiredFunctions: initiatingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: 'A2_FINANCE_ROLE_ASSIGNMENT', id: resourceId },
      actionFingerprint,
      reason: b.reason,
      ...(b.approvalScope === undefined ? {} : { approvalScope: b.approvalScope }),
    });
    if (!decision.approval)
      throw new ForbiddenException(`Approval request denied: ${decision.reason}`);
    return {
      approvalId: decision.approval.id,
      action,
      status: decision.approval.status,
      actionFingerprint,
      resourceType: 'A2_FINANCE_ROLE_ASSIGNMENT',
      resourceId,
      expiresAt: decision.approval.expiresAt,
    };
  }
  @Get('approvals') async listApprovals(@Query() q: ListPrivilegedApprovalsDto, @Req() r: R) {
    const principal = this.principal(r);
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException('Workforce principal required');
    }
    const result = await this.approvals.listApprovals({
      principal,
      status: q.status,
      actionType: q.actionType,
      resourceType: q.resourceType,
      institutionId: q.institutionId,
      limit: q.limit,
      offset: q.offset,
    });
    return {
      ...result,
      items: await Promise.all(result.items.map((item) => this.withAuthority(item))),
    };
  }
  /**
   * Authoritative single-approval read for the checker workspace (Arena B9).
   *
   * `listApprovals` already scopes every row to the caller (approval scope membership, MFA,
   * SUPER_ADMIN agent-funding exclusion, per-action approving roles); this re-uses that exact
   * predicate with an id filter so a checker can re-read ONE decision after an unconfirmed
   * outcome. A row outside the caller's visibility is answered 404, identical to an unknown id —
   * this route is not an enumeration or existence oracle, and it never mutates the approval.
   */
  @Get('approvals/:id') async getApproval(@Param('id') id: string, @Req() r: R) {
    const principal = this.principal(r);
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException('Workforce principal required');
    }
    const approval = await this.approvals.getVisibleApproval(id, principal);
    if (!approval) throw new NotFoundException('Approval not found');
    return this.withAuthority(approval);
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
        ...this.roleRequirement(rule.initiatingRoles),
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
        ...this.roleRequirement(rule.approvingRoles),
        ...(approvingFunctionCodes.length ? { requiredFunctions: approvingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: approval.resourceType, id: approval.resourceId ?? undefined },
    );
    if (!decision.allowed)
      throw new ForbiddenException(`Approval authorization denied: ${decision.reason}`);
    await this.assertApproverCatalogueCapacity(principal, rule, approvingFunctionCodes);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [principal.principalId, principal.sessionId ?? 'none', approval.actionType],
      r.requestContext?.correlationId ?? 'unknown',
    );
    // Never spread client input after authenticated identity or route-bound identifiers.
    return this.approvals.approve({
      approvalId,
      principal,
      comment: b.comment,
      expectedVersion: b.expectedVersion,
    });
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
    if (
      Object.values(AGENT_FUNDING_ACTIONS).some((action) => action.action === approval.actionType)
    ) {
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
        ...this.roleRequirement(rule.approvingRoles),
        ...(approvingFunctionCodes.length ? { requiredFunctions: approvingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: approval.resourceType, id: approval.resourceId ?? undefined },
    );
    if (!decision.allowed)
      throw new ForbiddenException(`Approval authorization denied: ${decision.reason}`);
    await this.assertApproverCatalogueCapacity(principal, rule, approvingFunctionCodes);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [principal.principalId, principal.sessionId ?? 'none', approval.actionType],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.approvals.reject({
      approvalId,
      principal,
      comment: b.comment ?? b.reason,
      expectedVersion: b.expectedVersion,
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
  /**
   * Decision-authority projection for the Approvals workspace (Arena B9).
   *
   * The screen must be able to state WHO may decide and under WHAT assurance before a checker
   * acts. That policy already exists — it is the exact rule the approve/reject path enforces — so
   * it is derived here from `rule()` plus the approval leg's catalogue function codes instead of
   * being re-declared in the browser. An action whose rule cannot be resolved is returned with
   * `authority: null` rather than a guess: the screen says the authority is unresolved, and the
   * decide path still fails closed exactly as before.
   */
  private async withAuthority(view: PrivilegedActionApprovalView) {
    try {
      const rule = this.rule(view.actionType);
      const approvingFunctions = [...this.approvingFunctionCodes(view.actionType)];
      const approvingRoles =
        rule.approvingRoles.length > 0
          ? [...rule.approvingRoles]
          : this.catalogueRuntime && approvingFunctions.length > 0
            ? [
                ...(await this.catalogueRuntime.listRoleKeysWithFunctionAccess(approvingFunctions, [
                  RoleFunctionAccessType.APPROVE,
                  RoleFunctionAccessType.EXECUTE,
                ])),
              ]
            : [];
      return {
        ...view,
        authority: {
          approvingRoles,
          approvingFunctions,
          minimumApprovals: rule.minimumApprovals,
          // `decide()` refuses a requester's own decision unconditionally; a rule may only relax
          // that by explicitly declaring BOTH `selfApprovalProhibited: false` and no separation
          // requirement. Anything less definite is reported as prohibited (fail closed).
          selfApprovalProhibited: !(
            rule.selfApprovalProhibited === false && rule.separationRequired !== true
          ),
          minimumAssurance: rule.minimumAssurance,
          approvalScope: governedAction(view.actionType)?.approvalScope ?? view.approvalScope,
          governed: Boolean(governedAction(view.actionType)),
        },
      };
    } catch {
      return { ...view, authority: null };
    }
  }
  private rateRule(category: string) {
    const rule = this.config.rateLimits.find((item) => item.category === category);
    if (!rule) throw new ForbiddenException(`Rate-limit policy missing: ${category}`);
    return rule;
  }
  private roleRequirement(roles: readonly string[]) {
    if (roles.length > 1) return { anyOfRoles: roles };
    if (roles.length === 1) return { requiredRoles: roles };
    return {};
  }
  private async assertApproverCatalogueCapacity(
    p: AuthorizationPrincipal,
    rule: A2MakerCheckerRuleV1,
    approvingFunctionCodes: readonly string[],
  ) {
    if (p.readOnlyPrincipal) {
      throw new ForbiddenException('Approval authorization denied: READ_ONLY_PRINCIPAL');
    }
    if (
      rule.approvingRoles.length > 0 ||
      !approvingFunctionCodes.length ||
      !this.catalogueRuntime
    ) {
      return;
    }
    const check = await this.catalogueRuntime.evaluateFunctionAccess(
      p.roles,
      approvingFunctionCodes,
      [RoleFunctionAccessType.APPROVE, RoleFunctionAccessType.EXECUTE],
    );
    if (check.recognized && !check.allowed) {
      throw new ForbiddenException('Approval authorization denied: FUNCTION_MISSING');
    }
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
        ...this.roleRequirement(rule.initiatingRoles),
        ...(initiatingFunctionCodes.length ? { requiredFunctions: initiatingFunctionCodes } : {}),
        minimumAssurance: rule.minimumAssurance,
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!d.allowed) throw new ForbiddenException(`Authorization denied: ${d.reason}`);
  }
}
