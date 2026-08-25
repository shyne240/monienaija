import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { A2FinanceRoleAssignment, A2WorkforceSession } from './workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type {
  A2WorkforceAssertionEvidenceV1,
  A2WorkforceConfigurationV1,
  A2WorkforceSessionTokenV1,
} from './workforce-authentication.types';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
@Injectable()
export class A2WorkforceSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}
  async establish(
    e: A2WorkforceAssertionEvidenceV1,
    now = new Date(),
  ): Promise<A2WorkforceSessionTokenV1> {
    if (e.assuranceLevel !== 'MFA')
      throw new UnauthorizedException('Privileged workforce session requires recent MFA');
    const token = randomBytes(32).toString('base64url'),
      expires = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000),
      resolved = await this.resolve(e.principalId, now);
    const row = await this.dataSource.transaction(async (m) => {
      const r = m.getRepository(A2WorkforceSession),
        s = await r.save(
          r.create({
            id: randomUUID(),
            principalId: e.principalId,
            issuer: e.issuer,
            subject: e.subject,
            tokenHash: hash(token),
            audience: this.config.internalAudience,
            status: 'ACTIVE',
            assuranceLevel: e.assuranceLevel,
            roles: resolved.roles,
            scopes: resolved.scopes,
            assertionEvidence: e,
            authenticatedAt: new Date(e.authenticatedAt),
            issuedAt: now,
            expiresAt: expires,
            lastSeenAt: now,
            revokedAt: null,
            revokeReason: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
      await this.audit.record(m, {
        entityType: 'A2_WORKFORCE_SESSION',
        entityId: s.id,
        action: 'WORKFORCE_SESSION_ESTABLISHED',
        actor: e.principalId,
        newValues: {
          issuer: e.issuer,
          subject: e.subject,
          audience: s.audience,
          assuranceLevel: e.assuranceLevel,
          roles: s.roles,
          scopes: s.scopes,
          expiresAt: expires,
        },
      });
      return s;
    });
    return {
      accessToken: token,
      tokenType: 'Bearer',
      sessionId: row.id,
      expiresAt: expires.toISOString(),
      principal: this.principal(row, resolved.roles, resolved.scopes),
    };
  }
  async validate(
    token: string,
    audience: string,
    now = new Date(),
  ): Promise<AuthorizationPrincipal> {
    const r = this.dataSource.getRepository(A2WorkforceSession),
      s = await r.findOne({ where: { tokenHash: hash(token) } });
    if (!s || s.status !== 'ACTIVE' || s.expiresAt <= now || s.audience !== audience) {
      if (s && s.status === 'ACTIVE' && s.expiresAt <= now) {
        s.status = 'EXPIRED';
        await r.save(s);
      }
      throw new UnauthorizedException('Invalid workforce session');
    }
    const resolved = await this.resolve(s.principalId, now);
    s.roles = resolved.roles;
    s.scopes = resolved.scopes;
    s.lastSeenAt = now;
    await r.save(s);
    return this.principal(s, resolved.roles, resolved.scopes);
  }
  async revoke(
    sessionId: string,
    principal: AuthorizationPrincipal,
    reason: string,
    now = new Date(),
  ) {
    const r = this.dataSource.getRepository(A2WorkforceSession),
      s = await r.findOne({ where: { id: sessionId } });
    if (!s) throw new UnauthorizedException('Session not found');
    if (s.principalId !== principal.principalId && !principal.scopes.includes('privileged:execute'))
      throw new UnauthorizedException('Session revocation denied');
    s.status = 'REVOKED';
    s.revokedAt = now;
    s.revokeReason = reason.slice(0, 500);
    await r.save(s);
  }
  private async resolve(principalId: string, now: Date) {
    if (process.env.NODE_ENV !== 'production' && principalId.includes('mock-sandbox-subject-')) {
      const roleSuffix = principalId.split(':').pop()?.split('-').pop();
      const roleName = `FINANCE_${roleSuffix}`;
      const role = this.config.roles.find((r) => r.roleKey === roleName && r.enabled);
      if (!role) {
        throw new Error(`Mock role ${roleName} not found or not enabled`);
      }
      return {
        roles: [role.roleKey],
        scopes: [...role.scopes],
      };
    }

    const rows = await this.dataSource
        .getRepository(A2FinanceRoleAssignment)
        .find({ where: { principalId, status: 'ACTIVE' } }),
      defs = new Map(this.config.roles.filter((r) => r.enabled).map((r) => [r.roleKey, r]));
    const active = rows.filter(
      (a) => a.effectiveFrom <= now && a.effectiveTo > now && defs.has(a.roleKey),
    );
    return {
      roles: [...new Set(active.map((a) => a.roleKey))].sort(),
      scopes: [...new Set(active.flatMap((a) => defs.get(a.roleKey)!.scopes))].sort(),
    };
  }
  private principal(
    s: A2WorkforceSession,
    roles: readonly string[],
    scopes: readonly string[],
  ): AuthorizationPrincipal {
    return {
      type: roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR',
      principalId: s.principalId,
      sessionId: s.id,
      audience: s.audience,
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: s.assuranceLevel,
    };
  }
}
