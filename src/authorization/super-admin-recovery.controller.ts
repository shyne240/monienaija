import { Body, Controller, ForbiddenException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthorizationPrincipal } from './authorization.types';
import { AuthorizationService } from './authorization.service';
import { A2SecurityRateLimitService } from './security-rate-limit.service';
import { SuperAdminRecoveryService } from './super-admin-recovery.service';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';

interface R extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  requestContext?: { correlationId: string };
}

/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01.
 *
 * Deliberately a SEPARATE controller class from `A2WorkforceAdministrationController` (which
 * owns the ordinary `bootstrap`/`roles`/`approvals` endpoints) — this mirrors, in code structure,
 * the governance decision that SUPER_ADMIN recovery is a structurally separate ceremony from
 * ordinary workforce/role administration, not a variant of it. It still lives under the existing
 * `/internal/a2/workforce/` path prefix, so it is covered by the same
 * `RoutePolicyRegistry`/`RuntimeAccessGuard` WORKFORCE_SESSION authentication mode as every other
 * route in that family (see route-policy-registry.ts) — no new route-policy wiring required.
 *
 * Authorization for this one route is two independent, both-mandatory layers:
 *   1. `auth.requireFunction(p, 'workforce.super_admin.recover', ...)` — the catalogue function
 *      is granted ONLY to ADMINISTRATOR (see authorization-catalogue.seed.ts); this is what
 *      prevents an ordinary OPERATOR/PRIVILEGED principal lacking that specific grant (including
 *      SUPER_ADMIN itself, and every other catalogue role) from ever reaching the service.
 *   2. `SuperAdminRecoveryService.consumeRevocation()`'s own independent
 *      `principal.roles.includes('ADMINISTRATOR')` + MFA checks (defense-in-depth — the service
 *      must remain safe even if ever called through a future, different controller).
 *
 * Neither layer, nor anything else in this file, can authorize the underlying operation by
 * itself — the cryptographically-verified statement is the only source of authority for WHAT is
 * revoked; this controller only gates WHO may ask the service to attempt consuming one.
 */
@Controller('internal/a2/workforce/super-admin')
export class SuperAdminRecoveryController {
  constructor(
    private readonly recovery: SuperAdminRecoveryService,
    private readonly auth: AuthorizationService,
    private readonly limits: A2SecurityRateLimitService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly config: A2WorkforceConfigurationV1,
  ) {}

  @Post('recovery')
  async recoverSuperAdmin(@Body() b: { statement: string }, @Req() r: R) {
    const p = this.principal(r);
    await this.auth.requireFunction(p, 'workforce.super_admin.recover', 'A2_SUPER_ADMIN_RECOVERY', [
      'OPERATOR',
      'PRIVILEGED',
    ]);
    // V1-SECURITY-SUPER-ADMIN-RECOVERY-01: reuses the existing `finance-role-administration`
    // rate-limit category (this IS a role-administration action — revoking a finance role
    // assignment) rather than introducing a new required rate-limit category. Adding a new
    // REQUIRED_RATES entry in workforce-configuration.ts would force every existing deployment's
    // A2_WORKFORCE_RATE_LIMITS_JSON to be updated before it could start — an unnecessary,
    // backward-incompatible change this task's scope does not call for.
    await this.limits.consume(
      this.rateRule('finance-role-administration'),
      [p.principalId, p.sessionId ?? 'none', 'SUPER_ADMIN_RECOVER'],
      r.requestContext?.correlationId ?? 'unknown',
    );
    return this.recovery.consumeRevocation(b.statement, p);
  }

  private principal(r: R) {
    if (!r.authorizationPrincipal) throw new ForbiddenException('Workforce principal missing');
    return r.authorizationPrincipal;
  }

  private rateRule(category: string) {
    const rule = this.config.rateLimits.find((item) => item.category === category);
    if (!rule) throw new ForbiddenException(`Rate-limit policy missing: ${category}`);
    return rule;
  }
}
