/**
 * B2T06 — B2 consent authority types.
 *
 * The B2 consent authority implements three consent families through a
 * single authority surface: Customer Consent, Marketing Consent, and
 * Commercial Consent for purposes B2_ACTIVATION, B2_COMMERCIAL,
 * B2_SELF_SERVICE, MARKETING_COMMERCIAL_OFFER. Each consent decision is
 * deterministic, replay-safe, and lifecycle-gated through
 * PENDING -> GRANTED -> REVOKED -> EXPIRED. The authority exposes only
 * read-only consumer ports to later B2 tasks.
 */

import type { RequestContext } from '../production/request-context';

export type B2ConsentContractName = 'B2-CONSENT-AUTHORITY';
export type B2ConsentContractVersion = 1;

export type B2ConsentPurpose =
  | 'B2_ACTIVATION'
  | 'B2_COMMERCIAL'
  | 'B2_SELF_SERVICE'
  | 'MARKETING_COMMERCIAL_OFFER';

export type B2ConsentChannel = 'email' | 'sms' | 'push' | 'inApp' | null;

export type B2ConsentState = 'PENDING' | 'GRANTED' | 'REVOKED' | 'EXPIRED';

export type B2ConsentOutcome = 'PENDING' | 'GRANTED' | 'REVOKED' | 'EXPIRED' | 'REJECTED';

export type B2ConsentFailureCode =
  | 'B2_CONSENT_INVALID_COMMAND'
  | 'B2_CONSENT_INCOMPATIBLE'
  | 'B2_CONSENT_QUERY_UNAVAILABLE'
  | 'B2_CONSENT_PROHIBITED'
  | 'B2_CONSENT_REPLAY_CONFLICT'
  | 'B2_CONSENT_REPLAY_EXPIRED'
  | 'B2_CONSENT_IN_PROGRESS'
  | 'B2_CONSENT_NOT_FOUND'
  | 'B2_CONSENT_EXPIRED'
  | 'B2_CONSENT_INVALID_STATE_TRANSITION';

export interface B2ConsentRequestV1 {
  readonly subjectCustomerId: string;
  readonly purpose: B2ConsentPurpose;
  readonly channel: B2ConsentChannel;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestedState: B2ConsentState;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2ConsentDecisionV1 {
  readonly consentReference: string;
  readonly consentVersion: 1;
  readonly subjectCustomerId: string;
  readonly purpose: B2ConsentPurpose;
  readonly channel: B2ConsentChannel;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly state: B2ConsentState;
  readonly outcome: B2ConsentOutcome;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.consent.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-CONSENT-AUTHORITY';
  readonly contractVersion: 1;
}

export interface B2ConsentFailureV1 {
  readonly code: B2ConsentFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2ConsentReplaySafeResultV1 {
  readonly decision: B2ConsentDecisionV1 | null;
  readonly failure: B2ConsentFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2ConsentCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2ConsentFailureV1 | null;
}

export interface B2ConsentConsumerPortsV1 {
  readonly contractName: B2ConsentContractName;
  readonly contractVersion: B2ConsentContractVersion;
  readonly idempotencyScope: 'b2.consent.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}

export interface B2ConsentTransitionRequestV1 {
  readonly consentReference: string;
  readonly targetState: B2ConsentState;
  readonly causationId: string;
  readonly requestContext: RequestContext;
}
