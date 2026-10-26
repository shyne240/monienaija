import { createHash, pbkdf2Sync, randomBytes, randomInt, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { MfaExecutionService } from '../customer-authentication/mfa-execution.service';
import type { IssueMfaChallengeCommand } from '../customer-authentication/mfa-execution.types';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import { ConsoleNotificationProvider } from '../notification/notification-provider.interface';
import type { NotificationProvider } from '../notification/notification.types';
import {
  AGENT_DESK_OTP_CODE_LENGTH,
  AGENT_DESK_OTP_EVENT_TYPE,
  AGENT_DESK_OTP_PBKDF2_ITERATIONS,
  maskPhoneForAudit,
  type AgentDeskOtpPurpose,
} from './agent-desk-otp.constants';

/** Narrow command — controller already validated DTO + AGENT principal. */
export interface IssueDeskOtpChallengeCommand {
  agentId: string;
  customerId: string;
  purpose: AgentDeskOtpPurpose;
  ttlSeconds?: number;
  correlationId?: string;
}

export interface IssueDeskOtpChallengeView {
  challengeId: string;
  customerId: string;
  purpose: AgentDeskOtpPurpose;
  deliveryChannel: 'SMS';
  /** Audit-safe masked destination (last-4) — never the full phone, never the OTP. */
  destinationMasked: string | null;
  delivered: boolean;
  issuedAt: Date;
  expiresAt: Date;
  ttlSeconds: number;
}

/**
 * V1-AGENT-MFA-API-01 — agent-desk customer OTP challenge issuance.
 *
 * Closes the documented V1 gap: Wallet→Cash and Cash→Cash claim consume
 * `mfaChallengeId` + `otp` through the canonical MfaExecutionService (single
 * authoritative verification path), but no HTTP surface existed to issue such a
 * challenge legitimately; only tests fabricated rows. This service reuses the EXISTING
 * machinery end-to-end:
 *
 *  - canonical `MfaExecutionService.issueChallenge` (TTL 30–900 default 300, ENABLED
 *    enrollment/method guards, audit + security-event writes) — unchanged rules;
 *  - purpose binding (§3 of the task): challenge carries `WALLET_TO_CASH` or
 *    `CASH_TO_CASH_CLAIM`; mismatched consumption fails WRONG_PURPOSE. Legacy
 *    purpose-NULL challenges are unaffected;
 *  - session binding: the challenge is bound to a customer-plane `authentication_sessions`
 *    row created here with a SHA-256 token hash that is NEVER issued to anyone (the row
 *    exists solely to satisfy the established customer+session MFA context; the token
 *    itself does not exist outside a discarded random value), mirroring the established
 *    test-fixture semantic and the verification-time session/credential reconstruction in
 *    the financial services;
 *  - OTP hygiene: 6-digit CSPRNG code; at rest only a salted PBKDF2 digest (canonical
 *    `challenge_matches` extension accepts both this digest format and the legacy raw
 *    comparand, so pre-existing challenges keep verifying); the plaintext code is sent
 *    ONLY to the customer's verified primary phone via the established provider-neutral
 *    DIRECT SMS path (NOTIFICATION_PROVIDER_TOKEN → robase/console) — never the
 *    dispatcher/outbox (an outbox record would persist the OTP — forbidden by
 *    notification-security taxonomy), never returned in the HTTP response, never logged;
 *  - issuance has NO financial side effects: no journals, no wallet/ledger writes;
 *    it creates only MFA-context rows (enrollment/method/session/challenge) + audit.
 */
@Injectable()
export class AgentDeskOtpService {
  private readonly logger = new Logger(AgentDeskOtpService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mfaExecutionService: MfaExecutionService,
    private readonly auditService: AuditService,
    @Optional()
    @Inject(NOTIFICATION_PROVIDER_TOKEN)
    private readonly injectedProvider: NotificationProvider | null,
  ) {}

  private get provider(): NotificationProvider {
    return this.injectedProvider ?? new ConsoleNotificationProvider();
  }

  async issue(command: IssueDeskOtpChallengeCommand): Promise<IssueDeskOtpChallengeView> {
    const customerId = command.customerId.trim().toLowerCase();
    const now = new Date();

    // 1. Customer must exist and not be deleted (money flows re-check status/lifecycle).
    const customers = await this.dataSource.query<Array<{ id: string; status: string }>>(
      `SELECT id, status FROM customers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [customerId],);
    if (!customers[0]) {
      throw new NotFoundException('Customer not found');
    }
    if (customers[0].status === 'CLOSED') {
      throw new BadRequestException('Customer is closed');
    }

    // 2. Delivery destination: customer's verified PRIMARY phone — the established
    //    destination rule (same as V1-CUSTOMER-CREDENTIALS-01 temporary credential SMS).
    const contacts = await this.dataSource.query<Array<{ value: string }>>(
      `SELECT value FROM customer_contact_methods
        WHERE customer_id = $1 AND type = 'PHONE' AND is_primary = true
          AND verified_at IS NOT NULL AND deleted_at IS NULL
        LIMIT 1`,
      [customerId],);
    const destinationPhone = contacts[0]?.value;
    if (!destinationPhone) {
      // Fail closed: issuing without a deliverable OTP would strand the desk flow.
      throw new BadRequestException('Customer has no verified primary phone');
    }

    // 3. An ACTIVE customer credential must exist — the canonical verifier reconstructs
    //    its principal from the challenge's session (and falls back to the active
    //    credential). Without one verification cannot succeed, so fail early.
    const credRows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM customer_authentication_credentials
        WHERE customer_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [customerId],);
    const credentialId = credRows[0]?.id;
    if (!credentialId) {
      throw new BadRequestException('Customer OTP verification unavailable');
    }

    // 4. MFA context: ensure ENABLED enrollment + ENABLED SMS method exist for the
    //    customer (canonical issuance requires both; established idempotent semantic).
    const enrollmentSelect = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM mfa_enrollments WHERE customer_id = $1 AND status = 'ENABLED' AND deleted_at IS NULL LIMIT 1`,
      [customerId],);
    let enrollmentId: string | undefined = enrollmentSelect[0]?.id;
    if (!enrollmentId) {
      const enrollmentInsert = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO mfa_enrollments (id, customer_id, reference, status, enabled_at)
           VALUES ($1, $2, $3, 'ENABLED', NOW()) RETURNING id`,
        [randomUUID(), customerId, `desk-otp-enroll-${randomUUID().slice(0, 6)}`],);
      enrollmentId = enrollmentInsert[0]!.id;
    }
    const identifierHash = createHash('sha256').update(destinationPhone).digest('hex');
    const methodSelect = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM mfa_methods
        WHERE customer_id = $1 AND enrollment_id = $2 AND method_type = 'SMS'
          AND status = 'ENABLED' AND deleted_at IS NULL
        LIMIT 1`,
      [customerId, enrollmentId],);
    let methodId: string | undefined = methodSelect[0]?.id;
    if (!methodId) {
      const methodInsert = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO mfa_methods
           (id, customer_id, enrollment_id, method_type, label, identifier_hash, is_primary, status)
           VALUES ($1, $2, $3, 'SMS', 'agent-desk-otp', $4, true, 'ENABLED') RETURNING id`,
        [randomUUID(), customerId, enrollmentId, identifierHash],);
      methodId = methodInsert[0]!.id;
    }

    // 5. Customer-plane session context row. The canonical challenge requires a session
    //    binding; verification reconstructs credential from it. The row's token_hash is a
    //    SHA-256 of a discarded random value — no live token is ever issued.
    const sessionId = randomUUID();
    const ghostTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    await this.dataSource.query(
      `INSERT INTO authentication_sessions
         (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 'customer-api', 'ACTIVE', NOW(), NOW() + ($5 || ' seconds')::interval, NOW())`,
      [sessionId, customerId, credentialId, ghostTokenHash, String(command.ttlSeconds ?? 300)],
    );

    // 6. OTP: CSPRNG 6-digit numeric; at rest ONLY its salted PBKDF2 digest (canonical
    //    comparand format supported by MfaExecutionService.challengeMatches).
    const code = randomInt(0, 10 ** AGENT_DESK_OTP_CODE_LENGTH)
      .toString()
      .padStart(AGENT_DESK_OTP_CODE_LENGTH, '0');
    const salt = randomBytes(16);
    const digest = pbkdf2Sync(code, salt, AGENT_DESK_OTP_PBKDF2_ITERATIONS, 32, 'sha256');
    const challengeHash = `PBKDF2$sha256$${AGENT_DESK_OTP_PBKDF2_ITERATIONS}$${salt.toString('base64url')}$${digest.toString('base64url')}`;

    // 7. Canonical issuance — TTL/audit/security-event/enrollment-method guards intact.
    const issueCommand: IssueMfaChallengeCommand = {
      principal: {
        principalType: 'CUSTOMER',
        customerId,
        credentialId,
        sessionId,
        audience: 'customer-api',
        authenticatedAt: now,
        expiresAt: new Date(now.getTime() + (command.ttlSeconds ?? 300) * 1000),
      },
      enrollmentId,
      methodId,
      challengeHash,
      actor: `agent:${command.agentId}`,
      ttlSeconds: command.ttlSeconds,
      purpose: command.purpose,
    };
    const challenge = await this.mfaExecutionService.issueChallenge(issueCommand);

    // 8. Delivery — DIRECT provider-neutral SMS (never dispatcher/outbox; failure is
    //    isolated and audited, matching registration/temporary-credential conventions).
    const minutes = Math.max(1, Math.round(challenge.expiresAt.getTime() - challenge.issuedAt.getTime()) / 60000);
    let delivered = false;
    try {
      const result = await this.provider.send({
        channel: 'SMS',
        destination: destinationPhone,
        message:
          `MoneyNaija: your verification code is ${code}. It expires in ${minutes} minutes. ` +
          `Only share it with the agent serving you. If you did not expect this, contact support.`,
        payload: {},
        correlationId: command.correlationId ?? null,
        eventType: AGENT_DESK_OTP_EVENT_TYPE,
        eventKey: `agent-desk-otp:${challenge.id}`,
        recipientType: 'CUSTOMER',
        recipientId: customerId,
      });
      delivered = result.success === true;
      if (!result.success) {
        this.logger.warn(
          `Agent desk OTP delivery failed via ${this.provider.name}: ${result.error ?? 'provider rejected send'}`,
        );
      }
    } catch (error) {
      // Never surface delivery internals; never log the OTP.
      this.logger.warn(
        `Agent desk OTP delivery failed via ${this.provider.name}: ${(error as Error).message}`,
      );
    }

    const destinationMasked = maskPhoneForAudit(destinationPhone);
    await this.auditService.record(this.dataSource.manager, {
      entityType: 'MFA_CHALLENGE',
      entityId: challenge.id,
      action: delivered ? 'AGENT_DESK_OTP_DELIVERED' : 'AGENT_DESK_OTP_DELIVERY_FAILED',
      actor: `agent:${command.agentId}`,
      newValues: {
        customerId,
        purpose: command.purpose,
        deliveryChannel: 'SMS',
        destinationMasked,
        provider: this.provider.name,
        delivered,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      },
    });

    return {
      challengeId: challenge.id,
      customerId,
      purpose: command.purpose,
      deliveryChannel: 'SMS',
      destinationMasked,
      delivered,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      ttlSeconds: Math.round((challenge.expiresAt.getTime() - challenge.issuedAt.getTime()) / 1000),
    };
  }
}
