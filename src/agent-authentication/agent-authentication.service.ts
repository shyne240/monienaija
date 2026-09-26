import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { Agent } from '../agent/agent.entity';
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

export interface AgentRecordFailedAuthenticationCommand {
  actor: string;
  reason?: string;
}

export interface AgentSetPinCommand {
  pinHash: string;
  hashAlgorithm: AgentPasswordHashAlgorithm;
  pinVersion: number;
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
    const passwordExpiresAt = this.parseOptionalDate(command.passwordExpiresAt, 'passwordExpiresAt');
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
      await this.audit(manager, 'AGENT_AUTHENTICATION_CREDENTIAL', credential.id, 'CREATED', actor, undefined, this.credentialValues(credential));
      return credential;
    });
  }

  async getCredential(agentId: string): Promise<AgentAuthenticationCredential | null> {
    this.assertUuid(agentId, 'agentId');
    const credential = await this.credentialRepository.findOne({ where: { agentId } });
    if (!credential || credential.deletedAt !== null) return null;
    return credential;
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
      await this.audit(manager, 'AGENT_AUTHENTICATION_CREDENTIAL', saved.id, 'FAILED_AUTHENTICATION_RECORDED', actor, previous, this.credentialValues(saved));
      return saved;
    });
  }

  async unlockCredential(agentId: string, credentialId: string, actor: string): Promise<AgentAuthenticationCredential> {
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
      await this.audit(manager, 'AGENT_AUTHENTICATION_CREDENTIAL', saved.id, 'ACCOUNT_UNLOCKED', normalizedActor, previous, this.credentialValues(saved));
      return saved;
    });
  }

  // Transaction PIN — Agent-owned, separate from login credential

  async setTransactionPin(agentId: string, command: AgentSetPinCommand): Promise<AgentTransactionPin> {
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
      let pin = await pinRepo.findOne({ where: { agentId } });
      const now = new Date();
      if (pin && pin.deletedAt === null) {
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
        await this.audit(manager, 'AGENT_TRANSACTION_PIN', saved.id, 'PIN_ROTATED', actor, previous, this.pinValues(saved));
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
      await this.audit(manager, 'AGENT_TRANSACTION_PIN', pin.id, 'PIN_CREATED', actor, undefined, this.pinValues(pin));
      return pin;
    });
  }

  async verifyTransactionPin(
    agentId: string,
    command: AgentVerifyPinCommand,
    verificationService: { verify: (pin: string, alg: AgentPasswordHashAlgorithm, hash: string) => { verified: boolean } },
  ): Promise<{ verified: boolean; locked?: boolean; failureReason?: string }> {
    this.assertUuid(agentId, 'agentId');
    const actor = this.normalizeActor(command.actor);
    const pin = command.pin;
    if (typeof pin !== 'string' || pin.length === 0 || pin.length > 1024) {
      return { verified: false, failureReason: 'INVALID_PIN' };
    }
    const stored = await this.pinRepository.findOne({ where: { agentId } });
    if (!stored || stored.deletedAt !== null) {
      return { verified: false, failureReason: 'PIN_NOT_FOUND' };
    }
    if (stored.accountLocked) {
      return { verified: false, locked: true, failureReason: 'PIN_LOCKED' };
    }
    const result = verificationService.verify(pin, stored.hashAlgorithm, stored.pinHash);
    if (result.verified) {
      await this.dataSource.transaction(async (manager) => {
        const fresh = await manager.getRepository(AgentTransactionPin).findOne({ where: { id: stored.id } });
        if (!fresh) return;
        if (fresh.failedCount > 0) {
          fresh.failedCount = 0;
          await manager.getRepository(AgentTransactionPin).save(fresh);
        }
        await this.audit(manager, 'AGENT_TRANSACTION_PIN', stored.id, 'PIN_VERIFIED', actor, undefined, {
          agentId,
          pinVersion: stored.pinVersion,
          outcome: 'VERIFIED',
        } as unknown as Record<string, unknown>);
      });
      return { verified: true };
    }
    await this.dataSource.transaction(async (manager) => {
      const pinRepo = manager.getRepository(AgentTransactionPin);
      const fresh = await pinRepo.findOne({ where: { id: stored.id } });
      if (!fresh) return;
      const previous = this.pinValues(fresh);
      fresh.failedCount += 1;
      if (fresh.failedCount >= MAX_FAILED_PINS) {
        fresh.accountLocked = true;
        fresh.lockedAt ??= new Date();
        fresh.lockReason = 'Maximum failed PIN attempts reached';
      }
      const saved = await pinRepo.save(fresh);
      await this.audit(manager, 'AGENT_TRANSACTION_PIN', saved.id, 'PIN_FAILED', actor, previous, this.pinValues(saved));
    });
    const reloaded = await this.pinRepository.findOne({ where: { agentId } });
    if (reloaded?.accountLocked) {
      return { verified: false, locked: true, failureReason: 'PIN_LOCKED' };
    }
    return { verified: false, failureReason: 'MISMATCH' };
  }

  async getTransactionPin(agentId: string): Promise<AgentTransactionPin | null> {
    this.assertUuid(agentId, 'agentId');
    const pin = await this.pinRepository.findOne({ where: { agentId } });
    if (!pin || pin.deletedAt !== null) return null;
    return pin;
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

  private async requireAgent(repository: Repository<Agent>, agentId: string): Promise<Agent> {
    const agent = await repository.findOne({ where: { id: agentId } });
    if (!agent || agent.deletedAt !== null) {
      throw new NotFoundException(`Agent ${agentId} was not found`);
    }
    return agent;
  }

  private async requireCredential(repository: Repository<AgentAuthenticationCredential>, agentId: string, credentialId: string): Promise<AgentAuthenticationCredential> {
    const credential = await repository.findOne({ where: { id: credentialId, agentId } });
    if (!credential || credential.deletedAt !== null) {
      throw new NotFoundException(`Credential ${credentialId} was not found for agent ${agentId}`);
    }
    return credential;
  }

  private async audit(manager: EntityManager, entityType: string, entityId: string, action: string, actor: string, previousValues?: Record<string, unknown>, newValues?: Record<string, unknown>): Promise<void> {
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

  private normalizeOptionalText(value: string | undefined, field: string, max: number): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    return normalized;
  }

  private parseOptionalDate(value: string | undefined, field: string): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return parsed;
  }
}
