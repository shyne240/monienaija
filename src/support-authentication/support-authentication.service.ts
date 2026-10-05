import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { SupportWorkforceUser } from './support-workforce-user.entity';
import { SupportWorkforceSession } from './support-workforce-session.entity';
import {
  SupportPasswordHashAlgorithm,
  SupportWorkforceSessionStatus,
  SupportWorkforceUserStatus,
} from './support-authentication.enums';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,160}$/;
const PBKDF2_ITERATIONS = 10_000;
const TEMPORARY_PASSWORD_BYTES = 12;
const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours — same convention as Agent/Customer credential issuance
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_SECONDS = 900; // 15 minutes — least-privilege, short-lived support session

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SupportWorkforceUserView {
  id: string;
  username: string;
  status: SupportWorkforceUserStatus;
  createdBy: string;
  createdAt: Date;
  disabledAt: Date | null;
  version: number;
}

export interface SupportWorkforceSessionTokenV1 {
  accessToken: string;
  tokenType: 'Bearer';
  sessionId: string;
  expiresAt: string;
  principal: AuthorizationPrincipal;
}

/**
 * V1-OPS-01 — minimal SUPPORT workforce identity/session mechanism.
 *
 * Deliberately separate from the A2 Finance workforce stack (OIDC + MFA + maker/checker),
 * which is schema-locked to exactly FINANCE_ADMIN/PREPARER/CONTROLLER/AUDITOR and cannot
 * accept a SUPPORT role. This mirrors the existing per-principal-type pattern already used
 * for AGENT and CUSTOMER: a dedicated credential + session store, scoped to exactly the
 * SUPPORT principal.
 *
 * Provisioning is NEVER self-service: `provision()` is only ever invoked by
 * AdminSupportCredentialsController, which requires an already-authenticated
 * OPERATOR/SERVICE/PRIVILEGED (A2) workforce principal. SUPPORT itself has no path in this
 * service, and no path anywhere in the codebase, to create or elevate any workforce identity.
 */
@Injectable()
export class SupportAuthenticationService {
  constructor(
    @InjectRepository(SupportWorkforceUser)
    private readonly userRepo: Repository<SupportWorkforceUser>,
    @InjectRepository(SupportWorkforceSession)
    private readonly sessionRepo: Repository<SupportWorkforceSession>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async provision(input: {
    username: string;
    actor: string;
  }): Promise<{ user: SupportWorkforceUserView; temporaryPassword: string; passwordExpiresAt: Date }> {
    const username = this.normalizeUsername(input.username);
    const existing = await this.userRepo.findOne({ where: { username } as never });
    if (existing) throw new ConflictException(`Support user '${username}' already exists`);

    const { plaintext, hash } = this.generateTemporaryCredential();
    const passwordExpiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS);
    const now = new Date();

    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SupportWorkforceUser);
      const saved = await repo.save(
        repo.create({
          id: randomUUID(),
          username,
          passwordHash: hash,
          hashAlgorithm: SupportPasswordHashAlgorithm.PBKDF2,
          status: SupportWorkforceUserStatus.ACTIVE,
          passwordExpiresAt,
          createdBy: input.actor,
          disabledBy: null,
          disabledAt: null,
          disableReason: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
      await this.auditService.record(manager, {
        entityType: 'SUPPORT_WORKFORCE_USER',
        entityId: saved.id,
        action: 'SUPPORT_WORKFORCE_USER_PROVISIONED',
        actor: input.actor,
        newValues: { username, status: saved.status, passwordExpiresAt },
      });
      return saved;
    });

    return { user: this.toUserView(row), temporaryPassword: plaintext, passwordExpiresAt };
  }

  async disable(id: string, actor: string, reason?: string): Promise<SupportWorkforceUserView> {
    const row = await this.userRepo.findOne({ where: { id } as never });
    if (!row) throw new NotFoundException(`Support user ${id} not found`);
    if (row.status === SupportWorkforceUserStatus.DISABLED) return this.toUserView(row);

    const now = new Date();
    const result = await this.userRepo.update(
      { id, version: row.version } as never,
      {
        status: SupportWorkforceUserStatus.DISABLED,
        disabledBy: actor,
        disabledAt: now,
        disableReason: reason?.slice(0, 500) ?? null,
        version: row.version + 1,
      } as never,
    );
    if (result.affected !== 1) {
      throw new ConflictException('Support user was modified concurrently — retry');
    }

    // Disabling a Support identity must immediately invalidate every outstanding session —
    // a previously-issued bearer token must not continue to grant access (Part E).
    await this.sessionRepo.update(
      { supportUserId: id, status: SupportWorkforceSessionStatus.ACTIVE } as never,
      {
        status: SupportWorkforceSessionStatus.REVOKED,
        revokedAt: now,
        revokeReason: 'Support user disabled',
      } as never,
    );

    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        entityType: 'SUPPORT_WORKFORCE_USER',
        entityId: id,
        action: 'SUPPORT_WORKFORCE_USER_DISABLED',
        actor,
        previousValues: { status: SupportWorkforceUserStatus.ACTIVE },
        newValues: { status: SupportWorkforceUserStatus.DISABLED, reason: reason ?? null },
      });
    });

    const updated = await this.userRepo.findOne({ where: { id } as never });
    return this.toUserView(updated!);
  }

  async enable(id: string, actor: string): Promise<SupportWorkforceUserView> {
    const row = await this.userRepo.findOne({ where: { id } as never });
    if (!row) throw new NotFoundException(`Support user ${id} not found`);
    if (row.status === SupportWorkforceUserStatus.ACTIVE) return this.toUserView(row);

    const result = await this.userRepo.update(
      { id, version: row.version } as never,
      {
        status: SupportWorkforceUserStatus.ACTIVE,
        disabledBy: null,
        disabledAt: null,
        disableReason: null,
        version: row.version + 1,
      } as never,
    );
    if (result.affected !== 1) {
      throw new ConflictException('Support user was modified concurrently — retry');
    }

    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        entityType: 'SUPPORT_WORKFORCE_USER',
        entityId: id,
        action: 'SUPPORT_WORKFORCE_USER_ENABLED',
        actor,
        previousValues: { status: SupportWorkforceUserStatus.DISABLED },
        newValues: { status: SupportWorkforceUserStatus.ACTIVE },
      });
    });

    const updated = await this.userRepo.findOne({ where: { id } as never });
    return this.toUserView(updated!);
  }

  async login(
    username: string,
    password: string,
    now = new Date(),
  ): Promise<SupportWorkforceSessionTokenV1> {
    if (typeof password !== 'string' || password.length === 0) {
      throw new UnauthorizedException('Invalid support credentials');
    }
    const normalized = this.normalizeUsername(username);
    const row = await this.userRepo.findOne({ where: { username: normalized } as never });

    // Always perform a PBKDF2 comparison, even for an unknown user, to avoid trivially
    // distinguishing "unknown username" from "wrong password" via timing.
    let verified: boolean;
    if (row) {
      verified = this.verifyPassword(password, row.passwordHash);
    } else {
      pbkdf2Sync(password, randomBytes(16), PBKDF2_ITERATIONS, 32, 'sha256');
      verified = false;
    }

    if (!row || !verified || row.status !== SupportWorkforceUserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid support credentials');
    }
    if (row.passwordExpiresAt && row.passwordExpiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException('Support credential has expired — contact an administrator');
    }

    const accessToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    const session = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SupportWorkforceSession);
      const saved = await repo.save(
        repo.create({
          id: randomUUID(),
          supportUserId: row.id,
          tokenHash: hashToken(accessToken),
          audience: 'support-workforce',
          status: SupportWorkforceSessionStatus.ACTIVE,
          issuedAt: now,
          expiresAt,
          lastSeenAt: now,
          revokedAt: null,
          revokeReason: null,
          version: 1,
        }),
      );
      await this.auditService.record(manager, {
        entityType: 'SUPPORT_WORKFORCE_SESSION',
        entityId: saved.id,
        action: 'SUPPORT_WORKFORCE_LOGIN_SUCCEEDED',
        actor: row.id,
        newValues: { username: row.username, expiresAt },
      });
      return saved;
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      principal: this.principalFor(row.id, session.id),
    };
  }

  async validate(token: string, now = new Date()): Promise<AuthorizationPrincipal> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
      throw new UnauthorizedException('Invalid support session');
    }
    const session = await this.sessionRepo.findOne({ where: { tokenHash: hashToken(token) } as never });
    if (!session) throw new UnauthorizedException('Invalid support session');
    if (session.status !== SupportWorkforceSessionStatus.ACTIVE) {
      throw new UnauthorizedException('Support session is no longer active');
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.sessionRepo.update(
        { id: session.id, status: SupportWorkforceSessionStatus.ACTIVE } as never,
        { status: SupportWorkforceSessionStatus.EXPIRED } as never,
      );
      throw new UnauthorizedException('Support session has expired');
    }

    const user = await this.userRepo.findOne({ where: { id: session.supportUserId } as never });
    if (!user || user.status !== SupportWorkforceUserStatus.ACTIVE) {
      // Defence in depth: disable() already revokes active sessions, but a session
      // validated in the same instant as a disable transaction must still be denied.
      throw new UnauthorizedException('Support identity is disabled');
    }

    await this.sessionRepo.update({ id: session.id } as never, { lastSeenAt: now } as never);
    return this.principalFor(user.id, session.id);
  }

  async revokeSession(
    sessionId: string,
    principal: AuthorizationPrincipal,
    reason: string,
    now = new Date(),
  ): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } as never });
    if (!session) throw new NotFoundException('Support session not found');
    const isSelf = principal.type === 'SUPPORT' && principal.sessionId === sessionId;
    const isPrivilegedWorkforce = ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type);
    if (!isSelf && !isPrivilegedWorkforce) {
      throw new ForbiddenException('Support session revocation denied');
    }
    if (session.status !== SupportWorkforceSessionStatus.ACTIVE) return;
    await this.sessionRepo.update(
      { id: sessionId, status: SupportWorkforceSessionStatus.ACTIVE } as never,
      {
        status: SupportWorkforceSessionStatus.REVOKED,
        revokedAt: now,
        revokeReason: reason.slice(0, 500),
      } as never,
    );
    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        entityType: 'SUPPORT_WORKFORCE_SESSION',
        entityId: sessionId,
        action: 'SUPPORT_WORKFORCE_SESSION_REVOKED',
        actor: principal.principalId,
        newValues: { reason },
      });
    });
  }

  private principalFor(supportUserId: string, sessionId: string): AuthorizationPrincipal {
    return {
      type: 'SUPPORT',
      principalId: supportUserId,
      sessionId,
      audience: 'support-workforce',
      roles: ['SUPPORT'],
      scopes: ['support:ticket:read', 'support:ticket:reply', 'support:ticket:status'],
      customerAccess: 'NONE',
      assuranceLevel: 'PASSWORD',
    };
  }

  private normalizeUsername(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException('username is required');
    const normalized = value.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(normalized)) {
      throw new BadRequestException('username must match ^[a-z0-9._-]{3,160}$');
    }
    return normalized;
  }

  private generateTemporaryCredential(): { plaintext: string; hash: string } {
    const plaintext = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(plaintext, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const hash = `PBKDF2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    return { plaintext, hash };
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

  private toUserView(row: SupportWorkforceUser): SupportWorkforceUserView {
    return {
      id: row.id,
      username: row.username,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      disabledAt: row.disabledAt,
      version: row.version,
    };
  }
}
