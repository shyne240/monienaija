import { randomUUID, timingSafeEqual } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import { DataSource, EntityManager, Repository } from 'typeorm';

import type { AuthenticatedPrincipal } from './authentication-session.types';
import { Customer } from '../customer/customer.entity';
import { AuditService } from '../operations/audit.service';
import {
  MfaEnrollmentStatus,
  MfaMethodStatus,
  SecurityEventType,
  TrustedDeviceStatus,
} from './customer-authentication.enums';
import type { MfaMethodType } from './customer-authentication.enums';
import { MfaChallenge } from './mfa-challenge.entity';
import { MfaChallengeStatus } from './mfa-challenge.enums';
import type {
  CheckTrustedDeviceCommand,
  IssueMfaChallengeCommand,
  MfaChallengeResult,
  MfaChallengeView,
  TrustedDeviceResult,
  VerifyMfaChallengeCommand,
} from './mfa-execution.types';
import { MfaEnrollment } from './mfa-enrollment.entity';
import { MfaMethod } from './mfa-method.entity';
import { SecurityEventHistory } from './security-event-history.entity';
import { TrustedDevice } from './trusted-device.entity';

const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
const MIN_CHALLENGE_TTL_SECONDS = 30;
const MAX_CHALLENGE_TTL_SECONDS = 900;
const MAX_HASH_LENGTH = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MfaExecutionService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(MfaEnrollment)
    private readonly mfaEnrollmentRepository: Repository<MfaEnrollment>,
    @InjectRepository(MfaMethod)
    private readonly mfaMethodRepository: Repository<MfaMethod>,
    @InjectRepository(MfaChallenge)
    private readonly challengeRepository: Repository<MfaChallenge>,
    @InjectRepository(TrustedDevice)
    private readonly trustedDeviceRepository: Repository<TrustedDevice>,
    @InjectRepository(SecurityEventHistory)
    private readonly securityEventRepository: Repository<SecurityEventHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async issueChallenge(command: IssueMfaChallengeCommand): Promise<MfaChallengeView> {
    this.assertPrincipal(command.principal);
    this.assertUuid(command.enrollmentId, 'enrollmentId');
    this.assertUuid(command.methodId, 'methodId');
    const actor = this.normalizeActor(command.actor);
    const challengeHash = this.normalizeHash(command.challengeHash, 'challengeHash');
    const now = command.now ?? new Date();
    const ttlSeconds = this.normalizeTtl(command.ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const challenge = await this.dataSource.transaction(async (manager) => {
      const customer = await manager.getRepository(Customer).findOne({
        where: { id: command.principal.customerId },
      });
      const enrollment = await manager.getRepository(MfaEnrollment).findOne({
        where: { id: command.enrollmentId, customerId: command.principal.customerId },
      });
      const method = await manager.getRepository(MfaMethod).findOne({
        where: {
          id: command.methodId,
          enrollmentId: command.enrollmentId,
          customerId: command.principal.customerId,
        },
      });
      if (!customer || customer.deletedAt !== null || !enrollment || !method) {
        throw new BadRequestException('MFA challenge context is invalid');
      }
      if (
        enrollment.deletedAt !== null ||
        enrollment.status !== MfaEnrollmentStatus.ENABLED ||
        method.deletedAt !== null ||
        method.status !== MfaMethodStatus.ENABLED
      ) {
        throw new BadRequestException('MFA method is unavailable');
      }

      const repository = manager.getRepository(MfaChallenge);
      const saved = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId: command.principal.customerId,
          enrollmentId: enrollment.id,
          methodId: method.id,
          sessionId: command.principal.sessionId,
          challengeHash,
          status: MfaChallengeStatus.ACTIVE,
          issuedAt: now,
          expiresAt,
          verifiedAt: null,
          revokedAt: null,
          version: 1,
        }),
      );
      await this.audit(manager, saved.id, 'MFA_CHALLENGE', 'ISSUED', actor, {
        customerId: saved.customerId,
        enrollmentId: saved.enrollmentId,
        methodId: saved.methodId,
        sessionId: saved.sessionId,
        issuedAt: saved.issuedAt,
        expiresAt: saved.expiresAt,
      });
      await this.securityEvent(
        manager,
        saved.customerId,
        null,
        SecurityEventType.MFA_CHALLENGE_ISSUED,
        actor,
        { challengeId: saved.id, enrollmentId: saved.enrollmentId, methodId: saved.methodId },
      );
      return { saved, methodType: method.type };
    });

    return this.toChallengeView(challenge.saved, challenge.methodType);
  }

  async verifyChallenge(command: VerifyMfaChallengeCommand): Promise<MfaChallengeResult> {
    this.assertPrincipal(command.principal);
    const challengeId = command.challengeId.trim().toLowerCase();
    if (!UUID_PATTERN.test(challengeId) || !this.validHash(command.providedHash)) {
      return this.failedChallenge(command.principal, challengeId, 'INVALID_CHALLENGE');
    }
    const actor = this.normalizeActor(command.actor);
    const now = command.now ?? new Date();

    return this.dataSource.transaction(async (manager) => {
      const challenge = await manager.getRepository(MfaChallenge).findOne({
        where: { id: challengeId },
      });
      if (!challenge) {
        return this.failedChallenge(command.principal, challengeId, 'INVALID_CHALLENGE');
      }
      if (challenge.customerId !== command.principal.customerId) {
        return this.failedChallenge(command.principal, challengeId, 'WRONG_CUSTOMER');
      }
      if (challenge.sessionId !== command.principal.sessionId) {
        return this.failedChallenge(command.principal, challengeId, 'WRONG_SESSION');
      }
      if (challenge.status !== MfaChallengeStatus.ACTIVE) {
        return this.failedChallenge(
          command.principal,
          challenge.id,
          challenge.status === MfaChallengeStatus.EXPIRED
            ? 'EXPIRED'
            : challenge.status === MfaChallengeStatus.VERIFIED
              ? 'REPLAYED'
              : 'MFA_UNAVAILABLE',
          challenge,
        );
      }
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        challenge.status = MfaChallengeStatus.EXPIRED;
        const expired = await manager.getRepository(MfaChallenge).save(challenge);
        await this.audit(manager, expired.id, 'MFA_CHALLENGE', 'EXPIRED', 'mfa-execution', {
          customerId: expired.customerId,
          enrollmentId: expired.enrollmentId,
          methodId: expired.methodId,
        });
        return this.failedChallenge(command.principal, expired.id, 'EXPIRED', expired);
      }

      const enrollment = await manager.getRepository(MfaEnrollment).findOne({
        where: { id: challenge.enrollmentId, customerId: challenge.customerId },
      });
      const method = await manager.getRepository(MfaMethod).findOne({
        where: {
          id: challenge.methodId,
          enrollmentId: challenge.enrollmentId,
          customerId: challenge.customerId,
        },
      });
      if (
        !enrollment ||
        enrollment.deletedAt !== null ||
        enrollment.status !== MfaEnrollmentStatus.ENABLED ||
        !method ||
        method.deletedAt !== null ||
        method.status !== MfaMethodStatus.ENABLED
      ) {
        return this.failedChallenge(command.principal, challenge.id, 'MFA_UNAVAILABLE', challenge);
      }

      if (!this.sameHash(challenge.challengeHash, command.providedHash)) {
        await this.audit(manager, challenge.id, 'MFA_CHALLENGE', 'FAILED', actor, {
          customerId: challenge.customerId,
          enrollmentId: challenge.enrollmentId,
          methodId: challenge.methodId,
          reason: 'MISMATCH',
        });
        await this.securityEvent(
          manager,
          challenge.customerId,
          null,
          SecurityEventType.MFA_CHALLENGE_FAILED,
          actor,
          {
            challengeId: challenge.id,
            enrollmentId: challenge.enrollmentId,
            methodId: challenge.methodId,
          },
        );
        return this.failedChallenge(
          command.principal,
          challenge.id,
          'MISMATCH',
          challenge,
          method.type,
        );
      }

      challenge.status = MfaChallengeStatus.VERIFIED;
      challenge.verifiedAt = now;
      const verified = await manager.getRepository(MfaChallenge).save(challenge);
      await this.audit(manager, verified.id, 'MFA_CHALLENGE', 'VERIFIED', actor, {
        customerId: verified.customerId,
        enrollmentId: verified.enrollmentId,
        methodId: verified.methodId,
        sessionId: verified.sessionId,
        verifiedAt: verified.verifiedAt,
        assurance: 'MFA',
      });
      await this.securityEvent(
        manager,
        verified.customerId,
        null,
        SecurityEventType.MFA_CHALLENGE_SUCCEEDED,
        actor,
        {
          challengeId: verified.id,
          enrollmentId: verified.enrollmentId,
          methodId: verified.methodId,
        },
      );
      return {
        verified: true,
        customerId: verified.customerId,
        sessionId: verified.sessionId,
        challengeId: verified.id,
        enrollmentId: verified.enrollmentId,
        methodId: verified.methodId,
        methodType: method.type,
        assurance: 'MFA',
        verifiedAt: verified.verifiedAt ?? now,
        expiresAt: verified.expiresAt,
      };
    });
  }

  async checkTrustedDevice(command: CheckTrustedDeviceCommand): Promise<TrustedDeviceResult> {
    this.assertPrincipal(command.principal);
    this.assertUuid(command.deviceId, 'deviceId');
    if (!this.validHash(command.fingerprintHash)) {
      return {
        trusted: false,
        customerId: command.principal.customerId,
        sessionId: command.principal.sessionId,
        deviceId: command.deviceId,
        checkedAt: command.now ?? new Date(),
        failureReason: 'MISMATCH',
      };
    }
    const actor = this.normalizeActor(command.actor);
    const now = command.now ?? new Date();
    const device = await this.trustedDeviceRepository.findOne({
      where: { id: command.deviceId },
    });
    if (!device) {
      return this.deviceFailure(command.principal, command.deviceId, now, 'NOT_FOUND');
    }
    if (device.customerId !== command.principal.customerId) {
      return this.deviceFailure(command.principal, command.deviceId, now, 'WRONG_CUSTOMER');
    }
    if (device.status !== TrustedDeviceStatus.TRUSTED || device.deletedAt !== null) {
      await this.auditDeviceCheck(device.id, command.principal.customerId, actor, 'REJECTED', {
        reason: 'NOT_TRUSTED',
      });
      return this.deviceFailure(command.principal, command.deviceId, now, 'NOT_TRUSTED');
    }
    if (!this.sameHash(device.deviceFingerprintHash, command.fingerprintHash)) {
      await this.auditDeviceCheck(device.id, command.principal.customerId, actor, 'REJECTED', {
        reason: 'MISMATCH',
      });
      return this.deviceFailure(command.principal, command.deviceId, now, 'MISMATCH');
    }

    device.lastSeenAt = now;
    await this.trustedDeviceRepository.save(device);
    await this.auditDeviceCheck(device.id, command.principal.customerId, actor, 'ACCEPTED', {
      status: device.status,
      checkedAt: now,
    });
    return {
      trusted: true,
      customerId: command.principal.customerId,
      sessionId: command.principal.sessionId,
      deviceId: command.deviceId,
      checkedAt: now,
    };
  }

  private async auditDeviceCheck(
    deviceId: string,
    customerId: string,
    actor: string,
    outcome: 'ACCEPTED' | 'REJECTED',
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.audit(manager, deviceId, 'TRUSTED_DEVICE', `CHECK_${outcome}`, actor, {
        customerId,
        deviceId,
        ...values,
      });
      await this.securityEvent(
        manager,
        customerId,
        null,
        outcome === 'ACCEPTED'
          ? SecurityEventType.TRUSTED_DEVICE_CHECKED
          : SecurityEventType.TRUSTED_DEVICE_REJECTED,
        actor,
        { deviceId, outcome },
      );
    });
  }

  private async audit(
    manager: EntityManager,
    entityId: string,
    entityType: string,
    action: string,
    actor: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      newValues,
    });
  }

  private async securityEvent(
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
    await this.audit(manager, event.id, 'SECURITY_EVENT_HISTORY', 'CREATED', actor, {
      customerId,
      credentialId,
      eventType,
      metadata,
    });
  }

  private toChallengeView(challenge: MfaChallenge, methodType: MfaMethodType): MfaChallengeView {
    return {
      id: challenge.id,
      customerId: challenge.customerId,
      enrollmentId: challenge.enrollmentId,
      methodId: challenge.methodId,
      sessionId: challenge.sessionId,
      methodType,
      status: challenge.status,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    };
  }

  private failedChallenge(
    principal: AuthenticatedPrincipal,
    challengeId: string,
    reason: MfaChallengeResult['failureReason'],
    challenge?: MfaChallenge,
    methodType?: MfaMethodType,
  ): MfaChallengeResult {
    return {
      verified: false,
      customerId: principal.customerId,
      sessionId: principal.sessionId,
      challengeId,
      enrollmentId: challenge?.enrollmentId ?? '',
      methodId: challenge?.methodId ?? '',
      ...(methodType ? { methodType } : {}),
      assurance: 'MFA',
      failureReason: reason,
    };
  }

  private deviceFailure(
    principal: AuthenticatedPrincipal,
    deviceId: string,
    checkedAt: Date,
    failureReason: TrustedDeviceResult['failureReason'],
  ): TrustedDeviceResult {
    return {
      trusted: false,
      customerId: principal.customerId,
      sessionId: principal.sessionId,
      deviceId,
      checkedAt,
      failureReason,
    };
  }

  private assertPrincipal(principal: AuthenticatedPrincipal): void {
    if (
      principal.principalType !== 'CUSTOMER' ||
      !UUID_PATTERN.test(principal.customerId) ||
      !UUID_PATTERN.test(principal.credentialId) ||
      !UUID_PATTERN.test(principal.sessionId)
    ) {
      throw new BadRequestException('Authenticated principal is invalid');
    }
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
    if (!this.validHash(value)) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return value.trim();
  }

  private validHash(value: string): boolean {
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

  private normalizeTtl(value: number | undefined): number {
    const ttl = value ?? DEFAULT_CHALLENGE_TTL_SECONDS;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_CHALLENGE_TTL_SECONDS ||
      ttl > MAX_CHALLENGE_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds must be between ${MIN_CHALLENGE_TTL_SECONDS} and ${MAX_CHALLENGE_TTL_SECONDS}`,
      );
    }
    return ttl;
  }
}
