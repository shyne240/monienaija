import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { Agent } from '../agent/agent.entity';
import { AgentStatus } from '../agent/agent.enums';
import { AuditService } from '../operations/audit.service';
import { AgentAuthenticationCredential } from './agent-authentication-credential.entity';
import { AgentAuthenticationSession } from './agent-authentication-session.entity';
import {
  AgentAuthenticationSessionStatus,
  AgentAuthenticationCredentialStatus,
} from './agent-authentication.enums';
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

export interface RotateAgentAuthenticationSessionCommand
  extends RevokeAgentAuthenticationSessionCommand {
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
  reason?:
    | 'MISSING_TOKEN'
    | 'MALFORMED_TOKEN'
    | 'NOT_FOUND'
    | 'REVOKED'
    | 'EXPIRED'
    | 'WRONG_AUDIENCE';
}

@Injectable()
export class AgentAuthenticationSessionService {
  constructor(
    @InjectRepository(AgentAuthenticationSession)
    private readonly sessionRepository: Repository<AgentAuthenticationSession>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async issue(
    command: IssueAgentAuthenticationSessionCommand,
  ): Promise<AgentAuthenticationSessionToken> {
    this.assertSuccessfulAuthentication(command.authentication);
    const actor = this.normalizeActor(command.actor);
    const audience = this.normalizeAudience(command.audience ?? DEFAULT_AGENT_SESSION_AUDIENCE);
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const accessToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(accessToken);

    const session = await this.dataSource.transaction(async (manager) => {
      // Lifecycle changes and administrative revocation take this same lock first. An
      // authentication result obtained before suspension must not create a session afterward.
      const agent = await manager.getRepository(Agent).findOne({
        where: { id: command.authentication.agentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!agent || agent.deletedAt !== null || agent.status !== AgentStatus.ACTIVE) {
        // Keep the public login failure non-enumerating, including the post-authentication race.
        throw new UnauthorizedException('Invalid credentials');
      }
      const credential = await manager.getRepository(AgentAuthenticationCredential).findOne({
        where: {
          id: this.requiredCredentialId(command.authentication),
          agentId: command.authentication.agentId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const eligibilityTime = command.now ?? new Date();
      if (
        !credential ||
        credential.deletedAt !== null ||
        credential.status !== AgentAuthenticationCredentialStatus.ACTIVE ||
        credential.accountLocked ||
        credential.rotationRequired ||
        credential.passwordVersion !== command.authentication.passwordVersion ||
        (credential.passwordExpiresAt !== null && credential.passwordExpiresAt <= eligibilityTime)
      ) {
        throw new BadRequestException('Credential is no longer available for session issuance');
      }
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

  async validate(
    command: ValidateAgentAuthenticationSessionCommand,
  ): Promise<AgentAuthenticationSessionValidation> {
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

    // Fail closed even for an out-of-band status change or soft deletion. Lifecycle
    // operations additionally revoke existing sessions atomically with the transition.
    const agent = await this.dataSource.getRepository(Agent).findOne({
      where: { id: session.agentId },
    });
    if (!agent || agent.deletedAt !== null || agent.status !== AgentStatus.ACTIVE) {
      return { valid: false, reason: 'REVOKED' };
    }

    const credential = await this.dataSource
      .getRepository(AgentAuthenticationCredential)
      .findOne({ where: { id: session.credentialId, agentId: session.agentId } });
    if (
      !credential ||
      credential.deletedAt !== null ||
      credential.status !== AgentAuthenticationCredentialStatus.ACTIVE ||
      credential.rotationRequired ||
      credential.accountLocked ||
      (credential.passwordExpiresAt !== null && credential.passwordExpiresAt <= now) ||
      session.issuedAt < credential.passwordChangedAt
    ) {
      return { valid: false, reason: 'REVOKED' };
    }
    // Never save a stale session snapshot: a concurrent revocation must not be overwritten.
    const updated = await this.sessionRepository.update(
      { id: session.id, status: AgentAuthenticationSessionStatus.ACTIVE },
      { lastSeenAt: now },
    );
    if (!updated.affected) return { valid: false, reason: 'REVOKED' };
    return { valid: true, principal: this.toPrincipal(session) };
  }

  async revoke(
    command: RevokeAgentAuthenticationSessionCommand,
  ): Promise<AgentAuthenticationSessionValidation> {
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
      // Do not overwrite a concurrent lifecycle/admin revocation with a stale snapshot.
      const updated = await manager.getRepository(AgentAuthenticationSession).update(
        { id: session.id, status: AgentAuthenticationSessionStatus.ACTIVE },
        { status: AgentAuthenticationSessionStatus.REVOKED, revokedAt: now, revokeReason: reason },
      );
      if (!updated.affected) return;
      await this.audit(manager, session, 'SESSION_REVOKED', actor, {
        agentId: session.agentId,
        audience: session.audience,
        revokeReason: reason,
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

  /**
   * Revoke current sessions without changing credentials. Soft-deleted Agents are included:
   * operators must still be able to invalidate any legacy sessions left on such an account.
   * The Agent lock serializes this operation with session issuance and lifecycle transitions.
   */
  async revokeAllForAgent(agentId: string, actor: string): Promise<number> {
    if (!UUID_PATTERN.test(agentId)) throw new BadRequestException('agentId must be a UUID');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const agent = await manager.getRepository(Agent).findOne({
        where: { id: agentId },
        withDeleted: true,
        lock: { mode: 'pessimistic_write' },
      });
      if (!agent) throw new NotFoundException('Agent not found');
      const revokedSessionCount = await this.revokeAllForAgentInManager(
        manager, agent.id, normalizedActor, 'ADMINISTRATIVE',
      );
      // Record the command even when there were no active sessions, in the same transaction.
      await this.auditService.record(manager, {
        entityType: 'AGENT',
        entityId: agent.id,
        action: 'AGENT_SESSIONS_REVOKED',
        actor: normalizedActor,
        newValues: { revokedSessionCount },
      });
      return revokedSessionCount;
    });
  }

  /** Caller MUST hold the Agent row's write lock in this transaction, before touching sessions. */
  async revokeAllForAgentInManager(
    manager: EntityManager,
    agentId: string,
    actor: string,
    cause: 'SUSPENDED' | 'TERMINATED' | 'ADMINISTRATIVE',
  ): Promise<number> {
    const reason = cause === 'ADMINISTRATIVE' ? 'Administrative session revocation' : `Agent ${cause}`;
    const rows: Array<{ id: string; credential_id: string; audience: string }> = await manager.query(
      `WITH revoked AS (
         UPDATE agent_authentication_sessions
            SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = $2,
                version = version + 1, updated_at = clock_timestamp()
          WHERE agent_id = $1 AND status = 'ACTIVE'
          RETURNING id, credential_id, audience
       ) SELECT id, credential_id, audience FROM revoked`,
      [agentId, reason],
    );
    for (const row of rows) {
      await this.auditService.record(manager, {
        entityType: 'AGENT_AUTHENTICATION_SESSION',
        entityId: row.id,
        action: 'SESSION_REVOKED',
        actor,
        newValues: { agentId, credentialId: row.credential_id, audience: row.audience, revokeReason: reason, cause },
      });
    }
    return rows.length;
  }

  async getSession(sessionId: string): Promise<AgentAuthenticationSessionView | null> {
    if (!UUID_PATTERN.test(sessionId)) {
      throw new BadRequestException('sessionId must be a UUID');
    }
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    return session ? this.toView(session) : null;
  }

  private async expire(session: AgentAuthenticationSession, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // A stale validation must never replace an already-committed revocation.
      const updated = await manager.getRepository(AgentAuthenticationSession).update(
        { id: session.id, status: AgentAuthenticationSessionStatus.ACTIVE },
        { status: AgentAuthenticationSessionStatus.EXPIRED, revokedAt: now, revokeReason: 'Session expired' },
      );
      if (!updated.affected) return;
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

  private toToken(
    accessToken: string,
    session: AgentAuthenticationSession,
  ): AgentAuthenticationSessionToken {
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
    if (
      !Number.isSafeInteger(value) ||
      value < MIN_AGENT_SESSION_TTL_SECONDS ||
      value > MAX_AGENT_SESSION_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds must be an integer between ${MIN_AGENT_SESSION_TTL_SECONDS} and ${MAX_AGENT_SESSION_TTL_SECONDS}`,
      );
    }
    return value;
  }

  private normalizeReason(value: string | undefined): string | null {
    if (value === undefined) return null;
    const reason = value.trim();
    if (!reason) return null;
    if (reason.length > 500)
      throw new BadRequestException('reason must contain 1 to 500 characters');
    return reason;
  }

  private async audit(
    manager: EntityManager,
    session: AgentAuthenticationSession,
    action: string,
    actor: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
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
