/* eslint-disable @typescript-eslint/require-await */
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AgentDeskOtpService } from '../../src/agent/agent-desk-otp.service';
import type { AgentDeskOtpPurpose } from '../../src/agent/agent-desk-otp.constants';
import { NOTIFICATION_PROVIDER_TOKEN } from '../../src/notification/notification.constants';
import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from '../../src/notification/notification.types';

/**
 * Governed agent-desk OTP fixture (ARENA 3B Stage 3/4).
 *
 * Cash-Out and Cash-to-Cash claim both consume an MFA challenge that must be *bound* to the
 * financial operation: Cash-Out binds the challenge to a persisted `cash_out_intents` row, claim
 * binds it to `cash_to_cash_claim_challenge_bindings`. Fabricating an `mfa_challenges` row
 * (what the legacy fixtures did) produces intent-less challenges that the accepted services
 * correctly refuse.
 *
 * This fixture drives the real `AgentDeskOtpService.issue()` — the same code path production
 * uses — and captures the delivered code from a recording SMS provider, because the plaintext
 * OTP is deliberately never returned in the service response or persisted.
 *
 * The provider records the message text in memory only, under NODE_ENV=test, so the suite can
 * read the one-time code exactly as the recipient's phone would.
 */

export interface RecordedSms {
  to: string;
  message: string;
}

export class RecordingSmsProvider implements NotificationProvider {
  readonly name = 'recording-sms';
  readonly sent: RecordedSms[] = [];

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    const destination = request.destination;
    const message = request.message;
    this.sent.push({ to: destination, message });
    return { success: true, providerRef: `recording-${this.sent.length}` };
  }

  clear(): void {
    this.sent.length = 0;
  }

  /** The most recent 6-digit code delivered to the given destination. */
  lastCode(to?: string): string {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const entry = this.sent[index]!;
      if (to && entry.to !== to) continue;
      const match = /(\d{6})/.exec(entry.message);
      if (match) return match[1]!;
    }
    throw new Error(`No delivered OTP code was recorded (${this.sent.length} messages captured)`);
  }
}

export interface DeskOtpHandle {
  provider: RecordingSmsProvider;
  issue(command: DeskOtpCommand): Promise<{ challengeId: string; otp: string }>;
}

export interface DeskOtpCommand {
  agentId: string;
  customerId: string;
  purpose: AgentDeskOtpPurpose;
  agentSessionId?: string;
  transferId?: string;
  redemptionMethod?: 'AGENT_CASH' | 'CUSTOMER_WALLET';
  amountMinor?: string;
  currency?: string;
  operationKey?: string;
  supersedesOperationKey?: string;
  ttlSeconds?: number;
}

export function createDeskOtpFixture(
  app: NestFastifyApplication,
  boundProvider?: RecordingSmsProvider,
): DeskOtpHandle {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('The recording OTP provider may only be used under NODE_ENV=test');
  }
  const provider = boundProvider ?? new RecordingSmsProvider();
  const service = app.get(AgentDeskOtpService);
  const resolved = app.get<NotificationProvider>(NOTIFICATION_PROVIDER_TOKEN, { strict: false });
  if (resolved !== provider) {
    throw new Error(
      `Recording SMS provider was not bound (resolved: ${resolved?.constructor?.name ?? 'none'})`,
    );
  }
  return {
    provider,
    async issue(command: DeskOtpCommand) {
      provider.clear();
      const view = await service.issue(command);
      const otp = provider.lastCode();
      return { challengeId: view.challengeId, otp };
    },
  };
}

/** Bind the recording provider so the issuance path delivers into the fixture. */
export function overrideSmsProvider(
  builder: TestingModuleBuilder,
  provider: RecordingSmsProvider,
): TestingModuleBuilder {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Overriding the SMS provider is only permitted under NODE_ENV=test');
  }
  return builder.overrideProvider(NOTIFICATION_PROVIDER_TOKEN).useValue(provider);
}
