import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  AttributionGapQueryDto,
  ExecuteInstitutionAffiliationDto,
  ExecuteInstitutionLifecycleDto,
  GrantInstitutionScopeDto,
  LinkAggregatorDto,
  RecordRegulatoryEvidenceDto,
  RegisterInstitutionDto,
  RequestInstitutionAffiliationDto,
  RequestInstitutionLifecycleDto,
} from './dto/institution.dto';
import { FinancialInstitutionService } from './financial-institution.service';
import { InstitutionAffiliationService } from './institution-affiliation.service';
import { InstitutionReconciliationService } from './institution-reconciliation.service';
import { InstitutionWorkforceScopeService } from './institution-workforce-scope.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Institutional administration surface (ARENA 4 Phase 1).
 *
 * Every route is reachable only through the existing workforce-session policy that covers the
 * `/api/v1/internal/...` prefix, and each route then requires an explicit catalogue function.
 * Institution-scoped reads and writes are additionally resolved against
 * `workforce_institution_assignments` at request time: holding `institution.view` never grants
 * access to every institution, and the only cross-institution authority is the explicit
 * `institution.attribution.view` platform marker.
 *
 * Nothing here can set `status = 'APPROVED'` directly: registration and evidence are
 * administrative, and operational approval/suspension/closure go through
 * `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` maker-checker consumption. Affiliation writes go
 * through `INSTITUTION_AGENT_AFFILIATION_CHANGE`. No route moves balances, commitments or history.
 */
@Controller('internal/institutions')
export class InstitutionController {
  constructor(
    private readonly institutions: FinancialInstitutionService,
    private readonly affiliations: InstitutionAffiliationService,
    private readonly reconciliation: InstitutionReconciliationService,
    private readonly scope: InstitutionWorkforceScopeService,
    private readonly authorization: AuthorizationService,
  ) {}

  // ------------------------------------------------------------------ platform reads

  /** Read-only attribution-gap report. Platform-level authority only; never writes. */
  @Get('attribution-gaps')
  async attributionGaps(@Query() query: AttributionGapQueryDto, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'institution-attribution-gaps');
    return this.reconciliation.listAttributionGaps({
      entityId: query.entityId,
      limit: query.limit,
    });
  }

  @Get('attribution-gaps/summary')
  async attributionGapSummary(@Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'institution-attribution-gaps');
    return this.reconciliation.attributionGapSummary();
  }

  // ------------------------------------------------------------------ institution writes

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterInstitutionDto, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'institution-register');
    return this.institutions.register({
      reference: dto.reference,
      code: dto.code,
      legalName: dto.legalName,
      displayName: dto.displayName,
      institutionType: dto.institutionType,
      regulatorName: dto.regulatorName,
      licenceReference: dto.licenceReference,
      principal,
    });
  }

  @Post(':institutionId/evidence')
  @HttpCode(HttpStatus.CREATED)
  async recordEvidence(
    @Param('institutionId') institutionId: string,
    @Body() dto: RecordRegulatoryEvidenceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.manage',
      'institution-evidence',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.recordRegulatoryEvidence({
      institutionId,
      evidenceReference: dto.evidenceReference,
      evidenceDigest: dto.evidenceDigest,
      regulatorName: dto.regulatorName,
      licenceReference: dto.licenceReference,
      principal,
    });
  }

  @Post(':institutionId/lifecycle/request')
  @HttpCode(HttpStatus.CREATED)
  async requestLifecycle(
    @Param('institutionId') institutionId: string,
    @Body() dto: RequestInstitutionLifecycleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.lifecycle.prepare',
      'institution-lifecycle-prepare',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.requestLifecycleChange({
      institutionId,
      targetStatus: dto.targetStatus as never,
      reason: dto.reason,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Post(':institutionId/lifecycle')
  @HttpCode(HttpStatus.CREATED)
  async executeLifecycle(
    @Param('institutionId') institutionId: string,
    @Body() dto: ExecuteInstitutionLifecycleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.lifecycle.approve',
      'institution-lifecycle-approve',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.executeLifecycleChange({
      institutionId,
      targetStatus: dto.targetStatus as never,
      reason: dto.reason,
      approvalId: dto.approvalId,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Post(':institutionId/aggregators')
  @HttpCode(HttpStatus.CREATED)
  async linkAggregator(
    @Param('institutionId') institutionId: string,
    @Body() dto: LinkAggregatorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.manage',
      'institution-aggregator-link',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.linkAggregator({
      institutionId,
      aggregatorId: dto.aggregatorId,
      principal,
    });
  }

  @Delete(':institutionId/aggregators/:aggregatorId')
  async unlinkAggregator(
    @Param('institutionId') institutionId: string,
    @Param('aggregatorId') aggregatorId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.manage',
      'institution-aggregator-unlink',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.unlinkAggregator({ institutionId, aggregatorId, principal });
  }

  // ------------------------------------------------------------------ workforce scope

  @Post(':institutionId/workforce')
  @HttpCode(HttpStatus.CREATED)
  async grantScope(
    @Param('institutionId') institutionId: string,
    @Body() dto: GrantInstitutionScopeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(
      principal,
      'institution-workforce-grant',
      'institution.workforce.assign',
    );
    return this.scope.grant({ institutionId, principalId: dto.principalId, principal });
  }

  @Delete(':institutionId/workforce/:principalId')
  async revokeScope(
    @Param('institutionId') institutionId: string,
    @Param('principalId') principalId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(
      principal,
      'institution-workforce-revoke',
      'institution.workforce.assign',
    );
    return this.scope.revoke({ institutionId, principalId, principal });
  }

  @Get(':institutionId/workforce')
  async listScope(@Param('institutionId') institutionId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-workforce-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.scope.listForInstitution(institutionId);
  }

  // ------------------------------------------------------------------ institution reads

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-list',
      WORKFORCE_TYPES,
    );
    const allowed = this.scope.hasPlatformAuthority(principal)
      ? undefined
      : await this.scope.institutionIdsForPrincipal(principal.principalId);
    return this.institutions.list(allowed);
  }

  @Get(':institutionId/affiliations')
  async listAffiliations(
    @Param('institutionId') institutionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-affiliations-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.affiliations.listForInstitution(institutionId);
  }

  @Get(':institutionId')
  async getById(@Param('institutionId') institutionId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-read',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.institutions.getById(institutionId);
  }

  // ------------------------------------------------------------------ helpers

  private async requirePlatform(
    principal: AuthorizationPrincipal,
    resourceType: string,
    functionCode = 'institution.attribution.view',
  ): Promise<void> {
    await this.authorization.requireFunction(
      principal,
      functionCode,
      resourceType,
      WORKFORCE_TYPES,
    );
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}

/**
 * Agent-anchored institutional reads. Cross-agent lookups are platform reads only
 * (`institution.attribution.view`), so an institution-scoped operator can never enumerate another
 * institution's agents through this surface.
 */
@Controller('internal/agent-affiliations')
export class AgentAffiliationController {
  constructor(
    private readonly affiliations: InstitutionAffiliationService,
    private readonly reconciliation: InstitutionReconciliationService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get(':agentId')
  async current(@Param('agentId') agentId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'agent-affiliation-read');
    return this.affiliations.getForAgent(agentId);
  }

  @Get(':agentId/history')
  async history(@Param('agentId') agentId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'agent-affiliation-history');
    return this.affiliations.listHistoryForAgent(agentId);
  }

  @Get(':agentId/resolution')
  async resolution(@Param('agentId') agentId: string, @Req() req: AuthenticatedRequest) {
    const principal = this.requirePrincipal(req);
    await this.requirePlatform(principal, 'agent-institution-resolution');
    return this.reconciliation.resolutionForAgent(agentId);
  }

  @Post(':agentId/request')
  @HttpCode(HttpStatus.CREATED)
  async request(
    @Param('agentId') agentId: string,
    @Body() dto: RequestInstitutionAffiliationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.affiliation.prepare',
      'agent-affiliation-prepare',
      WORKFORCE_TYPES,
    );
    return this.affiliations.requestAffiliation({
      agentId,
      institutionId: dto.institutionId,
      changeKind: dto.changeKind,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  @Post(':agentId/execute')
  @HttpCode(HttpStatus.CREATED)
  async execute(
    @Param('agentId') agentId: string,
    @Body() dto: ExecuteInstitutionAffiliationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.affiliation.approve',
      'agent-affiliation-approve',
      WORKFORCE_TYPES,
    );
    return this.affiliations.executeAffiliation({
      agentId,
      institutionId: dto.institutionId,
      changeKind: dto.changeKind,
      evidenceType: dto.evidenceType,
      evidenceReference: dto.evidenceReference,
      reason: dto.reason,
      approvalId: dto.approvalId,
      expiresInSeconds: dto.expiresInSeconds,
      principal,
    });
  }

  private async requirePlatform(principal: AuthorizationPrincipal, resourceType: string) {
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      resourceType,
      WORKFORCE_TYPES,
    );
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}
