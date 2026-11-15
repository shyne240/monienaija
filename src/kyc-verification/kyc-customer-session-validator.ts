import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { DEFAULT_SESSION_AUDIENCE } from '../customer-authentication/authentication-session.service';
import type {
  AuthenticationSessionValidation,
  AuthenticatedPrincipal,
  CustomerSessionValidator,
  ValidateAuthenticationSessionCommand,
} from '../customer-authentication/authentication-session.types';

export const CUSTOMER_ONBOARDING_AUDIENCE = 'customer-onboarding';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Validates the restricted mobile-onboarding session used by customers who do not yet have
 * financial eligibility. It deliberately checks session, customer lifecycle, credential binding,
 * lock and password-version state without invoking financial eligibility. The token is only
 * accepted by the KYC-only routes that explicitly pass this audience; it never creates a general
 * customer principal or financial session.
 */
export class KycCustomerSessionValidator implements CustomerSessionValidator {
  constructor(private readonly financialSessions: CustomerSessionValidator) {}

  async validateInManager(
    manager: EntityManager,
    command: ValidateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    const audience = command.audience ?? DEFAULT_SESSION_AUDIENCE;
    if (audience === DEFAULT_SESSION_AUDIENCE)
      return this.financialSessions.validateInManager(manager, command);
    if (audience !== CUSTOMER_ONBOARDING_AUDIENCE || !TOKEN.test(command.token))
      return { valid: false, reason: 'WRONG_AUDIENCE' };

    const mode = command.mode ?? 'READ';
    const lock = mode === 'MUTATION' ? 'FOR UPDATE OF s,c,a' : 'FOR SHARE OF s,c,a';
    const tokenHash = createHash('sha256').update(command.token).digest('hex');
    const rows = await manager.query<
      Array<{
        session_id: string;
        customer_id: string;
        credential_id: string;
        audience: string;
        issued_at: Date;
        expires_at: Date;
      }>
    >(
      `SELECT s.id AS session_id,s.customer_id,s.credential_id,s.audience,s.issued_at,s.expires_at
       FROM authentication_sessions s
       JOIN customers c ON c.id=s.customer_id
       JOIN customer_authentication_credentials a ON a.id=s.credential_id AND a.customer_id=c.id
       WHERE s.token_hash=$1 AND s.audience=$2 AND s.status='ACTIVE'
         AND s.expires_at>clock_timestamp() AND c.deleted_at IS NULL
         AND c.status IN ('DRAFT','ACTIVE') AND c.is_synthetic=false
         AND a.deleted_at IS NULL AND a.status='ACTIVE' AND NOT a.account_locked
         AND NOT a.rotation_required
         AND a.password_version=s.onboarding_password_version
         AND (a.password_expires_at IS NULL OR a.password_expires_at>clock_timestamp())
       ${lock}`,
      [tokenHash, CUSTOMER_ONBOARDING_AUDIENCE],
    );
    const row = rows[0];
    if (!row) return { valid: false, reason: 'NOT_FOUND' };
    const principal: AuthenticatedPrincipal = {
      principalType: 'CUSTOMER',
      customerId: row.customer_id,
      credentialId: row.credential_id,
      sessionId: row.session_id,
      audience: row.audience,
      authenticatedAt: row.issued_at,
      expiresAt: row.expires_at,
    };
    return { valid: true, principal };
  }
}
