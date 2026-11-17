import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type {
  ExternalOperationStatusVerificationRequest,
  ExternalOperationStatusVerifier,
  ExternalOperationStatusVerificationResult,
} from '../partner/external-operation-status-verifier';
import type { BankingProviderRegistry } from './banking-provider.registry';
import type { BankingReadinessService } from './banking-readiness.service';

/**
 * Independently verifies an A6 external operation against the banking provider.
 *
 * This is the trust boundary between "a provider told us something" and "the ledger may move". The A6
 * settlement service already refuses to settle without a `VERIFIED_SETTLED` result carrying the hash
 * of an authenticated provider reference; this class is what produces that result, and it is
 * deliberately strict about when it will:
 *
 * - `VERIFIED_SETTLED` requires a provider enquiry that returns a terminal *successful* status for the
 *   exact operation reference we created. An acknowledgement, a stored reference, or a prior
 *   `PENDING_PROVIDER` state is correlation, never proof;
 * - `VERIFIED_REJECTED` requires a terminal *failed* status — and only a terminal one. An unknown or
 *   pending answer must not release a reservation, because release is irreversible;
 * - `VERIFIED_ACCEPTED_NOT_SETTLED` is its own state precisely so "the provider accepted the
 *   instruction" is never mistaken for "the institution settled the funds". Those are different facts
 *   with different accounting consequences;
 * - every other answer, including any provider error, is `UNKNOWN` or `UNAVAILABLE` and moves nothing.
 *
 * The provider reference hash binds the outcome to a specific reference. A hash is used rather than
 * the reference itself so this surface never becomes a place where provider identifiers leak.
 */
@Injectable()
export class BankingExternalOperationStatusVerifier implements ExternalOperationStatusVerifier {
  private readonly logger = new Logger(BankingExternalOperationStatusVerifier.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
    private readonly readiness: BankingReadinessService,
    private readonly environment: 'sandbox' | 'production',
  ) {}

  async verify(
    request: ExternalOperationStatusVerificationRequest,
  ): Promise<ExternalOperationStatusVerificationResult> {
    const operation = request.operation;
    const unavailable = (reasonCode: string): ExternalOperationStatusVerificationResult => ({
      state: 'UNAVAILABLE',
      providerStatus: null,
      providerReferenceHash: null,
      observedAt: request.requestedAt,
      reasonCode,
    });

    // The banking record is keyed by our operation reference and carries the institution, so the
    // provider enquiry is scoped to the same institution the commitment was made under.
    const rows = await this.db.query<
      Array<{
        id: string;
        operation_reference: string;
        institution_id: string;
        provider_key: string;
        state: string;
        provider_status: string | null;
        provider_transaction_reference: string | null;
      }>
    >(
      `SELECT id,operation_reference,institution_id,provider_key,state,provider_status,
              provider_transaction_reference
         FROM banking_outbound_operations
        WHERE external_operation_id=$1 OR operation_reference=$2
        LIMIT 1`,
      [operation.externalOperationId, operation.externalOperationReference],
    );
    const record = rows[0];
    if (!record) {
      // An operation with no banking record cannot be verified here. Not an error and not a failure:
      // it may belong to a partner this deployment does not own.
      return unavailable('NO_BANKING_RECORD');
    }
    // The institution is taken from the wallet the commitment debited, not from the caller. A
    // caller-supplied institution would let a verification be pointed at another institution's
    // configuration.
    const wallets = await this.db.query<Array<{ institution_id: string | null }>>(
      'SELECT institution_id FROM wallet_accounts WHERE id=$1',
      [operation.walletAccountId],
    );
    const institutionId = wallets[0]?.institution_id ?? null;
    if (!institutionId) return unavailable('WALLET_HAS_NO_INSTITUTION');
    if (record.institution_id !== institutionId) {
      // Refusing to verify across institutions is a hard boundary, not a caution.
      this.logger.error(
        `Refusing cross-institution verification for operation ${operation.externalOperationReference}`,
      );
      return unavailable('INSTITUTION_MISMATCH');
    }

    const usable = await this.readiness.capabilityUsable(
      record.institution_id,
      record.provider_key,
      this.environment,
      'TRANSFER_STATUS_ENQUIRY',
    );
    if (!usable.usable) {
      // Verification is not possible, so nothing may settle. This is the state a missing provider
      // contract or a missing approval produces, and it must never silently pass.
      return unavailable(`TRANSFER_STATUS_ENQUIRY_${usable.state}`);
    }

    const provider = this.registry.find(record.provider_key);
    if (!provider?.getTransferStatus) return unavailable('PROVIDER_MISSING_STATUS_METHOD');

    try {
      const result = await provider.getTransferStatus(record.operation_reference, {
        correlationId: request.correlationId,
      });
      if (!result.ok) {
        // A provider error is not an outcome. Nothing moves.
        return {
          state: 'UNKNOWN',
          providerStatus: null,
          providerReferenceHash: null,
          observedAt: request.requestedAt,
          reasonCode: result.error.code,
        };
      }
      const value = result.value;
      const hash = this.referenceHash(
        value.providerReference ??
          record.provider_transaction_reference ??
          record.operation_reference,
      );
      const base = {
        providerStatus: value.providerStatus ?? value.outcome,
        providerReferenceHash: hash,
        observedAt: request.requestedAt,
        reasonCode: null,
      };
      switch (value.outcome) {
        case 'SUCCESSFUL':
          // Terminal success for OUR reference: the only state that may settle funds.
          return {
            state: 'VERIFIED_SETTLED',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: null,
          };
        case 'FAILED':
        case 'REJECTED':
          return {
            state: 'VERIFIED_REJECTED',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: null,
          };
        case 'REVERSED':
          // A reversal after success is its own financial event with its own accounting. Treating it
          // as a rejection would unwind a settled obligation that genuinely settled first.
          return {
            state: 'UNKNOWN',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: 'PROVIDER_REVERSED',
          };
        case 'PENDING':
          return {
            state: 'VERIFIED_ACCEPTED_NOT_SETTLED',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: 'PROVIDER_PENDING',
          };
        case 'NOT_FOUND':
          // The provider has no record of our reference. Not proof of failure.
          return {
            state: 'UNKNOWN',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: 'PROVIDER_HAS_NO_RECORD',
          };
        case 'UNKNOWN':
        default:
          return {
            state: 'UNKNOWN',
            providerStatus: base.providerStatus,
            providerReferenceHash: hash,
            observedAt: request.requestedAt,
            reasonCode: 'STATUS_UNKNOWN',
          };
      }
    } catch {
      return {
        state: 'UNKNOWN',
        providerStatus: null,
        providerReferenceHash: null,
        observedAt: request.requestedAt,
        reasonCode: 'VERIFICATION_FAILED',
      };
    }
  }

  private referenceHash(reference: string): string {
    return createHash('sha256').update(reference).digest('hex');
  }
}
