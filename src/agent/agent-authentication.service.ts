import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { PasswordHashVerificationService } from '../customer-authentication/password-hash-verification.service';
import { PinHashService } from '../customer-authentication/pin-hash.service';
import {
  DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
  TRANSACTION_PIN_POLICY,
  type TransactionPinSecurityPolicy,
} from '../customer-authentication/transaction-pin-policy';
import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AgentAuthenticationCredential } from './agent-authentication.entity';
import { AgentSession } from './agent-session.entity';
import { Agent } from './agent.entity';
import {
  AgentCredentialStatus,
  AgentCredentialType,
  AgentSessionStatus,
  AgentStatus,
} from './agent.enums';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Agent sessions are audience-bound and never valid on other surfaces. */
export const AGENT_SESSION_AUDIENCE = 'agent';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MIN_SECRET_LENGTH = 12;

export interface AgentSessionView {
  sessionId: string;
  agentId: string;
  audience: string;
  /** Returned once at login. Never persisted, logged or audited. */
  token: string;
  expiresAt: Date;
}

/**
 * A6 — Agent login authentication and Agent transaction PIN.
 *
 * SEPARATION, NOT DUPLICATION
 *   Agent credentials live in Agent-owned tables FK-bound to `agents`. An
 *   Agent never becomes a Customer and no customer row is created to
 *   authenticate one. What is reused is the mature SECURITY PRIMITIVES:
 *   `PinHashService` (PBKDF2), `PasswordHashVerificationService`, and the
 *   configurable `TransactionPinSecurityPolicy` - which is entirely generic
 *   (max attempts, min/max length) and carries no customer coupling.
 *
 * TWO DISTINCT LAYERS
 *   The login secret (`PASSWORD`) establishes WHO the agent is. The
 *   transaction PIN (`PIN`) authorizes a money-moving intent. They are
 *   separate credential rows; one can never satisfy the other.
 *
 * NO SECRET EVER LEAVES
 *   Only hashes are stored. Plaintext secrets and PINs are never persisted,
 *   never logged, never returned and never written to an audit payload.
 */
@Injectable()
export class AgentAuthenticationService {
  private readonly policy: TransactionPinSecurityPolicy;

  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentAuthenticationCredential)
    private readonly credentialRepository: Repository<AgentAuthenticationCredential>,
    @InjectRepository(AgentSession)
    private readonly sessionRepository: Repository<AgentSession>,
    private readonly dataSource: DataSource,
    private readonly pinHashService: PinHashService,
    private readonly passwordHashVerificationService: PasswordHashVerificationService,
    private readonly auditService: AuditService,
    @Optional()
    @Inject(TRANSACTION_PIN_POLICY)
    configuredPolicy?: TransactionPinSecurityPolicy,
  ) {
    this.policy = configuredPolicy ?? DEFAULT_TRANSACTION_PIN_SECURITY_POLICY;
  }

  // ---------------------------------------------------------------- login --

  /**
   * Registers the Agent login credential.
   *
   * Mirrors the established customer convention exactly: the platform does not
   * hash login passwords anywhere, it stores a caller-supplied hash and
   * verifies it through the shared `PasswordHashVerificationService`. No new
   * password-hashing path is introduced, and the plaintext never reaches this
   * service.
   */
  async setLoginCredential(
    agentId: string,
    passwordHash: string,
    hashAlgorithm: PasswordHashAlgorithm,
    actor: string,
  ): Promise<void> {
    const id = this.requireUuid(agentId, 'agentId');
    const normalizedActor = this.requireText(actor, 'actor');
    if (typeof passwordHash !== 'string' || passwordHash.trim().length < MIN_SECRET_LENGTH) {
      throw new BadRequestException('passwordHash must be a stored credential hash');
    }
    await this.requireAgent(id);
    await this.storeCredential(
      id,
      AgentCredentialType.PASSWORD,
      passwordHash.trim(),
      hashAlgorithm,
      normalizedActor,
      'LOGIN_CREDENTIAL_SET',
    );
  }

  /**
   * Authenticates an Agent and issues an audience-bound session.
   *
   * Only an ACTIVE agent may authenticate for agent operations. PENDING,
   * SUSPENDED and TERMINATED agents are refused before any secret is checked
   * against a live credential, and no session is issued.
   */
  async authenticate(
    agentId: string,
    secret: string,
    actor: string,
  ): Promise<AgentSessionView> {
    const id = this.requireUuid(agentId, 'agentId');
    const normalizedActor = this.requireText(actor, 'actor');
    const agent = await this.requireAgent(id);
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ForbiddenException(
        `Agent ${id} is ${agent.status}; only an ACTIVE agent may authenticate for agent operations`,
      );
    }

    const credential = await this.requireActiveCredential(id, AgentCredentialType.PASSWORD);
    if (credential.accountLocked) {
      throw new ForbiddenException('Agent login credential is locked');
    }
    const verification = this.passwordHashVerificationService.verify(
      typeof secret === 'string' ? secret : '',
      credential.hashAlgorithm as PasswordHashAlgorithm,
      credential.secretHash,
    );
    if (!verification.verified) {
      await this.recordFailure(credential, normalizedActor, 'LOGIN_FAILED');
      throw new UnauthorizedException('Invalid agent credentials');
    }
    await this.clearFailures(credential);

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        id: randomUUID(),
        agentId: id,
        tokenHash: this.hashToken(token),
        audience: AGENT_SESSION_AUDIENCE,
        status: AgentSessionStatus.ACTIVE,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        revokedAt: null,
        revokedReason: null,
      }),
    );

    await this.dataSource.transaction((manager) =>
      this.auditService.record(manager, {
        entityType: 'AGENT_SESSION',
        entityId: session.id,
        action: 'AUTHENTICATED',
        actor: normalizedActor,
        // Metadata only: no secret, no token, no hash.
        newValues: { agentId: id, audience: AGENT_SESSION_AUDIENCE },
      }),
    );

    return {
      sessionId: session.id,
      agentId: id,
      audience: AGENT_SESSION_AUDIENCE,
      token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Resolves a bearer token to an AGENT principal.
   *
   * The principal carries `agentId` and `agentAccess: 'SELF'` and deliberately
   * carries NO customer identity, NO roles and NO scopes, so it cannot satisfy
   * customer SELF policies and cannot reach internal or administrative routes,
   * none of which list AGENT in their allowed principal types.
   */
  async resolvePrincipal(token: string): Promise<AuthorizationPrincipal> {
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new UnauthorizedException('Agent session token is required');
    }
    const session = await this.sessionRepository.findOne({
      where: { tokenHash: this.hashToken(token.trim()), status: AgentSessionStatus.ACTIVE },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Agent session is not valid');
    }
    const agent = await this.requireAgent(session.agentId);
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ForbiddenException(`Agent ${agent.id} is ${agent.status}`);
    }

    return {
      type: 'AGENT',
      principalId: `agent:${agent.id}`,
      agentId: agent.id,
      agentAccess: 'SELF',
      sessionId: session.id,
      audience: AGENT_SESSION_AUDIENCE,
      roles: [],
      scopes: [],
      // An agent has no customer identity and no customer access, ever.
      customerAccess: 'NONE',
    };
  }

  // ------------------------------------------------------ transaction PIN --

  /** Provisions the Agent transaction PIN. Stores only a PBKDF2 hash. */
  async setTransactionPin(agentId: string, pin: string, actor: string): Promise<void> {
    const id = this.requireUuid(agentId, 'agentId');
    const normalizedActor = this.requireText(actor, 'actor');
    // Reuses the configurable transaction-PIN policy (length bounds) and the
    // shared PBKDF2 PIN hashing. The plaintext PIN is never stored.
    const hashed = this.pinHashService.hashPin(this.pinHashService.normalizePin(pin));
    await this.requireAgent(id);
    await this.storeCredential(
      id,
      AgentCredentialType.PIN,
      hashed.encodedHash,
      PasswordHashAlgorithm.PBKDF2,
      normalizedActor,
      'TRANSACTION_PIN_SET',
    );
  }

  /**
   * Authorizes a money-moving intent for the AUTHENTICATED agent.
   *
   * Binds authorization to the principal: an agent can never authorize on
   * behalf of another agent, and a customer principal can never authorize an
   * agent intent. Wrong PINs increment the failure counter and lock the
   * credential at the configured threshold.
   */
  async authorizeTransaction(
    principal: AuthorizationPrincipal,
    agentId: string,
    pin: string,
    actor: string,
  ): Promise<void> {
    const id = this.requireUuid(agentId, 'agentId');
    const normalizedActor = this.requireText(actor, 'actor');

    if (principal?.type !== 'AGENT' || principal.agentAccess !== 'SELF' || !principal.agentId) {
      throw new ForbiddenException('An authenticated AGENT principal is required');
    }
    if (principal.agentId !== id) {
      throw new ForbiddenException('An agent may only authorize its own transactions');
    }

    const agent = await this.requireAgent(id);
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ForbiddenException(`Agent ${id} is ${agent.status}`);
    }

    const credential = await this.requireActiveCredential(id, AgentCredentialType.PIN);
    if (credential.accountLocked) {
      throw new ForbiddenException('Agent transaction PIN is locked');
    }
    const verification = this.passwordHashVerificationService.verify(
      this.pinHashService.normalizePin(pin),
      credential.hashAlgorithm as PasswordHashAlgorithm,
      credential.secretHash,
    );
    if (!verification.verified) {
      await this.recordFailure(credential, normalizedActor, 'PIN_VERIFICATION_FAILED');
      throw new UnauthorizedException('Invalid agent transaction PIN');
    }
    await this.clearFailures(credential);

    await this.dataSource.transaction((manager) =>
      this.auditService.record(manager, {
        entityType: 'AGENT_TRANSACTION_PIN',
        entityId: credential.id,
        action: 'PIN_VERIFICATION_SUCCEEDED',
        actor: normalizedActor,
        newValues: { agentId: id },
      }),
    );
  }

  /** Clears a lockout. Mirrors the customer unlock affordance. */
  async unlockTransactionPin(agentId: string, actor: string): Promise<void> {
    const id = this.requireUuid(agentId, 'agentId');
    const normalizedActor = this.requireText(actor, 'actor');
    const credential = await this.requireActiveCredential(id, AgentCredentialType.PIN);

    credential.accountLocked = false;
    credential.lockedAt = null;
    credential.lockReason = null;
    credential.failedAuthenticationCount = 0;
    await this.credentialRepository.save(credential);

    await this.dataSource.transaction((manager) =>
      this.auditService.record(manager, {
        entityType: 'AGENT_TRANSACTION_PIN',
        entityId: credential.id,
        action: 'PIN_UNLOCKED',
        actor: normalizedActor,
        newValues: { agentId: id },
      }),
    );
  }

  // ------------------------------------------------------------- internals --

  private async storeCredential(
    agentId: string,
    credentialType: AgentCredentialType,
    secretHash: string,
    hashAlgorithm: PasswordHashAlgorithm,
    actor: string,
    action: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgentAuthenticationCredential);
      const existing = await repository.findOne({
        where: { agentId, credentialType, status: AgentCredentialStatus.ACTIVE },
      });
      if (existing) {
        existing.status = AgentCredentialStatus.REVOKED;
        await repository.save(existing);
      }
      const created = await repository.save(
        repository.create({
          id: randomUUID(),
          agentId,
          credentialType,
          secretHash,
          hashAlgorithm,
          status: AgentCredentialStatus.ACTIVE,
          failedAuthenticationCount: 0,
          accountLocked: false,
          lockedAt: null,
          lockReason: null,
        }),
      );
      await this.auditService.record(manager, {
        entityType:
          credentialType === AgentCredentialType.PIN
            ? 'AGENT_TRANSACTION_PIN'
            : 'AGENT_LOGIN_CREDENTIAL',
        entityId: created.id,
        action,
        actor,
        // Metadata only. The secret, the PIN and the hash are never recorded.
        newValues: { agentId, credentialType, hashAlgorithm },
      });
    });
  }

  private async recordFailure(
    credential: AgentAuthenticationCredential,
    actor: string,
    action: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AgentAuthenticationCredential);
      const fresh = await repository.findOne({ where: { id: credential.id } });
      if (!fresh) return;
      fresh.failedAuthenticationCount += 1;
      if (fresh.failedAuthenticationCount >= this.policy.maxFailedAttempts) {
        fresh.accountLocked = true;
        fresh.lockedAt = new Date();
        fresh.lockReason = 'Maximum failed attempts exceeded';
      }
      const saved = await repository.save(fresh);
      await this.auditService.record(manager, {
        entityType:
          credential.credentialType === AgentCredentialType.PIN
            ? 'AGENT_TRANSACTION_PIN'
            : 'AGENT_LOGIN_CREDENTIAL',
        entityId: saved.id,
        action,
        actor,
        newValues: {
          agentId: saved.agentId,
          failedAuthenticationCount: saved.failedAuthenticationCount,
          accountLocked: saved.accountLocked,
        },
      });
    });
  }

  private async clearFailures(credential: AgentAuthenticationCredential): Promise<void> {
    if (credential.failedAuthenticationCount === 0) return;
    const fresh = await this.credentialRepository.findOne({ where: { id: credential.id } });
    if (!fresh) return;
    fresh.failedAuthenticationCount = 0;
    await this.credentialRepository.save(fresh);
  }

  private async requireAgent(agentId: string): Promise<Agent> {
    const agent = await this.agentRepository.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} was not found`);
    return agent;
  }

  private async requireActiveCredential(
    agentId: string,
    credentialType: AgentCredentialType,
  ): Promise<AgentAuthenticationCredential> {
    const credential = await this.credentialRepository.findOne({
      where: { agentId, credentialType, status: AgentCredentialStatus.ACTIVE },
    });
    if (!credential) {
      throw new NotFoundException(
        `Agent ${agentId} has no active ${credentialType} credential`,
      );
    }
    return credential;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private requireUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return value.trim();
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
      throw new BadRequestException(`${field} must contain 1 to 160 characters`);
    }
    return value.trim();
  }
}
