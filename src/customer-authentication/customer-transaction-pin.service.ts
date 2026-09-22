import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { redactRecord } from '../common/sensitive-data-redaction';
import { AuditService } from '../operations/audit.service';
import { AuthenticationExecutionService } from './authentication-execution.service';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  AuthenticationCredentialType,
  PasswordHashAlgorithm,
  SecurityEventType,
} from './customer-authentication.enums';
import type {
  ChangeTransactionPinCommand,
  CreateTransactionPinCommand,
  ResetTransactionPinCommand,
  TransactionPinStatusView,
  UnlockTransactionPinCommand,
  VerifyTransactionPinCommand,
} from './customer-transaction-pin.types';
import { PasswordHashVerificationService } from './password-hash-verification.service';
import { PinHashService } from './pin-hash.service';
import { SecurityEventHistory } from './security-event-history.entity';
import {
  assertValidTransactionPinSecurityPolicy,
  DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
  TRANSACTION_PIN_POLICY,
  type TransactionPinSecurityPolicy,
} from './transaction-pin-policy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer transaction PIN management and verification.
 *
 * The PIN lives as a dedicated credential row (credential_type = 'PIN') in
 * the existing customer_authentication_credentials family, so failure
 * counting, locking, and unlocking reuse the established per-credential
 * security model and can NEVER lock the customer's PASSWORD/login credential
 * (which is a separate row, scoped by type). The plaintext PIN is never
 * persisted, returned, logged, audited, or put into security-event metadata:
 * only safe operational fields are recorded.
 */
@Injectable()
export class CustomerTransactionPinService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerAuthenticationCredential)
    private readonly credentialRepository: Repository<CustomerAuthenticationCredential>,
    @InjectRepository(SecurityEventHistory)
    private readonly securityEventRepository: Repository<SecurityEventHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly pinHashService: PinHashService,
    private readonly passwordHashVerificationService: PasswordHashVerificationService,
    private readonly authenticationExecutionService: AuthenticationExecutionService,
    @Optional()
    @Inject(TRANSACTION_PIN_POLICY)
    private readonly configuredPinPolicy?: TransactionPinSecurityPolicy,
  ) {}

  /**
   * The centralized Transaction PIN security policy (see
   * transaction-pin-policy.ts): an internal MonieNaija V1 configuration,
   * not a regulatory constant. The PIN-scoped lockout threshold comes from
   * `maxFailedAttempts` — never from a magic number here.
   */
  private get pinPolicy(): TransactionPinSecurityPolicy {
    return assertValidTransactionPinSecurityPolicy(
      this.configuredPinPolicy ?? DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
    );
  }

  /** Safe status view; 200 with `configured:false` when no PIN exists. Never leaks the PIN. */
  async getPinStatus(customerId: string): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const credential = await this.findActivePinCredential(this.credentialRepository, customerId);
    if (!credential) {
      return {
        configured: false,
        accountLocked: false,
        failedPinAttemptCount: 0,
        pinVersion: null,
        lockedAt: null,
        changedAt: null,
      };
    }
    return this.toStatusView(credential);
  }

  async createPin(
    customerId: string,
    command: CreateTransactionPinCommand,
  ): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const pin = this.pinHashService.normalizePin(command.pin);
    const hashed = this.pinHashService.hashPin(pin);
    try {
      const credentialId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerAuthenticationCredential);
        const existing = await this.findActivePinCredential(repository, customerId);
        if (existing) {
          throw new ConflictException('A transaction PIN is already configured for this customer');
        }
        const credential = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: AuthenticationCredentialType.PIN,
            passwordHash: hashed.encodedHash,
            hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
            passwordVersion: 1,
            passwordChangedAt: new Date(),
            passwordExpiresAt: null,
            status: AuthenticationCredentialStatus.ACTIVE,
            failedAuthenticationCount: 0,
            accountLocked: false,
            lockedAt: null,
            lockReason: null,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          credential.id,
          'PIN_CREATED',
          actor,
          undefined,
          this.pinCredentialValues(credential),
        );
        await this.recordSecurityEvent(
          manager,
          customerId,
          credential.id,
          SecurityEventType.PIN_CREATED,
          actor,
          { pinVersion: credential.passwordVersion, hashAlgorithm: credential.hashAlgorithm },
        );
        return credential.id;
      });
      const credential = await this.requirePinCredentialById(
        this.credentialRepository,
        customerId,
        credentialId,
      );
      return this.toStatusView(credential);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A transaction PIN is already configured for this customer');
      }
      throw error;
    }
  }

  async changePin(
    customerId: string,
    command: ChangeTransactionPinCommand,
  ): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const currentPin = this.pinHashService.normalizePin(command.currentPin, 'currentPin');
    const newPin = this.pinHashService.normalizePin(command.newPin, 'newPin');
    if (currentPin === newPin) {
      throw new BadRequestException('The new transaction PIN must differ from the current PIN');
    }
    // Verifying the current PIN is the change authorization. Failure counting
    // and locking happen inside verification (committed independently of the
    // rotation below).
    await this.verifyTransactionPin(customerId, { pin: currentPin, actor });
    const hashed = this.pinHashService.hashPin(newPin);
    const credentialId = await this.rotatePin(customerId, hashed.encodedHash, actor, 'PIN_CHANGED');
    const credential = await this.requirePinCredentialById(
      this.credentialRepository,
      customerId,
      credentialId,
    );
    return this.toStatusView(credential);
  }

  async resetPin(
    customerId: string,
    command: ResetTransactionPinCommand,
  ): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const newPin = this.pinHashService.normalizePin(command.newPin, 'newPin');
    if (typeof command.password !== 'string' || command.password.length === 0) {
      throw new BadRequestException('Recovery authorization requires the customer password');
    }
    const existing = await this.requireActivePinCredential(customerId);

    await this.dataSource.transaction(async (manager) => {
      await this.recordSecurityEvent(
        manager,
        customerId,
        existing.id,
        SecurityEventType.PIN_RESET_REQUESTED,
        actor,
        {},
      );
    });

    // Recovery authorization: the customer's existing password credential,
    // verified through the established authentication execution path (which
    // itself reuses the PASSWORD failed-attempt/lockout machinery). Knowing
    // the customer ID alone never authorizes a reset.
    const recovery = await this.authenticationExecutionService.authenticate({
      customerId,
      password: command.password,
      actor,
    });
    if (!recovery.authenticated) {
      throw new UnauthorizedException('Recovery authorization failed');
    }

    const hashed = this.pinHashService.hashPin(newPin);
    const credentialId = await this.rotatePin(customerId, hashed.encodedHash, actor, 'PIN_RESET');
    const credential = await this.requirePinCredentialById(
      this.credentialRepository,
      customerId,
      credentialId,
    );
    return this.toStatusView(credential);
  }

  async unlockPin(
    customerId: string,
    command: UnlockTransactionPinCommand,
  ): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    const credentialId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const credential = await this.requirePinCredential(repository, customerId);
      if (!credential.accountLocked) {
        return credential.id;
      }
      const previous = this.pinCredentialValues(credential);
      credential.accountLocked = false;
      credential.failedAuthenticationCount = 0;
      credential.lockedAt = null;
      credential.lockReason = null;
      const saved = await repository.save(credential);
      await this.audit(
        manager,
        saved.id,
        'PIN_UNLOCKED',
        actor,
        previous,
        this.pinCredentialValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        SecurityEventType.PIN_UNLOCKED,
        actor,
        { reason },
      );
      return saved.id;
    });
    const credential = await this.requirePinCredentialById(
      this.credentialRepository,
      customerId,
      credentialId,
    );
    return this.toStatusView(credential);
  }

  /**
   * Step-up verification primitive (also used by transaction authorization).
   * Throws nothing on success; on failure the attempt is counted (and the PIN
   * locks at the threshold) in a transaction committed BEFORE returning, so
   * the thrown HTTP error never rolls back the security state.
   */
  async verifyTransactionPin(
    customerId: string,
    command: VerifyTransactionPinCommand,
  ): Promise<TransactionPinStatusView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const pin = this.pinHashService.normalizePin(command.pin);
    const credential = await this.requireActivePinCredential(customerId);
    if (credential.accountLocked) {
      throw new ForbiddenException('Transaction PIN is locked');
    }
    if (credential.status !== AuthenticationCredentialStatus.ACTIVE) {
      throw new ForbiddenException('Transaction PIN is not active');
    }

    const verification = this.passwordHashVerificationService.verify(
      pin,
      credential.hashAlgorithm,
      credential.passwordHash,
    );
    if (!verification.verified) {
      await this.recordFailedPinAttempt(credential, actor, verification.failure ?? 'MISMATCH');
      throw new UnauthorizedException('Invalid transaction PIN');
    }

    const resetId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const fresh = await this.requirePinCredential(repository, customerId);
      if (fresh.failedAuthenticationCount > 0) {
        const previous = this.pinCredentialValues(fresh);
        fresh.failedAuthenticationCount = 0;
        const saved = await repository.save(fresh);
        await this.audit(
          manager,
          saved.id,
          'PIN_VERIFIED',
          actor,
          previous,
          this.pinCredentialValues(saved),
        );
      }
      await this.recordSecurityEvent(
        manager,
        customerId,
        fresh.id,
        SecurityEventType.PIN_VERIFICATION_SUCCEEDED,
        actor,
        {},
      );
      return fresh.id;
    });
    const verifiedCredential = await this.requirePinCredentialById(
      this.credentialRepository,
      customerId,
      resetId,
    );
    return this.toStatusView(verifiedCredential);
  }

  /** Counts a failed attempt and locks at the policy threshold (`pinPolicy.maxFailedAttempts`); committed before the caller throws. */
  private async recordFailedPinAttempt(
    credential: CustomerAuthenticationCredential,
    actor: string,
    verificationFailure: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const fresh = await this.requirePinCredential(repository, credential.customerId);
      if (fresh.accountLocked) {
        return;
      }
      const previous = this.pinCredentialValues(fresh);
      fresh.failedAuthenticationCount += 1;
      const shouldLock = fresh.failedAuthenticationCount >= this.pinPolicy.maxFailedAttempts;
      if (shouldLock) {
        fresh.accountLocked = true;
        fresh.lockedAt ??= new Date();
        fresh.lockReason = 'Maximum failed transaction PIN attempts reached';
      }
      const saved = await repository.save(fresh);
      await this.audit(
        manager,
        saved.id,
        'PIN_VERIFICATION_FAILED',
        actor,
        previous,
        this.pinCredentialValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        credential.customerId,
        saved.id,
        SecurityEventType.PIN_VERIFICATION_FAILED,
        actor,
        { verificationFailure, failedPinAttemptCount: saved.failedAuthenticationCount },
      );
      if (shouldLock && !previous.accountLocked) {
        await this.recordSecurityEvent(
          manager,
          credential.customerId,
          saved.id,
          SecurityEventType.PIN_LOCKED,
          actor,
          { failedPinAttemptCount: saved.failedAuthenticationCount },
        );
      }
    });
  }

  /** Rotates the PIN hash and clears any lock; reset flows recover locked PINs through here. */
  private async rotatePin(
    customerId: string,
    encodedHash: string,
    actor: string,
    action: 'PIN_CHANGED' | 'PIN_RESET',
  ): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const credential = await this.requirePinCredential(repository, customerId);
      if (credential.status !== AuthenticationCredentialStatus.ACTIVE) {
        throw new ForbiddenException('Transaction PIN is not active');
      }
      const previous = this.pinCredentialValues(credential);
      credential.passwordHash = encodedHash;
      credential.hashAlgorithm = PasswordHashAlgorithm.PBKDF2;
      credential.passwordVersion += 1;
      credential.passwordChangedAt = new Date();
      credential.passwordExpiresAt = null;
      credential.failedAuthenticationCount = 0;
      credential.accountLocked = false;
      credential.lockedAt = null;
      credential.lockReason = null;
      const saved = await repository.save(credential);
      await this.audit(manager, saved.id, action, actor, previous, this.pinCredentialValues(saved));
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        action === 'PIN_CHANGED' ? SecurityEventType.PIN_CHANGED : SecurityEventType.PIN_RESET,
        actor,
        { pinVersion: saved.passwordVersion, hashAlgorithm: saved.hashAlgorithm },
      );
      return saved.id;
    });
  }

  private async findActivePinCredential(
    repository: Repository<CustomerAuthenticationCredential>,
    customerId: string,
  ): Promise<CustomerAuthenticationCredential | null> {
    const records = await repository.find({
      where: { customerId, type: AuthenticationCredentialType.PIN },
    });
    return records.find((record) => record.deletedAt === null) ?? null;
  }

  private async requireActivePinCredential(
    customerId: string,
  ): Promise<CustomerAuthenticationCredential> {
    await this.requireCustomer(this.customerRepository, customerId);
    const credential = await this.findActivePinCredential(this.credentialRepository, customerId);
    if (!credential) {
      throw new NotFoundException('Transaction PIN is not configured for this customer');
    }
    return credential;
  }

  private async requirePinCredential(
    repository: Repository<CustomerAuthenticationCredential>,
    customerId: string,
  ): Promise<CustomerAuthenticationCredential> {
    const credential = await repository.findOne({
      where: { customerId, type: AuthenticationCredentialType.PIN },
    });
    if (!credential || credential.deletedAt !== null) {
      throw new NotFoundException('Transaction PIN is not configured for this customer');
    }
    return credential;
  }

  private async requirePinCredentialById(
    repository: Repository<CustomerAuthenticationCredential>,
    customerId: string,
    credentialId: string,
  ): Promise<CustomerAuthenticationCredential> {
    const credential = await repository.findOne({
      where: { id: credentialId, customerId, type: AuthenticationCredentialType.PIN },
    });
    if (!credential || credential.deletedAt !== null) {
      throw new NotFoundException('Transaction PIN is not configured for this customer');
    }
    return credential;
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
    return customer;
  }

  private toStatusView(credential: CustomerAuthenticationCredential): TransactionPinStatusView {
    return {
      configured: true,
      accountLocked: credential.accountLocked,
      failedPinAttemptCount: credential.failedAuthenticationCount,
      pinVersion: credential.passwordVersion,
      lockedAt: credential.lockedAt,
      changedAt: credential.passwordChangedAt,
    };
  }

  /** Audit-safe projection: NEVER contains the PIN or any hash material. */
  private pinCredentialValues(
    credential: CustomerAuthenticationCredential,
  ): Record<string, unknown> {
    return {
      customerId: credential.customerId,
      type: credential.type,
      status: credential.status,
      hashAlgorithm: credential.hashAlgorithm,
      pinVersion: credential.passwordVersion,
      pinChangedAt: credential.passwordChangedAt,
      failedPinAttemptCount: credential.failedAuthenticationCount,
      accountLocked: credential.accountLocked,
      lockedAt: credential.lockedAt,
      lockReason: credential.lockReason,
      version: credential.version,
    };
  }

  private async recordSecurityEvent(
    manager: EntityManager,
    customerId: string,
    credentialId: string | null,
    eventType: SecurityEventType,
    actor: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const event = await manager.getRepository(SecurityEventHistory).save(
      manager.getRepository(SecurityEventHistory).create({
        id: randomUUID(),
        customerId,
        credentialId,
        eventType,
        actor,
        metadata: redactRecord(metadata),
        occurredAt: new Date(),
        deletedAt: null,
      }),
    );
    await this.audit(manager, event.id, 'SECURITY_EVENT_CREATED', actor, undefined, {
      customerId,
      credentialId,
      eventType,
    });
  }

  private async audit(
    manager: EntityManager,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL',
      entityId,
      action,
      actor,
      previousValues,
      newValues,
    });
  }

  private assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private normalizeActor(value: string): string {
    const actor = typeof value === 'string' ? value.trim() : '';
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length > max) {
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    }
    return normalized || null;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
