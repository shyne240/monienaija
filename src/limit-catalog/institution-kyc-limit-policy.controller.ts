import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import { InstitutionKycLimitPolicyService } from './institution-kyc-limit-policy.service';

interface WorkforceRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

@Controller('internal/institutions/:institutionId/kyc-tier-limit-policy')
export class InstitutionKycLimitPolicyController {
  constructor(
    private readonly policies: InstitutionKycLimitPolicyService,
    private readonly institutionScope: InstitutionWorkforceScopeService,
  ) {}

  @Get()
  async view(@Param('institutionId') institutionId: string, @Req() req: WorkforceRequest) {
    await this.requireInstitutionScope(req.authorizationPrincipal, institutionId);
    return this.policies.view(req.authorizationPrincipal, institutionId);
  }

  @Get('proposals')
  async proposals(@Param('institutionId') institutionId: string, @Req() req: WorkforceRequest) {
    await this.requireInstitutionScope(req.authorizationPrincipal, institutionId);
    return this.policies.proposals(req.authorizationPrincipal, institutionId);
  }

  @Post('proposals')
  @HttpCode(200)
  async propose(
    @Param('institutionId') institutionId: string,
    @Req() req: WorkforceRequest,
    @Body() body: unknown,
  ) {
    await this.requireInstitutionScope(req.authorizationPrincipal, institutionId);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid institutional KYC tier-limit policy proposal');
    const value = body as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'definition,expectedVersion,reason,requestId' ||
      typeof value.requestId !== 'string' ||
      typeof value.expectedVersion !== 'number' ||
      typeof value.reason !== 'string'
    )
      throw new BadRequestException('Invalid institutional KYC tier-limit policy proposal');
    return this.policies.propose(req.authorizationPrincipal, {
      institutionId,
      requestId: value.requestId,
      expectedVersion: value.expectedVersion,
      definition: value.definition,
      reason: value.reason,
    });
  }

  @Post('proposals/:proposalId/approve')
  @HttpCode(200)
  async approve(
    @Param('institutionId') institutionId: string,
    @Param('proposalId') proposalId: string,
    @Req() req: WorkforceRequest,
  ) {
    await this.requireInstitutionScope(req.authorizationPrincipal, institutionId);
    return this.policies.decide(req.authorizationPrincipal, institutionId, proposalId, true);
  }

  @Post('proposals/:proposalId/reject')
  @HttpCode(200)
  async reject(
    @Param('institutionId') institutionId: string,
    @Param('proposalId') proposalId: string,
    @Req() req: WorkforceRequest,
  ) {
    await this.requireInstitutionScope(req.authorizationPrincipal, institutionId);
    return this.policies.decide(req.authorizationPrincipal, institutionId, proposalId, false);
  }

  private async requireInstitutionScope(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string,
  ): Promise<void> {
    if (!principal) throw new UnauthorizedException('Authentication required');
    try {
      await this.institutionScope.assertCanAccessInstitution(principal, institutionId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException)
        throw error;
      // A missing institution assignment is intentionally indistinguishable from an absent
      // institution, matching the institution-scoped console and directory surfaces.
      throw error;
    }
  }
}
