export type IdentityKind = 'BVN' | 'NIN';
/** Governed extension points for provider-backed assurance beyond identity-number checks. */
export const KYC_ASSURANCE_CAPABILITIES = [
  'ADDRESS_VERIFICATION',
  'ENHANCED_DUE_DILIGENCE',
] as const;
export type KycAssuranceCapability = (typeof KYC_ASSURANCE_CAPABILITIES)[number];
export type KycProviderCapability = IdentityKind | KycAssuranceCapability;
export type AttemptOutcome =
  | 'DISPATCHING'
  | 'MATCH'
  | 'REVIEW'
  | 'UNKNOWN'
  | 'CONSENT_WITHDRAWN'
  | 'EXPIRED';
export interface IdentityDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
}
/** Sensitive: in memory only, never persist/log this object. */
export interface VerificationInput {
  kind: IdentityKind;
  identifier: string;
  identity: IdentityDetails;
}
export interface ProviderResult {
  outcome: 'MATCH' | 'REVIEW';
  reference?: string;
}
export interface KycProvider {
  readonly code: string;
  verify(input: VerificationInput, signal: AbortSignal): Promise<ProviderResult>;
}
/** Server-side routing authority; no client-provided provider choice. */
export interface KycRoutingAuthority {
  assert(provider: string, kind: IdentityKind): Promise<void>;
}
export interface KycPolicy {
  version: string;
  enabled: boolean;
  maxAttemptsPerConsent: number;
  cooldownSeconds: number;
  customerWindowSeconds: number;
  customerWindowLimit: number;
  providerWindowSeconds: number;
  providerWindowLimit: number;
  timeoutMs: number;
  evidenceValiditySeconds: number;
}
export interface Attempt {
  id: string;
  customerId: string;
  consentId: string;
  kind: IdentityKind;
  provider: string;
  outcome: AttemptOutcome;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}
export interface Reservation {
  customerId: string;
  consentId: string;
  requestId: string;
  kind: IdentityKind;
  provider: string;
  sessionToken: string;
  /** Internal audience selected by the route, never supplied by a customer request body. */
  audience?: string;
  /** Revision read with the authoritative profile; reservation rejects if it has since changed. */
  identityRevision?: string;
  /** Route version selected server-side and recorded in the customer's consent. */
  providerRouteVersion?: number;
  identifierMac: string;
  ownershipKeyProof: string;
  ownershipKeyVersion: string;
  requestMac: string;
  identityMac: string;
  macKeyVersion: string;
  policy: KycPolicy;
}
export interface KycStore {
  reserve(request: Reservation): Promise<{ attempt: Attempt; isNew: boolean }>;
  finish(
    attempt: Attempt,
    outcome: Exclude<AttemptOutcome, 'DISPATCHING' | 'CONSENT_WITHDRAWN' | 'EXPIRED'>,
    evidenceValiditySeconds: number,
    referenceMac: string | null,
  ): Promise<Attempt>;
}
export class KycFoundationError extends Error {
  constructor(readonly code: 'INVALID' | 'DISABLED' | 'BLOCKED' | 'CONFLICT' | 'NOT_FOUND') {
    super(`KYC foundation: ${code}`);
    this.name = 'KycFoundationError';
  }
}
