/**
 * Approval evaluation — pure, display-only derivation for the Approvals workspace.
 *
 * The server remains the only authority on whether a request may be decided, consumed or is
 * stale (`PrivilegedActionApprovalService.decide()` / `consumeInTransaction()`). These helpers only
 * describe the authoritative record the API returned, in the vocabulary a checker needs:
 * what was proposed, which records it would change, who may decide it, what already happened, and
 * whether the change has actually been applied.
 *
 * Kept free of React and of the API client so every rule below is unit-testable without a DOM.
 */

export interface ApprovalAuthority {
  approvingRoles: string[];
  approvingFunctions: string[];
  minimumApprovals: number;
  selfApprovalProhibited: boolean;
  minimumAssurance: string;
  approvalScope: string;
  governed: boolean;
}

/** The subset of `GET /internal/a2/workforce/approvals` the workspace reads. */
export interface ApprovalRecord {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  customerId?: string | null;
  requesterPrincipalId: string;
  approvedBy: string | null;
  reason?: string;
  approvalScope: string;
  requiredAssurance: string;
  policy?: Readonly<Record<string, unknown>> | null;
  status: string;
  isEmergency?: boolean;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  consumedAt: string | null;
  version?: number;
  authority?: ApprovalAuthority | null;
}

export interface ApprovalRecordPage {
  items: ApprovalRecord[];
  total: number;
}

export type ApprovalEvaluationState =
  | 'PENDING_DECISION'
  | 'STALE'
  | 'APPROVED_NOT_APPLIED'
  | 'APPLIED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SELF_APPROVAL_BLOCKED'
  | 'EMERGENCY_ACTIVE'
  | 'EMERGENCY_REVOKED'
  | 'UNKNOWN';

export interface ApprovalEvaluation {
  state: ApprovalEvaluationState;
  label: string;
  tone: 'pending' | 'success' | 'danger' | 'warning' | 'neutral';
  /** One sentence a checker can act on. Always explains WHY, never just a status word. */
  explanation: string;
  /** Whether the current principal may submit a decision from this screen. */
  canDecide: boolean;
  /** Why a decision is blocked, when it is. `null` when `canDecide` is true. */
  blockedReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  expiresAt: string;
}

const stateLabel: Record<ApprovalEvaluationState, string> = {
  PENDING_DECISION: 'Awaiting decision',
  STALE: 'Stale — expired',
  APPROVED_NOT_APPLIED: 'Approved — not yet applied',
  APPLIED: 'Approved — applied',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  SELF_APPROVAL_BLOCKED: 'Your own request',
  EMERGENCY_ACTIVE: 'Emergency access active',
  EMERGENCY_REVOKED: 'Emergency access revoked',
  UNKNOWN: 'Unrecognised status',
};

const stateTone: Record<ApprovalEvaluationState, ApprovalEvaluation['tone']> = {
  PENDING_DECISION: 'pending',
  STALE: 'warning',
  APPROVED_NOT_APPLIED: 'success',
  APPLIED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  SELF_APPROVAL_BLOCKED: 'warning',
  EMERGENCY_ACTIVE: 'warning',
  EMERGENCY_REVOKED: 'neutral',
  UNKNOWN: 'warning',
};

const isPast = (value: string | null | undefined, now: Date): boolean => {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now.getTime();
};

/**
 * Evaluate one authoritative approval record.
 *
 * Precedence matters and mirrors the server's terminal-state handling: an applied (CONSUMED)
 * request can never be decided again; a rejected/cancelled request is terminal; a pending or
 * approved request whose expiry has passed is stale (the service reports `EXPIRED` and refuses
 * both decision and consumption); only a live REQUESTED record made by a different principal is
 * decidable here.
 */
export function evaluateApproval(
  record: ApprovalRecord,
  now: Date,
  currentPrincipalId: string | undefined,
): ApprovalEvaluation {
  const status = String(record.status ?? '').toUpperCase();
  const decidedBy = record.approvedBy ?? null;
  const decidedAt =
    status === 'REJECTED'
      ? record.rejectedAt
      : status === 'APPROVED' || status === 'CONSUMED'
        ? record.approvedAt
        : null;

  const base = {
    expiresAt: record.expiresAt,
    decidedBy,
    decidedAt,
    appliedAt: record.consumedAt ?? null,
  };

  const evaluation = (
    state: ApprovalEvaluationState,
    explanation: string,
    canDecide = false,
    blockedReason: string | null = null,
  ): ApprovalEvaluation => ({
    ...base,
    state,
    label: stateLabel[state],
    tone: stateTone[state],
    explanation,
    canDecide,
    blockedReason,
  });

  if (status === 'CONSUMED') {
    return evaluation(
      'APPLIED',
      `Approved${decidedBy ? ` by ${decidedBy}` : ''} and applied${
        record.consumedAt ? ` at ${formatInstant(record.consumedAt)}` : ''
      }. The change is already in effect — deciding again cannot apply it twice.`,
    );
  }
  if (status === 'REJECTED') {
    return evaluation(
      'REJECTED',
      `Rejected${decidedBy ? ` by ${decidedBy}` : ''}${
        record.rejectedAt ? ` at ${formatInstant(record.rejectedAt)}` : ''
      }. Terminal: the change was not applied and cannot be decided again.`,
    );
  }
  if (status === 'CANCELLED') {
    return evaluation(
      'CANCELLED',
      `Withdrawn by the requester${
        record.cancelledAt ? ` at ${formatInstant(record.cancelledAt)}` : ''
      }. Nothing was applied and no decision is possible.`,
    );
  }
  if (status === 'EXPIRED') {
    return evaluation(
      'STALE',
      'Expired before a decision. The service refuses a decision on an expired request; the change must be re-proposed.',
    );
  }
  if (status === 'EMERGENCY_ACTIVE') {
    return evaluation(
      'EMERGENCY_ACTIVE',
      'Emergency access window is active. It is revoked through the recovery controls, not decided here.',
    );
  }
  if (status === 'EMERGENCY_REVOKED') {
    return evaluation('EMERGENCY_REVOKED', 'Emergency access window was revoked.');
  }
  if (status === 'REQUESTED' || status === 'APPROVED') {
    if (isPast(record.expiresAt, now)) {
      return evaluation(
        'STALE',
        'The expiry time has passed. The service will report this request as expired and refuse both the decision and any execution — re-propose the change instead of deciding it here.',
      );
    }
  }
  if (status === 'APPROVED') {
    return evaluation(
      'APPROVED_NOT_APPLIED',
      `Approved${decidedBy ? ` by ${decidedBy}` : ''}${
        record.approvedAt ? ` at ${formatInstant(record.approvedAt)}` : ''
      }, but not applied yet. The owning workflow must execute the approved change; this decision cannot be repeated.`,
    );
  }
  if (status === 'REQUESTED') {
    if (
      currentPrincipalId &&
      record.requesterPrincipalId &&
      record.requesterPrincipalId === currentPrincipalId
    ) {
      return evaluation(
        'SELF_APPROVAL_BLOCKED',
        'You raised this request. Maker-checker separation forbids you from checking it — an independent checker must decide.',
        false,
        'Self-approval is prohibited by the server, so this request cannot be decided from your session.',
      );
    }
    if (record.authority?.selfApprovalProhibited && !record.authority.approvingRoles.length) {
      return evaluation(
        'PENDING_DECISION',
        'Awaiting an independent checker decision. The required approving role could not be resolved, so confirm the policy with the owning team before acting.',
      );
    }
    return evaluation(
      'PENDING_DECISION',
      'Awaiting an independent checker decision. Approving records the decision only; the owning workflow applies the change.',
      true,
    );
  }
  return evaluation(
    'UNKNOWN',
    `Unrecognised approval status "${record.status}". Do not act until an authorized operator confirms the record.`,
  );
}

/**
 * Human description of the authority a decision requires, derived from the server's own
 * `authority` projection (the same rule the decide path enforces). Returns `null` only when the
 * server could not resolve a rule — which is itself shown, never hidden.
 */
export function describeRequiredAuthority(record: ApprovalRecord): {
  roles: string[];
  functions: string[];
  assurance: string;
  minimumApprovals: number;
  approvalScope: string;
  separation: string;
  resolved: boolean;
} {
  const authority = record.authority;
  return {
    roles: authority?.approvingRoles ?? [],
    functions: authority?.approvingFunctions ?? [],
    assurance: authority?.minimumAssurance ?? record.requiredAssurance,
    minimumApprovals: authority?.minimumApprovals ?? 1,
    approvalScope: authority?.approvalScope ?? record.approvalScope,
    separation:
      authority?.selfApprovalProhibited === false
        ? 'Maker and checker may be the same principal for this action.'
        : 'Maker and checker must be different principals (self-approval refused by the server).',
    resolved: Boolean(authority),
  };
}

const SENSITIVE_KEY = /(token|secret|password|hash|otp|pin|accountnumber|bvn|nin|card)/i;

const labelFor = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase());

/**
 * The proposed change as a flat list of fields for the checker.
 *
 * `policy.requestDetails` is the frozen, already-redacted business payload the maker submitted
 * (the server redacts it at write time and again for readers without the approving functions).
 * Only scalar values are rendered; nested structures are summarised as JSON so nothing is silently
 * misrepresented as a single value.
 */
export function describeProposedChange(
  record: ApprovalRecord,
): Array<{ label: string; value: string }> {
  const details = record.policy?.requestDetails;
  const rows: Array<{ label: string; value: string }> = [];
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') {
        rows.push({ label: labelFor(key), value: JSON.stringify(value) });
      } else {
        rows.push({ label: labelFor(key), value: SENSITIVE_KEY.test(key) ? '—' : String(value) });
      }
    }
  }
  if (record.reason) rows.push({ label: 'Requester reason', value: record.reason });
  return rows;
}

/** The records the decision would affect, named as the approval binds them. */
export function describeAffectedRecords(
  record: ApprovalRecord,
): Array<{ label: string; value: string }> {
  const rows = [
    { label: 'Resource type', value: record.resourceType || '—' },
    { label: 'Resource id', value: record.resourceId || '—' },
  ];
  if (record.customerId) rows.push({ label: 'Customer id', value: record.customerId });
  return rows;
}

/** Lifecycle entries that actually happened, oldest first — the recorded decision history. */
export function describeDecisionHistory(
  record: ApprovalRecord,
): Array<{ label: string; at: string; actor: string | null; detail: string }> {
  const entries: Array<{ label: string; at: string; actor: string | null; detail: string }> = [
    {
      label: 'Requested',
      at: record.requestedAt,
      actor: record.requesterPrincipalId,
      detail: 'Frozen request recorded with its fingerprint and expiry.',
    },
  ];
  if (record.approvedAt) {
    entries.push({
      label: 'Approved',
      at: record.approvedAt,
      actor: record.approvedBy ?? null,
      detail: 'Independent checker decision recorded.',
    });
  }
  if (record.rejectedAt) {
    entries.push({
      label: 'Rejected',
      at: record.rejectedAt,
      actor: record.approvedBy ?? null,
      detail: 'Independent checker rejected the proposed change.',
    });
  }
  if (record.cancelledAt) {
    entries.push({
      label: 'Cancelled',
      at: record.cancelledAt,
      actor: record.requesterPrincipalId,
      detail: 'Withdrawn before a decision.',
    });
  }
  if (record.consumedAt) {
    entries.push({
      label: 'Applied',
      at: record.consumedAt,
      actor: record.approvedBy ?? null,
      detail: 'The approved change was consumed by its owning workflow.',
    });
  }
  return entries
    .filter((entry) => Boolean(entry.at))
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

export function formatInstant(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().replace('T', ' ').replace('.000Z', 'Z')
    : '—';
}

/** Compact countdown used on the inbox rows; never used to authorise anything. */
export function describeExpiry(record: ApprovalRecord, now: Date): string {
  const expiry = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiry)) return 'expiry unknown';
  const delta = expiry - now.getTime();
  if (delta <= 0) return 'expired';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m left`;
  return `${Math.floor(hours / 24)}d left`;
}
