import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  AuthenticationCredentialType,
  MfaEnrollmentStatus,
  MfaMethodStatus,
  PasswordHistoryAction,
  PasswordResetRequestStatus,
  PasswordResetTokenStatus,
  RecoveryCodeStatus,
  SecurityEventType,
  TrustedDeviceStatus,
} from './customer-authentication.enums';
import type {
  CreateAuthenticationCredentialCommand,
  CreateMfaEnrollmentCommand,
  CreateMfaMethodCommand,
  CreatePasswordResetRequestCommand,
  CreateRecoveryCodeCommand,
  CreateTrustedDeviceCommand,
  AuthenticationCredentialView,
  RecordFailedAuthenticationCommand,
  RotatePasswordCommand,
  UnlockCredentialCommand,
  UpdateAuthenticationCredentialCommand,
  UpdateMfaEnrollmentCommand,
  UpdateMfaMethodCommand,
  UpdatePasswordResetRequestCommand,
  UpdatePasswordResetTokenCommand,
  UpdateRecoveryCodeCommand,
  UpdateTrustedDeviceCommand,
  IssuePasswordResetTokenCommand,
} from './customer-authentication.types';
import { MfaEnrollment } from './mfa-enrollment.entity';
import { MfaMethod } from './mfa-method.entity';
import { PasswordHistory } from './password-history.entity';
import { PasswordResetRequest } from './password-reset-request.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RecoveryCode } from './recovery-code.entity';
import { SecurityEventHistory } from './security-event-history.entity';
import { TrustedDevice } from './trusted-device.entity';

const MAX_FAILED_AUTHENTICATIONS = 5;

@Injectable()
export class CustomerAuthenticationService {
  constructor(
    @InjectRepository(CustomerAuthenticationCredential)
    private readonly credentialRepository: Repository<CustomerAuthenticationCredential>,
    @InjectRepository(PasswordHistory)
    private readonly passwordHistoryRepository: Repository<PasswordHistory>,
    @InjectRepository(PasswordResetRequest)
    private readonly resetRequestRepository: Repository<PasswordResetRequest>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(MfaEnrollment)
    private readonly mfaEnrollmentRepository: Repository<MfaEnrollment>,
    @InjectRepository(MfaMethod)
    private readonly mfaMethodRepository: Repository<MfaMethod>,
    @InjectRepository(TrustedDevice)
    private readonly trustedDeviceRepository: Repository<TrustedDevice>,
    @InjectRepository(RecoveryCode)
    private readonly recoveryCodeRepository: Repository<RecoveryCode>,
    @InjectRepository(SecurityEventHistory)
    private readonly securityEventRepository: Repository<SecurityEventHistory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createCredential(
    customerId: string,
    command: CreateAuthenticationCredentialCommand,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    const passwordExpiresAt = this.parseOptionalDate(
      command.passwordExpiresAt,
      'passwordExpiresAt',
    );
    try {
      const credentialId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerAuthenticationCredential);
        const existing = await this.findActiveCredential(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has an active authentication credential');
        }
        const credential = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: AuthenticationCredentialType.PASSWORD,
            passwordHash,
            hashAlgorithm: command.hashAlgorithm,
            passwordVersion: command.passwordVersion,
            passwordChangedAt: new Date(),
            passwordExpiresAt,
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
          'CUSTOMER_AUTHENTICATION_CREDENTIAL',
          credential.id,
          'CREATED',
          actor,
          undefined,
          this.credentialValues(credential),
        );
        await this.appendPasswordHistory(manager, credential, PasswordHistoryAction.CREATED, actor);
        await this.recordSecurityEvent(
          manager,
          customerId,
          credential.id,
          SecurityEventType.CREDENTIAL_CREATED,
          actor,
          {},
        );
        return credential.id;
      });
      return this.getCredential(customerId, credentialId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active authentication credential');
      }
      throw error;
    }
  }

  async getCredential(
    customerId: string,
    credentialId?: string,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    if (credentialId !== undefined) {
      this.assertUuid(credentialId, 'credentialId');
    }
    await this.requireCustomer(this.customerRepository, customerId);
    const credential = credentialId
      ? await this.credentialRepository.findOne({ where: { id: credentialId, customerId } })
      : await this.findActiveCredential(this.credentialRepository, customerId);
    if (!credential || !this.isNotDeleted(credential.deletedAt)) {
      throw new NotFoundException(
        `Authentication credential for customer ${customerId} was not found`,
      );
    }
    return this.toCredentialView(credential);
  }

  async updateCredential(
    customerId: string,
    credentialId: string,
    command: UpdateAuthenticationCredentialCommand,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const expiresAt =
      command.passwordExpiresAt === undefined
        ? undefined
        : this.parseOptionalDate(command.passwordExpiresAt, 'passwordExpiresAt');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const credential = await this.requireCredential(repository, customerId, credentialId);
      if (command.version !== undefined && command.version !== credential.version) {
        throw new ConflictException('Authentication credential version is stale');
      }
      const statusChanged = command.status !== undefined && command.status !== credential.status;
      const expiryChanged = expiresAt !== undefined;
      if (!statusChanged && !expiryChanged) {
        return this.toCredentialView(credential);
      }
      if (command.status === AuthenticationCredentialStatus.ACTIVE && credential.accountLocked) {
        throw new ConflictException(
          'Locked credentials must be explicitly unlocked before activation',
        );
      }
      if (statusChanged) {
        this.assertCredentialTransition(
          credential.status,
          command.status as AuthenticationCredentialStatus,
        );
      }
      const previous = this.credentialValues(credential);
      if (command.status !== undefined) {
        credential.status = command.status;
      }
      if (expiresAt !== undefined) {
        credential.passwordExpiresAt = expiresAt;
      }
      const saved = await repository.save(credential);
      await this.audit(
        manager,
        'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.credentialValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        SecurityEventType.CREDENTIAL_UPDATED,
        actor,
        { statusChanged, expiryChanged },
      );
      return this.toCredentialView(saved);
    });
  }

  async rotatePassword(
    customerId: string,
    credentialId: string,
    command: RotatePasswordCommand,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const passwordHash = this.normalizeHash(command.passwordHash, 'passwordHash');
    const passwordExpiresAt = this.parseOptionalDate(
      command.passwordExpiresAt,
      'passwordExpiresAt',
    );
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const credential = await this.requireCredential(repository, customerId, credentialId);
      if (credential.status === AuthenticationCredentialStatus.REVOKED) {
        throw new ConflictException('Revoked credentials cannot rotate passwords');
      }
      const previous = this.credentialValues(credential);
      credential.passwordHash = passwordHash;
      credential.hashAlgorithm = command.hashAlgorithm;
      credential.passwordVersion = command.passwordVersion;
      credential.passwordChangedAt = new Date();
      credential.passwordExpiresAt = passwordExpiresAt;
      const saved = await repository.save(credential);
      await this.audit(
        manager,
        'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'PASSWORD_ROTATED',
        actor,
        previous,
        this.credentialValues(saved),
      );
      await this.appendPasswordHistory(manager, saved, PasswordHistoryAction.ROTATED, actor);
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        SecurityEventType.PASSWORD_ROTATED,
        actor,
        { passwordVersion: saved.passwordVersion, hashAlgorithm: saved.hashAlgorithm },
      );
      return this.toCredentialView(saved);
    });
  }

  async listPasswordHistory(customerId: string, credentialId: string): Promise<PasswordHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(credentialId, 'credentialId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireCredential(this.credentialRepository, customerId, credentialId);
    const history = await this.passwordHistoryRepository.find({ where: { credentialId } });
    return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async recordFailedAuthentication(
    customerId: string,
    credentialId: string,
    command: RecordFailedAuthenticationCommand,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    return this.dataSource.transaction(async (manager) => {
      const credential = await this.requireCredential(
        manager.getRepository(CustomerAuthenticationCredential),
        customerId,
        credentialId,
      );
      if (credential.status === AuthenticationCredentialStatus.REVOKED) {
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
      const saved = await manager.getRepository(CustomerAuthenticationCredential).save(credential);
      await this.audit(
        manager,
        'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'FAILED_AUTHENTICATION_RECORDED',
        actor,
        previous,
        this.credentialValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        SecurityEventType.AUTHENTICATION_FAILED,
        actor,
        { reason, failedAuthenticationCount: saved.failedAuthenticationCount },
      );
      if (shouldLock && !previous.accountLocked) {
        await this.recordSecurityEvent(
          manager,
          customerId,
          saved.id,
          SecurityEventType.ACCOUNT_LOCKED,
          actor,
          { failedAuthenticationCount: saved.failedAuthenticationCount },
        );
      }
      return this.toCredentialView(saved);
    });
  }

  async unlockCredential(
    customerId: string,
    credentialId: string,
    command: UnlockCredentialCommand,
  ): Promise<AuthenticationCredentialView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerAuthenticationCredential);
      const credential = await this.requireCredential(repository, customerId, credentialId);
      if (!credential.accountLocked) {
        return this.toCredentialView(credential);
      }
      const previous = this.credentialValues(credential);
      credential.accountLocked = false;
      credential.failedAuthenticationCount = 0;
      credential.lockedAt = null;
      credential.lockReason = null;
      const saved = await repository.save(credential);
      await this.audit(
        manager,
        'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        saved.id,
        'ACCOUNT_UNLOCKED',
        actor,
        previous,
        this.credentialValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.id,
        SecurityEventType.ACCOUNT_UNLOCKED,
        actor,
        { reason },
      );
      return this.toCredentialView(saved);
    });
  }

  async createPasswordResetRequest(
    customerId: string,
    command: CreatePasswordResetRequestCommand,
  ): Promise<PasswordResetRequest> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(command.credentialId, 'credentialId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    const expiresAt = command.expiresAt
      ? this.parseRequiredDate(command.expiresAt, 'expiresAt')
      : new Date(Date.now() + 30 * 60 * 1000);
    if (expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    return this.dataSource.transaction(async (manager) => {
      const credential = await this.requireCredential(
        manager.getRepository(CustomerAuthenticationCredential),
        customerId,
        command.credentialId,
      );
      if (credential.status === AuthenticationCredentialStatus.REVOKED) {
        throw new ConflictException('Cannot create a reset request for a revoked credential');
      }
      const request = await manager.getRepository(PasswordResetRequest).save(
        manager.getRepository(PasswordResetRequest).create({
          id: randomUUID(),
          customerId,
          credentialId: credential.id,
          status: PasswordResetRequestStatus.REQUESTED,
          reason,
          requestedBy: actor,
          requestedAt: new Date(),
          expiresAt,
          completedAt: null,
          version: 1,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'PASSWORD_RESET_REQUEST',
        request.id,
        'CREATED',
        actor,
        undefined,
        this.resetRequestValues(request),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        credential.id,
        SecurityEventType.PASSWORD_RESET_REQUESTED,
        actor,
        { requestId: request.id },
      );
      return request;
    });
  }

  async listPasswordResetRequests(customerId: string): Promise<PasswordResetRequest[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const requests = await this.resetRequestRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(requests.filter((request) => this.isNotDeleted(request.deletedAt)));
  }

  async updatePasswordResetRequest(
    customerId: string,
    requestId: string,
    command: UpdatePasswordResetRequestCommand,
  ): Promise<PasswordResetRequest> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(requestId, 'requestId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PasswordResetRequest);
      const request = await requestRepository.findOne({ where: { id: requestId, customerId } });
      if (!request || !this.isNotDeleted(request.deletedAt)) {
        throw new NotFoundException(`Password reset request ${requestId} was not found`);
      }
      if (command.version !== undefined && command.version !== request.version) {
        throw new ConflictException('Password reset request version is stale');
      }
      if (request.status === command.status) {
        return request;
      }
      this.assertResetRequestTransition(request.status, command.status);
      const previous = this.resetRequestValues(request);
      request.status = command.status;
      if (command.status === PasswordResetRequestStatus.COMPLETED) {
        request.completedAt = new Date();
      }
      const saved = await requestRepository.save(request);
      await this.audit(
        manager,
        'PASSWORD_RESET_REQUEST',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        this.resetRequestValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        saved.credentialId,
        SecurityEventType.PASSWORD_RESET_STATUS_CHANGED,
        actor,
        { requestId: saved.id, status: saved.status },
      );
      return saved;
    });
  }

  async issuePasswordResetToken(
    customerId: string,
    requestId: string,
    command: IssuePasswordResetTokenCommand,
  ): Promise<PasswordResetToken> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(requestId, 'requestId');
    const actor = this.normalizeActor(command.actor);
    const tokenHash = this.normalizeHash(command.tokenHash, 'tokenHash');
    const expiresAt = this.parseRequiredDate(command.expiresAt, 'expiresAt');
    if (expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const requestRepository = manager.getRepository(PasswordResetRequest);
        const request = await requestRepository.findOne({ where: { id: requestId, customerId } });
        if (!request || !this.isNotDeleted(request.deletedAt)) {
          throw new NotFoundException(`Password reset request ${requestId} was not found`);
        }
        if (
          request.status !== PasswordResetRequestStatus.REQUESTED &&
          request.status !== PasswordResetRequestStatus.IN_PROGRESS
        ) {
          throw new ConflictException('Password reset request is not open for token issuance');
        }
        const token = await manager.getRepository(PasswordResetToken).save(
          manager.getRepository(PasswordResetToken).create({
            id: randomUUID(),
            requestId: request.id,
            tokenHash,
            tokenVersion: command.tokenVersion,
            status: PasswordResetTokenStatus.ACTIVE,
            issuedAt: new Date(),
            expiresAt,
            usedAt: null,
            version: 1,
            deletedAt: null,
          }),
        );
        if (request.status === PasswordResetRequestStatus.REQUESTED) {
          const previousRequest = this.resetRequestValues(request);
          request.status = PasswordResetRequestStatus.IN_PROGRESS;
          const savedRequest = await requestRepository.save(request);
          await this.audit(
            manager,
            'PASSWORD_RESET_REQUEST',
            savedRequest.id,
            'STATUS_UPDATED',
            actor,
            previousRequest,
            this.resetRequestValues(savedRequest),
          );
          await this.recordSecurityEvent(
            manager,
            customerId,
            savedRequest.credentialId,
            SecurityEventType.PASSWORD_RESET_STATUS_CHANGED,
            actor,
            { requestId: savedRequest.id, status: savedRequest.status },
          );
        }
        await this.audit(
          manager,
          'PASSWORD_RESET_TOKEN',
          token.id,
          'CREATED',
          actor,
          undefined,
          this.resetTokenValues(token),
        );
        await this.recordSecurityEvent(
          manager,
          customerId,
          request.credentialId,
          SecurityEventType.PASSWORD_RESET_TOKEN_ISSUED,
          actor,
          { requestId: request.id, tokenId: token.id },
        );
        return token;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Reset token hash already exists');
      }
      throw error;
    }
  }

  async listPasswordResetTokens(
    customerId: string,
    requestId: string,
  ): Promise<PasswordResetToken[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(requestId, 'requestId');
    const request = await this.requireResetRequest(
      this.resetRequestRepository,
      customerId,
      requestId,
    );
    const tokens = await this.resetTokenRepository.find({ where: { requestId: request.id } });
    return this.sortByCreatedAt(tokens.filter((token) => this.isNotDeleted(token.deletedAt)));
  }

  async updatePasswordResetToken(
    customerId: string,
    requestId: string,
    tokenId: string,
    command: UpdatePasswordResetTokenCommand,
  ): Promise<PasswordResetToken> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(requestId, 'requestId');
    this.assertUuid(tokenId, 'tokenId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireResetRequest(
        manager.getRepository(PasswordResetRequest),
        customerId,
        requestId,
      );
      const repository = manager.getRepository(PasswordResetToken);
      const token = await repository.findOne({ where: { id: tokenId, requestId } });
      if (!token || !this.isNotDeleted(token.deletedAt)) {
        throw new NotFoundException(`Password reset token ${tokenId} was not found`);
      }
      if (command.version !== undefined && command.version !== token.version) {
        throw new ConflictException('Password reset token version is stale');
      }
      if (token.status === command.status) {
        return token;
      }
      this.assertResetTokenTransition(token.status, command.status);
      const previous = this.resetTokenValues(token);
      token.status = command.status;
      if (command.status === PasswordResetTokenStatus.USED) {
        token.usedAt = new Date();
      }
      const saved = await repository.save(token);
      await this.audit(
        manager,
        'PASSWORD_RESET_TOKEN',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        this.resetTokenValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        request.credentialId,
        SecurityEventType.PASSWORD_RESET_TOKEN_UPDATED,
        actor,
        { requestId, tokenId, status: saved.status },
      );
      return saved;
    });
  }

  async createMfaEnrollment(
    customerId: string,
    command: CreateMfaEnrollmentCommand,
  ): Promise<MfaEnrollment> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const reference = this.normalizeReference(command.reference);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(MfaEnrollment);
        const existing = await repository.findOne({ where: { customerId } });
        if (
          existing &&
          this.isNotDeleted(existing.deletedAt) &&
          existing.status !== MfaEnrollmentStatus.REVOKED
        ) {
          throw new ConflictException('Customer already has an active MFA enrollment');
        }
        const enrollment = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            reference,
            status: MfaEnrollmentStatus.PENDING,
            enabledAt: null,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'MFA_ENROLLMENT',
          enrollment.id,
          'CREATED',
          actor,
          undefined,
          this.mfaEnrollmentValues(enrollment),
        );
        await this.recordSecurityEvent(
          manager,
          customerId,
          null,
          SecurityEventType.MFA_ENROLLMENT_CREATED,
          actor,
          { enrollmentId: enrollment.id },
        );
        return enrollment;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('MFA enrollment reference or active enrollment already exists');
      }
      throw error;
    }
  }

  async listMfaEnrollments(customerId: string): Promise<MfaEnrollment[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const enrollments = await this.mfaEnrollmentRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(enrollments.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async updateMfaEnrollment(
    customerId: string,
    enrollmentId: string,
    command: UpdateMfaEnrollmentCommand,
  ): Promise<MfaEnrollment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(enrollmentId, 'enrollmentId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MfaEnrollment);
      const enrollment = await repository.findOne({ where: { id: enrollmentId, customerId } });
      if (!enrollment || !this.isNotDeleted(enrollment.deletedAt)) {
        throw new NotFoundException(`MFA enrollment ${enrollmentId} was not found`);
      }
      if (command.version !== undefined && command.version !== enrollment.version) {
        throw new ConflictException('MFA enrollment version is stale');
      }
      if (enrollment.status === command.status) return enrollment;
      this.assertMfaEnrollmentTransition(enrollment.status, command.status);
      const previous = this.mfaEnrollmentValues(enrollment);
      enrollment.status = command.status;
      enrollment.enabledAt =
        command.status === MfaEnrollmentStatus.ENABLED ? new Date() : enrollment.enabledAt;
      const saved = await repository.save(enrollment);
      await this.audit(
        manager,
        'MFA_ENROLLMENT',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.mfaEnrollmentValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.MFA_ENROLLMENT_UPDATED,
        actor,
        { enrollmentId: saved.id, status: saved.status },
      );
      return saved;
    });
  }

  async createMfaMethod(
    customerId: string,
    enrollmentId: string,
    command: CreateMfaMethodCommand,
  ): Promise<MfaMethod> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(enrollmentId, 'enrollmentId');
    const actor = this.normalizeActor(command.actor);
    const label = this.normalizeText(command.label, 'label', 160);
    const identifierHash = command.identifierHash
      ? this.normalizeHash(command.identifierHash, 'identifierHash')
      : null;
    return this.dataSource.transaction(async (manager) => {
      const enrollment = await this.requireMfaEnrollment(
        manager.getRepository(MfaEnrollment),
        customerId,
        enrollmentId,
      );
      if (enrollment.status === MfaEnrollmentStatus.REVOKED)
        throw new ConflictException('Revoked MFA enrollments cannot receive methods');
      const repository = manager.getRepository(MfaMethod);
      const existing = await repository.findOne({ where: { enrollmentId, type: command.type } });
      if (existing && this.isNotDeleted(existing.deletedAt))
        throw new ConflictException('MFA method already exists for this enrollment');
      const method = await repository.save(
        repository.create({
          id: randomUUID(),
          enrollmentId,
          customerId,
          type: command.type,
          label,
          identifierHash,
          isPrimary: command.isPrimary,
          status: MfaMethodStatus.PENDING,
          version: 1,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'MFA_METHOD',
        method.id,
        'CREATED',
        actor,
        undefined,
        this.mfaMethodValues(method),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.MFA_METHOD_ADDED,
        actor,
        { enrollmentId, methodId: method.id },
      );
      return method;
    });
  }

  async listMfaMethods(customerId: string, enrollmentId: string): Promise<MfaMethod[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(enrollmentId, 'enrollmentId');
    await this.requireMfaEnrollment(this.mfaEnrollmentRepository, customerId, enrollmentId);
    const methods = await this.mfaMethodRepository.find({ where: { enrollmentId, customerId } });
    return this.sortByCreatedAt(methods.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async updateMfaMethod(
    customerId: string,
    methodId: string,
    command: UpdateMfaMethodCommand,
  ): Promise<MfaMethod> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(methodId, 'methodId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MfaMethod);
      const method = await repository.findOne({ where: { id: methodId, customerId } });
      if (!method || !this.isNotDeleted(method.deletedAt))
        throw new NotFoundException(`MFA method ${methodId} was not found`);
      if (command.version !== undefined && command.version !== method.version)
        throw new ConflictException('MFA method version is stale');
      if (method.status === command.status) return method;
      this.assertMfaMethodTransition(method.status, command.status);
      const previous = this.mfaMethodValues(method);
      method.status = command.status;
      const saved = await repository.save(method);
      await this.audit(
        manager,
        'MFA_METHOD',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.mfaMethodValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.MFA_METHOD_UPDATED,
        actor,
        { methodId: saved.id, status: saved.status },
      );
      return saved;
    });
  }

  async createTrustedDevice(
    customerId: string,
    command: CreateTrustedDeviceCommand,
  ): Promise<TrustedDevice> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const deviceReference = this.normalizeReference(command.deviceReference);
    const deviceName = this.normalizeText(command.deviceName, 'deviceName', 160);
    const platform = this.normalizeText(command.platform, 'platform', 80);
    const fingerprintHash = this.normalizeHash(
      command.deviceFingerprintHash,
      'deviceFingerprintHash',
    );
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(TrustedDevice);
        const existing = await repository.findOne({ where: { customerId, deviceReference } });
        if (existing && this.isNotDeleted(existing.deletedAt))
          throw new ConflictException('Trusted device already exists');
        const now = new Date();
        const device = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            deviceReference,
            deviceName,
            platform,
            deviceFingerprintHash: fingerprintHash,
            status: TrustedDeviceStatus.PENDING,
            registeredAt: now,
            lastSeenAt: null,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'TRUSTED_DEVICE',
          device.id,
          'CREATED',
          actor,
          undefined,
          this.trustedDeviceValues(device),
        );
        await this.recordSecurityEvent(
          manager,
          customerId,
          null,
          SecurityEventType.TRUSTED_DEVICE_REGISTERED,
          actor,
          { deviceId: device.id },
        );
        return device;
      });
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('Trusted device already exists');
      throw error;
    }
  }

  async listTrustedDevices(customerId: string): Promise<TrustedDevice[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const devices = await this.trustedDeviceRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(devices.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async updateTrustedDevice(
    customerId: string,
    deviceId: string,
    command: UpdateTrustedDeviceCommand,
  ): Promise<TrustedDevice> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(deviceId, 'deviceId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TrustedDevice);
      const device = await repository.findOne({ where: { id: deviceId, customerId } });
      if (!device || !this.isNotDeleted(device.deletedAt))
        throw new NotFoundException(`Trusted device ${deviceId} was not found`);
      if (command.version !== undefined && command.version !== device.version)
        throw new ConflictException('Trusted device version is stale');
      if (device.status === command.status) return device;
      this.assertTrustedDeviceTransition(device.status, command.status);
      const previous = this.trustedDeviceValues(device);
      device.status = command.status;
      const saved = await repository.save(device);
      await this.audit(
        manager,
        'TRUSTED_DEVICE',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.trustedDeviceValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.TRUSTED_DEVICE_UPDATED,
        actor,
        { deviceId: saved.id, status: saved.status },
      );
      return saved;
    });
  }

  async createRecoveryCode(
    customerId: string,
    command: CreateRecoveryCodeCommand,
  ): Promise<RecoveryCode> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const codeHash = this.normalizeHash(command.codeHash, 'codeHash');
    if (command.enrollmentId) this.assertUuid(command.enrollmentId, 'enrollmentId');
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      if (command.enrollmentId)
        await this.requireMfaEnrollment(
          manager.getRepository(MfaEnrollment),
          customerId,
          command.enrollmentId,
        );
      const repository = manager.getRepository(RecoveryCode);
      const code = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId,
          enrollmentId: command.enrollmentId ?? null,
          codeHash,
          codeVersion: command.codeVersion,
          status: RecoveryCodeStatus.AVAILABLE,
          generatedAt: new Date(),
          usedAt: null,
          version: 1,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'RECOVERY_CODE',
        code.id,
        'CREATED',
        actor,
        undefined,
        this.recoveryCodeValues(code),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.RECOVERY_CODE_CREATED,
        actor,
        { recoveryCodeId: code.id },
      );
      return code;
    });
  }

  async listRecoveryCodes(customerId: string): Promise<RecoveryCode[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const codes = await this.recoveryCodeRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(codes.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async updateRecoveryCode(
    customerId: string,
    codeId: string,
    command: UpdateRecoveryCodeCommand,
  ): Promise<RecoveryCode> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(codeId, 'codeId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RecoveryCode);
      const code = await repository.findOne({ where: { id: codeId, customerId } });
      if (!code || !this.isNotDeleted(code.deletedAt))
        throw new NotFoundException(`Recovery code ${codeId} was not found`);
      if (command.version !== undefined && command.version !== code.version)
        throw new ConflictException('Recovery code version is stale');
      if (code.status === command.status) return code;
      this.assertRecoveryCodeTransition(code.status, command.status);
      const previous = this.recoveryCodeValues(code);
      code.status = command.status;
      code.usedAt = command.status === RecoveryCodeStatus.USED ? new Date() : code.usedAt;
      const saved = await repository.save(code);
      await this.audit(
        manager,
        'RECOVERY_CODE',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.recoveryCodeValues(saved),
      );
      await this.recordSecurityEvent(
        manager,
        customerId,
        null,
        SecurityEventType.RECOVERY_CODE_UPDATED,
        actor,
        { recoveryCodeId: saved.id, status: saved.status },
      );
      return saved;
    });
  }

  async listSecurityEvents(customerId: string): Promise<SecurityEventHistory[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const events = await this.securityEventRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(events.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  private async findActiveCredential(
    repository: Repository<CustomerAuthenticationCredential>,
    customerId: string,
  ): Promise<CustomerAuthenticationCredential | null> {
    const records = await repository.find({ where: { customerId } });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private async requireCredential(
    repository: Repository<CustomerAuthenticationCredential>,
    customerId: string,
    credentialId: string,
  ): Promise<CustomerAuthenticationCredential> {
    const credential = await repository.findOne({ where: { id: credentialId, customerId } });
    if (!credential || !this.isNotDeleted(credential.deletedAt))
      throw new NotFoundException(`Authentication credential ${credentialId} was not found`);
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

  private async requireResetRequest(
    repository: Repository<PasswordResetRequest>,
    customerId: string,
    requestId: string,
  ): Promise<PasswordResetRequest> {
    const request = await repository.findOne({ where: { id: requestId, customerId } });
    if (!request || !this.isNotDeleted(request.deletedAt))
      throw new NotFoundException(`Password reset request ${requestId} was not found`);
    return request;
  }

  private async requireMfaEnrollment(
    repository: Repository<MfaEnrollment>,
    customerId: string,
    enrollmentId: string,
  ): Promise<MfaEnrollment> {
    const enrollment = await repository.findOne({ where: { id: enrollmentId, customerId } });
    if (!enrollment || !this.isNotDeleted(enrollment.deletedAt))
      throw new NotFoundException(`MFA enrollment ${enrollmentId} was not found`);
    return enrollment;
  }

  private async appendPasswordHistory(
    manager: EntityManager,
    credential: CustomerAuthenticationCredential,
    action: PasswordHistoryAction,
    actor: string,
  ): Promise<void> {
    const history = await manager.getRepository(PasswordHistory).save(
      manager.getRepository(PasswordHistory).create({
        id: randomUUID(),
        credentialId: credential.id,
        passwordHash: credential.passwordHash,
        hashAlgorithm: credential.hashAlgorithm,
        passwordVersion: credential.passwordVersion,
        action,
        changedAt: new Date(),
        deletedAt: null,
      }),
    );
    await this.audit(manager, 'PASSWORD_HISTORY', history.id, 'CREATED', actor, undefined, {
      credentialId: history.credentialId,
      action: history.action,
      hashAlgorithm: history.hashAlgorithm,
      passwordVersion: history.passwordVersion,
    });
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
        metadata,
        occurredAt: new Date(),
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'SECURITY_EVENT_HISTORY',
      event.id,
      'CREATED',
      actor,
      undefined,
      this.securityEventValues(event),
    );
  }

  private assertCredentialTransition(
    current: AuthenticationCredentialStatus,
    next: AuthenticationCredentialStatus,
  ): void {
    const allowed: Record<AuthenticationCredentialStatus, AuthenticationCredentialStatus[]> = {
      [AuthenticationCredentialStatus.PENDING]: [
        AuthenticationCredentialStatus.ACTIVE,
        AuthenticationCredentialStatus.SUSPENDED,
        AuthenticationCredentialStatus.REVOKED,
      ],
      [AuthenticationCredentialStatus.ACTIVE]: [
        AuthenticationCredentialStatus.SUSPENDED,
        AuthenticationCredentialStatus.REVOKED,
      ],
      [AuthenticationCredentialStatus.SUSPENDED]: [
        AuthenticationCredentialStatus.ACTIVE,
        AuthenticationCredentialStatus.REVOKED,
      ],
      [AuthenticationCredentialStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid credential transition from ${current} to ${next}`);
  }

  private assertResetRequestTransition(
    current: PasswordResetRequestStatus,
    next: PasswordResetRequestStatus,
  ): void {
    const allowed: Record<PasswordResetRequestStatus, PasswordResetRequestStatus[]> = {
      [PasswordResetRequestStatus.REQUESTED]: [
        PasswordResetRequestStatus.IN_PROGRESS,
        PasswordResetRequestStatus.EXPIRED,
        PasswordResetRequestStatus.CANCELLED,
        PasswordResetRequestStatus.REJECTED,
      ],
      [PasswordResetRequestStatus.IN_PROGRESS]: [
        PasswordResetRequestStatus.COMPLETED,
        PasswordResetRequestStatus.EXPIRED,
        PasswordResetRequestStatus.CANCELLED,
        PasswordResetRequestStatus.REJECTED,
      ],
      [PasswordResetRequestStatus.COMPLETED]: [],
      [PasswordResetRequestStatus.EXPIRED]: [],
      [PasswordResetRequestStatus.CANCELLED]: [],
      [PasswordResetRequestStatus.REJECTED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(
        `Invalid password reset request transition from ${current} to ${next}`,
      );
  }

  private assertResetTokenTransition(
    current: PasswordResetTokenStatus,
    next: PasswordResetTokenStatus,
  ): void {
    const allowed: Record<PasswordResetTokenStatus, PasswordResetTokenStatus[]> = {
      [PasswordResetTokenStatus.ACTIVE]: [
        PasswordResetTokenStatus.USED,
        PasswordResetTokenStatus.EXPIRED,
        PasswordResetTokenStatus.REVOKED,
      ],
      [PasswordResetTokenStatus.USED]: [],
      [PasswordResetTokenStatus.EXPIRED]: [],
      [PasswordResetTokenStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(
        `Invalid password reset token transition from ${current} to ${next}`,
      );
  }

  private assertMfaEnrollmentTransition(
    current: MfaEnrollmentStatus,
    next: MfaEnrollmentStatus,
  ): void {
    const allowed: Record<MfaEnrollmentStatus, MfaEnrollmentStatus[]> = {
      [MfaEnrollmentStatus.PENDING]: [
        MfaEnrollmentStatus.ENABLED,
        MfaEnrollmentStatus.DISABLED,
        MfaEnrollmentStatus.REVOKED,
      ],
      [MfaEnrollmentStatus.ENABLED]: [MfaEnrollmentStatus.DISABLED, MfaEnrollmentStatus.REVOKED],
      [MfaEnrollmentStatus.DISABLED]: [MfaEnrollmentStatus.ENABLED, MfaEnrollmentStatus.REVOKED],
      [MfaEnrollmentStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid MFA enrollment transition from ${current} to ${next}`);
  }

  private assertMfaMethodTransition(current: MfaMethodStatus, next: MfaMethodStatus): void {
    const allowed: Record<MfaMethodStatus, MfaMethodStatus[]> = {
      [MfaMethodStatus.PENDING]: [
        MfaMethodStatus.ENABLED,
        MfaMethodStatus.DISABLED,
        MfaMethodStatus.REVOKED,
      ],
      [MfaMethodStatus.ENABLED]: [MfaMethodStatus.DISABLED, MfaMethodStatus.REVOKED],
      [MfaMethodStatus.DISABLED]: [MfaMethodStatus.ENABLED, MfaMethodStatus.REVOKED],
      [MfaMethodStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid MFA method transition from ${current} to ${next}`);
  }

  private assertTrustedDeviceTransition(
    current: TrustedDeviceStatus,
    next: TrustedDeviceStatus,
  ): void {
    const allowed: Record<TrustedDeviceStatus, TrustedDeviceStatus[]> = {
      [TrustedDeviceStatus.PENDING]: [
        TrustedDeviceStatus.TRUSTED,
        TrustedDeviceStatus.SUSPENDED,
        TrustedDeviceStatus.REVOKED,
      ],
      [TrustedDeviceStatus.TRUSTED]: [TrustedDeviceStatus.SUSPENDED, TrustedDeviceStatus.REVOKED],
      [TrustedDeviceStatus.SUSPENDED]: [TrustedDeviceStatus.TRUSTED, TrustedDeviceStatus.REVOKED],
      [TrustedDeviceStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid trusted device transition from ${current} to ${next}`);
  }

  private assertRecoveryCodeTransition(
    current: RecoveryCodeStatus,
    next: RecoveryCodeStatus,
  ): void {
    const allowed: Record<RecoveryCodeStatus, RecoveryCodeStatus[]> = {
      [RecoveryCodeStatus.AVAILABLE]: [RecoveryCodeStatus.USED, RecoveryCodeStatus.REVOKED],
      [RecoveryCodeStatus.USED]: [],
      [RecoveryCodeStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next))
      throw new ConflictException(`Invalid recovery code transition from ${current} to ${next}`);
  }

  private normalizeReference(value: string): string {
    return this.normalizeSafe(value, 'reference', 160);
  }
  private normalizeHash(value: string, field: string): string {
    return this.normalizeText(value, field, 512);
  }
  private normalizeSafe(value: string, field: string, max: number): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized) || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} safe characters`);
    return normalized;
  }
  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    return normalized;
  }
  private normalizeActor(value: string): string {
    return this.normalizeText(value, 'actor', 160);
  }
  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length > max)
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    return normalized || null;
  }
  private parseRequiredDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }
  private parseOptionalDate(value: string | undefined, field: string): Date | null {
    return value === undefined ? null : this.parseRequiredDate(value, field);
  }
  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      throw new BadRequestException(`${field} must be a UUID`);
  }
  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }
  private sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
    return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private toCredentialView(
    credential: CustomerAuthenticationCredential,
  ): AuthenticationCredentialView {
    return {
      id: credential.id,
      customerId: credential.customerId,
      type: credential.type,
      status: credential.status,
      hashAlgorithm: credential.hashAlgorithm,
      passwordVersion: credential.passwordVersion,
      passwordChangedAt: credential.passwordChangedAt,
      passwordExpiresAt: credential.passwordExpiresAt,
      passwordExpired:
        credential.passwordExpiresAt !== null &&
        credential.passwordExpiresAt.getTime() <= Date.now(),
      failedAuthenticationCount: credential.failedAuthenticationCount,
      accountLocked: credential.accountLocked,
      lockedAt: credential.lockedAt,
      lockReason: credential.lockReason,
      version: credential.version,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
  private credentialValues(credential: CustomerAuthenticationCredential): Record<string, unknown> {
    return {
      customerId: credential.customerId,
      type: credential.type,
      status: credential.status,
      hashAlgorithm: credential.hashAlgorithm,
      passwordVersion: credential.passwordVersion,
      passwordChangedAt: credential.passwordChangedAt,
      passwordExpiresAt: credential.passwordExpiresAt,
      failedAuthenticationCount: credential.failedAuthenticationCount,
      accountLocked: credential.accountLocked,
      lockedAt: credential.lockedAt,
      lockReason: credential.lockReason,
      version: credential.version,
    };
  }
  private resetRequestValues(request: PasswordResetRequest): Record<string, unknown> {
    return {
      customerId: request.customerId,
      credentialId: request.credentialId,
      status: request.status,
      reason: request.reason,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      completedAt: request.completedAt,
      version: request.version,
    };
  }
  private resetTokenValues(token: PasswordResetToken): Record<string, unknown> {
    return {
      requestId: token.requestId,
      tokenVersion: token.tokenVersion,
      status: token.status,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      usedAt: token.usedAt,
      version: token.version,
    };
  }
  private mfaEnrollmentValues(value: MfaEnrollment): Record<string, unknown> {
    return {
      customerId: value.customerId,
      reference: value.reference,
      status: value.status,
      enabledAt: value.enabledAt,
      version: value.version,
    };
  }
  private mfaMethodValues(value: MfaMethod): Record<string, unknown> {
    return {
      customerId: value.customerId,
      enrollmentId: value.enrollmentId,
      type: value.type,
      label: value.label,
      isPrimary: value.isPrimary,
      status: value.status,
      version: value.version,
    };
  }
  private trustedDeviceValues(value: TrustedDevice): Record<string, unknown> {
    return {
      customerId: value.customerId,
      deviceReference: value.deviceReference,
      deviceName: value.deviceName,
      platform: value.platform,
      status: value.status,
      registeredAt: value.registeredAt,
      lastSeenAt: value.lastSeenAt,
      version: value.version,
    };
  }
  private recoveryCodeValues(value: RecoveryCode): Record<string, unknown> {
    return {
      customerId: value.customerId,
      enrollmentId: value.enrollmentId,
      codeVersion: value.codeVersion,
      status: value.status,
      generatedAt: value.generatedAt,
      usedAt: value.usedAt,
      version: value.version,
    };
  }
  private securityEventValues(value: SecurityEventHistory): Record<string, unknown> {
    return {
      customerId: value.customerId,
      credentialId: value.credentialId,
      eventType: value.eventType,
      actor: value.actor,
      metadata: value.metadata,
      occurredAt: value.occurredAt,
    };
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
      previousValues,
      newValues,
    });
  }
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
