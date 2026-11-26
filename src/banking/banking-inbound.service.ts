import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';
import type { InboundPaymentVerificationResult } from './banking-provider.types';

/**
 * Inbound deposits.
 *
 * The event that starts this flow is untrusted. A webhook arrives from the internet claiming a
 * customer paid; the money is real only after the provider confirms it server-to-server. So the flow
 * is:
 *
 *   1. record the claimed event (`recorded`, `UNVERIFIED`);
 *   2. verify with the provider using its own reference;
 *   3. only then mark it `VERIFIED` and expose it for posting.
 *
 * Three properties this service does not compromise:
 *
 * - **Deduplication is on the provider's transaction reference**, enforced by a unique constraint. A
 *   replayed webhook cannot produce a second credit, and it cannot be made to by a retry loop.
 * - **Unverifiable is not unverified-and-fine.** A provider outage leaves the payment `UNKNOWN`; it is
 *   never treated as verified and never shown to a customer as money received.
 * - **Amounts are evidence.** Gross, provider fee and credited amount are stored once and never
 *   restated; a correction is a new record. The CHECK constraint guarantees gross = fee + credited.
 *
 * Webhook verification and recording are deliberately separate from posting. This service writes
 * what was observed; it does not touch the ledger. Posting a verified payment is a financial
 * operation that belongs to the governed ledger path, not here.
 */

export interface RecordInboundCommand {
  institutionId: string;
  providerKey: string;
  environment: 'sandbox' | 'production';
  providerTransactionReference: string;
  providerPaymentReference?: string | null;
  reservationId?: string | null;
  receivingAccountNumber?: string | null;
  receivingBankCode?: string | null;
  currency: string;
  grossAmountMinor: string;
  providerFeeMinor: string;
  creditedAmountMinor: string;
  paidAt?: string | null;
  /** Our durable reference, generated once at intake and reused everywhere downstream. */
  businessReference?: string | null;
  /** Merchant settlement amount after provider deductions, when the provider reports it. */
  settlementAmountMinor?: string | null;
  monienaijaFeeMinor?: string | null;
  customerCreditMinor?: string | null;
}

export interface InboundPaymentView {
  id: string;
  provider_transaction_reference: string;
  business_reference: string | null;
  verification_state: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'UNKNOWN';
  resolution_state: string;
  gross_amount_minor: string;
  provider_fee_minor: string;
  credited_amount_minor: string;
  settlement_amount_minor: string | null;
  monienaija_fee_minor: string;
  customer_credit_minor: string | null;
  currency: string;
  ledger_transaction_id: string | null;
  credit_journal_id: string | null;
  wallet_id: string | null;
  virtual_account_id: string | null;
}

const MINOR = /^[0-9]{1,19}$/;

@Injectable()
export class BankingInboundService {
  private readonly logger = new Logger(BankingInboundService.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
  ) {}

  async view(id: string): Promise<InboundPaymentView> {
    const rows = await this.db.query<InboundPaymentView[]>(
      `SELECT id,provider_transaction_reference,business_reference,verification_state,resolution_state,
              gross_amount_minor::text AS gross_amount_minor,
              provider_fee_minor::text AS provider_fee_minor,
              credited_amount_minor::text AS credited_amount_minor,
              settlement_amount_minor::text AS settlement_amount_minor,
              monienaija_fee_minor::text AS monienaija_fee_minor,
              customer_credit_minor::text AS customer_credit_minor,
              currency,ledger_transaction_id,credit_journal_id,wallet_id,virtual_account_id
         FROM banking_inbound_payments WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new Error('Inbound payment not found');
    return rows[0];
  }

  /**
   * Records a claimed payment without believing it.
   *
   * Idempotent on the provider's transaction reference: a replayed webhook returns the existing record
   * rather than creating a second one. It deliberately does NOT update the existing row — a replayed
   * event carrying different amounts is evidence of a problem, not permission to restate history.
   */
  async record(command: RecordInboundCommand): Promise<{ id: string; alreadyRecorded: boolean }> {
    for (const [name, value] of [
      ['grossAmountMinor', command.grossAmountMinor],
      ['providerFeeMinor', command.providerFeeMinor],
      ['creditedAmountMinor', command.creditedAmountMinor],
    ] as const) {
      if (!MINOR.test(value)) throw new Error(`${name} must be a non-negative integer string`);
    }
    if (
      BigInt(command.creditedAmountMinor) !==
      BigInt(command.grossAmountMinor) - BigInt(command.providerFeeMinor)
    ) {
      // Refused here as well as by the CHECK, so the caller gets a meaningful error instead of a
      // constraint violation after the row was attempted.
      throw new Error('creditedAmountMinor must equal grossAmountMinor - providerFeeMinor');
    }

    const existing = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM banking_inbound_payments
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3
          AND provider_transaction_reference=$4`,
      [
        command.institutionId,
        command.providerKey,
        command.environment,
        command.providerTransactionReference,
      ],
    );
    if (existing[0]) {
      this.logger.log(
        `Inbound payment ${command.providerTransactionReference} was already recorded; returning existing record`,
      );
      return { id: existing[0].id, alreadyRecorded: true };
    }

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO banking_inbound_payments
        (id,institution_id,provider_key,environment,provider_transaction_reference,
         provider_payment_reference,reservation_id,receiving_account_number,receiving_bank_code,
         currency,gross_amount_minor,provider_fee_minor,credited_amount_minor,paid_at,
         verification_state,business_reference,settlement_amount_minor,monienaija_fee_minor,
         customer_credit_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'UNVERIFIED',$15,$16,$17,$18)
       ON CONFLICT (institution_id,provider_key,environment,provider_transaction_reference)
       DO NOTHING`,
      [
        id,
        command.institutionId,
        command.providerKey,
        command.environment,
        command.providerTransactionReference,
        command.providerPaymentReference ?? null,
        command.reservationId ?? null,
        command.receivingAccountNumber ?? null,
        command.receivingBankCode ?? null,
        command.currency,
        command.grossAmountMinor,
        command.providerFeeMinor,
        command.creditedAmountMinor,
        command.paidAt ?? null,
        command.businessReference ?? null,
        command.settlementAmountMinor ?? null,
        command.monienaijaFeeMinor ?? '0',
        command.customerCreditMinor ?? null,
      ],
    );
    const inserted = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM banking_inbound_payments
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3
          AND provider_transaction_reference=$4`,
      [
        command.institutionId,
        command.providerKey,
        command.environment,
        command.providerTransactionReference,
      ],
    );
    if (!inserted[0]) throw new Error('Unable to record inbound payment');
    return { id: inserted[0].id, alreadyRecorded: inserted[0].id !== id };
  }

  /**
   * Confirms a recorded payment with the provider.
   *
   * The provider's answer — not the webhook — decides `VERIFIED`. Where the provider reports amounts
   * that differ from what was recorded, the record is set `REJECTED` rather than quietly adjusted:
   * two conflicting stories about what a customer paid must be reconciled by a human, not resolved by
   * preference for the more recent one.
   */
  async verify(
    id: string,
    correlationId: string,
    /** Re-present a stored VERIFIED payment to obtain fresh evidence for a posting decision. */
    force = false,
  ): Promise<{
    state: InboundPaymentView['verification_state'];
    verification?: InboundPaymentVerificationResult;
  }> {
    const rows = await this.db.query<
      Array<{
        provider_key: string;
        environment: string;
        provider_transaction_reference: string;
        gross_amount_minor: string;
        currency: string;
        verification_state: string;
      }>
    >(
      `SELECT provider_key,environment,provider_transaction_reference,gross_amount_minor::text AS gross_amount_minor,
              currency,verification_state
         FROM banking_inbound_payments WHERE id=$1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error('Inbound payment not found');
    if (row.verification_state === 'VERIFIED' && !force) return { state: 'VERIFIED' };

    const provider = this.registry.find(row.provider_key);
    if (
      !provider ||
      provider.descriptor.environment !== row.environment ||
      !this.registry.supports(row.provider_key, 'INBOUND_PAYMENT_VERIFICATION')
    ) {
      // No verification capability means the payment stays unverified. It is never assumed good.
      await this.db.query(
        `UPDATE banking_inbound_payments SET verification_state='UNKNOWN' WHERE id=$1`,
        [id],
      );
      return { state: 'UNKNOWN' };
    }

    let result;
    try {
      result = await provider.verifyInboundPayment!(row.provider_transaction_reference, {
        correlationId,
      });
    } catch {
      // Verification could not be completed. Leave it as it is — definitely not VERIFIED.
      return { state: 'UNKNOWN' };
    }
    if (!result.ok) {
      await this.db.query(
        `UPDATE banking_inbound_payments SET verification_state='UNKNOWN' WHERE id=$1`,
        [id],
      );
      return { state: 'UNKNOWN' };
    }

    const verification = result.value;
    if (verification.outcome === 'VERIFIED') {
      // Amount agreement is the difference between "the provider confirms this reference" and "the
      // provider confirms this reference for this amount".
      if (
        verification.providerTransactionReference !== row.provider_transaction_reference ||
        (verification.currency !== undefined && verification.currency !== row.currency) ||
        (verification.grossAmountMinor !== undefined &&
          BigInt(verification.grossAmountMinor) !== BigInt(row.gross_amount_minor))
      ) {
        await this.db.query(
          `UPDATE banking_inbound_payments SET verification_state='REJECTED' WHERE id=$1`,
          [id],
        );
        this.logger.warn(
          `Inbound payment ${row.provider_transaction_reference} amount disagrees with the provider`,
        );
        return { state: 'REJECTED', verification };
      }
      await this.db.query(
        `UPDATE banking_inbound_payments SET verification_state='VERIFIED' WHERE id=$1
          AND verification_state IN ('UNVERIFIED','UNKNOWN')`,
        [id],
      );
      return { state: 'VERIFIED', verification };
    }
    if (verification.outcome === 'CONFLICT') {
      // The provider knows the reference but disagrees about it. That is a dispute, not a payment;
      // marking it rejected keeps it out of the posting path until a human resolves it.
      await this.db.query(
        `UPDATE banking_inbound_payments SET verification_state='REJECTED' WHERE id=$1`,
        [id],
      );
      return { state: 'REJECTED', verification };
    }
    // PENDING/UNKNOWN from the provider: the payment is not confirmed, so it is not verified.
    await this.db.query(
      `UPDATE banking_inbound_payments SET verification_state='UNKNOWN' WHERE id=$1`,
      [id],
    );
    return { state: 'UNKNOWN', verification };
  }

  /**
   * Returns verified, unposted payments for a wallet.
   *
   * This is what the posting path consumes. It returns nothing for payments that are merely recorded:
   * an unverified webhook is not money.
   */
  async verifiedUnposted(institutionId: string, limit = 100): Promise<InboundPaymentView[]> {
    return this.db.query<InboundPaymentView[]>(
      `SELECT id,provider_transaction_reference,business_reference,verification_state,resolution_state,
              gross_amount_minor::text AS gross_amount_minor,
              provider_fee_minor::text AS provider_fee_minor,
              credited_amount_minor::text AS credited_amount_minor,
              settlement_amount_minor::text AS settlement_amount_minor,
              monienaija_fee_minor::text AS monienaija_fee_minor,
              customer_credit_minor::text AS customer_credit_minor,
              currency,ledger_transaction_id,credit_journal_id,wallet_id,virtual_account_id
         FROM banking_inbound_payments
        WHERE institution_id=$1 AND verification_state='VERIFIED' AND ledger_transaction_id IS NULL
        ORDER BY paid_at NULLS LAST, recorded_at
        LIMIT $2`,
      [institutionId, Math.min(Math.max(limit, 1), 500)],
    );
  }
}
