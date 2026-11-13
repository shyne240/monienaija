import type { StatusTone } from '../../design-system/primitives';
import type {
  AffiliationStatus,
  EnrolmentStatus,
  InstitutionStatus,
} from '../../services/institution-admin-api';

/**
 * ARENA 4 Phase 3 — presentation helpers for the institutional administration console.
 *
 * Presentation only: function-code checks mirror the catalogue so the UI can hide actions the
 * backend would refuse, but the backend guard remains the only authority. Nothing here infers an
 * institutional affiliation, an eligibility or an approval outcome.
 */

export const INSTITUTION_FUNCTIONS = {
  view: 'institution.view',
  manage: 'institution.manage',
  lifecyclePrepare: 'institution.lifecycle.prepare',
  lifecycleApprove: 'institution.lifecycle.approve',
  affiliationPrepare: 'institution.affiliation.prepare',
  affiliationApprove: 'institution.affiliation.approve',
  workforceAssign: 'institution.workforce.assign',
  attributionView: 'institution.attribution.view',
  attributionPrepare: 'institution.attribution.prepare',
  attributionApprove: 'institution.attribution.approve',
  enrolmentPrepare: 'institution.enrolment.prepare',
  enrolmentApprove: 'institution.enrolment.approve',
  auditSearch: 'audit.search',
  privilegedApprove: 'privileged:approve',
} as const;

/** Approving function required by each governed action's independent checker step. */
export const APPROVING_FUNCTION_BY_ACTION: Record<string, string> = {
  FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE: INSTITUTION_FUNCTIONS.lifecycleApprove,
  INSTITUTION_AGENT_AFFILIATION_CHANGE: INSTITUTION_FUNCTIONS.affiliationApprove,
  WALLET_INSTITUTION_ATTRIBUTION: INSTITUTION_FUNCTIONS.attributionApprove,
  CUSTOMER_INSTITUTION_ENROLMENT_CHANGE: INSTITUTION_FUNCTIONS.enrolmentApprove,
};

export const ACTION_LABELS: Record<string, string> = {
  FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE: 'Institution lifecycle change',
  INSTITUTION_AGENT_AFFILIATION_CHANGE: 'Agent institutional affiliation change',
  WALLET_INSTITUTION_ATTRIBUTION: 'Wallet institution attribution',
  CUSTOMER_INSTITUTION_ENROLMENT_CHANGE: 'Customer institution enrolment change',
};

export const STATUS_TONES: Record<InstitutionStatus, StatusTone> = {
  REGISTERED: 'neutral',
  EVIDENCE_SUBMITTED: 'info',
  APPROVED: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'danger',
};

export const ENROLMENT_TONES: Record<EnrolmentStatus, StatusTone> = {
  PENDING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'neutral',
};

export const ELIGIBILITY_TONES: Record<string, StatusTone> = {
  PENDING_KYC: 'warning',
  ELIGIBLE: 'success',
  RESTRICTED: 'danger',
};

export const AFFILIATION_TONES: Record<AffiliationStatus, StatusTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  TERMINATED: 'danger',
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  INSTITUTION_AFFILIATED: 'Institution-affiliated',
  AGGREGATOR_LINKED: 'Aggregator-linked (not an institutional affiliation)',
  INDEPENDENT: 'Independent (no institutional affiliation)',
};

export function hasAnyScope(scopes: readonly string[] | undefined, ...codes: string[]): boolean {
  const granted = new Set(scopes ?? []);
  return codes.some((code) => granted.has(code));
}

/** Readable timestamp; keeps the raw value when it cannot be parsed rather than inventing one. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

/** Actionable error text for a failed request; never claims success. */
export function describeError(error: unknown, fallback: string): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401) return 'Your workforce session is no longer valid. Sign in again.';
  if (status === 403)
    return `Your workforce principal is not authorized for this action. ${message}`.trim();
  if (status === 404) return 'Not found in your authorized institution scope.';
  if (status === 409) return `Refused by the server: ${message || 'the current state conflicts.'}`;
  if (status === 400) return `The request was rejected: ${message || 'check the entered values.'}`;
  return message || fallback;
}

export function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
