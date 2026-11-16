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
