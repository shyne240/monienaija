import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  DEFAULT_SESSION_AUDIENCE,
  type AuthenticationSessionService,
} from '../customer-authentication/authentication-session.service';
import { UUID } from './kyc-orchestrator';
import { KycFoundationError } from './kyc.types';

/** Restricted internal action: record a hold only; it cannot transfer an identifier or grant KYC. */
export class KycExceptionReviewService {
  constructor(
    private readonly db: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly sessions?: Pick<
      AuthenticationSessionService,
      'revokeAllForCustomerInManager'
    >,
  ) {}
  async hold(
    principal: AuthorizationPrincipal | undefined,
    conflictId: string,
    reason: 'DUPLICATE_UNRESOLVED' | 'OWNERSHIP_DISPUTED' | 'PROVIDER_OUTCOME_UNKNOWN',
  ): Promise<void> {
    if (
      !UUID.test(conflictId) ||
      !['DUPLICATE_UNRESOLVED', 'OWNERSHIP_DISPUTED', 'PROVIDER_OUTCOME_UNKNOWN'].includes(reason)
    )
      throw new KycFoundationError('INVALID');
    if (
      principal &&
      (principal.readOnlyPrincipal === true ||
        !principal.sessionId ||
        !UUID.test(principal.sessionId) ||
        !UUID.test(principal.principalId))
    )
      throw new KycFoundationError('BLOCKED');
    const decision = await this.authorization.authorize(
      principal,
      {
        resourceType: 'KYC_IDENTITY_CONFLICT',
        action: 'kyc.review',
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredFunctions: ['kyc.review'],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      { type: 'KYC_IDENTITY_CONFLICT', id: conflictId },
    );
    if (!decision.allowed || !principal) throw new KycFoundationError('BLOCKED');
    await this.db.transaction(async (m) => {
      const rows = await m.query<Array<{ requester_customer_id: string; status: string }>>(
        'SELECT requester_customer_id,status FROM kyc_identity_conflicts WHERE id=$1 FOR UPDATE',
        [conflictId],
      );
      if (!rows[0]) throw new KycFoundationError('NOT_FOUND');
      if (rows[0].status !== 'OPEN') throw new KycFoundationError('CONFLICT');
      const id = randomUUID();
      await m.query(
        "INSERT INTO kyc_exception_reviews(id,conflict_id,reviewer_id,disposition,reason_code) VALUES($1,$2,$3,'HOLD',$4)",
        [id, conflictId, principal.principalId, reason],
      );
      await m.query("UPDATE kyc_identity_conflicts SET status='REVIEWED_HOLD' WHERE id=$1", [
        conflictId,
      ]);
      await this.sessions?.revokeAllForCustomerInManager(
        m,
        rows[0].requester_customer_id,
        principal.principalId,
        `KYC exception hold: ${reason}`,
        { audiences: [DEFAULT_SESSION_AUDIENCE], preserveSelfLogout: true },
      );
      await m.query(
        "INSERT INTO kyc_private_audit(id,customer_id,resource_id,action,actor_id,outcome) VALUES($1,$2,$3,'OWNERSHIP_REVIEWED',$4,NULL)",
        [randomUUID(), rows[0].requester_customer_id, id, principal.principalId],
      );
    });
  }
}
