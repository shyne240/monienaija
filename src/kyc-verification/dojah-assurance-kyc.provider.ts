import type { FutureAssuranceCapability, FutureAssuranceProvider } from './kyc-future-capabilities';
import { KYC_ASSURANCE_CAPABILITIES, type KycAssuranceCapability } from './kyc.types';

export interface DojahAssuranceResult {
  outcome: 'VERIFIED' | 'REVIEW' | 'UNKNOWN';
}

/**
 * Provider-contract boundary for Dojah address/enhanced-KYC operations.
 *
 * No endpoint, request fields, response fields, entitlement, pricing or retention behavior is
 * assumed here. A separately reviewed Dojah connector may implement this interface once the
 * account-specific contract is approved. Until then this adapter is deliberately not registered
 * in the production provider runtime, and the governance runtime-readiness gate rejects dispatch.
 * The operation receives only a server-created opaque submission reference, never a raw document,
 * address, identity number, or provider response payload.
 */
export interface DojahAssuranceContract {
  verifyAddress(submissionReference: string, signal: AbortSignal): Promise<DojahAssuranceResult>;
  verifyEnhancedKyc(
    submissionReference: string,
    signal: AbortSignal,
  ): Promise<DojahAssuranceResult>;
}

const UUID_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const resultOutcomes = new Set(['VERIFIED', 'REVIEW', 'UNKNOWN']);

/**
 * Domain adapter only. The reviewed contract implementation owns all wire-level mapping and
 * transport security; this wrapper accepts only one normalized outcome and never logs or persists
 * provider payloads. A missing contract is an error, not a negative identity match.
 */
export class DojahAssuranceKycProvider implements FutureAssuranceProvider {
  readonly code = 'DOJAH';
  readonly supportedCapabilities: readonly FutureAssuranceCapability[] = [
    ...KYC_ASSURANCE_CAPABILITIES,
  ];

  constructor(private readonly contract?: DojahAssuranceContract) {}

  async verify(
    capability: FutureAssuranceCapability,
    submissionReference: string,
    signal: AbortSignal,
  ): Promise<DojahAssuranceResult> {
    if (
      !KYC_ASSURANCE_CAPABILITIES.includes(capability as KycAssuranceCapability) ||
      !UUID_REFERENCE.test(submissionReference) ||
      signal.aborted
    )
      throw new Error('Dojah assurance request is invalid or unsupported');
    if (!this.contract) throw new Error('Dojah assurance contract is not configured');

    const result =
      capability === 'ADDRESS_VERIFICATION'
        ? await this.contract.verifyAddress(submissionReference, signal)
        : capability === 'ENHANCED_DUE_DILIGENCE'
          ? await this.contract.verifyEnhancedKyc(submissionReference, signal)
          : null;
    if (signal.aborted) throw new Error('Dojah assurance request was aborted');
    if (
      !result ||
      typeof result !== 'object' ||
      Object.keys(result).sort().join(',') !== 'outcome' ||
      !resultOutcomes.has(result.outcome)
    )
      throw new Error('Dojah assurance outcome is unrecognized');
    return { outcome: result.outcome };
  }
}

/**
 * Reviewed `DojahAssuranceContract` implementation for the documented address-verification surface.
 *
 * An earlier revision assumed no Dojah address endpoint was documented. That was wrong:
 * `POST /api/v1/kyc/address` submits and `GET /api/v1/kyc/address?reference_id=…` polls, with an
 * asynchronous result. This connector therefore maps only that documented surface.
 *
 * It is registered explicitly (never as a default), and it still degrades closed:
 *
 *   * a reference that has not completed maps to `REVIEW` — a visit that is merely outstanding can
 *     never become trusted evidence;
 *   * a completed visit without a positive provider indication or without a collected address maps
 *     to `UNKNOWN`, never `VERIFIED`;
 *   * any adapter error maps to `UNKNOWN` (a missing answer is not a negative finding either).
 *
 * ENHANCED_DUE_DILIGENCE is intentionally NOT implemented here: no documented Dojah operation backs
 * it, so it stays unavailable rather than being approximated from an unrelated endpoint.
 */
export interface DojahAddressAssuranceSource {
  submitAddressVerification(input: {
    firstName: string;
    lastName: string;
    mobile: string;
    street: string;
    lga: string;
    state: string;
  }): Promise<{ referenceId: string }>;
  getAddressVerificationStatus(referenceId: string): Promise<{
    referenceId: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    verified: boolean;
    collected: { address?: string; lga?: string; state?: string } | null;
  }>;
}

export class DojahDocumentedAddressContract implements DojahAssuranceContract {
  constructor(private readonly source: DojahAddressAssuranceSource) {}

  async verifyAddress(
    submissionReference: string,
    signal: AbortSignal,
  ): Promise<DojahAssuranceResult> {
    if (signal.aborted) throw new Error('Dojah address verification was aborted');
    let status: Awaited<ReturnType<DojahAddressAssuranceSource['getAddressVerificationStatus']>>;
    try {
      status = await this.source.getAddressVerificationStatus(submissionReference);
    } catch {
      return { outcome: 'UNKNOWN' };
    }
    if (signal.aborted) throw new Error('Dojah address verification was aborted');
    if (status.status === 'PENDING') return { outcome: 'REVIEW' };
    if (status.status === 'FAILED') return { outcome: 'REVIEW' };
    return status.verified && status.collected?.address
      ? { outcome: 'VERIFIED' }
      : { outcome: 'UNKNOWN' };
  }

  verifyEnhancedKyc(
    submissionReference: string,
    signal: AbortSignal,
  ): Promise<DojahAssuranceResult> {
    // Both arguments are part of the contract signature; refusing does not read them.
    void submissionReference;
    void signal;
    // No documented operation exists for this capability; refuse rather than invent one.
    return Promise.reject(new Error('Dojah enhanced KYC is not a documented operation'));
  }
}
