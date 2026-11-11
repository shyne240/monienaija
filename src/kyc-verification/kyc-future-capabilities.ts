/** Contracts only; no biometric, address, utility or GPS integration is provided or enabled. */
export type FutureAssuranceCapability =
  | 'SELFIE_LIVENESS'
  | 'FACIAL_MATCH'
  | 'ADDITIONAL_BIOMETRIC'
  | 'DIGITAL_ADDRESS'
  | 'UTILITY_BILL'
  | 'GPS_ADDRESS_COMPARISON';

export interface FutureAssuranceProvider {
  readonly code: string;
  readonly supportedCapabilities: readonly FutureAssuranceCapability[];
  // An opaque reference to a separately authorized, securely stored submission; never image or GPS data in logs.
  verify(
    capability: FutureAssuranceCapability,
    submissionReference: string,
    signal: AbortSignal,
  ): Promise<{
    outcome: 'VERIFIED' | 'REVIEW' | 'UNKNOWN';
    providerReference?: string;
  }>;
}
