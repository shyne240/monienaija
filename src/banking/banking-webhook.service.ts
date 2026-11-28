import { Injectable, Logger } from '@nestjs/common';

import { verifyWebhook } from './monnify/monnify-webhook.signature';
import type { BankingInboundService } from './banking-inbound.service';
import type { BankingOutboundService } from './banking-outbound.service';
import type { BankToWalletService } from './bank-to-wallet.service';

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
  /** Optional override; defaults to the configured client secret for this provider. */
  clientSecret?: string;
  environment?: 'sandbox' | 'production';
  trustedFixtureTransport?: boolean;
}

export type WebhookOutcome =
  | { status: 'ACCEPTED'; providerTransactionReference: string; alreadyRecorded: boolean }
  | { status: 'UNRESOLVED'; reason: string }
  | { status: 'IGNORED'; reason: string }
  | { status: 'REJECTED'; reason: string };

export interface BankingWebhookAttribution {
  readonly institutionId: string;
}

export interface BankingWebhookConfiguration {
  readonly providerKey: string;
  readonly clientSecret: string;
  readonly environment: 'sandbox' | 'production';
  /**
   * Resolves which institution a payment belongs to, from the receiving account only. Returning null
   * means the payment cannot be attributed; the handler then reports UNRESOLVED and records nothing.
   */
  readonly resolveAttribution: (input: {
    providerKey: string;
    receivingAccountNumber: string | null;
    receivingBankCode: string | null;
    providerTransactionReference: string;
  }) => Promise<BankingWebhookAttribution | null>;
}

/** Event types Monnify documents. Anything else is acknowledged and ignored, never guessed at. */
const INBOUND_EVENTS = new Set(['SUCCESSFUL_TRANSACTION', 'SETTLEMENT']);

/**
 * Monnify's documented disbursement notifications. The payload does NOT decide the outcome: it only
 * identifies our operation reference. Authoritative status is always re-read from the provider by
 * the outbound service, so a late, repeated, delayed or out-of-order notification cannot credit a
 * wallet or release a reservation on stale news.
 */
const OUTBOUND_EVENTS = new Set([
  'SUCCESSFUL_DISBURSEMENT',
  'FAILED_DISBURSEMENT',
  'REVERSED_DISBURSEMENT',
]);

@Injectable()
export class BankingWebhookService {
  private readonly logger = new Logger(BankingWebhookService.name);

  constructor(
    private readonly inbound: BankingInboundService,
    private readonly config: BankingWebhookConfiguration,
    private readonly bankToWallet?: BankToWalletService,
    private readonly outbound?: BankingOutboundService,
  ) {}

  /**
   * Disbursement notifications are recovery hints, never settlement instructions. The event payload
   * identifies our operation reference; the provider status enquiry decides the truth. An unknown,
   * late, delayed, repeated or out-of-order event therefore all take the same safe path: re-read the
   * authoritative status against the durable record. No second submission is possible here.
   */
  private async handleOutboundNotification(
    eventType: string,
    rawEventData: unknown,
  ): Promise<WebhookOutcome> {
    if (!this.outbound) {
      return { status: 'IGNORED', reason: 'Outbound recovery is not configured' };
    }
    const eventData =
      typeof rawEventData === 'object' && rawEventData !== null
        ? (rawEventData as Record<string, unknown>)
        : null;
    // Monnify's disbursement webhook calls our original request reference `reference`; the
    // provider's own identifier is `transactionReference`. Never confuse the two.
    const operationReference =
      typeof eventData?.reference === 'string' ? eventData.reference.trim() : '';
    const providerReference =
      typeof eventData?.transactionReference === 'string'
        ? eventData.transactionReference.trim()
        : '';
    if (!operationReference) {
      return { status: 'IGNORED', reason: 'No outbound operation reference' };
    }
    const id = await this.outbound.findByOperationReference(operationReference);
    if (!id) {
      // Traceable no-op: a notification for an operation this deployment never dispatched is not
      // evidence of a transfer and must not create one.
      this.logger.warn(`Disbursement webhook ${eventType} has no matching outbound operation`);
      return { status: 'IGNORED', reason: 'Outbound operation not found' };
    }
    const record = await this.outbound.enquire(id, `webhook:${eventType}`);
    return {
      status: 'ACCEPTED',
      providerTransactionReference: providerReference || operationReference,
      alreadyRecorded: record.state !== 'CREATED',
    };
  }

  /**
   * Handles a Monnify collection webhook.
   *
   * Returns an outcome rather than throwing: the controller must always answer the provider with a
   * status, and a 500 to a webhook is a retry request in disguise.
   */
  async handleMonnify(request: WebhookRequest): Promise<WebhookOutcome> {
    const clientSecret = request.clientSecret ?? this.config.clientSecret;
    if (!clientSecret) {
      // No configured secret means nothing can authenticate this deployment's webhook. Reporting a
      // verification failure (401) rather than an internal error (503) is the honest distinction:
      // the request was not authenticated, and no amount of retrying by the provider will change it.
      this.logger.error('Monnify webhook received but no client secret is configured');
      return { status: 'REJECTED', reason: 'Webhook authentication is not configured' };
    }
    const verification = verifyWebhook({
      rawBody: request.rawBody,
      signature: request.signature,
      clientSecret,
      environment: request.environment ?? this.config.environment,
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
    if (OUTBOUND_EVENTS.has(eventType)) {
      return this.handleOutboundNotification(eventType, body.eventData);
    }
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

    // The institution is resolved from the receiving account, because one webhook endpoint serves
    // every institution on the platform. An unattributable payment is recorded against nothing and
    // reported as unresolved rather than being guessed into an institution.
    const attribution = await this.config.resolveAttribution({
      providerKey: this.config.providerKey,
      receivingAccountNumber:
        typeof eventData.destinationAccountNumber === 'string'
          ? eventData.destinationAccountNumber
          : null,
      receivingBankCode:
        typeof eventData.destinationBankCode === 'string' ? eventData.destinationBankCode : null,
      providerTransactionReference,
    });
    const receivingAccountNumber =
      typeof eventData.destinationAccountNumber === 'string'
        ? eventData.destinationAccountNumber
        : null;
    const receivingBankCode =
      typeof eventData.destinationBankCode === 'string' ? eventData.destinationBankCode : null;
    const providerPaymentReference =
      typeof eventData.paymentReference === 'string' ? eventData.paymentReference : null;
    const currency = typeof eventData.currency === 'string' ? eventData.currency : 'NGN';

    if (!attribution) {
      // Acknowledged so the provider stops retrying, but now TRACEABLE: the business reference and
      // the reason are retained for Finance. No institution is invented and no wallet is credited.
      if (this.bankToWallet) {
        await this.bankToWallet.recordUnattributed({
          environment: this.config.environment,
          providerTransactionReference,
          providerPaymentReference,
          receivingAccountNumber,
          receivingBankCode,
          currency,
          grossAmountMinor: grossMinor,
          providerFeeMinor: feeMinor,
        });
      }
      return { status: 'UNRESOLVED', reason: 'Receiving account could not be attributed' };
    }

    let businessReference: string | undefined;
    if (this.bankToWallet) {
      businessReference = this.bankToWallet.businessReferenceFor({
        providerKey: this.config.providerKey,
        environment: this.config.environment,
        providerTransactionReference,
        institutionId: attribution.institutionId,
        receivingAccountNumber,
      });
    }
    const recorded = await this.inbound.record({
      institutionId: attribution.institutionId,
      providerKey: this.config.providerKey,
      environment: this.config.environment,
      providerTransactionReference,
      providerPaymentReference,
      reservationId: null,
      receivingAccountNumber,
      receivingBankCode,
      currency,
      grossAmountMinor: grossMinor,
      providerFeeMinor: feeMinor,
      creditedAmountMinor: grossMinor,
      paidAt: typeof eventData.paidOn === 'string' ? eventData.paidOn : null,
      businessReference,
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
