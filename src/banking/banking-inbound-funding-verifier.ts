import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type {
  InboundFundingVerifier,
  InboundVerification,
} from '../virtual-account/inbound-funding-verifier';
import type { BankingReadinessService } from './banking-readiness.service';
import type { BankingProviderRegistry } from './banking-provider.registry';

/**
 * Bank-funded inbound verification: the provider-facing half of the accepted inbound boundary.
 *
 * `InboundFundingService` already decides everything about *whether* a verified receipt may credit a
 * wallet — institution authority, wallet boundary, limits, suspense policy, idempotency and ledger
 * posting. This class answers only one question for it: did the provider independently confirm that
 * this reference delivered this amount to an account we control?
 *
 * Two rules it will not bend:
 *
 * - `UNAVAILABLE` means "this deployment cannot verify", and the caller turns that into a 503. It must
 *   never be reported as `UNKNOWN`, because `UNKNOWN` leads to review while `UNAVAILABLE` leads to a
 *   refusal, and conflating them would let a misconfiguration look like a pending payment.
 * - The receiving account must be one we issued. A verified payment into an account that is not ours
 *   is someone else's money, and crediting it would be a transfer between institutions.
 */
@Injectable()
export class BankingInboundFundingVerifier implements InboundFundingVerifier {
  private readonly logger = new Logger(BankingInboundFundingVerifier.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
    private readonly readiness: BankingReadinessService,
    private readonly environment: 'sandbox' | 'production',
  ) {}

  async verify(input: {
    providerKey: string;
    providerReference: string;
  }): Promise<InboundVerification> {
    const provider = this.registry.find(input.providerKey);
    if (!provider || !this.registry.supports(input.providerKey, 'INBOUND_PAYMENT_VERIFICATION')) {
      // Not configured. A refusal, not a pending payment.
      return { state: 'UNAVAILABLE' };
    }

    let result;
    try {
      result = await provider.verifyInboundPayment!(input.providerReference, {
        correlationId: `inbound:${input.providerReference}`,
      });
    } catch {
      // The provider could not be reached. We know nothing about the money.
      return { state: 'UNKNOWN' };
    }
    if (!result.ok) return { state: 'UNKNOWN' };

    const value = result.value;
    if (value.outcome !== 'VERIFIED') {
      // PENDING is not received; NOT_FOUND is not proof of absence; CONFLICT is a dispute.
      return { state: value.outcome === 'PENDING' ? 'UNKNOWN' : 'UNKNOWN' };
    }
    if (
      !value.grossAmountMinor ||
      !value.currency ||
      !value.providerBankCode ||
      !value.receivingAccountNumber
    ) {
      // A verified payment without the fields needed to attribute it is not usable evidence.
      this.logger.warn(
        `Verified inbound ${input.providerReference} is missing attribution fields; treating as unknown`,
      );
      return { state: 'UNKNOWN' };
    }

    // The receiving account must be one this platform issued, for this provider, and active. This
    // is the check that keeps a verified payment made to a third party from being credited to a
    // customer here — the provider verified *a* payment, not necessarily *our* payment.
    const accounts = await this.db.query<Array<{ wallet_id: string; institution_id: string }>>(
      `SELECT va.wallet_id, w.institution_id
         FROM virtual_accounts va
         JOIN wallet_accounts w ON w.id = va.wallet_id
        WHERE va.provider=$1 AND va.account_number=$2 AND va.status='ACTIVE'`,
      [input.providerKey, value.receivingAccountNumber],
    );
    const account = accounts[0];
    if (!account) {
      this.logger.warn(
        `Verified inbound ${input.providerReference} credited an account this platform does not issue`,
      );
      return { state: 'UNKNOWN' };
    }
    if (!account.institution_id) {
      // Without an institution there is no approved configuration to credit under.
      return { state: 'UNKNOWN' };
    }

    const usable = await this.readiness.capabilityUsable(
      account.institution_id,
      input.providerKey,
      this.environment,
      'INBOUND_PAYMENT_VERIFICATION',
    );
    if (!usable.usable) {
      // Verification succeeded but this deployment is not approved to credit on it.
      this.logger.warn(
        `Inbound ${input.providerReference} verified but not admissible: ${usable.state}`,
      );
      return { state: 'UNKNOWN' };
    }

    return {
      state: 'RECEIVED',
      providerKey: input.providerKey,
      providerReference: input.providerReference,
      bankCode: value.providerBankCode,
      accountNumber: value.receivingAccountNumber,
      amountMinor: value.grossAmountMinor,
      currency: value.currency,
      observedAt: value.paidAt ?? new Date().toISOString(),
    };
  }
}
