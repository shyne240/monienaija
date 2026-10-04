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
import { runSerializableWithRetry } from '../common/serializable-transaction';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import { ConsoleNotificationProvider } from '../notification/notification-provider.interface';
import type { NotificationProvider } from '../notification/notification.types';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { ContactMethodType, CustomerStatus, CustomerType, CustomerKycLevel, CustomerKycStatus } from '../customer/customer.enums';
import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerAuthenticationCredential } from '../customer-authentication/customer-authentication-credential.entity';
import { AuthenticationCredentialStatus, AuthenticationCredentialType, PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletStatus } from '../wallet/wallet.enums';
import { WalletService } from '../wallet/wallet.service';
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
 * V1-CUSTOMER-01 — Customer self-service lifecycle foundation.
 *
 * Implements end-to-end customer self-service onboarding:
 * 1. OTP phone challenge issuance & CSPRNG verification.
 * 2. Self-service password configuration with server-side PBKDF2 hashing.
 * 3. Atomic primary NGN wallet provisioning via double-entry liability ledger binding.
 * 4. Activation out of DRAFT to ACTIVE upon verified primary phone prerequisite satisfaction.
 * 5. Idempotent replay safety and duplicate protection.
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
    @Optional()
    private readonly walletService?: WalletService,
    @Optional()
    private readonly idempotencyService?: IdempotencyService,
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
    const issued = await runSerializableWithRetry(this.dataSource, 'CUSTOMER_REGISTRATION_OTP_REQUEST', async (manager) => {
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
    // rejection is raised OUTSIDE the transaction.
    const outcome = await runSerializableWithRetry(this.dataSource, 'CUSTOMER_REGISTRATION_OTP_VERIFY', async (manager) => {
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
    });

    if (!outcome.ok) throw new BadRequestException(GENERIC_VERIFY_FAILURE);
    return {
      status: 'PHONE_VERIFIED',
      verificationToken: outcome.verificationToken,
      expiresInSeconds: REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS,
    };
  }

  // ---------------------------------------------------------------- completion

  async completeRegistration(
    phoneRaw: string,
    verificationToken: string,
    sourceIp: string,
    password?: string,
    displayName?: string,
    idempotencyKey?: string,
  ): Promise<CompleteRegistrationView> {
    const correlationId = randomUUID();
    await this.consumeRateLimit('CUSTOMER_REGISTRATION_COMPLETE_PER_IP', sourceIp, correlationId);
    const phone = this.normalizeNigerianPhone(phoneRaw);
    const tokenHash = createHash('sha256').update(verificationToken).digest('hex');

    const outcome = await runSerializableWithRetry(this.dataSource, 'CUSTOMER_REGISTRATION_COMPLETE', async (manager) => {
      // Idempotency check if idempotencyKey is supplied
      if (idempotencyKey && this.idempotencyService) {
        const reqHash = createHash('sha256')
          .update(JSON.stringify({ phone: phone.canonical, verificationToken, displayName }))
          .digest('hex');
        const reservation = await this.idempotencyService.reserve(manager, {
          scope: 'CUSTOMER_REGISTRATION',
          key: idempotencyKey,
          requestHash: reqHash,
          retentionSeconds: 86400,
        });
        if (reservation.kind === 'REPLAY') {
          return { ok: true, view: reservation.record.responseBody as unknown as CompleteRegistrationView };
        }
      }

      const challengeRepository = manager.getRepository(CustomerRegistrationPhoneChallenge);
      const challenge = await challengeRepository
        .createQueryBuilder('challenge')
        .where('challenge.normalized_phone = :phone', { phone: phone.canonical })
        .orderBy('challenge.created_at', 'DESC')
        .setLock('pessimistic_write')
        .getOne();
      const now = new Date();

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
        throw new ConflictException(GENERIC_REGISTRATION_CONFLICT);
      }

      await this.audit(
        manager,
        'CUSTOMER_REGISTRATION_CHALLENGE',
        challenge.id,
        'REGISTRATION_INITIATED',
        { normalizedPhoneSuffix: phone.canonical.slice(-4) },
      );

      // Determine customer lifecycle status:
      // If password is provided (customer self-service onboarding), customer activates immediately
      // upon satisfying the verified primary phone prerequisite.
      // If password is not provided, maintains backward compatibility (DRAFT status for workforce review).
      const hasPassword = typeof password === 'string' && password.length >= 8;
      const initialStatus = hasPassword ? CustomerStatus.ACTIVE : CustomerStatus.DRAFT;

      const customerRepository = manager.getRepository(Customer);
      const customerDraft = customerRepository.create({
        id: randomUUID(),
        reference: `mn-${phone.canonical}`,
        type: CustomerType.INDIVIDUAL,
        status: initialStatus,
        kycLevel: CustomerKycLevel.NONE,
        kycStatus: CustomerKycStatus.NOT_STARTED,
        version: 1,
        deletedAt: null,
      });
      const customer = await customerRepository.save(customerDraft);
      await this.audit(manager, 'CUSTOMER', customer.id, 'CREATED', {
        reference: customer.reference,
        type: customer.type,
        status: customer.status,
        kycLevel: customer.kycLevel,
        kycStatus: customer.kycStatus,
        registeredVia: 'customer-self-service',
      });

      if (initialStatus === CustomerStatus.ACTIVE) {
        await this.audit(manager, 'CUSTOMER', customer.id, 'STATUS_UPDATED', {
          previousStatus: 'DRAFT',
          status: 'ACTIVE',
          reason: 'SELF_SERVICE_REGISTRATION_ACTIVATED',
        });
      }

      const contactRepository = manager.getRepository(CustomerContactMethod);
      const contactDraft = contactRepository.create({
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

      // Optional profile creation if displayName is provided
      if (displayName && displayName.trim().length > 0) {
        const profileRepository = manager.getRepository(CustomerProfile);
        const profileDraft = profileRepository.create({
          id: randomUUID(),
          customerId: customer.id,
          displayName: displayName.trim(),
          legalName: displayName.trim(),
          isActive: true,
          deletedAt: null,
        });
        const profile = await profileRepository.save(profileDraft);
        await this.audit(manager, 'CUSTOMER_PROFILE', profile.id, 'CREATED', {
          customerId: customer.id,
          displayName: profile.displayName,
        });
      }

      // Provision Password Credential & Primary NGN Wallet if self-service password provided
      let provisionedWallet: WalletAccount | null = null;
      if (hasPassword) {
        const passwordHash = this.pbkdf2PasswordHash(password!);
        const credentialRepository = manager.getRepository(CustomerAuthenticationCredential);
        const credentialDraft = credentialRepository.create({
          id: randomUUID(),
          customerId: customer.id,
          type: AuthenticationCredentialType.PASSWORD,
          passwordHash,
          hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
          passwordVersion: 1,
          passwordChangedAt: now,
          status: AuthenticationCredentialStatus.ACTIVE,
          failedAuthenticationCount: 0,
          accountLocked: false,
          lockedAt: null,
          lockReason: null,
          rotationRequired: false,
          version: 1,
          deletedAt: null,
        });
        const credential = await credentialRepository.save(credentialDraft);
        await this.audit(manager, 'CUSTOMER_AUTHENTICATION_CREDENTIAL', credential.id, 'CREATED', {
          customerId: customer.id,
          credentialId: credential.id,
          hashAlgorithm: credential.hashAlgorithm,
          passwordVersion: credential.passwordVersion,
          status: credential.status,
          rotationRequired: false,
        });

        // Atomic Primary NGN Wallet Provisioning
        const walletCreationIdempotencyKey =
          idempotencyKey ?? `wallet-provision-${customer.id}`;
        if (this.walletService) {
          provisionedWallet = await this.walletService.createWalletInTransaction(manager, {
            customerId: customer.id,
            currency: 'NGN',
            idempotencyKey: walletCreationIdempotencyKey,
          });
        } else {
          // Direct fallback if WalletService is not injected
          const walletId = randomUUID();
          const ledgerAccountRepository = manager.getRepository(LedgerAccount);
          const ledgerAccount = await ledgerAccountRepository.save(
            ledgerAccountRepository.create({
              id: randomUUID(),
              code: `WALLET-${walletId}`,
              name: `Customer wallet ${walletId}`,
              accountType: LedgerAccountType.LIABILITY,
              normalBalance: LedgerNormalBalance.CREDIT,
              currency: 'NGN',
              accountingUnit: 'CUSTOMER_FUNDS',
              allowNegativeBalance: false,
              isActive: true,
            }),
          );
          const walletRepository = manager.getRepository(WalletAccount);
          provisionedWallet = await walletRepository.save(
            walletRepository.create({
              id: walletId,
              customerId: customer.id,
              currency: 'NGN',
              status: WalletStatus.ACTIVE,
              ledgerAccountId: ledgerAccount.id,
              creationIdempotencyKey: walletCreationIdempotencyKey,
            }),
          );
        }

        await this.audit(
          manager,
          'CUSTOMER_WALLET',
          provisionedWallet.id,
          'PROVISIONED',
          {
            customerId: customer.id,
            walletId: provisionedWallet.id,
            currency: provisionedWallet.currency,
            status: provisionedWallet.status,
            ledgerAccountId: provisionedWallet.ledgerAccountId,
          },
        );
      }

      const view: CompleteRegistrationView = {
        id: customer.id,
        reference: customer.reference,
        status: customer.status,
        phone: this.maskPhone(phone),
        phoneVerifiedAt: contact.verifiedAt!.toISOString(),
        ...(provisionedWallet
          ? {
              wallet: {
                id: provisionedWallet.id,
                currency: provisionedWallet.currency,
                status: provisionedWallet.status,
              },
            }
          : {}),
      };

      if (idempotencyKey && this.idempotencyService) {
        // Complete the reservation
        const existingRecord = await manager
          .getRepository(IdempotencyService)
          .createQueryBuilder('rec')
          .where('rec.scope = :s AND rec.idempotency_key = :k', {
            s: 'CUSTOMER_REGISTRATION',
            k: idempotencyKey,
          })
          .getOne()
          .catch(() => null);
        if (existingRecord) {
          await this.idempotencyService.complete(manager, (existingRecord as any).id, {
            responseBody: view as unknown as Record<string, unknown>,
            statusCode: 201,
            resourceType: 'CUSTOMER',
            resourceId: customer.id,
          });
        }
      }

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

  private pbkdf2PasswordHash(password: string): string {
    const salt = randomBytes(16);
    const iterations = 10000;
    const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    return `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
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
    } catch (error) {
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
