import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { Agent } from '../agent/agent.entity';
import { AgentStatus } from '../agent/agent.enums';
import { AuditService } from '../operations/audit.service';
import { AgentAuthenticationCredential } from './agent-authentication-credential.entity';
import { AgentTransactionPin } from './agent-transaction-pin.entity';
import {
  AgentAuthenticationCredentialStatus,
  AgentPasswordHashAlgorithm,
} from './agent-authentication.enums';
import { redactRecord } from '../common/sensitive-data-redaction';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FAILED_AUTHENTICATIONS = 5;
const MAX_FAILED_PINS = 5;

export interface AgentCreateCredentialCommand {
  passwordHash: string;
  hashAlgorithm: AgentPasswordHashAlgorithm;
  passwordVersion: number;
  passwordExpiresAt?: string;
  actor: string;
}

/** V1-AGENT-CREDENTIALS-01 — workforce issuance of a temporary first credential. The plaintext
 *  password is generated and hashed by the CALLER (secure RNG + PBKDF2); this service never
 *  sees and never persists plaintext. Temporary credentials MUST expire: passwordExpiresAt
 *  is mandatory here (unlike createCredential). */
export interface AgentIssueInitialCredentialCommand {
  passwordHash: string;
  hashAlgorithm: AgentPasswordHashAlgorithm;
  /** ISO timestamp for the temporary credential's expiry (required — temporary credentials
   *  must not remain permanently valid). */
  passwordExpiresAt: string;
  actor: string;
}

export interface AgentRotateInitialPasswordCommand {
  expectedPasswordVersion?: number;
  passwordHash: string;
  hashAlgorithm: AgentPasswordHashAlgorithm;
  actor: string;
}

export interface AgentRecordFailedAuthenticationCommand {
  actor: string;
  reason?: string;
}

export interface AgentSetPinCommand {
  pinHash: string;
  hashAlgorithm: AgentPasswordHashAlgorithm;
  pinVersion: number;
  createOnly?: boolean;
  actor: string;
}

export interface AgentVerifyPinCommand {
  pin: string;
  actor: string;
}

@Injectable()
export class AgentAuthenticationService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepository: Repository<Agent>,
    @InjectRepository(AgentAuthenticationCredential)
    private readonly credentialRepository: Repository<AgentAuthenticationCredential>,
    @InjectRepository(AgentTransactionPin)
    private readonly pinRepository: Repository<AgentTransactionPin>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createCredential(
    agentId: string,
    command: AgentCreateCredentialCommand,
  ): Promise<AgentAuthenticationCredential> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    const passwordExpiresAt = this.parseOptionalDate(
      command.passwordExpiresAt,
      'passwordExpiresAt',
    );
    if (!Object.values(AgentPasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    if (!Number.isSafeInteger(command.passwordVersion) || command.passwordVersion < 1) {
      throw new BadRequestException('passwordVersion must be a positive integer');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.requireAgent(manager.getRepository(Agent), agentId);
      const existing = await manager
        .getRepository(AgentAuthenticationCredential)
        .findOne({ where: { agentId } });
      if (existing && existing.deletedAt === null) {
        throw new ConflictException('Agent already has an authentication credential');
      }
      const credential = await manager.getRepository(AgentAuthenticationCredential).save(
        manager.getRepository(AgentAuthenticationCredential).create({
          id: randomUUID(),
          agentId,
          passwordHash,
          hashAlgorithm: command.hashAlgorithm,
          passwordVersion: command.passwordVersion,
          passwordChangedAt: new Date(),
          passwordExpiresAt,
          status: AgentAuthenticationCredentialStatus.ACTIVE,
          failedAuthenticationCount: 0,
          accountLocked: false,
          lockedAt: null,
          lockReason: null,
          version: 1,
        }),
      );
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        credential.id,
        'CREATED',
        actor,
        undefined,
        this.credentialValues(credential),
      );
      return credential;
    });
  }

  async getCredential(agentId: string): Promise<AgentAuthenticationCredential | null> {
    this.assertUuid(agentId, 'agentId');
    const credential = await this.credentialRepository.findOne({ where: { agentId } });
    if (!credential || credential.deletedAt !== null) return null;
    return credential;
  }

  /**
   * V1-AGENT-CREDENTIALS-01 — issues the Agent's FIRST credential (temporary, rotation-required).
   * Fail-closed conventions (same vocabulary as the rest of the module):
   *  - Agent must exist (404) and must be ACTIVE (409, mirrors AgentReceivingNumberService gate):
   *    PENDING/SUSPENDED/TERMINATED Agents cannot receive credentials.
   *  - One active credential per Agent (409) — reissue goes through reissueInitialCredential.
   * Audited as CREDENTIALS_ISSUED; the hash is never written to audit/log/response.
   */
  async issueInitialCredential(
    agentId: string,
    command: AgentIssueInitialCredentialCommand,
  ): Promise<AgentAuthenticationCredential> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    const passwordExpiresAt = this.parseOptionalDate(
      command.passwordExpiresAt,
      'passwordExpiresAt',
    );
    if (!passwordExpiresAt) {
      throw new BadRequestException(
        'passwordExpiresAt is required for temporary credential issuance',
      );
    }
    if (passwordExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('passwordExpiresAt must be in the future');
    }
    if (!Object.values(AgentPasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    return this.dataSource.transaction(async (manager) => {
      const agent = await this.requireAgent(manager.getRepository(Agent), agentId);
      this.requireActiveAgent(agent);
      const credential = await this.persistIssuedCredential(
        manager,
        agentId,
        passwordHash,
        command.hashAlgorithm,
        passwordExpiresAt,
      );
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        credential.id,
        'CREDENTIALS_ISSUED',
        actor,
        undefined,
        this.credentialValues(credential),
      );
      return credential;
    });
  }

  /**
   * V1-AGENT-CREDENTIALS-01 — reissues a temporary credential for an Agent that already has one.
   * The previous credential is REVOKED and soft-deleted (freeing the one-active-unique slot),
   * and a NEW temporary rotation-required credential replaces it. Existing sessions bound to the
   * previous credential are revoked by the CALLER (revokeAllForCredential) within the same
   * request flow. Agent must be ACTIVE.
   */
  async reissueInitialCredential(
    agentId: string,
    command: AgentIssueInitialCredentialCommand,
  ): Promise<{ credential: AgentAuthenticationCredential; previousCredentialId: string }> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    const passwordExpiresAt = this.parseOptionalDate(
      command.passwordExpiresAt,
      'passwordExpiresAt',
    );
    if (!passwordExpiresAt) {
      throw new BadRequestException(
        'passwordExpiresAt is required for temporary credential issuance',
      );
    }
    if (passwordExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('passwordExpiresAt must be in the future');
    }
    if (!Object.values(AgentPasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    return this.dataSource.transaction(async (manager) => {
      const agent = await this.requireAgent(manager.getRepository(Agent), agentId);
      this.requireActiveAgent(agent);
      const repo = manager.getRepository(AgentAuthenticationCredential);
      const previous = await repo.findOne({
        where: { agentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!previous || previous.deletedAt !== null) {
        throw new NotFoundException('Agent has no authentication credential to reissue');
      }
      const previousValues = this.credentialValues(previous);
      previous.status = AgentAuthenticationCredentialStatus.REVOKED;
      previous.deletedAt = new Date();
      await repo.save(previous);
      await this.invalidateCredentialSessions(manager, previous.id);
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        previous.id,
        'REVOKED',
        actor,
        previousValues,
        this.credentialValues(previous),
      );
      const credential = await this.persistIssuedCredential(
        manager,
        agentId,
        passwordHash,
        command.hashAlgorithm,
        passwordExpiresAt,
      );
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        credential.id,
        'CREDENTIALS_REISSUED',
        actor,
        undefined,
        this.credentialValues(credential),
      );
      return { credential, previousCredentialId: previous.id };
    });
  }

  /**
   * V1-AGENT-CREDENTIALS-01 — completes the mandatory first-login rotation. Callers MUST have
   * already verified the current (temporary) password via AgentAuthenticationExecutionService.
   * Sets the new hash, clears the rotation flag and the temporary expiry, resets lockout
   * counters, and advances passwordVersion. Fails closed unless the credential is ACTIVE and
   * rotationRequired — a normal credential cannot be rotated through this path.
   */
  async rotateInitialPassword(
    agentId: string,
    credentialId: string,
    command: AgentRotateInitialPasswordCommand,
  ): Promise<AgentAuthenticationCredential> {
    this.assertUuid(agentId, 'agentId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    if (!Object.values(AgentPasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    return this.dataSource.transaction(async (manager) => {
      const agent = await this.requireAgent(manager.getRepository(Agent), agentId);
      this.requireActiveAgent(agent);
      const repo = manager.getRepository(AgentAuthenticationCredential);
      const credential = await this.requireCredential(repo, agentId, credentialId);
      if (
        credential.status !== AgentAuthenticationCredentialStatus.ACTIVE ||
        credential.rotationRequired !== true ||
        credential.accountLocked ||
        (credential.passwordExpiresAt !== null && credential.passwordExpiresAt <= new Date()) ||
        (command.expectedPasswordVersion !== undefined &&
          credential.passwordVersion !== command.expectedPasswordVersion)
      ) {
        throw new ConflictException('Credential rotation is not pending');
      }
      const previousValues = this.credentialValues(credential);
      credential.passwordHash = passwordHash;
      credential.hashAlgorithm = command.hashAlgorithm;
      credential.passwordVersion = credential.passwordVersion + 1;
      credential.passwordChangedAt = new Date();
      credential.passwordExpiresAt = null;
      credential.rotationRequired = false;
      credential.failedAuthenticationCount = 0;
      credential.accountLocked = false;
      credential.lockedAt = null;
      credential.lockReason = null;
      const saved = await repo.save(credential);
      await this.invalidateCredentialSessions(manager, credential.id);
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'PASSWORD_ROTATED',
        actor,
        previousValues,
        this.credentialValues(saved),
      );
      return saved;
    });
  }

  async recordFailedAuthentication(
    agentId: string,
    credentialId: string,
    command: AgentRecordFailedAuthenticationCommand,
  ): Promise<AgentAuthenticationCredential> {
    this.assertUuid(agentId, 'agentId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    return this.dataSource.transaction(async (manager) => {
      const credential = await this.requireCredential(
        manager.getRepository(AgentAuthenticationCredential),
        agentId,
        credentialId,
      );
      if (credential.status === AgentAuthenticationCredentialStatus.REVOKED) {
        throw new ConflictException('Revoked credentials cannot record authentication failures');
      }
      const previous = this.credentialValues(credential);
      credential.failedAuthenticationCount += 1;
      const shouldLock = credential.failedAuthenticationCount >= MAX_FAILED_AUTHENTICATIONS;
      if (shouldLock) {
        credential.accountLocked = true;
        credential.lockedAt ??= new Date();
        credential.lockReason = reason ?? 'Maximum failed authentication attempts reached';
      }
      const saved = await manager.getRepository(AgentAuthenticationCredential).save(credential);
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'FAILED_AUTHENTICATION_RECORDED',
        actor,
        previous,
        this.credentialValues(saved),
      );
      return saved;
    });
  }

  async unlockCredential(
    agentId: string,
    credentialId: string,
    actor: string,
  ): Promise<AgentAuthenticationCredential> {
    this.assertUuid(agentId, 'agentId');
    this.assertUuid(credentialId, 'credentialId');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const credential = await this.requireCredential(
        manager.getRepository(AgentAuthenticationCredential),
        agentId,
        credentialId,
      );
      if (!credential.accountLocked) {
        return credential;
      }
      const previous = this.credentialValues(credential);
      credential.accountLocked = false;
      credential.failedAuthenticationCount = 0;
      credential.lockedAt = null;
      credential.lockReason = null;
      const saved = await manager.getRepository(AgentAuthenticationCredential).save(credential);
      await this.audit(
        manager,
        'AGENT_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'ACCOUNT_UNLOCKED',
        normalizedActor,
        previous,
        this.credentialValues(saved),
      );
      return saved;
    });
  }

  // Transaction PIN — Agent-owned, separate from login credential

  async setTransactionPin(
    agentId: string,
    command: AgentSetPinCommand,
  ): Promise<AgentTransactionPin> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const pinHash = this.normalizeHash(command.pinHash, 'pinHash');
    if (!Object.values(AgentPasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      throw new BadRequestException('hashAlgorithm is invalid');
    }
    if (!Number.isSafeInteger(command.pinVersion) || command.pinVersion < 1) {
      throw new BadRequestException('pinVersion must be a positive integer');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.requireAgent(manager.getRepository(Agent), agentId);
      const pinRepo = manager.getRepository(AgentTransactionPin);
      let pin = await pinRepo.findOne({ where: { agentId }, lock: { mode: 'pessimistic_write' } });
      const now = new Date();
      if (pin && pin.deletedAt === null) {
        if (command.createOnly)
          throw new ConflictException(
            'A Transaction PIN already exists. Use Change Transaction PIN.',
          );
        // rotate
        const previous = this.pinValues(pin);
        pin.pinHash = pinHash;
        pin.hashAlgorithm = command.hashAlgorithm;
        pin.pinVersion = command.pinVersion;
        pin.lastChangedAt = now;
        pin.failedCount = 0;
        pin.accountLocked = false;
        pin.lockedAt = null;
        pin.lockReason = null;
        const saved = await pinRepo.save(pin);
        await this.audit(
          manager,
          'AGENT_TRANSACTION_PIN',
          saved.id,
          'PIN_ROTATED',
          actor,
          previous,
          this.pinValues(saved),
        );
        return saved;
      }
      pin = await pinRepo.save(
        pinRepo.create({
          id: randomUUID(),
          agentId,
          pinHash,
          hashAlgorithm: command.hashAlgorithm,
          pinVersion: command.pinVersion,
          failedCount: 0,
          accountLocked: false,
          lockedAt: null,
          lockReason: null,
          lastChangedAt: now,
          version: 1,
        }),
      );
      await this.audit(
        manager,
        'AGENT_TRANSACTION_PIN',
        pin.id,
        'PIN_CREATED',
        actor,
        undefined,
        this.pinValues(pin),
      );
      return pin;
    });
  }

  async verifyTransactionPin(
    agentId: string,
    command: AgentVerifyPinCommand,
    verificationService: {
      verify: (pin: string, alg: AgentPasswordHashAlgorithm, hash: string) => { verified: boolean };
    },
  ): Promise<{ verified: boolean; locked?: boolean; failureReason?: string }> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const pin = command.pin;
    if (typeof pin !== 'string' || pin.length === 0 || pin.length > 1024) {
      return { verified: false, failureReason: 'INVALID_PIN' };
    }
    return this.dataSource.transaction(async (manager) => {
      const stored = await manager
        .getRepository(AgentTransactionPin)
        .findOne({ where: { agentId }, lock: { mode: 'pessimistic_write' } });
      return this.verifyPinWithManager(manager, stored, pin, actor, verificationService);
    });
  }

  private async verifyPinWithManager(
    manager: EntityManager,
    stored: AgentTransactionPin | null,
    pin: string,
    actor: string,
    verifier: {
      verify: (pin: string, alg: AgentPasswordHashAlgorithm, hash: string) => { verified: boolean };
    },
  ): Promise<{ verified: boolean; locked?: boolean; failureReason?: string }> {
    if (!stored || stored.deletedAt !== null)
      return { verified: false, failureReason: 'PIN_NOT_FOUND' };
    if (stored.accountLocked) return { verified: false, locked: true, failureReason: 'PIN_LOCKED' };
    const previous = this.pinValues(stored);
    const verified = verifier.verify(pin, stored.hashAlgorithm, stored.pinHash).verified;
    if (verified) stored.failedCount = 0;
    else {
      stored.failedCount += 1;
      if (stored.failedCount >= MAX_FAILED_PINS) {
        stored.accountLocked = true;
        stored.lockedAt = new Date();
        stored.lockReason = 'Maximum failed PIN attempts reached';
      }
    }
    await manager.getRepository(AgentTransactionPin).save(stored);
    await this.audit(
      manager,
      'AGENT_TRANSACTION_PIN',
      stored.id,
      verified ? 'PIN_VERIFIED' : 'PIN_FAILED',
      actor,
      previous,
      this.pinValues(stored),
    );
    return {
      verified,
      locked: stored.accountLocked,
      ...(verified ? {} : { failureReason: stored.accountLocked ? 'PIN_LOCKED' : 'MISMATCH' }),
    };
  }

  async changeTransactionPin(
    agentId: string,
    currentPin: string,
    command: AgentSetPinCommand,
    verifier: {
      verify: (pin: string, alg: AgentPasswordHashAlgorithm, hash: string) => { verified: boolean };
    },
  ): Promise<{
    verified: boolean;
    locked?: boolean;
    failureReason?: string;
    pin?: AgentTransactionPin;
  }> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const pinHash = this.normalizeHash(command.pinHash, 'pinHash');
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentTransactionPin);
      const stored = await repo.findOne({
        where: { agentId },
        lock: { mode: 'pessimistic_write' },
      });
      const outcome = await this.verifyPinWithManager(manager, stored, currentPin, actor, verifier);
      // Return failures, so the attempt counter commits before the HTTP layer throws.
      if (!outcome.verified || !stored) return outcome;
      const previous = this.pinValues(stored);
      stored.pinHash = pinHash;
      stored.hashAlgorithm = command.hashAlgorithm;
      stored.pinVersion += 1;
      stored.lastChangedAt = new Date();
      const saved = await repo.save(stored);
      await this.audit(
        manager,
        'AGENT_TRANSACTION_PIN',
        stored.id,
        'PIN_ROTATED',
        actor,
        previous,
        this.pinValues(saved),
      );
      return { verified: true, pin: saved };
    });
  }

  async getTransactionPin(agentId: string): Promise<AgentTransactionPin | null> {
    this.assertUuid(agentId, 'agentId');
    const pin = await this.pinRepository.findOne({ where: { agentId } });
    if (!pin || pin.deletedAt !== null) return null;
    return pin;
  }

  private async invalidateCredentialSessions(
    manager: EntityManager,
    credentialId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE agent_authentication_sessions SET status='REVOKED', revoked_at=NOW(), revoke_reason='Credential invalidated', updated_at=NOW() WHERE credential_id=$1 AND status='ACTIVE'`,
      [credentialId],
    );
    await this.audit(
      manager,
      'AGENT_AUTHENTICATION_CREDENTIAL',
      credentialId,
      'CREDENTIAL_SESSIONS_INVALIDATED',
      'credential-lifecycle',
      undefined,
      { credentialId },
    );
  }

  // Helpers

  private credentialValues(credential: AgentAuthenticationCredential): Record<string, unknown> {
    return {
      agentId: credential.agentId,
      status: credential.status,
      hashAlgorithm: credential.hashAlgorithm,
      passwordVersion: credential.passwordVersion,
      passwordChangedAt: credential.passwordChangedAt,
      passwordExpiresAt: credential.passwordExpiresAt,
      failedAuthenticationCount: credential.failedAuthenticationCount,
      accountLocked: credential.accountLocked,
      rotationRequired: credential.rotationRequired,
      version: credential.version,
    };
  }

  private pinValues(pin: AgentTransactionPin): Record<string, unknown> {
    return {
      agentId: pin.agentId,
      hashAlgorithm: pin.hashAlgorithm,
      pinVersion: pin.pinVersion,
      failedCount: pin.failedCount,
      accountLocked: pin.accountLocked,
      version: pin.version,
      lastChangedAt: pin.lastChangedAt,
    };
  }

  private requireActiveAgent(agent: Agent): void {
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new ConflictException('Agent is not ACTIVE');
    }
  }

  private async persistIssuedCredential(
    manager: EntityManager,
    agentId: string,
    passwordHash: string,
    hashAlgorithm: AgentPasswordHashAlgorithm,
    passwordExpiresAt: Date,
  ): Promise<AgentAuthenticationCredential> {
    const repo = manager.getRepository(AgentAuthenticationCredential);
    const existing = await repo.findOne({ where: { agentId } });
    if (existing && existing.deletedAt === null) {
      throw new ConflictException('Agent already has an authentication credential');
    }
    return repo.save(
      repo.create({
        id: randomUUID(),
        agentId,
        passwordHash,
        hashAlgorithm,
        passwordVersion: 1,
        passwordChangedAt: new Date(),
        passwordExpiresAt,
        status: AgentAuthenticationCredentialStatus.ACTIVE,
        failedAuthenticationCount: 0,
        accountLocked: false,
        lockedAt: null,
        lockReason: null,
        rotationRequired: true,
        version: 1,
      }),
    );
  }

  private async requireAgent(repository: Repository<Agent>, agentId: string): Promise<Agent> {
    const agent = await repository.findOne({
      where: { id: agentId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!agent || agent.deletedAt !== null) {
      throw new NotFoundException(`Agent ${agentId} was not found`);
    }
    return agent;
  }

  private async requireCredential(
    repository: Repository<AgentAuthenticationCredential>,
    agentId: string,
    credentialId: string,
  ): Promise<AgentAuthenticationCredential> {
    const credential = await repository.findOne({
      where: { id: credentialId, agentId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!credential || credential.deletedAt !== null) {
      throw new NotFoundException(`Credential ${credentialId} was not found for agent ${agentId}`);
    }
    return credential;
  }

  private async audit(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues: previousValues ? redactRecord(previousValues) : undefined,
      newValues: newValues ? redactRecord(newValues) : undefined,
    });
  }

  private assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeHash(value: string, field: string): string {
    const hash = value.trim();
    if (!hash || hash.length > 512 || /\s/.test(hash)) {
      throw new BadRequestException(`${field} must contain 1 to 512 characters without whitespace`);
    }
    return hash;
  }

  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    return normalized;
  }

  private parseOptionalDate(value: string | undefined, field: string): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`${field} must be a valid date`);
    return parsed;
  }
}
