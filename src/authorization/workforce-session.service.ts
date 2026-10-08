import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../operations/audit.service';
import { AuthorizationCatalogueRuntimeService } from '../authorization-catalogue/authorization-catalogue-runtime.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { A2FinanceRoleAssignment, A2WorkforceSession } from './workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type {
  A2WorkforceAssertionEvidenceV1,
  A2WorkforceConfigurationV1,
  A2WorkforceSessionTokenV1,
} from './workforce-authentication.types';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');

interface ResolvedPrincipalRoles {
  roles: readonly string[];
  scopes: readonly string[];
  /** V1-ADMIN-AUTHORIZATION-RUNTIME-01: catalogue- (or, as fallback, legacy-config-) derived. */
  administrativeCapability: boolean;
  /** V1-ADMIN-AUTHORIZATION-RUNTIME-01: true only when every recognized role is catalogue-flagged read-only. */
  readOnlyPrincipal: boolean;
}

@Injectable()
export class A2WorkforceSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly catalogue: AuthorizationCatalogueRuntimeService,
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
      principal: this.principal(row, resolved),
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
    return this.principal(s, resolved);
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
  /**
   * V1-ADMIN-AUTHORIZATION-RUNTIME-01: roles/scopes now resolve against BOTH sources —
   *
   *   1. `this.config.roles` (A2_FINANCE_ROLES_JSON) — the legacy, 4-slot configuration that
   *      supplies the literal scope strings (`privileged:execute`, `finance:prepare`, ...) the
   *      out-of-scope B1/B2F maker/checker frameworks and `PrivilegedActionApprovalService` still
   *      consume directly. SUPER_ADMIN occupies the slot FINANCE_ADMIN used to (see
   *      workforce-configuration.ts) — this config is NOT the organizational role authority
   *      anymore, it is retained only as a legacy scope-compatibility provider.
   *   2. `authorization_roles` / `authorization_role_functions` (the DB catalogue seeded by
   *      AuthorizationCatalogueSeedService) — the authoritative, ten-role organizational model.
   *      Every role key held by a principal is looked up here regardless of whether it is also
   *      present in (1), which is what makes the six catalogue-only roles (OPERATIONS,
   *      AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY) resolvable at
   *      all — `config.roles` has no entries for them and never will (they have no legacy scope
   *      semantics to provide).
   *
   * `principal.scopes` is the UNION of both sources' outputs, so existing `requiredScopes`
   * policies (legacy strings) and new `requiredFunctions` policies (catalogue function codes)
   * can both be evaluated off the same flat array.
   */
  private async resolve(principalId: string, now: Date): Promise<ResolvedPrincipalRoles> {
    // V1-RELEASE-01: narrowed from `NODE_ENV !== 'production'` to an explicit
    // development/test allowlist for the same reason documented in
    // A2WorkforceOidcService.validate() — `staging` must never grant this. This must stay
    // in lockstep with the gate in workforce-oidc.service.ts (the only caller that can ever
    // produce a `mock-sandbox-subject` principalId).
    const sandboxBypassAllowed =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (sandboxBypassAllowed && principalId.includes('mock-sandbox-subject')) {
      const defs = this.config.roles.filter((r) => r.enabled);
      const roleKeys = defs.map((r) => r.roleKey);
      const legacyScopes = defs.flatMap((r) => r.scopes);
      const legacyAdministrative = defs.some((r) => r.administrativeCapability);
      const catalogue = await this.catalogue.resolveForRoleKeys(roleKeys);
      return {
        roles: [...new Set(roleKeys)].sort(),
        scopes: [...new Set([...legacyScopes, ...catalogue.functionCodes])].sort(),
        administrativeCapability: legacyAdministrative || catalogue.hasAdministrativeCapability,
        readOnlyPrincipal:
          catalogue.recognizedRoleKeys.length > 0 && catalogue.allRecognizedRolesReadOnly,
      };
    }

    const rows = await this.dataSource
      .getRepository(A2FinanceRoleAssignment)
      .find({ where: { principalId, status: 'ACTIVE' } });
    const legacyDefs = new Map(this.config.roles.filter((r) => r.enabled).map((r) => [r.roleKey, r]));
    const active = rows.filter((a) => a.effectiveFrom <= now && a.effectiveTo > now);
    const activeRoleKeys = [...new Set(active.map((a) => a.roleKey))];

    const catalogue = await this.catalogue.resolveForRoleKeys(activeRoleKeys);

    // A roleKey survives into principal.roles if EITHER source recognizes it — fail-closed for
    // any genuinely unknown roleKey (neither legacy config nor the catalogue has ever heard of
    // it), identical to the old behaviour of silently dropping assignment rows config.roles did
    // not recognize.
    const recognizedRoleKeys = activeRoleKeys.filter(
      (k) => legacyDefs.has(k) || catalogue.recognizedRoleKeys.includes(k),
    );
    const legacyScopes = recognizedRoleKeys.flatMap((k) => legacyDefs.get(k)?.scopes ?? []);
    const legacyAdministrative = recognizedRoleKeys.some(
      (k) => legacyDefs.get(k)?.administrativeCapability === true,
    );

    return {
      roles: recognizedRoleKeys.sort(),
      scopes: [...new Set([...legacyScopes, ...catalogue.functionCodes])].sort(),
      administrativeCapability: legacyAdministrative || catalogue.hasAdministrativeCapability,
      readOnlyPrincipal:
        catalogue.recognizedRoleKeys.length > 0 &&
        recognizedRoleKeys.every((k) => catalogue.recognizedRoleKeys.includes(k)) &&
        catalogue.allRecognizedRolesReadOnly,
    };
  }
  private principal(s: A2WorkforceSession, resolved: ResolvedPrincipalRoles): AuthorizationPrincipal {
    return {
      // V1-ADMIN-AUTHORIZATION-RUNTIME-01: generalized from the hardcoded
      // `roles.includes('FINANCE_ADMIN')` literal to the catalogue's (or, as fallback, legacy
      // config's) `administrative_capability` flag — see ResolvedPrincipalRoles. `type` here is
      // still only ever OPERATOR/PRIVILEGED; it is NOT a proxy for any specific administrative
      // function (see `requiredFunctions` / AuthorizationCatalogueRuntimeService for that).
      type: resolved.administrativeCapability ? 'PRIVILEGED' : 'OPERATOR',
      principalId: s.principalId,
      sessionId: s.id,
      audience: s.audience,
      roles: resolved.roles,
      scopes: resolved.scopes,
      customerAccess: 'NONE',
      assuranceLevel: s.assuranceLevel,
      readOnlyPrincipal: resolved.readOnlyPrincipal,
    };
  }
}
