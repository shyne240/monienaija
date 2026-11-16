import { Injectable, Logger } from '@nestjs/common';

import { verifyWebhook } from './monnify/monnify-webhook.signature';
import type { BankingInboundService } from './banking-inbound.service';

/**
 * Webhook ingestion.
 *
 * The ordering here is the security control:
 *
 *   1. verify the signature over the **raw bytes** — never a re-serialised body, because
 *      `JSON.stringify(JSON.parse(x))` is not byte-identical and would silently break verification
 *      while appearing to work;
 *   2. acknowledge the provider quickly and deduplicate on its own reference, because a provider that
 *      does not get a fast 200 retries, and retries are how one payment becomes three;
 *   3. verify server-to-server before anything is treated as money.
 *
 * Nothing in this file trusts the payload's contents to decide whether a payment happened. The
 * payload decides *what to look up*; the lookup decides what is true.
 *
 * Failures are deliberately coarse in the response and specific in the log: a rejected webhook must
 * not tell an attacker which part of a forgery attempt was closest to working.
 */

export interface WebhookRequest {
  rawBody: Buffer | string;
  signature?: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
  trustedFixtureTransport?: boolean;
}

export type WebhookOutcome =
  | { status: 'ACCEPTED'; providerTransactionReference: string; alreadyRecorded: boolean }
  | { status: 'IGNORED'; reason: string }
  | { status: 'REJECTED'; reason: string };

/** Event types Monnify documents. Anything else is acknowledged and ignored, never guessed at. */
const INBOUND_EVENTS = new Set(['SUCCESSFUL_TRANSACTION', 'SETTLEMENT']);

@Injectable()
export class BankingWebhookService {
  private readonly logger = new Logger(BankingWebhookService.name);

  constructor(
    private readonly inbound: BankingInboundService,
    private readonly institutionId: string,
    private readonly providerKey: string,
  ) {}

  /**
   * Handles a Monnify collection webhook.
   *
   * Returns an outcome rather than throwing: the controller must always answer the provider with a
   * status, and a 500 to a webhook is a retry request in disguise.
   */
  async handleMonnify(request: WebhookRequest): Promise<WebhookOutcome> {
    const verification = verifyWebhook({
      rawBody: request.rawBody,
      signature: request.signature,
      clientSecret: request.clientSecret,
      environment: request.environment,
      trustedFixtureTransport: request.trustedFixtureTransport,
    });

    if (!verification.ok) {
      // Coarse on the way out, specific on the way in.
      this.logger.warn(`Rejected Monnify webhook: ${verification.reason}`);
      return { status: 'REJECTED', reason: 'Signature verification failed' };
    }

    const body = verification.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return { status: 'REJECTED', reason: 'Unrecognised payload' };
    }
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    if (!INBOUND_EVENTS.has(eventType)) {
      // Acknowledged and ignored. Guessing at an unknown event would mean inventing semantics.
      return { status: 'IGNORED', reason: `Unhandled event type ${eventType || '<missing>'}` };
    }

    const eventData =
      typeof body.eventData === 'object' && body.eventData !== null
        ? (body.eventData as Record<string, unknown>)
        : null;
    if (!eventData) return { status: 'IGNORED', reason: 'No event data' };

    // The provider's transaction reference is the dedupe key and the thing we later verify.
    const providerTransactionReference =
      typeof eventData.transactionReference === 'string'
        ? eventData.transactionReference
        : typeof eventData.paymentReference === 'string'
          ? eventData.paymentReference
          : undefined;

    if (!providerTransactionReference) {
      // Without a reference there is nothing to verify against, so there is nothing to record. A
      // payment we cannot look up must not be invented from webhook fields.
      return { status: 'IGNORED', reason: 'No provider transaction reference' };
    }

    const amountPaid = typeof eventData.amountPaid === 'number' ? eventData.amountPaid : undefined;
    if (amountPaid === undefined) {
      return { status: 'IGNORED', reason: 'No amount in webhook payload' };
    }
    const grossMinor = String(Math.round(amountPaid * 100));
    // The provider fee is not part of the documented payment-notification payload, so it is recorded
    // as zero here and corrected only by verification. Inventing a fee from the difference between
    // amountPaid and settlementAmount would be reading a settlement field as a fee.
    const feeMinor = '0';

    const recorded = await this.inbound.record({
      institutionId: this.institutionId,
      providerKey: this.providerKey,
      environment: request.environment,
      providerTransactionReference,
      providerPaymentReference:
        typeof eventData.paymentReference === 'string' ? eventData.paymentReference : null,
      receivingAccountNumber:
        typeof eventData.destinationAccountNumber === 'string'
          ? eventData.destinationAccountNumber
          : null,
      receivingBankCode:
        typeof eventData.destinationBankCode === 'string' ? eventData.destinationBankCode : null,
      currency: typeof eventData.currency === 'string' ? eventData.currency : 'NGN',
      grossAmountMinor: grossMinor,
      providerFeeMinor: feeMinor,
      creditedAmountMinor: grossMinor,
      paidAt: typeof eventData.paidOn === 'string' ? eventData.paidOn : null,
    });

    // Recorded, not verified. Verification is a separate server-to-server call driven by the
    // reconciliation/verification path, never by the webhook itself.
    return {
      status: 'ACCEPTED',
      providerTransactionReference,
      alreadyRecorded: recorded.alreadyRecorded,
    };
  }
}
