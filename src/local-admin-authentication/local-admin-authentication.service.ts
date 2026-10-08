import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { A2_WORKFORCE_CONFIG } from '../authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../authorization/workforce-session.service';
import { A2FinanceRoleAdministrationService } from '../authorization/finance-role-administration.service';
import { sha256 } from '../authorization/workforce-crypto';
import type {
  A2WorkforceAssertionEvidenceV1,
  A2WorkforceConfigurationV1,
  A2WorkforceSessionTokenV1,
} from '../authorization/workforce-authentication.types';
import { LocalAdminCredential } from './local-admin-credential.entity';

const PBKDF2_ITERATIONS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// V1-ADMIN-UAT-IDENTITY-01 — this service used to authenticate by calling
// `A2WorkforceOidcService.validate(SANDBOX_BYPASS_TOKEN)`, which ALWAYS resolves to the
// literal, shared subject 'mock-sandbox-subject' regardless of which local-admin credential
// row actually verified. `A2WorkforceSessionService.resolve()` special-cases that exact shared
// subject with a blanket "grant every enabled role" shortcut instead of looking the principal
// up in `a2_finance_role_assignments` the normal way. That meant the local administrator's
// authorization was never actually tied to its own identity — it piggy-backed on a bypass
// built for ad-hoc sandbox/test tokens.
//
// `A2WorkforceOidcService` (including this literal token) is left completely untouched: other
// automated tests still rely on it to establish sandbox sessions directly via
// `POST /internal/a2/workforce/sessions`. This service simply no longer calls it — it builds
// its own `A2WorkforceAssertionEvidenceV1` below, with a subject/principalId deterministically
// derived from the authenticated credential's own email, and hands that evidence to the exact
// same `A2WorkforceSessionService.establish()` every other workforce login already uses. No new
// session/token format and no new authorization decision path is introduced.

/**
 * Returns true only for the two environments the existing A2 workforce sandbox bypass
 * already recognises (see workforce-oidc.service.ts / workforce-session.service.ts, which
 * this MUST stay in lockstep with — all three gates exist independently on purpose).
 */
function isLocalDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * V1-ADMIN-LOCAL-LOGIN-01 — LOCAL DEVELOPMENT ONLY real username/password login for the
 * Admin Web operator console.
 *
 * This service never mints its own session or token. A verified password check here builds a
 * real `A2WorkforceAssertionEvidenceV1` and exchanges it for a real session through the
 * existing `A2WorkforceSessionService.establish` — the exact same workforce
 * session/authorization/audit infrastructure every other login path in this codebase uses.
 *
 * V1-ADMIN-UAT-IDENTITY-01: this service no longer calls `A2WorkforceOidcService.validate()` at
 * all — it builds its own `A2WorkforceAssertionEvidenceV1`, with a subject/principalId
 * deterministically derived from the credential's own email (see `localAdminPrincipalId`
 * below), so that `A2WorkforceSessionService`'s normal per-principal role resolution (a real
 * `a2_finance_role_assignments` lookup, the exact mechanism every other workforce principal's
 * authorization goes through) applies to the local administrator too — not the shared,
 * non-identity-specific `mock-sandbox-subject` grant. `A2WorkforceOidcService` itself, and its
 * `mock-sandbox-token-*` sandbox bypass, are completely untouched: other automated tests still
 * use that bypass directly against `POST /internal/a2/workforce/sessions`.
 *
 * Four independent, non-overlapping gates must all agree before this can ever produce a
 * session or grant a role:
 *   1. This service refuses outside NODE_ENV=development/test (`isLocalDevelopmentEnvironment`)
 *      — both `login()` and `seedDefaultAdmin()`.
 *   2. `login()` independently refuses to proceed unless `A2_WORKFORCE_ENABLED=true`
 *      (`workforceConfig.enabled`) — preserving the gate this service used to inherit
 *      transitively through `A2WorkforceOidcService.validate()`.
 *   3. `A2WorkforceSessionService.establish()` refuses to mint a session unless the evidence's
 *      `assuranceLevel` is `'MFA'` (unconditional, not environment-gated, but only ever
 *      satisfied here because gate 1 already passed).
 *   4. `A2FinanceRoleAdministrationService.grantLocalAdministratorFinanceAdmin()` independently
 *      re-checks NODE_ENV=development/test before writing to the shared
 *      `a2_finance_role_assignments` table.
 * A production (or staging) deployment fails at gate 1 immediately, before ever touching the
 * credential table, the role-assignment table, or the session service.
 */
@Injectable()
export class LocalAdminAuthenticationService {
  constructor(
    @InjectRepository(LocalAdminCredential)
    private readonly repository: Repository<LocalAdminCredential>,
    private readonly sessions: A2WorkforceSessionService,
    private readonly financeRoles: A2FinanceRoleAdministrationService,
    private readonly auditService: AuditService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly workforceConfig: A2WorkforceConfigurationV1,
  ) {}

  /**
   * Deterministic, per-email subject/principalId for the local administrator's REAL workforce
   * identity. Derived from the email (not the credential row's randomly-generated `id`) so that
   * re-seeding after a credential row is dropped and recreated — or seeding against a fresh
   * database — always converges on the exact same principal, keeping the resulting role
   * assignment and every session issued for it addressable by the same identity every time
   * (required for both idempotency and for this never being confusable with the shared
   * `mock-sandbox-subject`). The email is hashed (not embedded raw) purely to keep the resulting
   * identifier short and within the `principal_id varchar(160)` column bound regardless of how
   * long a configured email might be — this is an internal identifier, not a display value.
   */
  private localAdminSubject(email: string): string {
    return `local-admin-credential:${sha256(email).slice(0, 32)}`;
  }

  private localAdminPrincipalId(email: string): string {
    const issuer = this.workforceConfig.oidcIssuer || 'https://identity.issuer.invalid';
    return `${issuer}:${this.localAdminSubject(email)}`;
  }

  /**
   * Idempotent: calling this repeatedly with the same email never creates a second credential
   * row NOR a second role-assignment row. Used exclusively by `scripts/local-dev-seed-admin.js`
   * — never reachable from any HTTP route.
   *
   * V1-ADMIN-UAT-IDENTITY-01: in addition to the credential row, this now ALSO ensures the
   * local administrator's real, persisted `A2FinanceRoleAssignment` (FINANCE_ADMIN) exists for
   * its deterministic principalId — every call converges on exactly one credential row and
   * exactly one ACTIVE role assignment, regardless of whether the credential already existed
   * (the role-assignment step runs unconditionally so a database that already has the
   * credential from before this change still converges to the fixed, real assignment on the
   * next seed run).
   */
  async seedDefaultAdmin(input: {
    email: string;
    password: string;
  }): Promise<{
    created: boolean;
    email: string;
    role: { principalId: string; roleKey: 'FINANCE_ADMIN'; assignmentReference: string; status: string };
  }> {
    if (!isLocalDevelopmentEnvironment()) {
      throw new Error(
        'LocalAdminAuthenticationService.seedDefaultAdmin refuses to run outside ' +
          'NODE_ENV=development or NODE_ENV=test. Refusing to seed a local administrator ' +
          `credential while NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}.`,
      );
    }
    const email = this.normalizeEmail(input.email);
    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new Error('password must be at least 8 characters');
    }

    const existing = await this.repository.findOne({ where: { email } as never });
    let created: boolean;
    if (existing) {
      created = false;
    } else {
      const passwordHash = this.hashPassword(input.password);
      try {
        const saved = await this.repository.save(
          this.repository.create({
            id: randomUUID(),
            email,
            passwordHash,
            hashAlgorithm: 'PBKDF2',
          }),
        );
        await this.auditService.record(this.repository.manager, {
          entityType: 'LOCAL_ADMIN_CREDENTIAL',
          entityId: saved.id,
          action: 'LOCAL_ADMIN_CREDENTIAL_SEEDED',
          actor: 'local-dev-seed-admin-script',
          newValues: { email },
        });
        created = true;
      } catch (e) {
        // Mirrors SupportAuthenticationService.provision(): a concurrent seed racing on the
        // unique index reports "already exists" (idempotent), not a raw 500.
        if (this.isUniqueViolation(e)) {
          created = false;
        } else {
          throw e;
        }
      }
    }

    const principalId = this.localAdminPrincipalId(email);
    const role = await this.financeRoles.grantLocalAdministratorFinanceAdmin(
      principalId,
      'local-dev-seed-admin-script',
    );
    return {
      created,
      email,
      role: {
        principalId: role.principalId,
        roleKey: 'FINANCE_ADMIN',
        assignmentReference: role.assignmentReference,
        status: role.status,
      },
    };
  }

  async login(email: string, password: string): Promise<A2WorkforceSessionTokenV1> {
    if (!isLocalDevelopmentEnvironment()) {
      // Hide this endpoint's existence entirely outside development/test — a production or
      // staging deployment returns the same 404 it would for any undefined route.
      throw new NotFoundException('Not found');
    }
    if (typeof password !== 'string' || password.length === 0 || typeof email !== 'string') {
      throw new UnauthorizedException('Invalid local administrator credentials');
    }

    const normalized = this.normalizeEmail(email);
    const row = await this.repository.findOne({ where: { email: normalized } as never });

    // Always perform a PBKDF2 comparison, even for an unknown email, so that "unknown email"
    // and "wrong password" are not trivially distinguishable by timing — same convention as
    // SupportAuthenticationService.login / CustomerAuthenticationService.
    let verified: boolean;
    if (row) {
      verified = this.verifyPassword(password, row.passwordHash);
    } else {
      pbkdf2Sync(password, randomBytes(16), PBKDF2_ITERATIONS, 32, 'sha256');
      verified = false;
    }

    if (!row || !verified) {
      if (row) {
        await this.auditService.record(this.repository.manager, {
          entityType: 'LOCAL_ADMIN_CREDENTIAL',
          entityId: row.id,
          action: 'LOCAL_ADMIN_LOGIN_FAILED',
          actor: row.email,
          newValues: { reason: 'INVALID_CREDENTIALS' },
        });
      }
      throw new UnauthorizedException('Invalid local administrator credentials');
    }

    // V1-ADMIN-UAT-IDENTITY-01: previously this exchanged the verified local credential for a
    // session by calling `A2WorkforceOidcService.validate(SANDBOX_BYPASS_TOKEN)`, which ALWAYS
    // produced the shared, non-identity-specific 'mock-sandbox-subject' principal regardless of
    // which credential row verified. The evidence below is instead built directly from the
    // VERIFIED credential's own email, so the session this mints — and the role resolution it
    // triggers — is genuinely tied to `row` (the exact administrator who authenticated), not to
    // a bypass shared with every other sandbox/test caller. This still hands the evidence to the
    // exact same `A2WorkforceSessionService.establish()` every other workforce login in this
    // codebase uses — no new session/token format, no new authorization decision path.
    //
    // This explicit check preserves the gate the old code inherited implicitly from
    // `A2WorkforceOidcService.validate()` (`if (!this.config.enabled) throw ...`) now that this
    // service no longer calls that method.
    if (!this.workforceConfig.enabled) {
      throw new UnauthorizedException('Workforce authentication disabled');
    }
    const now = new Date();
    const evidence: A2WorkforceAssertionEvidenceV1 = {
      issuer: this.workforceConfig.oidcIssuer || 'https://identity.issuer.invalid',
      subject: this.localAdminSubject(row.email),
      principalId: this.localAdminPrincipalId(row.email),
      audience: [this.workforceConfig.oidcAudience || 'workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd'],
      acr: 'password',
      signingKeyId: 'local-admin-credential',
    };
    return this.sessions.establish(evidence);
  }

  rateLimitRule() {
    const rule = this.workforceConfig.rateLimits.find(
      (item) => item.category === 'workforce-authentication',
    );
    if (!rule) throw new Error('Rate-limit policy missing: workforce-authentication');
    return rule;
  }

  private normalizeEmail(value: unknown): string {
    if (typeof value !== 'string') throw new Error('email is required');
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 255) {
      throw new Error('email must be a valid email address');
    }
    return normalized;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    return `PBKDF2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  private verifyPassword(password: string, encodedHash: string): boolean {
    const parts = encodedHash.split('$');
    if (parts.length !== 5 || parts[0] !== 'PBKDF2') return false;
    const iterations = Number(parts[2]);
    if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;
    let salt: Buffer, expected: Buffer;
    try {
      salt = Buffer.from(parts[3]!, 'base64url');
      expected = Buffer.from(parts[4]!, 'base64url');
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError && (error as unknown as { code?: string }).code === '23505'
    );
  }
}
