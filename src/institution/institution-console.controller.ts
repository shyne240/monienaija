import { Controller, Get, Param, Query, Req, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { InstitutionConsoleService } from './institution-console.service';
import { InstitutionWorkforceScopeService } from './institution-workforce-scope.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const WORKFORCE_TYPES = ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

/**
 * Read-only console reads that the Phase 1/2 institution API did not expose.
 *
 * These are deliberately minimal: no writes, no new approval mechanism and no new financial
 * authority. Both routes are additive to the existing surface and reuse the same function codes,
 * institution scoping and 404-not-403 denial convention as the rest of the institution module.
 */
@Controller('internal/institutions')
export class InstitutionConsoleReadController {
  constructor(
    private readonly console: InstitutionConsoleService,
    private readonly scope: InstitutionWorkforceScopeService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Governed-action requests naming this institution, awaiting a checker or execution.
   * Institution-scoped: a supervisor only ever sees their own institution's queue.
   */
  @Get(':institutionId/pending-approvals')
  async pendingApprovals(
    @Param('institutionId') institutionId: string,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = this.requirePrincipal(req);
    await this.authorization.requireFunction(
      principal,
      'institution.view',
      'institution-pending-approvals',
      WORKFORCE_TYPES,
    );
    await this.scope.assertCanAccessInstitution(principal, institutionId);
    return this.console.listPendingApprovals(
      institutionId,
      limit === undefined ? undefined : Number(limit),
    );
  }

  private requirePrincipal(req: AuthenticatedRequest): AuthorizationPrincipal {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}

/**
 * Cross-agent institutional relationship directory.
 *
 * Platform read only (`institution.attribution.view`): the answer covers agents across institutions,
 * including agents with no affiliation at all, so it can never be served to institution-scoped staff
 * who would otherwise learn about another institution's agents.
 */
@Controller('internal/institution-agent-directory')
export class InstitutionAgentDirectoryController {
  constructor(
    private readonly console: InstitutionConsoleService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async directory(
    @Query('institutionId') institutionId: string | undefined,
    @Query('affiliation') affiliation: string | undefined,
    @Query('search') search: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    await this.authorization.requireFunction(
      principal,
      'institution.attribution.view',
      'institution-agent-directory',
      WORKFORCE_TYPES,
    );
    return this.console.listAgentAffiliationDirectory({
      institutionId,
      affiliation:
        affiliation === 'AFFILIATED' || affiliation === 'UNAFFILIATED' ? affiliation : undefined,
      search,
      limit: limit === undefined ? undefined : Number(limit),
    });
  }
}
