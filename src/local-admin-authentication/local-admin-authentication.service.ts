import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { A2_WORKFORCE_CONFIG, A2WorkforceOidcService } from '../authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../authorization/workforce-session.service';
import type {
  A2WorkforceConfigurationV1,
  A2WorkforceSessionTokenV1,
} from '../authorization/workforce-authentication.types';
import { LocalAdminCredential } from './local-admin-credential.entity';

const PBKDF2_ITERATIONS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// V1-ADMIN-LOCAL-LOGIN-01 — the literal token recognised by the pre-existing sandbox bypass
// in A2WorkforceOidcService.validate(). Reusing it here means a successful local-admin
// password check leads into EXACTLY the same session-issuance path
// (A2WorkforceSessionService.establish) that already backs every other workforce login in
// this codebase — no parallel session/token format is introduced.
const SANDBOX_BYPASS_TOKEN = 'mock-sandbox-token-ADMIN';

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
 * This service never mints its own session, token, or authorization decision. A verified
 * password check here only obtains an `A2WorkforceAssertionEvidenceV1` from the existing
 * `A2WorkforceOidcService` sandbox bypass and exchanges it for a real session through the
 * existing `A2WorkforceSessionService.establish` — the exact same workforce
 * session/authorization/audit infrastructure every other login path in this codebase uses.
 *
 * Three independent, non-overlapping gates must all agree before this can ever produce a
 * session:
 *   1. This service refuses outside NODE_ENV=development/test (`isLocalDevelopmentEnvironment`).
 *   2. `A2WorkforceOidcService.validate` refuses the `mock-sandbox-token-*` literal outside
 *      the same two environments.
 *   3. `A2WorkforceSessionService`'s role resolution refuses to grant the sandbox principal
 *      any role outside the same two environments.
 * A production (or staging) deployment fails at gate 1 immediately, before ever touching the
 * credential table, the OIDC service, or the session service.
 */
@Injectable()
export class LocalAdminAuthenticationService {
  constructor(
    @InjectRepository(LocalAdminCredential)
    private readonly repository: Repository<LocalAdminCredential>,
    private readonly oidc: A2WorkforceOidcService,
    private readonly sessions: A2WorkforceSessionService,
    private readonly auditService: AuditService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly workforceConfig: A2WorkforceConfigurationV1,
  ) {}

  /**
   * Idempotent: calling this repeatedly with the same email never creates a second row. Used
   * exclusively by `scripts/local-dev-seed-admin.js` — never reachable from any HTTP route.
   */
  async seedDefaultAdmin(input: {
    email: string;
    password: string;
  }): Promise<{ created: boolean; email: string }> {
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
    if (existing) {
      return { created: false, email };
    }

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
      return { created: true, email };
    } catch (e) {
      // Mirrors SupportAuthenticationService.provision(): a concurrent seed racing on the
      // unique index reports "already exists" (idempotent), not a raw 500.
      if (this.isUniqueViolation(e)) {
        return { created: false, email };
      }
      throw e;
    }
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

    // Exchange the verified local credential for a REAL A2 workforce session using the
    // existing, already-reviewed sandbox bypass. No new session/token format, no new
    // authorization decision — this is the same path `oidc.validate` +
    // `sessions.establish` already provide for every other workforce login.
    const evidence = await this.oidc.validate(SANDBOX_BYPASS_TOKEN);
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
