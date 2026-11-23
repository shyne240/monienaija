import { ApiClient } from './api-client';

export type CustomerKycKind = 'BVN' | 'NIN';
export type CustomerKycProvider = 'MONNIFY' | 'DOJAH' | 'PREMBLY';
export type CustomerKycCandidateStatus =
  | 'NOT_CONFIGURED'
  | 'PENDING'
  | 'REVIEW'
  | 'ELIGIBLE'
  | 'UNAVAILABLE';

export interface CustomerKycWorkflowConsent {
  id: string;
  kind: CustomerKycKind;
  noticeVersion: string;
  provider: CustomerKycProvider;
  routeVersion: number;
  expiresAt: string;
}

export interface CustomerKycWorkflowHistoryItem {
  id: string;
  kind: CustomerKycKind;
  provider: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

/** Safe, customer-owned recovery and action projection. It never contains the submitted identifier. */
export interface CustomerKycWorkflowStatus {
  customer: { status: string; kycLevel: string; kycStatus: string };
  policy: { configured: boolean; version: string | null };
  requirements: {
    level: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
    regulatory: { all: string[]; any: string[][] };
    operator: { all: string[]; any: string[][] };
  } | null;
  candidateAssessment: {
    status: CustomerKycCandidateStatus;
    level: string | null;
    reason: string;
  };
  consentNotice: { version: string; text: string } | null;
  verificationEnabled: boolean;
  consents: CustomerKycWorkflowConsent[];
  history: CustomerKycWorkflowHistoryItem[];
}

export interface CustomerKycAvailability {
  status: 'AVAILABLE' | 'CONFIGURATION_INCOMPLETE';
  provider: CustomerKycProvider | null;
  routeVersion: number | null;
  consentNotice: { version: string; text: string } | null;
}

export interface CustomerKycConsentInput {
  requestId: string;
  kind: CustomerKycKind;
  accepted: true;
  noticeVersion: string;
  expectedProvider: CustomerKycProvider;
  expectedRouteVersion: number;
}

export interface CustomerKycConsent {
  id: string;
  expiresAt: string;
  provider: CustomerKycProvider;
  routeVersion: number;
}

export interface CustomerKycVerificationInput {
  requestId: string;
  consentId: string;
  kind: CustomerKycKind;
  identifier: string;
}

export interface CustomerKycVerificationResult {
  id: string;
  status: string;
  provider: string;
  expiresAt: string | null;
}

export interface CustomerKycWorkflowClient {
  status(): Promise<CustomerKycWorkflowStatus>;
  availability(kind: CustomerKycKind): Promise<CustomerKycAvailability>;
  grantConsent(input: CustomerKycConsentInput): Promise<CustomerKycConsent>;
  withdrawConsent(consentId: string): Promise<{ status: 'WITHDRAWN' }>;
  verify(input: CustomerKycVerificationInput): Promise<CustomerKycVerificationResult>;
}

function clientFor(root: string, registrationBearer?: string): CustomerKycWorkflowClient {
  const post = <T>(suffix: string, body: unknown) => {
    const path = `${root}/${suffix}`;
    return registrationBearer === undefined
      ? ApiClient.post<T>(path, body)
      : ApiClient.post<T>(path, body, { registrationBearer });
  };
  return {
    status: () => post<CustomerKycWorkflowStatus>('status', {}),
    availability: (kind) => post<CustomerKycAvailability>('availability', { kind }),
    grantConsent: (input) => post<CustomerKycConsent>('consent', input),
    withdrawConsent: (consentId) =>
      post<{ status: 'WITHDRAWN' }>('consent/withdraw', { consentId }),
    verify: (input) => post<CustomerKycVerificationResult>('verification', input),
  };
}

/** Authenticated `customer-api` KYC actions, scoped by the backend to the bearer session owner. */
export const customerKycWorkflowApi = (): CustomerKycWorkflowClient =>
  clientFor('/customers/me/kyc');

/** Restricted `customer-onboarding` KYC actions. This token is never sent to financial endpoints. */
export const customerOnboardingKycWorkflowApi = (token: string): CustomerKycWorkflowClient =>
  clientFor('/customers/registration-sessions/customer-kyc', token);
