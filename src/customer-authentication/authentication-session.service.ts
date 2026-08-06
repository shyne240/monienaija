import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import type { AuthenticationExecutionResult } from './authentication-execution.service';
import type { AuditService } from '../operations/audit.service';
import { AuthenticationSession } from './authentication-session.entity';
import { AuthenticationSessionStatus } from './authentication-session.enums';
import type {
  AuthenticatedPrincipal,
  AuthenticationSessionToken,
  AuthenticationSessionValidation,
  AuthenticationSessionView,
  IssueAuthenticationSessionCommand,
  RevokeAuthenticationSessionCommand,
  RotateAuthenticationSessionCommand,
  ValidateAuthenticationSessionCommand,
} from './authentication-session.types';

export const DEFAULT_SESSION_AUDIENCE = 'customer-api';
export const DEFAULT_SESSION_TTL_SECONDS = 3600;
export const MIN_SESSION_TTL_SECONDS = 60;
export const MAX_SESSION_TTL_SECONDS = 86_400;

const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_AUDIENCE_LENGTH = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthenticationSessionService {
  constructor(
    @InjectRepository(AuthenticationSession)
    private readonly sessionRepository: Repository<AuthenticationSession>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async issue(command: IssueAuthenticationSessionCommand): Promise<AuthenticationSessionToken> {
    this.assertSuccessfulAuthentication(command.authentication);
    const actor = this.normalizeActor(command.actor);
    const audience = this.normalizeAudience(command.audience ?? DEFAULT_SESSION_AUDIENCE);
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(accessToken);

    const session = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AuthenticationSession);
      const saved = await repository.save(
        repository.create({
          id: randomUuid(),
          customerId: command.authentication.customerId,
          credentialId: this.requiredCredentialId(command.authentication),
          tokenHash,
          audience,
          status: AuthenticationSessionStatus.ACTIVE,
          issuedAt: now,
          expiresAt,
          lastSeenAt: now,
          revokedAt: null,
          revokeReason: null,
          version: 1,
        }),
      );
      await this.audit(manager, saved, 'SESSION_ISSUED', actor, {
        customerId: saved.customerId,
        credentialId: saved.credentialId,
        audience: saved.audience,
        issuedAt: saved.issuedAt,
        expiresAt: saved.expiresAt,
      });
      return saved;
    });

    return this.toToken(accessToken, session);
  }

  async validate(
    command: ValidateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    const token = this.normalizeToken(command.token);
    if (!token) {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return { valid: false, reason: 'MALFORMED_TOKEN' };
    }

    const audience = this.normalizeAudience(command.audience ?? DEFAULT_SESSION_AUDIENCE);
    const session = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!session) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (session.audience !== audience) {
      return { valid: false, reason: 'WRONG_AUDIENCE' };
    }
    if (session.status === AuthenticationSessionStatus.REVOKED) {
      return { valid: false, reason: 'REVOKED' };
    }

    const now = command.now ?? new Date();
    if (
      session.status === AuthenticationSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      if (session.status === AuthenticationSessionStatus.ACTIVE) {
        await this.expire(session, now);
      }
      return { valid: false, reason: 'EXPIRED' };
    }

    session.lastSeenAt = now;
    await this.sessionRepository.save(session);
    return { valid: true, principal: this.toPrincipal(session) };
  }

  async revoke(
    command: RevokeAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionValidation> {
    const validation = await this.validate({
      token: command.token,
      audience: DEFAULT_SESSION_AUDIENCE,
    });
    if (!validation.valid || !validation.principal) {
      return validation;
    }

    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeReason(command.reason);
    const now = command.now ?? new Date();
    const session = await this.sessionRepository.findOne({
      where: { id: validation.principal.sessionId },
    });
    if (!session || session.status !== AuthenticationSessionStatus.ACTIVE) {
      return { valid: false, reason: 'REVOKED', principal: validation.principal };
    }

    await this.dataSource.transaction(async (manager) => {
      session.status = AuthenticationSessionStatus.REVOKED;
      session.revokedAt = now;
      session.revokeReason = reason;
      const saved = await manager.getRepository(AuthenticationSession).save(session);
      await this.audit(manager, saved, 'SESSION_REVOKED', actor, {
        customerId: saved.customerId,
        audience: saved.audience,
        revokeReason: saved.revokeReason,
      });
    });
    return { valid: false, reason: 'REVOKED', principal: validation.principal };
  }

  async rotate(
    command: RotateAuthenticationSessionCommand,
  ): Promise<AuthenticationSessionToken | null> {
    const token = this.normalizeToken(command.token);
    if (!token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return null;
    }

    const audience = DEFAULT_SESSION_AUDIENCE;
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeReason(command.reason) ?? 'Session rotated';
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const existing = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (
      !existing ||
      existing.audience !== audience ||
      existing.status !== AuthenticationSessionStatus.ACTIVE
    ) {
      return null;
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      await this.expire(existing, now);
      return null;
    }

    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const replacementHash = this.hashToken(accessToken);
    const replacement = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AuthenticationSession);
      existing.status = AuthenticationSessionStatus.REVOKED;
      existing.revokedAt = now;
      existing.revokeReason = reason;
      const revoked = await repository.save(existing);
      await this.audit(manager, revoked, 'SESSION_ROTATED', actor, {
        customerId: revoked.customerId,
        audience: revoked.audience,
        replacementIssued: true,
      });

      const saved = await repository.save(
        repository.create({
          id: randomUuid(),
          customerId: revoked.customerId,
          credentialId: revoked.credentialId,
          tokenHash: replacementHash,
          audience,
          status: AuthenticationSessionStatus.ACTIVE,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          lastSeenAt: now,
          revokedAt: null,
          revokeReason: null,
          version: 1,
        }),
      );
      await this.audit(manager, saved, 'SESSION_ISSUED', actor, {
        customerId: saved.customerId,
        credentialId: saved.credentialId,
        audience: saved.audience,
        issuedAt: saved.issuedAt,
        expiresAt: saved.expiresAt,
        rotatedFromSessionId: revoked.id,
      });
      return saved;
    });

    return this.toToken(accessToken, replacement);
  }

  async getSession(sessionId: string): Promise<AuthenticationSessionView | null> {
    if (!UUID_PATTERN.test(sessionId)) {
      throw new BadRequestException('sessionId must be a UUID');
    }
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    return session ? this.toView(session) : null;
  }

  private async expire(session: AuthenticationSession, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      session.status = AuthenticationSessionStatus.EXPIRED;
      const saved = await manager.getRepository(AuthenticationSession).save(session);
      await this.audit(manager, saved, 'SESSION_EXPIRED', 'session-lifecycle', {
        customerId: saved.customerId,
        audience: saved.audience,
        expiredAt: now,
      });
    });
  }

  private async audit(
    manager: EntityManager,
    session: AuthenticationSession,
    action: string,
    actor: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'AUTHENTICATION_SESSION',
      entityId: session.id,
      action,
      actor,
      newValues,
    });
  }

  private toToken(accessToken: string, session: AuthenticationSession): AuthenticationSessionToken {
    return {
      accessToken,
      tokenType: 'Bearer',
      sessionId: session.id,
      audience: session.audience,
      expiresAt: session.expiresAt,
      principal: this.toPrincipal(session),
    };
  }

  private toPrincipal(session: AuthenticationSession): AuthenticatedPrincipal {
    return {
      principalType: 'CUSTOMER',
      customerId: session.customerId,
      credentialId: session.credentialId,
      sessionId: session.id,
      audience: session.audience,
      authenticatedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  private toView(session: AuthenticationSession): AuthenticationSessionView {
    return {
      id: session.id,
      customerId: session.customerId,
      credentialId: session.credentialId,
      audience: session.audience,
      status: session.status,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      version: session.version,
    };
  }

  private assertSuccessfulAuthentication(authentication: AuthenticationExecutionResult): void {
    if (
      !authentication.authenticated ||
      !authentication.customerId ||
      !authentication.credentialId
    ) {
      throw new ConflictException('A successful authentication result is required');
    }
  }

  private requiredCredentialId(authentication: AuthenticationExecutionResult): string {
    if (!authentication.credentialId || !UUID_PATTERN.test(authentication.credentialId)) {
      throw new ConflictException('Authentication result credential is invalid');
    }
    return authentication.credentialId;
  }

  private normalizeAudience(value: string): string {
    const audience = value.trim();
    if (
      !audience ||
      audience.length > MAX_AUDIENCE_LENGTH ||
      !/^[a-z0-9][a-z0-9_.:-]*$/.test(audience)
    ) {
      throw new BadRequestException('audience is invalid');
    }
    return audience;
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeReason(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    const reason = value.trim();
    if (reason.length > 500) {
      throw new BadRequestException('reason must contain at most 500 characters');
    }
    return reason || null;
  }

  private normalizeToken(value: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const token = value.trim();
    return token || null;
  }

  private normalizeTtl(value: number | undefined): number {
    const ttl = value ?? DEFAULT_SESSION_TTL_SECONDS;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_SESSION_TTL_SECONDS ||
      ttl > MAX_SESSION_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds must be between ${MIN_SESSION_TTL_SECONDS} and ${MAX_SESSION_TTL_SECONDS}`,
      );
    }
    return ttl;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

function randomUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] ?? 0) & 0x0f;
  bytes[6] = (bytes[6] ?? 0) | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f;
  bytes[8] = (bytes[8] ?? 0) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
