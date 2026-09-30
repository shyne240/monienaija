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
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import { ConsoleNotificationProvider } from '../notification/notification-provider.interface';
import type { NotificationProvider } from '../notification/notification.types';
import { AuditService } from '../operations/audit.service';
import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import { Customer } from '../customer/customer.entity';
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

export interface NormalizedNigerianPhone {
  /** Canonical 10-digit national significant number, e.g. 8012345678. */
  canonical: string;
  /** E.164 rendering, e.g. +2348012345678. */
  e164: string;
}

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

export interface CompleteRegistrationView {
  id: string;
  reference: string;
  status: CustomerStatus;
  phone: string;
  phoneVerifiedAt: string;
}

type VerifyFailureReason =
  | 'NO_CHALLENGE'
  | 'ALREADY_VERIFIED'
  | 'CHALLENGE_INACTIVE'
  | 'EXPIRED'
  | 'LOCKED'
  | 'MISMATCH';

type RegistrationFailureReason =
  | 'NO_CHALLENGE'
  | 'NOT_VERIFIED'
  | 'TOKEN_CONSUMED'
  | 'VERIFICATION_STALE'
  | 'TOKEN_MISMATCH';

type VerifyOutcome = { ok: true; verificationToken: string } | { ok: false };
type RegisterOutcome = { ok: true; view: CompleteRegistrationView } | { ok: false };

const GENERIC_VERIFY_FAILURE = 'OTP verification failed';
const GENERIC_REGISTRATION_VERIFY_FAILURE = 'Registration verification is invalid or expired';
const GENERIC_REGISTRATION_CONFLICT = 'Registration could not be completed';

/**
 * V1-CUSTOMER-ONBOARDING-01 — customer registration front door + phone verification.
 *
 * Implements the first slice of the decided hybrid onboarding model
 * (docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md): customer-facing capture and OTP phone
 * verification producing a DRAFT customer with a verified primary Nigerian phone.
 *
 * HARD BOUNDARIES (enforced here and covered by integration tests):
 * - Only creates DRAFT customers — never ACTIVE (activation stays workforce-only, S-FIX-01).
 * - Never creates a wallet, authentication credential/password, or transaction PIN.
 * - Never performs DRAFT→ACTIVE or touches any financial ledger.
 *
 * ENUMERATION POSTURE (documented in docs/V1-CUSTOMER-ONBOARDING-01.md §Enumeration):
 * - OTP request: identical generic response whether the phone is new, has a live challenge,
 *   or is already registered to another customer (no-ops hide distinction internally).
 * - OTP verification: single generic 400 for every failure class.
 * - Registration completion: invalid/expired verification → generic 400; phone claimed in
 *   the meantime → generic 409 (not distinguishable wording).
 */
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
    const compact = raw.replace(/[\s()-]/g, '');
    let local: string;
    if (/^\+234\d{10}$/.test(compact)) local = compact.slice(4);
    else if (/^234\d{10}$/.test(compact)) local = compact.slice(3);
    else if (/^0\d{10}$/.test(compact)) local = compact.slice(1);
    else if (/^\d{10}$/.test(compact)) local = compact;
    else throw new BadRequestException('phone must be a valid Nigerian mobile number');
    if (!/^[789]\d{9}$/.test(local)) {
      throw new BadRequestException('phone must be a valid Nigerian mobile number');
    }
    return { canonical: local, e164: `+234${local}` };
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

    const now = new Date();
    const issued = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
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
          normalizedValue: phone.canonical,
          deletedAt: IsNull(),
        },
      });
      if (bound) return null;

      const active = existing.find((challenge) => challenge.status === 'ACTIVE');
      if (
        active &&
        now <= active.expiresAt &&
        now.getTime() - active.issuedAt.getTime() < REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS * 1000
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
      await this.audit(manager, 'CUSTOMER_REGISTRATION_CHALLENGE', challenge.id, 'OTP_REQUESTED', {
        normalizedPhoneSuffix: phone.canonical.slice(-4),
        expiresAt: challenge.expiresAt,
      });
      return { challenge, code };
    });

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
    // rejection is raised OUTSIDE the transaction (same convention as the platform's
    // recordFailedAuthentication path — never throw inside the tx on expected failures).
    const outcome = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const repository = manager.getRepository(CustomerRegistrationPhoneChallenge);
      const challenge = await repository
        .createQueryBuilder('challenge')
        .where('challenge.normalized_phone = :phone', { phone: phone.canonical })
        .orderBy('challenge.created_at', 'DESC')
        .setLock('pessimistic_write')
        .getOne();
      const now = new Date();

      const fail = async (reason: VerifyFailureReason): Promise<VerifyOutcome> => {
        await this.audit(
          manager,
          'CUSTOMER_REGISTRATION_CHALLENGE',
          challenge?.id ?? randomUUID(),
          'OTP_VERIFY_FAILED',
          { reason, normalizedPhoneSuffix: phone.canonical.slice(-4) },
        );
        return { ok: false };
      };

      if (!challenge) {
        // Constant-work path: hash against a random salt so a missing challenge is not
        // distinguishable from a mismatch by response timing.
        this.hashOtp(code, randomBytes(16).toString('base64url'));
        return fail('NO_CHALLENGE');
      }
      if (challenge.status === 'VERIFIED') return fail('ALREADY_VERIFIED'); // replay guard
      if (challenge.status !== 'ACTIVE') return fail('CHALLENGE_INACTIVE');
      if (now > challenge.expiresAt) {
        challenge.status = 'EXPIRED';
        await repository.save(challenge);
        return fail('EXPIRED');
      }
      if (challenge.attemptCount >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) {
        return fail('LOCKED');
      }
      challenge.attemptCount += 1;
      if (!this.verifyOtpCode(code, challenge.codeSalt, challenge.codeHash)) {
        await repository.save(challenge);
        return fail('MISMATCH');
      }

      challenge.status = 'VERIFIED';
      challenge.verifiedAt = now;
      const verificationToken = randomBytes(32).toString('base64url');
      challenge.verificationTokenHash = createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      await repository.save(challenge);
      await this.audit(manager, 'CUSTOMER_REGISTRATION_CHALLENGE', challenge.id, 'OTP_VERIFIED', {
        normalizedPhoneSuffix: phone.canonical.slice(-4),
        attemptCount: challenge.attemptCount,
        verificationTokenExpiresInSeconds: REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS,
      });
      return { ok: true, verificationToken };
    });

    if (!outcome.ok) throw new BadRequestException(GENERIC_VERIFY_FAILURE);
    return {
      status: 'PHONE_VERIFIED',
      verificationToken: outcome.verificationToken,
      expiresInSeconds: REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS,
    };
  }

  // ---------------------------------------------------------------- registration completion

  async completeRegistration(
    phoneRaw: string,
    verificationToken: string,
    sourceIp: string,
  ): Promise<CompleteRegistrationView> {
    const correlationId = randomUUID();
    await this.consumeRateLimit('CUSTOMER_REGISTRATION_COMPLETE_PER_IP', sourceIp, correlationId);
    const phone = this.normalizeNigerianPhone(phoneRaw);
    const tokenHash = createHash('sha256').update(verificationToken).digest('hex');

    const outcome = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const challengeRepository = manager.getRepository(CustomerRegistrationPhoneChallenge);
      const challenge = await challengeRepository
        .createQueryBuilder('challenge')
        .where('challenge.normalized_phone = :phone', { phone: phone.canonical })
        .orderBy('challenge.created_at', 'DESC')
        .setLock('pessimistic_write')
        .getOne();
      const now = new Date();

      // Same failure-bookkeeping convention as verifyOtp: the transaction commits the
      // REGISTRATION_FAILED audit and returns the outcome; the rejection is raised outside.
      const failVerification = async (
        reason: RegistrationFailureReason,
      ): Promise<RegisterOutcome> => {
        await this.audit(
          manager,
          'CUSTOMER_REGISTRATION_CHALLENGE',
          challenge?.id ?? randomUUID(),
          'REGISTRATION_FAILED',
          { reason, normalizedPhoneSuffix: phone.canonical.slice(-4) },
        );
        return { ok: false };
      };

      if (!challenge) return failVerification('NO_CHALLENGE');
      if (challenge.consumedAt !== null) return failVerification('TOKEN_CONSUMED');
      if (challenge.status !== 'VERIFIED') return failVerification('NOT_VERIFIED');
      const verificationStale =
        now.getTime() - challenge.verifiedAt!.getTime() >
        REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS * 1000;
      if (verificationStale) return failVerification('VERIFICATION_STALE');
      if (
        challenge.verificationTokenHash === null ||
        !this.safeEqualHex(challenge.verificationTokenHash, tokenHash)
      ) {
        return failVerification('TOKEN_MISMATCH');
      }

      // Consume BEFORE any customer insert so a later failure rolls the token back cleanly.
      challenge.consumedAt = now;
      await challengeRepository.save(challenge);

      const bound = await manager.getRepository(CustomerContactMethod).findOne({
        where: {
          type: ContactMethodType.PHONE,
          normalizedValue: phone.canonical,
          deletedAt: IsNull(),
        },
      });
      if (bound) {
        // The phone became attached to a customer between verification and completion. The
        // wording is deliberately identical for every caller holding this token (the token
        // holder already proved possession of the phone, so this is not an enumeration leak).
        throw new ConflictException(GENERIC_REGISTRATION_CONFLICT);
      }

      await this.audit(
        manager,
        'CUSTOMER_REGISTRATION_CHALLENGE',
        challenge.id,
        'REGISTRATION_INITIATED',
        { normalizedPhoneSuffix: phone.canonical.slice(-4) },
      );

      const customerRepository = manager.getRepository(Customer);
      const draft = customerRepository.create();
      Object.assign(draft, {
        id: randomUUID(),
        // customers.reference is constraint-checked lowercase (chk_customers_reference);
        // mn-<canonical phone> is unique because the phone is unique system-wide.
        reference: `mn-${phone.canonical}`,
        type: 'INDIVIDUAL',
        // DRAFT is hard-coded, not caller-controlled: this service cannot create ACTIVE,
        // and activation remains a workforce-only transition (S-FIX-01 boundary).
        status: CustomerStatus.DRAFT,
        kycLevel: 'NONE',
        kycStatus: 'NOT_STARTED',
        version: 1,
        deletedAt: null,
      });
      const customer = await customerRepository.save(draft);
      await this.audit(manager, 'CUSTOMER', customer.id, 'CREATED', {
        reference: customer.reference,
        type: customer.type,
        status: customer.status,
        kycLevel: customer.kycLevel,
        kycStatus: customer.kycStatus,
        registeredVia: 'customer-self-service',
      });

      const contactRepository = manager.getRepository(CustomerContactMethod);
      const contactDraft = contactRepository.create();
      Object.assign(contactDraft, {
        id: randomUUID(),
        customerId: customer.id,
        type: ContactMethodType.PHONE,
        value: phone.e164,
        normalizedValue: phone.canonical,
        isPrimary: true,
        verifiedAt: challenge.verifiedAt,
        deletedAt: null,
      });
      const contact = await contactRepository.save(contactDraft);
      await this.audit(manager, 'CUSTOMER_CONTACT_METHOD', contact.id, 'CREATED', {
        customerId: customer.id,
        type: contact.type,
        isPrimary: contact.isPrimary,
      });
      await this.audit(manager, 'CUSTOMER_CONTACT_METHOD', contact.id, 'PHONE_VERIFIED', {
        customerId: customer.id,
        normalizedPhoneSuffix: phone.canonical.slice(-4),
        verifiedAt: contact.verifiedAt,
      });

      const view: CompleteRegistrationView = {
        id: customer.id,
        reference: customer.reference,
        status: customer.status,
        phone: this.maskPhone(phone),
        phoneVerifiedAt: contact.verifiedAt!.toISOString(),
      };
      return { ok: true, view };
    });

    if (!outcome.ok) throw new BadRequestException(GENERIC_REGISTRATION_VERIFY_FAILURE);
    return outcome.view;
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

  private safeEqualHex(storedHash: string, presentedHash: string): boolean {
    return /^[0-9a-f]{64}$/.test(presentedHash) && this.safeEqualString(storedHash, presentedHash);
  }

  private maskPhone(phone: NormalizedNigerianPhone): string {
    return `+234*****${phone.canonical.slice(-4)}`;
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
   * OTP delivery through the EXISTING provider-neutral SMS abstraction
   * (NOTIFICATION_PROVIDER_TOKEN → robase in configured environments, console/test
   * otherwise). Deliberately NOT routed through the notification outbox/inbox: an outbox
   * delivery record persists the rendered message, which would persist the OTP — forbidden
   * by the OTP-handling requirements. Delivery failure is isolated (never throws into the
   * request), matching existing provider-failure isolation conventions. The OTP itself is
   * never logged by this service.
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
    } catch (error) {
      // Never surface delivery internals to the caller (enumeration oracle); log only
      // provider name + error message — never the code.
      this.logger.warn(
        `Registration OTP delivery failed via ${this.provider.name}: ${(error as Error).message}`,
      );
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
