import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
/** Structural contract of Arena 4 InstitutionWorkforceScopeService. No implicit platform scope. */
@Injectable()
export class CashToCashWorkforceScope {
  assertCanAccessInstitution(
    _principal: AuthorizationPrincipal | undefined,
    _institutionId: string,
  ): Promise<void> {
    void _principal;
    void _institutionId;
    throw new ServiceUnavailableException('Institutional reconciliation authorization unavailable');
  }
}
