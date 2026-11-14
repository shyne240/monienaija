import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';

/**
 * Cash-to-Cash reconciliation access control.
 *
 * Delegates to the authoritative {@link InstitutionWorkforceScopeService} (ARENA 4 Phase 1/3):
 * a principal reaches an institution only through a current ACTIVE
 * `workforce_institution_assignments` row, or through the explicit platform function
 * `institution.attribution.view`. Assignments are read on every request, so a revocation takes
 * effect immediately for an existing session.
 *
 * There is no implicit platform scope: when the service is not wired (plain unit construction) the
 * answer is a 503, not a grant.
 */
@Injectable()
export class CashToCashWorkforceScope {
  constructor(
    @Optional()
    private readonly institutionScope?: InstitutionWorkforceScopeService,
  ) {}

  async assertCanAccessInstitution(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string,
  ): Promise<void> {
    if (!this.institutionScope) {
      throw new ServiceUnavailableException(
        'Institutional reconciliation authorization unavailable',
      );
    }
    await this.institutionScope.assertCanAccessInstitution(principal, institutionId);
  }

  /** Explicit platform authority, by catalogue function only — never a default. */
  hasPlatformAuthority(principal: AuthorizationPrincipal | undefined): boolean {
    return this.institutionScope?.hasPlatformAuthority(principal) ?? false;
  }
}
