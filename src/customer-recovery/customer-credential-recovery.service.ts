import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { CustomerAuthenticationService } from '../customer-authentication/customer-authentication.service';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { KycTierEvidenceReader } from '../kyc-verification/kyc-tier-evidence.reader';
import { hashMobileSecret } from '../kyc-verification/kyc-synthetic-credentials.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import type { NotificationProvider } from '../notification/notification.types';
import { AuditService } from '../operations/audit.service';
import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import {
  CUSTOMER_CREDENTIAL_RECOVERY_EVENT_TYPE,
  CUSTOMER_CREDENTIAL_RECOVERY_POLICY_VERSION,
  CUSTOMER_CREDENTIAL_RECOVERY_PURPOSES,
  CUSTOMER_CREDENTIAL_RECOVERY_RATE_LIMITS,
  type CustomerCredentialRecoveryPurpose,
  RECOVERY_OTP_CODE_LENGTH,
  RECOVERY_OTP_MAX_VERIFY_ATTEMPTS,
  RECOVERY_OTP_PBKDF2_ITERATIONS,
  RECOVERY_OTP_RESEND_COOLDOWN_SECONDS,
  RECOVERY_OTP_TTL_SECONDS,
  RECOVERY_TOKEN_TTL_SECONDS,
  isCustomerCredentialRecoveryEnabled,
} from './customer-credential-recovery.constants';
import { CustomerCredentialRecoveryChallenge } from './customer-credential-recovery.entity';

const ACTOR = 'CUSTOMER_CREDENTIAL_RECOVERY';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PASSCODE_PATTERN = /^\d{6}$/;
const PIN_PATTERN = /^\d{6}$/;

export interface RecoveryPolicyView {
  policyVersion: string;
  enabled: boolean;
  purposes: CustomerCredentialRecoveryPurpose[];
  authority: {
    requiresVerifiedPhoneOtp: true;
    requiresTrustedIdentityEvidence: true;
    requiresActiveCustomer: true;
    phoneNumberAloneIsSufficient: false;
  };
  otp: { expiresInSeconds: number; maxVerifyAttempts: number; resendAfterSeconds: number };
  recoveryToken: { expiresInSeconds: number };
  /** Honest statement of what happens when the policy or evidence is unavailable. */
  fallback: { status: 'SUPPORT_REQUIRED'; contact: 'SUPPORT_TICKET' };
}

export interface RequestRecoveryChallengeView {
  status: 'ACCEPTED';
  purpose: CustomerCredentialRecoveryPurpose;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export interface VerifyRecoveryChallengeView {
  status: 'VERIFIED';
  purpose: CustomerCredentialRecoveryPurpose;
  recoveryToken: string;
  expiresInSeconds: number;
  /** How the new device (if any) was authorised: always OTP + identity evidence, never device trust. */
  deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE';
}

export interface CompleteRecoveryView {
  status: 'COMPLETED';
  purpose: CustomerCredentialRecoveryPurpose;
  sessionsRevoked: number;
  deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE';
}

/**
 * ARENA 4 — self-service customer credential recovery.
 *
 * Reuses the accepted infrastructure rather than competing with it:
 * - phone OTP shape/limits follow the registration OTP conventions (salted PBKDF2 digest, attempt
 *   cap, expiry, resend cooldown, direct SMS delivery, never persisted in plaintext),
 * - the identity-evidence gate is the accepted `KycTierEvidenceReader` oracle,
 * - a login passcode is rotated through `CustomerAuthenticationService.rotatePasswordInManager`
 *   (password history, security event, session revocation) — it remains the same credential row,
 * - a transaction PIN is rotated through `CustomerTransactionPinService.setTransactionPinInManager`
 *   — it remains the same PIN row,
 * - sessions are revoked through `AuthenticationSessionService.revokeAllForCustomerInManager`.
 *
 * Nothing here grants financial authority: replacement only changes a credential, and session
 * issuance still goes through the eligibility gate.
 */
@Injectable()
export class CustomerCredentialRecoveryService {
  private readonly logger = new Logger(CustomerCredentialRecoveryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rateLimiter: A2SecurityRateLimitService,
    private readonly auditService: AuditService,
    private readonly authentication: CustomerAuthenticationService,
    private readonly pins: CustomerTransactionPinService,
    private readonly evidence: KycTierEvidenceReader,
    private readonly sessions: AuthenticationSessionService,
    @Optional()
    @Inject(NOTIFICATION_PROVIDER_TOKEN)
    private readonly notifications?: NotificationProvider,
  ) {}

  policy(): RecoveryPolicyView {
    return {
      policyVersion: CUSTOMER_CREDENTIAL_RECOVERY_POLICY_VERSION,
      enabled: isCustomerCredentialRecoveryEnabled(),
      purposes: [...CUSTOMER_CREDENTIAL_RECOVERY_PURPOSES],
      authority: {
        requiresVerifiedPhoneOtp: true,
        requiresTrustedIdentityEvidence: true,
        requiresActiveCustomer: true,
        phoneNumberAloneIsSufficient: false,
      },
      otp: {
        expiresInSeconds: RECOVERY_OTP_TTL_SECONDS,
        maxVerifyAttempts: RECOVERY_OTP_MAX_VERIFY_ATTEMPTS,
        resendAfterSeconds: RECOVERY_OTP_RESEND_COOLDOWN_SECONDS,
      },
      recoveryToken: { expiresInSeconds: RECOVERY_TOKEN_TTL_SECONDS },
      fallback: { status: 'SUPPORT_REQUIRED', contact: 'SUPPORT_TICKET' },
    };
  }

  /**
   * Issues a purpose-bound OTP for an existing, verified phone number.
   *
   * Enumeration-safe: the response is identical whether or not the number belongs to an eligible
   * customer, and no challenge row is created for an unknown/unverified number.
   */
  async requestChallenge(
    phoneRaw: string,
    purpose: string,
    sourceIp: string,
  ): Promise<RequestRecoveryChallengeView> {
    const normalizedPurpose = this.requirePurpose(purpose);
    const view: RequestRecoveryChallengeView = {
      status: 'ACCEPTED',
      purpose: normalizedPurpose,
      resendAfterSeconds: RECOVERY_OTP_RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: RECOVERY_OTP_TTL_SECONDS,
    };
    const correlationId = randomUUID();
    const phone = normalizeNigerianPhone(phoneRaw);
    await this.consume('CUSTOMER_CREDENTIAL_RECOVERY_ISSUE_PER_IP', sourceIp, correlationId);
    await this.consume(
      'CUSTOMER_CREDENTIAL_RECOVERY_ISSUE_PER_PHONE',
      `${purpose}:${phone.canonical}`,
      correlationId,
    );

    if (!isCustomerCredentialRecoveryEnabled()) {
      // Fail closed without disclosing that the policy is off for this particular number.
      this.logger.log(
        JSON.stringify({ event: 'credential_recovery.policy_disabled', correlationId }),
      );
      return view;
    }

    const issued = await this.dataSource.transaction(async (manager) => {
      const customer = await this.resolveRecoverableCustomer(manager, phone.canonical, phone.e164);
      if (!customer) return null;

      const repository = manager.getRepository(CustomerCredentialRecoveryChallenge);
      const now = new Date();
      const existing = await repository.find({
        where: { customerId: customer.id, purpose: normalizedPurpose, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      for (const challenge of existing) {
        if (now > challenge.expiresAt) {
          challenge.status = 'EXPIRED';
        } else {
          challenge.status = 'REVOKED';
          challenge.revokedAt = now;
          challenge.tokenHash = null;
          challenge.tokenExpiresAt = null;
        }
      }
      if (existing.length > 0) await repository.save(existing);

      const code = this.generateCode();
      const codeSalt = randomBytes(16).toString('base64url');
      const saved = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId: customer.id,
          purpose: normalizedPurpose,
          normalizedPhone: phone.canonical,
          destinationPhone: phone.e164,
          codeSalt,
          codeHash: this.hashCode(code, codeSalt),
          tokenHash: null,
          attemptCount: 0,
          status: 'ACTIVE',
          issuedAt: now,
          expiresAt: new Date(now.getTime() + RECOVERY_OTP_TTL_SECONDS * 1000),
          verifiedAt: null,
          tokenExpiresAt: null,
          consumedAt: null,
          revokedAt: null,
          version: 1,
        }),
      );
      await this.audit(manager, saved, 'RECOVERY_CHALLENGE_ISSUED', {
        purpose: normalizedPurpose,
        normalizedPhoneSuffix: phone.canonical.slice(-4),
        expiresAt: saved.expiresAt,
      });
      return { challenge: saved, code };
    });

    if (issued) await this.deliverOtp(issued.challenge, issued.code, correlationId);
    return view;
  }

  /**
   * Verifies the OTP and applies the recovery authority gate. A token is issued ONLY when the phone
   * OTP and the trusted identity evidence both succeed; otherwise the caller receives an explicit,
   * non-enumerating outcome (`INVALID_OR_EXPIRED` / `SUPPORT_REQUIRED`).
   */
  async verifyChallenge(
    challengeId: string,
    code: string,
    deviceId?: string,
  ): Promise<VerifyRecoveryChallengeView> {
    if (!UUID_PATTERN.test(challengeId) || typeof code !== 'string') {
      throw new BadRequestException('INVALID_OR_EXPIRED');
    }
    await this.consume(
      'CUSTOMER_CREDENTIAL_RECOVERY_VERIFY_PER_CHALLENGE',
      challengeId,
      randomUUID(),
    );

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerCredentialRecoveryChallenge);
      const challenge = await repository.findOne({
        where: { id: challengeId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (!challenge || challenge.status !== 'ACTIVE') {
        return { kind: 'INVALID' as const };
      }
      if (now > challenge.expiresAt) {
        challenge.status = 'EXPIRED';
        await repository.save(challenge);
        return { kind: 'INVALID' as const };
      }
      if (!PASSCODE_PATTERN.test(code)) {
        return { kind: 'INVALID' as const };
      }
      if (!this.matchesCode(code, challenge.codeHash, challenge.codeSalt)) {
        challenge.attemptCount += 1;
        if (challenge.attemptCount >= RECOVERY_OTP_MAX_VERIFY_ATTEMPTS) {
          challenge.status = 'REVOKED';
          challenge.revokedAt = now;
          await repository.save(challenge);
          await this.audit(manager, challenge, 'RECOVERY_CHALLENGE_LOCKED', {
            purpose: challenge.purpose,
            attemptCount: challenge.attemptCount,
          });
          return { kind: 'LOCKED' as const };
        }
        await repository.save(challenge);
        await this.audit(manager, challenge, 'RECOVERY_OTP_REJECTED', {
          purpose: challenge.purpose,
          attemptCount: challenge.attemptCount,
        });
        return { kind: 'INVALID' as const };
      }

      // OTP correct — now the identity-evidence / compliance gate.
      const gate = await this.assessRecoveryAuthority(manager, challenge);
      if (gate.kind === 'SUPPORT_REQUIRED') {
        challenge.status = 'REVOKED';
        challenge.revokedAt = now;
        await repository.save(challenge);
        await this.audit(manager, challenge, 'RECOVERY_SUPPORT_REQUIRED', {
          purpose: challenge.purpose,
          reason: gate.reason,
        });
        return { kind: 'SUPPORT_REQUIRED' as const, reason: gate.reason };
      }

      const token = randomBytes(32).toString('base64url');
      challenge.tokenHash = this.hashToken(token);
      challenge.verifiedAt = now;
      challenge.tokenExpiresAt = new Date(now.getTime() + RECOVERY_TOKEN_TTL_SECONDS * 1000);
      await repository.save(challenge);
      await this.audit(manager, challenge, 'RECOVERY_OTP_VERIFIED', {
        purpose: challenge.purpose,
        deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
        deviceIdHash: deviceId ? this.hashToken(deviceId) : null,
      });
      return { kind: 'VERIFIED' as const, token, purpose: challenge.purpose };
    });

    if (outcome.kind === 'SUPPORT_REQUIRED') {
      throw new ConflictException({
        status: 'SUPPORT_REQUIRED',
        reason: outcome.reason,
        message:
          'MonieNaija cannot verify your identity evidence for a self-service recovery. Contact support to continue.',
      });
    }
    if (outcome.kind === 'LOCKED') {
      throw new HttpException(
        {
          status: 'INVALID_OR_EXPIRED',
          message: 'This recovery request is no longer valid. Start a new one.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.kind !== 'VERIFIED') {
      throw new UnauthorizedException({
        status: 'INVALID_OR_EXPIRED',
        message: 'This recovery request is invalid or has expired.',
      });
    }
    return {
      status: 'VERIFIED',
      purpose: outcome.purpose,
      recoveryToken: outcome.token,
      expiresInSeconds: RECOVERY_TOKEN_TTL_SECONDS,
      deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
    };
  }

  /**
   * Atomically replaces ONE credential class and revokes every live session for the customer.
   * The recovery token is single-use, and the challenge is consumed in the same transaction as the
   * credential replacement, so a replayed request can never apply a second change.
   */
  async complete(
    recoveryToken: string,
    newSecret: string,
    confirmation: string,
    deviceId?: string,
  ): Promise<CompleteRecoveryView> {
    if (!RECOVERY_TOKEN_PATTERN.test(recoveryToken)) {
      throw new UnauthorizedException({
        status: 'INVALID_OR_EXPIRED',
        message: 'This recovery token is invalid or has expired.',
      });
    }
    await this.consume(
      'CUSTOMER_CREDENTIAL_RECOVERY_COMPLETE_PER_TOKEN',
      this.hashToken(recoveryToken),
      randomUUID(),
    );

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CustomerCredentialRecoveryChallenge);
      const challenge = await repository.findOne({
        where: { tokenHash: this.hashToken(recoveryToken) },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (
        !challenge ||
        challenge.status !== 'ACTIVE' ||
        !challenge.tokenHash ||
        !challenge.tokenExpiresAt ||
        now > challenge.tokenExpiresAt ||
        now > challenge.expiresAt
      ) {
        return { kind: 'INVALID' as const };
      }
      if (challenge.purpose === 'LOGIN_PASSCODE' && !PASSCODE_PATTERN.test(newSecret)) {
        throw new BadRequestException('newSecret must be a six-digit login passcode');
      }
      if (challenge.purpose === 'TRANSACTION_PIN' && !PIN_PATTERN.test(newSecret)) {
        throw new BadRequestException('newSecret must be a six-digit transaction PIN');
      }
      if (newSecret !== confirmation) {
        throw new BadRequestException('newSecret and confirmation must match');
      }

      const gate = await this.assessRecoveryAuthority(manager, challenge);
      if (gate.kind === 'SUPPORT_REQUIRED') {
        challenge.status = 'REVOKED';
        challenge.revokedAt = now;
        challenge.tokenHash = null;
        await repository.save(challenge);
        await this.audit(manager, challenge, 'RECOVERY_SUPPORT_REQUIRED', {
          purpose: challenge.purpose,
          reason: gate.reason,
          stage: 'COMPLETE',
        });
        return { kind: 'SUPPORT_REQUIRED' as const, reason: gate.reason };
      }

      if (challenge.purpose === 'LOGIN_PASSCODE') {
        const credential = await this.requireLiveCredential(manager, challenge.customerId);
        await this.authentication.rotatePasswordInManager(
          manager,
          challenge.customerId,
          credential.id,
          {
            passwordHash: await hashMobileSecret(newSecret),
            hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
            passwordVersion: credential.passwordVersion + 1,
            actor: ACTOR,
          },
          // Session revocation is done once, explicitly, below, so the caller receives an accurate
          // count and a single auditable reason. It runs in the same transaction: no window exists.
          { revokeSessions: false },
        );
      } else {
        const pin = await this.requireExistingPin(manager, challenge.customerId);
        await this.pins.setTransactionPinInManager(manager, challenge.customerId, {
          pinHash: await hashMobileSecret(newSecret),
          hashAlgorithm: 'PBKDF2',
          pinVersion: pin.pinVersion + 1,
          actor: ACTOR,
        });
      }

      const sessionsRevoked = await this.sessions.revokeAllForCustomerInManager(
        manager,
        challenge.customerId,
        ACTOR,
        `Credential recovered (${challenge.purpose})`,
      );

      challenge.status = 'CONSUMED';
      challenge.consumedAt = now;
      challenge.tokenHash = null;
      challenge.tokenExpiresAt = null;
      await repository.save(challenge);
      await this.audit(manager, challenge, 'CREDENTIAL_RECOVERED', {
        purpose: challenge.purpose,
        sessionsRevoked,
        deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
        deviceIdHash: deviceId ? this.hashToken(deviceId) : null,
      });
      return { kind: 'COMPLETED' as const, purpose: challenge.purpose, sessionsRevoked };
    });

    if (outcome.kind === 'SUPPORT_REQUIRED') {
      throw new ConflictException({
        status: 'SUPPORT_REQUIRED',
        reason: outcome.reason,
        message:
          'Your account now needs support to finish this recovery. No credential was changed.',
      });
    }
    if (outcome.kind !== 'COMPLETED') {
      throw new UnauthorizedException({
        status: 'INVALID_OR_EXPIRED',
        message: 'This recovery token is invalid or has expired.',
      });
    }
    return {
      status: 'COMPLETED',
      purpose: outcome.purpose,
      sessionsRevoked: outcome.sessionsRevoked,
      deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE',
    };
  }

  // ------------------------------------------------------------------ internals

  private async resolveRecoverableCustomer(
    manager: EntityManager,
    canonicalPhone: string,
    e164Phone: string,
  ): Promise<{ id: string } | null> {
    // Only a VERIFIED PRIMARY phone of a live, non-synthetic, ACTIVE customer is recoverable. An
    // unverified or unknown number yields no row and therefore no challenge (no enumeration).
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT c.id
         FROM customers c
         JOIN customer_contact_methods m
           ON m.customer_id = c.id
          AND m.type = 'PHONE'
          AND m.is_primary = true
          AND m.verified_at IS NOT NULL
          AND m.deleted_at IS NULL
          AND m.normalized_value = ANY($1::text[])
        WHERE c.deleted_at IS NULL
          AND c.is_synthetic = false
          AND c.status = 'ACTIVE'
        ORDER BY m.verified_at DESC, m.created_at ASC
        LIMIT 1
        FOR SHARE OF c, m`,
      [[canonicalPhone, e164Phone]],
    );
    return rows[0] ? { id: rows[0].id } : null;
  }

  /**
   * The recovery authority gate. Fails closed with `SUPPORT_REQUIRED` when the customer is no longer
   * an eligible subject, when a compliance hold exists, when the credential class is not applicable,
   * or when the accepted evidence oracle cannot produce an authoritative snapshot.
   */
  private async assessRecoveryAuthority(
    manager: EntityManager,
    challenge: CustomerCredentialRecoveryChallenge,
  ): Promise<{ kind: 'OK' } | { kind: 'SUPPORT_REQUIRED'; reason: string }> {
    const rows = await manager.query<
      Array<{
        status: string;
        is_synthetic: boolean;
        deleted_at: Date | null;
        has_credential: boolean;
        has_pin: boolean;
      }>
    >(
      `SELECT c.status, c.is_synthetic, c.deleted_at,
              EXISTS(SELECT 1 FROM customer_authentication_credentials x
                      WHERE x.customer_id=c.id AND x.deleted_at IS NULL
                        AND x.status='ACTIVE') AS has_credential,
              EXISTS(SELECT 1 FROM customer_transaction_pins x
                      WHERE x.customer_id=c.id AND x.deleted_at IS NULL) AS has_pin
         FROM customers c WHERE c.id=$1 FOR SHARE`,
      [challenge.customerId],
    );
    const customer = rows[0];
    if (!customer || customer.deleted_at || customer.is_synthetic || customer.status !== 'ACTIVE') {
      return { kind: 'SUPPORT_REQUIRED', reason: 'CUSTOMER_NOT_ACTIVE' };
    }
    if (challenge.purpose === 'LOGIN_PASSCODE' && !customer.has_credential) {
      return { kind: 'SUPPORT_REQUIRED', reason: 'CREDENTIAL_NOT_APPLICABLE' };
    }
    if (challenge.purpose === 'TRANSACTION_PIN' && !customer.has_pin) {
      return { kind: 'SUPPORT_REQUIRED', reason: 'CREDENTIAL_NOT_APPLICABLE' };
    }

    const holds = await manager.query<Array<{ id: string }>>(
      `SELECT customer_id AS id FROM kyc_tier_manual_holds WHERE customer_id=$1 FOR SHARE`,
      [challenge.customerId],
    );
    if (holds.length > 0) return { kind: 'SUPPORT_REQUIRED', reason: 'MANUAL_REVIEW' };
    const conflicts = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM kyc_identity_conflicts
        WHERE requester_customer_id=$1 OR claimed_customer_id=$1 FOR SHARE`,
      [challenge.customerId],
    );
    if (conflicts.length > 0) return { kind: 'SUPPORT_REQUIRED', reason: 'IDENTITY_CONFLICT' };

    // The accepted evidence oracle. `null` means "cannot assess" (no confirmed provider), which is
    // NOT the same as "no evidence" — it must fail closed to support, never to a silent reset.
    let snapshot: unknown = null;
    try {
      snapshot = await this.evidence.read(manager, challenge.customerId);
    } catch {
      snapshot = null;
    }
    if (!snapshot) return { kind: 'SUPPORT_REQUIRED', reason: 'TRUSTED_EVIDENCE_UNAVAILABLE' };

    // Note: financial eligibility is deliberately NOT required to recover a credential — a customer
    // whose financial access is restricted must still be able to regain control of their account.
    // Session issuance after recovery still goes through the eligibility gate, so recovery can
    // never manufacture financial authority.
    return { kind: 'OK' };
  }

  private async requireLiveCredential(
    manager: EntityManager,
    customerId: string,
  ): Promise<{ id: string; passwordVersion: number }> {
    const rows = await manager.query<Array<{ id: string; password_version: number }>>(
      `SELECT id, password_version FROM customer_authentication_credentials
        WHERE customer_id=$1 AND deleted_at IS NULL AND status='ACTIVE'
        ORDER BY password_changed_at DESC NULLS LAST, created_at DESC
        LIMIT 1 FOR UPDATE`,
      [customerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('No active credential to recover');
    return { id: row.id, passwordVersion: Number(row.password_version ?? 1) };
  }

  private async requireExistingPin(
    manager: EntityManager,
    customerId: string,
  ): Promise<{ pinVersion: number }> {
    const rows = await manager.query<Array<{ pin_version: number }>>(
      `SELECT pin_version FROM customer_transaction_pins
        WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [customerId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('No transaction PIN to recover');
    return { pinVersion: Number(row.pin_version ?? 1) };
  }

  private requirePurpose(purpose: string): CustomerCredentialRecoveryPurpose {
    if (
      !CUSTOMER_CREDENTIAL_RECOVERY_PURPOSES.includes(purpose as CustomerCredentialRecoveryPurpose)
    ) {
      throw new BadRequestException('purpose is not supported');
    }
    return purpose as CustomerCredentialRecoveryPurpose;
  }

  private generateCode(): string {
    return String(randomInt(0, 10 ** RECOVERY_OTP_CODE_LENGTH)).padStart(
      RECOVERY_OTP_CODE_LENGTH,
      '0',
    );
  }

  private hashCode(code: string, salt: string): string {
    const derived = pbkdf2Sync(
      code,
      Buffer.from(salt, 'base64url'),
      RECOVERY_OTP_PBKDF2_ITERATIONS,
      32,
      'sha256',
    );
    return derived.toString('base64url');
  }

  private matchesCode(code: string, storedHash: string, salt: string): boolean {
    try {
      const expected = Buffer.from(storedHash, 'base64url');
      const derived = pbkdf2Sync(
        code,
        Buffer.from(salt, 'base64url'),
        RECOVERY_OTP_PBKDF2_ITERATIONS,
        expected.length || 32,
        'sha256',
      );
      return expected.length === derived.length && timingSafeEqual(expected, derived);
    } catch {
      return false;
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async consume(category: string, dimension: string, correlationId: string): Promise<void> {
    const rule = CUSTOMER_CREDENTIAL_RECOVERY_RATE_LIMITS.find((r) => r.category === category);
    if (!rule) return;
    await this.rateLimiter.consume(rule, [dimension], correlationId);
  }

  private async deliverOtp(
    challenge: CustomerCredentialRecoveryChallenge,
    code: string,
    correlationId: string,
  ): Promise<void> {
    if (!this.notifications) return;
    const minutes = Math.max(1, Math.round(RECOVERY_OTP_TTL_SECONDS / 60));
    const what = challenge.purpose === 'LOGIN_PASSCODE' ? 'login passcode' : 'transaction PIN';
    try {
      await this.notifications.send({
        channel: 'SMS',
        destination: challenge.destinationPhone,
        message:
          `MonieNaija: your recovery code to reset your ${what} is ${code}. ` +
          `It expires in ${minutes} minutes. If you did not request this, contact support immediately.`,
        payload: {},
        correlationId,
        eventType: CUSTOMER_CREDENTIAL_RECOVERY_EVENT_TYPE,
        eventKey: `credential-recovery:${challenge.id}`,
        recipientType: 'CUSTOMER',
        recipientId: challenge.customerId,
      });
    } catch {
      // Delivery failure must not disclose customer state, and must not leave an ACTIVE challenge
      // that could still be verified: revoke it.
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(CustomerCredentialRecoveryChallenge);
        challenge.status = 'REVOKED';
        challenge.revokedAt = new Date();
        await repository.save(challenge);
      });
      this.logger.warn(
        JSON.stringify({ event: 'credential_recovery.delivery_failed', correlationId }),
      );
    }
  }

  private async audit(
    manager: EntityManager,
    challenge: CustomerCredentialRecoveryChallenge,
    action: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_CREDENTIAL_RECOVERY',
      entityId: challenge.id,
      action,
      actor: ACTOR,
      newValues: { customerId: challenge.customerId, ...newValues },
    });
  }
}
