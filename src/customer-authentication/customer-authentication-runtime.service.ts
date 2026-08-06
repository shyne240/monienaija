import { randomUUID, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { redactRecord } from '../common/sensitive-data-redaction';
import { AuditService } from '../operations/audit.service';
import { AuthenticationExecutionService } from './authentication-execution.service';
import { AuthenticationSessionService } from './authentication-session.service';
import { CustomerAuthenticationCredential } from './customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  PasswordHistoryAction,
  PasswordResetRequestStatus,
  PasswordResetTokenStatus,
  SecurityEventType,
  PasswordHashAlgorithm,
} from './customer-authentication.enums';
import type {
  CompletePasswordResetCommand,
  CustomerAuthenticationCommand,
  CustomerAuthenticationResult,
  PasswordResetCompletionResult,
} from './customer-authentication-runtime.types';
import { PasswordHistory } from './password-history.entity';
import { PasswordResetRequest } from './password-reset-request.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { SecurityEventHistory } from './security-event-history.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HASH_LENGTH = 512;

@Injectable()
export class CustomerAuthenticationRuntimeService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerAuthenticationCredential)
    private readonly credentialRepository: Repository<CustomerAuthenticationCredential>,
    @InjectRepository(PasswordResetRequest)
    private readonly resetRequestRepository: Repository<PasswordResetRequest>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(PasswordHistory)
    private readonly passwordHistoryRepository: Repository<PasswordHistory>,
    @InjectRepository(SecurityEventHistory)
    private readonly securityEventRepository: Repository<SecurityEventHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly authenticationExecutionService: AuthenticationExecutionService,
    private readonly authenticationSessionService: AuthenticationSessionService,
  ) {}

  async authenticateCustomer(
    command: CustomerAuthenticationCommand,
  ): Promise<CustomerAuthenticationResult> {
    const customerId = command.customerId.trim().toLowerCase();
    const authentication = await this.authenticationExecutionService.authenticate({
      customerId,
      password: command.password,
      actor: command.actor,
    });
    if (!authentication.authenticated) {
      return {
        authenticated: false,
        customerId,
        failureReason: 'INVALID_CREDENTIALS',
      };
    }

    const session = await this.authenticationSessionService.issue({
      authentication,
      actor: command.actor,
      audience: command.audience,
      ttlSeconds: command.ttlSeconds,
      now: command.now,
    });
    return { authenticated: true, customerId, session };
  }

  async completePasswordReset(
    command: CompletePasswordResetCommand,
  ): Promise<PasswordResetCompletionResult> {
    const customerId = command.customerId.trim().toLowerCase();
    const requestId = command.requestId.trim().toLowerCase();
    const actor = this.normalizeActor(command.actor);
    if (!UUID_PATTERN.test(customerId) || !UUID_PATTERN.test(requestId)) {
      return this.invalidRecovery(customerId, requestId);
    }
    if (!this.validHashInput(command.tokenHash) || !this.validHashInput(command.passwordHash)) {
      return this.invalidRecovery(customerId, requestId);
    }
    if (!Object.values(PasswordHashAlgorithm).includes(command.hashAlgorithm)) {
      return this.invalidRecovery(customerId, requestId);
    }
    if (!Number.isSafeInteger(command.passwordVersion) || command.passwordVersion < 1) {
      return this.invalidRecovery(customerId, requestId);
    }

    const now = command.now ?? new Date();
    const passwordExpiresAt = this.parseOptionalDate(command.passwordExpiresAt);
    if (command.passwordExpiresAt !== undefined && !passwordExpiresAt) {
      return this.invalidRecovery(customerId, requestId);
    }

    const completion = await this.dataSource.transaction(async (manager) => {
      const customer = await manager.getRepository(Customer).findOne({
        where: { id: customerId },
      });
      if (!customer || customer.deletedAt !== null) {
        return this.invalidRecovery(customerId, requestId);
      }

      const request = await manager.getRepository(PasswordResetRequest).findOne({
        where: { id: requestId, customerId },
      });
      if (!request || request.deletedAt !== null) {
        return this.invalidRecovery(customerId, requestId);
      }
      if (command.requestVersion !== undefined && command.requestVersion !== request.version) {
        return this.staleVersion(customerId, requestId);
      }
      if (
        request.status !== PasswordResetRequestStatus.IN_PROGRESS ||
        request.expiresAt.getTime() <= now.getTime()
      ) {
        return this.invalidRecovery(customerId, requestId);
      }

      const tokens = await manager.getRepository(PasswordResetToken).find({
        where: { requestId: request.id },
      });
      const token = tokens.find(
        (candidate) =>
          candidate.deletedAt === null &&
          candidate.status === PasswordResetTokenStatus.ACTIVE &&
          candidate.expiresAt.getTime() > now.getTime() &&
          this.sameHash(candidate.tokenHash, command.tokenHash),
      );
      if (!token) {
        return this.invalidRecovery(customerId, requestId);
      }
      if (command.tokenVersion !== undefined && command.tokenVersion !== token.version) {
        return this.staleVersion(customerId, requestId);
      }

      const credential = await manager.getRepository(CustomerAuthenticationCredential).findOne({
        where: { id: request.credentialId, customerId },
      });
      if (
        !credential ||
        credential.deletedAt !== null ||
        credential.status !== AuthenticationCredentialStatus.ACTIVE ||
        credential.accountLocked
      ) {
        return {
          completed: false,
          customerId,
          requestId,
          sessionsInvalidated: 0,
          failureReason: 'CREDENTIAL_UNAVAILABLE' as const,
        };
      }

      const previousCredential = this.credentialValues(credential);
      credential.passwordHash = command.passwordHash.trim();
      credential.hashAlgorithm = command.hashAlgorithm;
      credential.passwordVersion = command.passwordVersion;
      credential.passwordChangedAt = now;
      credential.passwordExpiresAt = passwordExpiresAt;
      credential.failedAuthenticationCount = 0;
      const savedCredential = await manager
        .getRepository(CustomerAuthenticationCredential)
        .save(credential);

      const history = await manager.getRepository(PasswordHistory).save(
        manager.getRepository(PasswordHistory).create({
          id: randomUUID(),
          credentialId: savedCredential.id,
          passwordHash: savedCredential.passwordHash,
          hashAlgorithm: savedCredential.hashAlgorithm,
          passwordVersion: savedCredential.passwordVersion,
          action: PasswordHistoryAction.ROTATED,
          changedAt: now,
          deletedAt: null,
        }),
      );

      token.status = PasswordResetTokenStatus.USED;
      token.usedAt = now;
      const savedToken = await manager.getRepository(PasswordResetToken).save(token);
      request.status = PasswordResetRequestStatus.COMPLETED;
      request.completedAt = now;
      const savedRequest = await manager.getRepository(PasswordResetRequest).save(request);

      await this.audit(
        manager,
        'CUSTOMER_AUTHENTICATION_CREDENTIAL',
        savedCredential.id,
        'PASSWORD_RESET_COMPLETED',
        actor,
        previousCredential,
        this.credentialValues(savedCredential),
      );
      await this.audit(manager, 'PASSWORD_HISTORY', history.id, 'CREATED', actor, undefined, {
        credentialId: history.credentialId,
        action: history.action,
        hashAlgorithm: history.hashAlgorithm,
        passwordVersion: history.passwordVersion,
      });
      await this.audit(
        manager,
        'PASSWORD_RESET_TOKEN',
        savedToken.id,
        'STATUS_UPDATED',
        actor,
        undefined,
        {
          requestId: savedRequest.id,
          tokenVersion: savedToken.tokenVersion,
          status: savedToken.status,
          usedAt: savedToken.usedAt,
        },
      );
      await this.audit(
        manager,
        'PASSWORD_RESET_REQUEST',
        savedRequest.id,
        'STATUS_UPDATED',
        actor,
        undefined,
        {
          customerId: savedRequest.customerId,
          credentialId: savedRequest.credentialId,
          status: savedRequest.status,
          completedAt: savedRequest.completedAt,
          version: savedRequest.version,
        },
      );
      await this.securityEvent(
        manager,
        customerId,
        savedCredential.id,
        SecurityEventType.PASSWORD_ROTATED,
        actor,
        {
          passwordVersion: savedCredential.passwordVersion,
          hashAlgorithm: savedCredential.hashAlgorithm,
        },
      );
      await this.securityEvent(
        manager,
        customerId,
        savedCredential.id,
        SecurityEventType.PASSWORD_RESET_TOKEN_UPDATED,
        actor,
        { requestId: savedRequest.id, tokenId: savedToken.id, status: savedToken.status },
      );
      await this.securityEvent(
        manager,
        customerId,
        savedCredential.id,
        SecurityEventType.PASSWORD_RESET_STATUS_CHANGED,
        actor,
        { requestId: savedRequest.id, status: savedRequest.status },
      );
      return {
        completed: true,
        customerId,
        requestId,
        credentialId: savedCredential.id,
        sessionsInvalidated: 0,
      };
    });

    if (!completion.completed || !('credentialId' in completion) || !completion.credentialId) {
      return completion;
    }
    const sessionsInvalidated = await this.authenticationSessionService.revokeAllForCredential(
      completion.credentialId,
      actor,
      'Password reset completed',
      now,
    );
    return { ...completion, sessionsInvalidated };
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

  private async securityEvent(
    manager: EntityManager,
    customerId: string,
    credentialId: string,
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
    await this.audit(manager, 'SECURITY_EVENT_HISTORY', event.id, 'CREATED', actor, undefined, {
      customerId,
      credentialId,
      eventType,
      metadata,
    });
  }

  private credentialValues(credential: CustomerAuthenticationCredential): Record<string, unknown> {
    return {
      customerId: credential.customerId,
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

  private invalidRecovery(customerId: string, requestId: string): PasswordResetCompletionResult {
    return {
      completed: false,
      customerId,
      requestId,
      sessionsInvalidated: 0,
      failureReason: 'INVALID_RECOVERY',
    };
  }

  private staleVersion(customerId: string, requestId: string): PasswordResetCompletionResult {
    return {
      completed: false,
      customerId,
      requestId,
      sessionsInvalidated: 0,
      failureReason: 'STALE_VERSION',
    };
  }

  private validHashInput(value: string): boolean {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_HASH_LENGTH &&
      !/\s/.test(value)
    );
  }

  private sameHash(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private normalizeActor(value: string): string {
    const actor = value.trim();
    if (!actor || actor.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return actor;
  }

  private parseOptionalDate(value: string | undefined): Date | null {
    if (value === undefined) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
