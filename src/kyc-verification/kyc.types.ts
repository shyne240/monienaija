export type IdentityKind = 'BVN' | 'NIN';
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
