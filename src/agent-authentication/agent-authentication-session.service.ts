import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { AgentAuthenticationSession } from './agent-authentication-session.entity';
import { AgentAuthenticationSessionStatus } from './agent-authentication.enums';
import type { AgentAuthenticationExecutionResult } from './agent-authentication-execution.service';

export const DEFAULT_AGENT_SESSION_AUDIENCE = 'agent-api';
export const DEFAULT_AGENT_SESSION_TTL_SECONDS = 3600;
export const MIN_AGENT_SESSION_TTL_SECONDS = 60;
export const MAX_AGENT_SESSION_TTL_SECONDS = 86_400;

const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_AUDIENCE_LENGTH = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IssueAgentAuthenticationSessionCommand {
  authentication: AgentAuthenticationExecutionResult;
  actor: string;
  audience?: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface ValidateAgentAuthenticationSessionCommand {
  token: string;
  audience?: string;
  now?: Date;
}

export interface RevokeAgentAuthenticationSessionCommand {
  token: string;
  actor: string;
  reason?: string;
  now?: Date;
}

export interface RotateAgentAuthenticationSessionCommand extends RevokeAgentAuthenticationSessionCommand {
  ttlSeconds?: number;
}

export interface AgentAuthenticatedPrincipal {
  principalType: 'AGENT';
  agentId: string;
  credentialId: string;
  sessionId: string;
  audience: string;
  authenticatedAt: Date;
  expiresAt: Date;
}

export interface AgentAuthenticationSessionToken {
  accessToken: string;
  tokenType: 'Bearer';
  sessionId: string;
  audience: string;
  expiresAt: Date;
  principal: AgentAuthenticatedPrincipal;
}

export interface AgentAuthenticationSessionView {
  id: string;
  agentId: string;
  credentialId: string;
  audience: string;
  status: AgentAuthenticationSessionStatus;
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  version: number;
}

export interface AgentAuthenticationSessionValidation {
  valid: boolean;
  principal?: AgentAuthenticatedPrincipal;
  reason?: 'MISSING_TOKEN' | 'MALFORMED_TOKEN' | 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'WRONG_AUDIENCE';
}

@Injectable()
export class AgentAuthenticationSessionService {
  constructor(
    @InjectRepository(AgentAuthenticationSession)
    private readonly sessionRepository: Repository<AgentAuthenticationSession>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async issue(command: IssueAgentAuthenticationSessionCommand): Promise<AgentAuthenticationSessionToken> {
    this.assertSuccessfulAuthentication(command.authentication);
    const actor = this.normalizeActor(command.actor);
    const audience = this.normalizeAudience(command.audience ?? DEFAULT_AGENT_SESSION_AUDIENCE);
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(accessToken);

    const session = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgentAuthenticationSession);
      const saved = await repository.save(
        repository.create({
          id: randomUuid(),
          agentId: command.authentication.agentId,
          credentialId: this.requiredCredentialId(command.authentication),
          tokenHash,
          audience,
          status: AgentAuthenticationSessionStatus.ACTIVE,
          issuedAt: now,
          expiresAt,
          lastSeenAt: now,
          revokedAt: null,
          revokeReason: null,
          version: 1,
        }),
      );
      await this.audit(manager, saved, 'SESSION_ISSUED', actor, {
        agentId: saved.agentId,
        credentialId: saved.credentialId,
        audience: saved.audience,
        issuedAt: saved.issuedAt,
        expiresAt: saved.expiresAt,
      });
      return saved;
    });

    return this.toToken(accessToken, session);
  }

  async validate(command: ValidateAgentAuthenticationSessionCommand): Promise<AgentAuthenticationSessionValidation> {
    const token = this.normalizeToken(command.token);
    if (!token) {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return { valid: false, reason: 'MALFORMED_TOKEN' };
    }

    const audience = this.normalizeAudience(command.audience ?? DEFAULT_AGENT_SESSION_AUDIENCE);
    const session = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!session) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (session.audience !== audience) {
      return { valid: false, reason: 'WRONG_AUDIENCE' };
    }
    if (session.status === AgentAuthenticationSessionStatus.REVOKED) {
      return { valid: false, reason: 'REVOKED' };
    }

    const now = command.now ?? new Date();
    if (
      session.status === AgentAuthenticationSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      if (session.status === AgentAuthenticationSessionStatus.ACTIVE) {
        await this.expire(session, now);
      }
      return { valid: false, reason: 'EXPIRED' };
    }

    session.lastSeenAt = now;
    await this.sessionRepository.save(session);
    return { valid: true, principal: this.toPrincipal(session) };
  }

  async revoke(command: RevokeAgentAuthenticationSessionCommand): Promise<AgentAuthenticationSessionValidation> {
    const validation = await this.validate({
      token: command.token,
      audience: DEFAULT_AGENT_SESSION_AUDIENCE,
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
    if (!session || session.status !== AgentAuthenticationSessionStatus.ACTIVE) {
      return { valid: false, reason: 'REVOKED', principal: validation.principal };
    }

    await this.dataSource.transaction(async (manager) => {
      session.status = AgentAuthenticationSessionStatus.REVOKED;
      session.revokedAt = now;
      session.revokeReason = reason;
      const saved = await manager.getRepository(AgentAuthenticationSession).save(session);
      await this.audit(manager, saved, 'SESSION_REVOKED', actor, {
        agentId: saved.agentId,
        audience: saved.audience,
        revokeReason: saved.revokeReason,
      });
    });
    return { valid: false, reason: 'REVOKED', principal: validation.principal };
  }

  async revokeAllForCredential(
    credentialId: string,
    actor: string,
    reason = 'Credential invalidated',
    now = new Date(),
  ): Promise<number> {
    if (!UUID_PATTERN.test(credentialId)) {
      throw new BadRequestException('credentialId must be a UUID');
    }
    const normalizedActor = this.normalizeActor(actor);
    const normalizedReason = this.normalizeReason(reason);
    const sessions = await this.sessionRepository.find({
      where: { credentialId, status: AgentAuthenticationSessionStatus.ACTIVE },
    });
    if (sessions.length === 0) {
      return 0;
    }

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgentAuthenticationSession);
      for (const session of sessions) {
        session.status = AgentAuthenticationSessionStatus.REVOKED;
        session.revokedAt = now;
        session.revokeReason = normalizedReason;
        const saved = await repository.save(session);
        await this.audit(manager, saved, 'SESSION_REVOKED', normalizedActor, {
          agentId: saved.agentId,
          credentialId: saved.credentialId,
          audience: saved.audience,
          revokeReason: saved.revokeReason,
          invalidatedByCredential: true,
        });
      }
    });
    return sessions.length;
  }

  async getSession(sessionId: string): Promise<AgentAuthenticationSessionView | null> {
    if (!UUID_PATTERN.test(sessionId)) {
      throw new BadRequestException('sessionId must be a UUID');
    }
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    return session ? this.toView(session) : null;
  }

  private async expire(session: AgentAuthenticationSession, now: Date): Promise<void> {
    session.status = AgentAuthenticationSessionStatus.EXPIRED;
    session.revokedAt = now;
    session.revokeReason = 'Session expired';
    await this.sessionRepository.save(session);
    await this.dataSource.transaction(async (manager) => {
      await this.audit(manager, session, 'SESSION_EXPIRED', 'system', {
        agentId: session.agentId,
        audience: session.audience,
        expiredAt: session.expiresAt,
      });
    });
  }

  private assertSuccessfulAuthentication(authentication: AgentAuthenticationExecutionResult): void {
    if (!authentication.authenticated || !authentication.credentialId) {
      throw new BadRequestException('Authentication must be successful to issue a session');
    }
  }

  private requiredCredentialId(authentication: AgentAuthenticationExecutionResult): string {
    if (!authentication.credentialId) {
      throw new BadRequestException('credentialId is required to issue a session');
    }
    if (!UUID_PATTERN.test(authentication.credentialId)) {
      throw new BadRequestException('credentialId must be a UUID');
    }
    return authentication.credentialId;
  }

  private toToken(accessToken: string, session: AgentAuthenticationSession): AgentAuthenticationSessionToken {
    return {
      accessToken,
      tokenType: 'Bearer',
      sessionId: session.id,
      audience: session.audience,
      expiresAt: session.expiresAt,
      principal: this.toPrincipal(session),
    };
  }

  private toPrincipal(session: AgentAuthenticationSession): AgentAuthenticatedPrincipal {
    return {
      principalType: 'AGENT',
      agentId: session.agentId,
      credentialId: session.credentialId,
      sessionId: session.id,
      audience: session.audience,
      authenticatedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  private toView(session: AgentAuthenticationSession): AgentAuthenticationSessionView {
    return {
      id: session.id,
      agentId: session.agentId,
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

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private normalizeToken(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeAudience(value: string): string {
    const audience = value.trim();
    if (!audience || audience.length > MAX_AUDIENCE_LENGTH) {
      throw new BadRequestException(`audience must contain 1 to ${MAX_AUDIENCE_LENGTH} characters`);
    }
    return audience;
  }

  private normalizeTtl(value: number | undefined): number {
    if (value === undefined) return DEFAULT_AGENT_SESSION_TTL_SECONDS;
    if (!Number.isSafeInteger(value) || value < MIN_AGENT_SESSION_TTL_SECONDS || value > MAX_AGENT_SESSION_TTL_SECONDS) {
      throw new BadRequestException(`ttlSeconds must be an integer between ${MIN_AGENT_SESSION_TTL_SECONDS} and ${MAX_AGENT_SESSION_TTL_SECONDS}`);
    }
    return value;
  }

  private normalizeReason(value: string | undefined): string | null {
    if (value === undefined) return null;
    const reason = value.trim();
    if (!reason) return null;
    if (reason.length > 500) throw new BadRequestException('reason must contain 1 to 500 characters');
    return reason;
  }

  private async audit(manager: EntityManager, session: AgentAuthenticationSession, action: string, actor: string, newValues: Record<string, unknown>): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'AGENT_AUTHENTICATION_SESSION',
      entityId: session.id,
      action,
      actor,
      newValues,
    });
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
