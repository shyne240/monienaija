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
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { runSerializableWithRetry } from '../common/serializable-transaction';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import { ConsoleNotificationProvider } from '../notification/notification-provider.interface';
import type { NotificationProvider } from '../notification/notification.types';
import { AuditService } from '../operations/audit.service';
import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import {
  CUSTOMER_REGISTRATION_ACTOR,
  CUSTOMER_REGISTRATION_RATE_LIMITS,
  REGISTRATION_OTP_CODE_LENGTH,
  REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS,
  REGISTRATION_OTP_PBKDF2_ITERATIONS,
  REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS,
  REGISTRATION_OTP_TTL_SECONDS,
  REGISTRATION_PHONE_VERIFICATION_EVENT_TYPE,
  REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS,
} from './customer-registration.constants';
import { CustomerRegistrationPhoneChallenge } from './customer-registration-phone-challenge.entity';
import { normalizeNigerianPhone } from './phone-normalization';
import type { NormalizedNigerianPhone } from './phone-normalization';

export type { NormalizedNigerianPhone } from './phone-normalization';

export interface RequestRegistrationOtpView {
  status: 'OTP_REQUEST_ACCEPTED';
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export interface VerifyRegistrationOtpView {
  status: 'PHONE_VERIFIED';
  verificationToken: string;
  expiresInSeconds: number;
}

export interface CompleteRegistrationWalletView {
  id: string;
  currency: string;
  status: string;
}

export interface CompleteRegistrationView {
  id: string;
  reference: string;
  status: CustomerStatus;
  phone: string;
  phoneVerifiedAt: string;
  wallet?: CompleteRegistrationWalletView;
}

type VerifyFailureReason =
  | 'NO_CHALLENGE'
  | 'ALREADY_VERIFIED'
  | 'CHALLENGE_INACTIVE'
  | 'EXPIRED'
  | 'LOCKED'
  | 'MISMATCH';

type VerifyOutcome = { ok: true; verificationToken: string } | { ok: false };

const GENERIC_VERIFY_FAILURE = 'OTP verification failed';

/** Legacy phone challenge service; self-service completion is fail-closed pending live KYC. */
@Injectable()
export class CustomerRegistrationService {
  private readonly logger = new Logger(CustomerRegistrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rateLimitService: A2SecurityRateLimitService,
    private readonly auditService: AuditService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN)
    @Optional()
    private readonly injectedProvider: NotificationProvider | null,
  ) {}

  private get provider(): NotificationProvider {
    return this.injectedProvider ?? new ConsoleNotificationProvider();
  }

  // ---------------------------------------------------------------- normalization

  /**
   * Canonicalizes a Nigerian mobile number to the repository-wide convention: a 10-digit
   * national significant number (`canonical`) plus its E.164 rendering (`e164`). Accepts
   * +234/234/0-prefixed and bare 10-digit input, same as agent receiving-number resolution.
   */
  normalizeNigerianPhone(raw: string): NormalizedNigerianPhone {
    return normalizeNigerianPhone(raw);
  }

  // ---------------------------------------------------------------- OTP request

  async requestOtp(phoneRaw: string, sourceIp: string): Promise<RequestRegistrationOtpView> {
    const view: RequestRegistrationOtpView = {
      status: 'OTP_REQUEST_ACCEPTED',
      resendAfterSeconds: REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: REGISTRATION_OTP_TTL_SECONDS,
    };
    const correlationId = randomUUID();
    await this.consumeRateLimit('CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP', sourceIp, correlationId);
    const phone = this.normalizeNigerianPhone(phoneRaw);
    await this.consumeRateLimit(
      'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_PHONE',
      phone.canonical,
      correlationId,
    );

    try {
      await this.consumeRateLimit(
        'CUSTOMER_REGISTRATION_OTP_COOLDOWN_PER_PHONE',
        phone.canonical,
        correlationId,
      );
    } catch (error) {
      // Preserve the legacy enumeration-safe resend response while sharing the cooldown.
      if (error instanceof HttpException && error.getStatus() === 429) return view;
      throw error;
    }
    const now = new Date();
    const issued = await runSerializableWithRetry(
      this.dataSource,
      'CUSTOMER_REGISTRATION_OTP_REQUEST',
      async (manager) => {
        const repository = manager.getRepository(CustomerRegistrationPhoneChallenge);
        const existing = await repository
          .createQueryBuilder('challenge')
          .where('challenge.normalized_phone = :phone', { phone: phone.canonical })
          .andWhere("challenge.status IN ('ACTIVE','VERIFIED')")
          .andWhere('challenge.consumed_at IS NULL')
          .orderBy('challenge.created_at', 'DESC')
          .setLock('pessimistic_write')
          .getMany();

        // Already registered to a customer → enumeration-safe no-op (no OTP, same response).
        const bound = await manager.getRepository(CustomerContactMethod).findOne({
          where: {
            type: ContactMethodType.PHONE,
            normalizedValue: In([phone.canonical, phone.e164]),
            deletedAt: IsNull(),
          },
        });
        // A verified number remains an enumeration-safe no-op. An unverified Admin-created
        // contact may receive an OTP so a workforce operator can complete its phone proof.
        if (bound?.verifiedAt) return null;

        const active = existing.find((challenge) => challenge.status === 'ACTIVE');
        if (
          active &&
          now <= active.expiresAt &&
          now.getTime() - active.issuedAt.getTime() <
            REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS * 1000
        ) {
          // Resend cooldown → enumeration-safe no-op (no new OTP, same response).
          return null;
        }

        // Supersede outstanding challenges/tokens: at most one ACTIVE and one
        // VERIFIED-unconsumed challenge exist per phone (partial unique indexes enforce).
        for (const challenge of existing) {
          if (challenge.status === 'ACTIVE' && now > challenge.expiresAt) {
            challenge.status = 'EXPIRED';
          } else {
            challenge.status = 'REVOKED';
            challenge.revokedAt = now; // also invalidates any outstanding verification token
          }
        }
        if (existing.length > 0) await repository.save(existing);

        const code = this.generateOtpCode();
        const codeSalt = randomBytes(16).toString('base64url');
        const challenge = await repository.save(
          repository.create({
            id: randomUUID(),
            normalizedPhone: phone.canonical,
            destinationPhone: phone.e164,
            codeSalt,
            codeHash: this.hashOtp(code, codeSalt),
            verificationTokenHash: null,
            status: 'ACTIVE',
            attemptCount: 0,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + REGISTRATION_OTP_TTL_SECONDS * 1000),
            verifiedAt: null,
            consumedAt: null,
            revokedAt: null,
            version: 1,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_REGISTRATION_CHALLENGE',
          challenge.id,
          'OTP_REQUESTED',
          {
            normalizedPhoneSuffix: phone.canonical.slice(-4),
            expiresAt: challenge.expiresAt,
          },
        );
        return { challenge, code };
      },
    );

    if (issued) {
      await this.deliverOtpSms(issued.challenge, issued.code, correlationId);
    }
    return view;
  }

  // ---------------------------------------------------------------- OTP verification

  async verifyOtp(phoneRaw: string, code: string): Promise<VerifyRegistrationOtpView> {
    const correlationId = randomUUID();
    const phone = this.normalizeNigerianPhone(phoneRaw);
    await this.consumeRateLimit(
      'CUSTOMER_REGISTRATION_OTP_VERIFY_PER_PHONE',
      phone.canonical,
      correlationId,
    );

    // Failure bookkeeping (attempt counters, EXPIRED flips, OTP_VERIFY_FAILED audits) must
    // SURVIVE the rejection, so the transaction returns an outcome and commits; the HTTP
    // rejection is raised OUTSIDE the transaction.
    const outcome = await runSerializableWithRetry(
      this.dataSource,
      'CUSTOMER_REGISTRATION_OTP_VERIFY',
      async (manager) => {
        const repository = manager.getRepository(CustomerRegistrationPhoneChallenge);
        const challenge = await repository
          .createQueryBuilder('challenge')
          .where('challenge.normalized_phone = :phone', { phone: phone.canonical })
          .andWhere('challenge.consumed_at IS NULL')
          .orderBy('challenge.created_at', 'DESC')
          .setLock('pessimistic_write')
          .getOne();
        const now = new Date();

        const fail = async (reason: VerifyFailureReason): Promise<VerifyOutcome> => {
          if (challenge) {
            // Only a genuine wrong-code guess against a still-live, in-budget challenge
            // consumes part of the REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS budget. Rejections
            // caused by the challenge already being dead — missing, already verified,
            // inactive/revoked, time-expired, or already locked out — must NOT inflate
            // attempt_count: no comparison against the stored OTP hash was even made, so no
            // attempt was actually consumed. Without this guard, re-probing an
            // already-exhausted challenge (e.g. the inevitable request immediately after the
            // 5th wrong attempt) pushed the persisted counter past the cap (observed: 6, 7, ...
            // with every further call) — the original lockout off-by-one.
            const isGenuineAttempt = reason === 'MISMATCH';
            const flipsToExpired = reason === 'EXPIRED';
            if (isGenuineAttempt) {
              challenge.attemptCount += 1;
            }
            if (flipsToExpired) {
              // Lazy expiry: the first request to observe a time-expired ACTIVE challenge
              // flips it to EXPIRED so persisted state matches reality. This is a status
              // transition independent of the attempt budget — it must not, by itself,
              // count as a failed verification attempt.
              challenge.status = 'EXPIRED';
            }
            // Note: exhausting the attempt budget (attemptCount reaching the cap) is
            // represented purely by attempt_count >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS
            // while status stays ACTIVE — it does NOT transition status to REVOKED.
            // REVOKED is reserved for supersession by a fresh OTP request (see requestOtp);
            // conflating "attempts exhausted" with "superseded" would make a locked-but-live
            // challenge indistinguishable from a resend-superseded one.
            if (isGenuineAttempt || flipsToExpired) {
              await repository.save(challenge);
            }
            await this.audit(
              manager,
              'CUSTOMER_REGISTRATION_CHALLENGE',
              challenge.id,
              'OTP_VERIFY_FAILED',
              {
                attemptCount: challenge.attemptCount,
                status: challenge.status,
                reason,
                normalizedPhoneSuffix: phone.canonical.slice(-4),
              },
            );
          }
          return { ok: false };
        };

        if (!challenge) return fail('NO_CHALLENGE');
        if (challenge.status === 'VERIFIED') return fail('ALREADY_VERIFIED');
        if (challenge.status !== 'ACTIVE') return fail('CHALLENGE_INACTIVE');
        if (now > challenge.expiresAt) return fail('EXPIRED');
        if (challenge.attemptCount >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) return fail('LOCKED');

        const matches = this.verifyOtpCode(code, challenge.codeSalt, challenge.codeHash);
        if (!matches) return fail('MISMATCH');

        const tokenBytes = randomBytes(32);
        const verificationToken = tokenBytes.toString('base64url');
        const tokenHash = createHash('sha256').update(verificationToken).digest('hex');

        challenge.status = 'VERIFIED';
        challenge.verifiedAt = now;
        challenge.verificationTokenHash = tokenHash;
        await repository.save(challenge);

        await this.audit(manager, 'CUSTOMER_REGISTRATION_CHALLENGE', challenge.id, 'OTP_VERIFIED', {
          normalizedPhoneSuffix: phone.canonical.slice(-4),
        });

        return { ok: true, verificationToken };
      },
    );

    if (!outcome.ok) throw new BadRequestException(GENERIC_VERIFY_FAILURE);
    return {
      status: 'PHONE_VERIFIED',
      verificationToken: outcome.verificationToken,
      expiresInSeconds: REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS,
    };
  }

  // ---------------------------------------------------------------- completion

  /**
   * The legacy self-service completion used phone OTP as its only activation gate.
   * No live, identity-bound KYC evidence adapter is available yet. Do not consume
   * the token or create a draft, credential, customer or wallet through this path.
   * Workforce phone verification uses the challenge independently and remains intact.
   */
  completeRegistration(
    _phoneRaw: string,
    _verificationToken: string,
    _sourceIp: string,
    _password?: string,
    _displayName?: string,
    _idempotencyKey?: string,
  ): Promise<CompleteRegistrationView> {
    void _phoneRaw;
    void _verificationToken;
    void _sourceIp;
    void _password;
    void _displayName;
    void _idempotencyKey;
    return Promise.reject(
      new ServiceUnavailableException('Customer registration is temporarily unavailable'),
    );
  }

  // ---------------------------------------------------------------- internals

  private generateOtpCode(): string {
    // crypto.randomInt → CSPRNG uniform selection from the full 0..999999 range.
    return randomInt(0, 10 ** REGISTRATION_OTP_CODE_LENGTH)
      .toString()
      .padStart(REGISTRATION_OTP_CODE_LENGTH, '0');
  }

  private hashOtp(code: string, codeSalt: string): string {
    return pbkdf2Sync(
      code,
      Buffer.from(codeSalt, 'base64url'),
      REGISTRATION_OTP_PBKDF2_ITERATIONS,
      32,
      'sha256',
    ).toString('base64url');
  }

  private verifyOtpCode(candidate: string, codeSalt: string, expectedHash: string): boolean {
    const candidateHash = this.hashOtp(candidate, codeSalt);
    return this.safeEqualString(candidateHash, expectedHash);
  }

  private safeEqualString(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async consumeRateLimit(
    category: string,
    dimension: string,
    correlationId: string,
  ): Promise<void> {
    const rule = CUSTOMER_REGISTRATION_RATE_LIMITS.find(
      (candidate) => candidate.category === category,
    );
    if (!rule) throw new Error(`Registration rate-limit rule ${category} is not configured`);
    await this.rateLimitService.consume(rule, [dimension], correlationId);
  }

  /**
   * OTP delivery through the EXISTING provider-neutral SMS abstraction.
   */
  private async deliverOtpSms(
    challenge: CustomerRegistrationPhoneChallenge,
    code: string,
    correlationId: string,
  ): Promise<void> {
    const minutes = Math.max(1, Math.round(REGISTRATION_OTP_TTL_SECONDS / 60));
    try {
      const result = await this.provider.send({
        channel: 'SMS',
        destination: challenge.destinationPhone,
        message:
          `MoneyNaija: your registration verification code is ${code}. ` +
          `It expires in ${minutes} minutes. If you did not request this, ignore this message.`,
        payload: {},
        correlationId,
        eventType: REGISTRATION_PHONE_VERIFICATION_EVENT_TYPE,
        eventKey: `reg-phone-verification:${challenge.id}`,
        recipientType: 'CUSTOMER',
        recipientId: challenge.destinationPhone,
      });
      if (!result.success) {
        await this.dataSource.transaction(async (manager) => {
          await this.audit(
            manager,
            'CUSTOMER_REGISTRATION_CHALLENGE',
            challenge.id,
            'OTP_DELIVERY_FAILED',
            { provider: this.provider.name },
          );
        });
      }
    } catch {
      // Provider exceptions can contain the OTP, destination or request body.
      this.logger.warn({ event: 'customer.registration_otp_delivery_failed' });
      await this.dataSource.transaction(async (manager) => {
        await this.audit(
          manager,
          'CUSTOMER_REGISTRATION_CHALLENGE',
          challenge.id,
          'OTP_DELIVERY_FAILED',
          { provider: this.provider.name },
        );
      });
    }
  }

  private async audit(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    values?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor: CUSTOMER_REGISTRATION_ACTOR,
      newValues: values,
    });
  }
}
