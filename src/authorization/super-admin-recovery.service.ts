import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { financeRoleAssignmentReference } from './finance-role-administration.service';
import { A2WorkforceSessionService } from './workforce-session.service';
import {
  A2FinanceRoleAssignment,
  A2SuperAdminRecoveryConsumption,
} from './workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type {
  A2RecoveryStatementV1,
  A2SuperAdminRecoveryViewV1,
  A2WorkforceConfigurationV1,
} from './workforce-authentication.types';
import { canonical, instant, parseCompactJws, sha256, text, verifyRs256 } from './workforce-crypto';

/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — "Protected CEO Recovery".
 *
 * Implements docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md §3: a structurally
 * separate offline ceremony from `A2FinanceRoleAdministrationService.consumeBootstrap()` (own
 * statement schema, own trusted-key configuration, own consumption ledger, own audit action),
 * built on the identical cryptographic trust model (RS256 JWS, canonical re-encoding check,
 * nonce-unique one-time consumption inside a SERIALIZABLE transaction).
 *
 * What this service is NOT:
 *   - It is NOT a second way to assign/revoke any ordinary role. `assign()`/`revoke()` on
 *     `A2FinanceRoleAdministrationService` remain completely untouched and still unconditionally
 *     reject `roleKey === 'SUPER_ADMIN'` — this service never calls them and never touches any
 *     other role's assignment row.
 *   - It is NOT an endpoint that can be satisfied by an authenticated session alone. The calling
 *     principal's own authority (ADMINISTRATOR role + MFA — enforced below, and redundantly by
 *     the controller's catalogue-function gate) only ever permits *consumption* of an
 *     already-valid, already-externally-signed statement. Nothing in this class can produce a
 *     statement that `verifyRs256` would accept — there is no code path here, or anywhere in the
 *     application, that holds a `A2_RECOVERY_JWKS_JSON`-trusted PRIVATE key. That key is
 *     generated and held entirely outside this application (see
 *     scripts/generate-revocation-statement.ts and the runbook) — an organizational key-custody
 *     responsibility this service deliberately does not, and cannot, solve in software.
 *   - It is NOT a new way to create a SUPER_ADMIN. The only effect of a successful consumption is
 *     revoking the one existing ACTIVE SUPER_ADMIN assignment and ending every active session for
 *     that principal; the system may legitimately then have zero ACTIVE SUPER_ADMIN until a fresh
 *     `consumeBootstrap()` ceremony is run (by design — see GOVERNANCE-DECISIONS-01 §3).
 */
@Injectable()
export class SuperAdminRecoveryService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly sessions: A2WorkforceSessionService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}

  async consumeRevocation(
    compact: string,
    principal: AuthorizationPrincipal,
    now = new Date(),
  ): Promise<A2SuperAdminRecoveryViewV1> {
    if (!this.config.recoveryEnabled) throw new ForbiddenException('Recovery disabled');
    if (principal.assuranceLevel !== 'MFA')
      throw new ForbiddenException('Recovery consumption requires MFA');
    // Defense-in-depth, independent of (not a substitute for) the controller's own
    // `requireFunction(..., 'workforce.super_admin.recover', ...)` catalogue gate, which grants
    // this ability to ADMINISTRATOR only (not SUPER_ADMIN, not any other role) — see
    // authorization-catalogue.seed.ts. SUPER_ADMIN is deliberately excluded here: the protected
    // role must never be able to both be the TARGET and the TRIGGER of its own recovery
    // ceremony, even though it could never fabricate a valid signature either way.
    if (!principal.roles.includes('ADMINISTRATOR'))
      throw new ForbiddenException('Recovery consumption requires the ADMINISTRATOR role');

    const j = parseCompactJws(compact),
      kid = String(j.header.kid),
      key = this.config.recoveryKeys.find(
        (k) => k.kid === kid && k.environment === this.config.environment,
      );
    if (!key) throw new UnauthorizedException('Unknown recovery signing key');
    verifyRs256(j, key, now);
    const encoded = Buffer.from(canonical(j.payload)).toString('base64url');
    if (compact.split('.')[1] !== encoded)
      throw new UnauthorizedException('Recovery payload is not canonical');

    const s = this.statement(j.payload),
      statementHash = sha256(canonical(s));
    if (
      s.schemaVersion !== 1 ||
      s.operation !== 'REVOKE_SUPER_ADMIN' ||
      s.environment !== this.config.environment ||
      s.audience !== this.config.recoveryAudience ||
      s.signingKeyReference !== kid
    )
      throw new UnauthorizedException('Recovery statement identity, purpose, or environment mismatch');

    const expectedRef = financeRoleAssignmentReference(
      s.targetPrincipalId,
      'SUPER_ADMIN',
      this.config.environment,
    );
    if (s.targetAssignmentReference !== expectedRef)
      throw new UnauthorizedException('Recovery statement target reference is inconsistent');

    const issued = instant(s.issuedAt, 'issuedAt'),
      expires = instant(s.expiresAt, 'expiresAt');
    if (issued > now || expires <= now)
      throw new UnauthorizedException('Recovery statement outside validity');

    return this.ds.transaction('SERIALIZABLE', async (m) => {
      const cr = m.getRepository(A2SuperAdminRecoveryConsumption),
        existing = await cr.findOne({ where: { nonce: s.nonce } });
      if (existing)
        throw new ConflictException(
          existing.statementHash === statementHash ? 'Recovery replayed' : 'Recovery nonce conflict',
        );

      const ar = m.getRepository(A2FinanceRoleAssignment),
        row = await ar.findOne({ where: { roleKey: 'SUPER_ADMIN', status: 'ACTIVE' } });
      if (!row || row.assignmentReference !== expectedRef || row.principalId !== s.targetPrincipalId)
        throw new ConflictException('No matching active SUPER_ADMIN assignment to revoke');

      row.status = 'REVOKED';
      row.revokedBy = `recovery:${principal.principalId}`;
      row.revokedAt = now;
      await ar.save(row);

      const revokedSessionCount = await this.sessions.revokeAllForPrincipal(
        m,
        s.targetPrincipalId,
        s.reason,
        now,
      );

      const recoveryReference = `a2-recovery-${statementHash.slice(0, 32)}`;
      const event = await this.audit.record(m, {
        entityType: 'A2_FINANCE_ROLE_ASSIGNMENT',
        entityId: row.id,
        action: 'SUPER_ADMIN_REVOKED',
        actor: principal.principalId,
        newValues: {
          recoveryReference,
          nonce: s.nonce,
          operation: s.operation,
          targetAssignmentReference: s.targetAssignmentReference,
          targetPrincipalId: s.targetPrincipalId,
          reason: s.reason,
          environment: s.environment,
          audience: s.audience,
          approvalChangeReference: s.approvalChangeReference,
          signingKeyReference: s.signingKeyReference,
          kid,
          revokedSessionCount,
        },
      });

      await cr.save(
        cr.create({
          id: randomUUID(),
          recoveryReference,
          nonce: s.nonce,
          statementHash,
          operation: 'REVOKE_SUPER_ADMIN',
          targetAssignmentReference: s.targetAssignmentReference,
          targetPrincipalId: s.targetPrincipalId,
          reason: s.reason,
          environment: s.environment,
          audience: s.audience,
          signingKeyReference: s.signingKeyReference,
          approvalChangeReference: s.approvalChangeReference,
          consumedBy: principal.principalId,
          consumedAt: now,
          auditReference: event.id,
          createdAt: now,
        }),
      );

      return {
        recoveryReference,
        operation: 'REVOKE_SUPER_ADMIN',
        targetAssignmentReference: s.targetAssignmentReference,
        targetPrincipalId: s.targetPrincipalId,
        reason: s.reason,
        revokedSessionCount,
        consumedBy: principal.principalId,
        consumedAt: now.toISOString(),
        auditReference: event.id,
      };
    });
  }

  private statement(p: Record<string, unknown>): A2RecoveryStatementV1 {
    return {
      schemaVersion: p.schemaVersion as 1,
      operation: text(p.operation, 'operation', 40) as 'REVOKE_SUPER_ADMIN',
      environment: text(p.environment, 'environment', 80),
      audience: text(p.audience, 'audience', 80),
      targetAssignmentReference: text(
        p.targetAssignmentReference,
        'targetAssignmentReference',
        160,
      ),
      targetPrincipalId: text(p.targetPrincipalId, 'targetPrincipalId', 160),
      reason: text(p.reason, 'reason', 500),
      approvalChangeReference: text(p.approvalChangeReference, 'approvalChangeReference', 160),
      nonce: text(p.nonce, 'nonce'),
      issuedAt: text(p.issuedAt, 'issuedAt'),
      expiresAt: text(p.expiresAt, 'expiresAt'),
      signingKeyReference: text(p.signingKeyReference, 'signingKeyReference', 160),
    };
  }
}
