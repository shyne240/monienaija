import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthorizationService } from './authorization.service';
import type { AuthorizationPrincipal } from './authorization.types';
import {
  RoleDefinitionFunctionGrantInput,
  RoleDefinitionGovernanceService,
} from './role-definition-governance.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';

interface R extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId: string };
}

/**
 * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01
 *
 * HTTP surface for the governed role-definition workflow. Every route lives under the same
 * `/internal/a2/workforce/` prefix as `A2WorkforceAdministrationController` (recognized by
 * `RoutePolicyRegistry` as WORKFORCE_SESSION), but is kept in its own controller/file to avoid
 * growing that controller further. Every handler performs its own `AuthorizationService`
 * function-code gate (defense-in-depth alongside the service-layer role checks in
 * `RoleDefinitionGovernanceService`) — mirroring the existing `workforce.role.assign_operational`
 * pattern.
 */
@Controller('internal/a2/workforce/role-definitions')
export class RoleDefinitionGovernanceController {
  constructor(
    private readonly governance: RoleDefinitionGovernanceService,
    private readonly auth: AuthorizationService,
    private readonly limits: A2SecurityRateLimitService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}

  @Post('proposals')
  async submit(
    @Body()
    b: {
      proposalType: 'CREATE' | 'MODIFY';
      roleKey: string;
      displayName: string;
      description: string;
      readOnly?: boolean;
      functionGrants: RoleDefinitionFunctionGrantInput[];
      deactivate?: boolean;
      expectedDefinitionVersion?: number;
      reason: string;
      expiresInSeconds?: number;
    },
    @Req() r: R,
  ) {
    const p = this.principal(r);
    const functionCode = b?.proposalType === 'MODIFY' ? 'workforce.role.modify' : 'workforce.role.create';
    await this.auth.requireFunction(p, functionCode, 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [p.principalId, p.sessionId ?? 'none', 'ROLE_DEFINITION_PROPOSAL_SUBMIT'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.governance.submit({
      ...b,
      principal: p,
      correlationId: r.requestContext?.correlationId,
    });
  }

  @Post('proposals/:id/approve')
  async approve(@Param('id') id: string, @Body() b: { comment?: string }, @Req() r: R) {
    const p = this.principal(r);
    const proposal = await this.governance.getProposal(id);
    if (!proposal) throw new NotFoundException('Role definition proposal not found');
    const functionCode = proposal.proposalType === 'MODIFY' ? 'workforce.role.modify' : 'workforce.role.create';
    await this.auth.requireFunction(p, functionCode, 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [p.principalId, p.sessionId ?? 'none', 'ROLE_DEFINITION_PROPOSAL_APPROVE'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.governance.approve({
      proposalId: id,
      principal: p,
      comment: b?.comment,
      correlationId: r.requestContext?.correlationId,
    });
  }

  @Post('proposals/:id/reject')
  async reject(@Param('id') id: string, @Body() b: { comment?: string }, @Req() r: R) {
    const p = this.principal(r);
    const proposal = await this.governance.getProposal(id);
    if (!proposal) throw new NotFoundException('Role definition proposal not found');
    const functionCode = proposal.proposalType === 'MODIFY' ? 'workforce.role.modify' : 'workforce.role.create';
    await this.auth.requireFunction(p, functionCode, 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [p.principalId, p.sessionId ?? 'none', 'ROLE_DEFINITION_PROPOSAL_REJECT'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.governance.reject({
      proposalId: id,
      principal: p,
      comment: b?.comment,
      correlationId: r.requestContext?.correlationId,
    });
  }

  @Post('proposals/:id/apply')
  async apply(@Param('id') id: string, @Req() r: R) {
    const p = this.principal(r);
    const proposal = await this.governance.getProposal(id);
    if (!proposal) throw new NotFoundException('Role definition proposal not found');
    const functionCode = proposal.proposalType === 'MODIFY' ? 'workforce.role.modify' : 'workforce.role.create';
    await this.auth.requireFunction(p, functionCode, 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    await this.limits.consume(
      this.rateRule('privileged-approval'),
      [p.principalId, p.sessionId ?? 'none', 'ROLE_DEFINITION_PROPOSAL_APPLY'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.governance.apply({
      proposalId: id,
      principal: p,
      correlationId: r.requestContext?.correlationId,
    });
  }

  @Get('proposals/:id')
  async getOne(@Param('id') id: string, @Req() r: R) {
    const p = this.principal(r);
    await this.auth.requireFunction(p, 'workforce.role.view', 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    const proposal = await this.governance.getProposal(id);
    if (!proposal) throw new NotFoundException('Role definition proposal not found');
    return proposal;
  }

  @Get('proposals')
  async list(@Query('status') status: string | undefined, @Query('roleKey') roleKey: string | undefined, @Req() r: R) {
    const p = this.principal(r);
    await this.auth.requireFunction(p, 'workforce.role.view', 'ROLE_DEFINITION_PROPOSAL', ['OPERATOR', 'PRIVILEGED']);
    return this.governance.listProposals({ status, roleKey });
  }

  private principal(r: R) {
    if (!r.authorizationPrincipal) throw new ForbiddenException('Workforce principal missing');
    return r.authorizationPrincipal;
  }

  private rateRule(category: string) {
    const rule = this.config.rateLimits.find((item) => item.category === category);
    if (!rule) throw new ForbiddenException(`Rate-limit policy missing: ${category}`);
    return rule;
  }
}
