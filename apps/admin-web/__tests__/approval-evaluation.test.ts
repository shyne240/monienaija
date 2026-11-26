import {
  ApprovalRecord,
  describeDecisionHistory,
  describeExpiry,
  describeProposedChange,
  describeRequiredAuthority,
  evaluateApproval,
  formatInstant,
} from '../src/utils/approval-evaluation';

/**
 * Arena B9 — approval evaluation rules.
 *
 * These assertions describe how the Approvals workspace INTERPRETS an approval record. The server
 * remains the authority on whether a decision is accepted; every rule here mirrors a state the
 * server can actually return (`PrivilegedActionApprovalStatus`) so the screen cannot invent one.
 */

const base = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: '00000000-0000-4000-8000-0000000000b9',
  actionType: 'FEE_RULE_MODIFY',
  resourceType: 'FEE_RULE',
  resourceId: 'fee-1',
  requesterPrincipalId: 'maker',
  approvedBy: null,
  reason: 'Align transfer fee with the approved schedule',
  approvalScope: 'fee_rule.modify',
  requiredAssurance: 'MFA',
  policy: { requestDetails: { feeRuleId: 'fee-1', newAmountMinor: '2500' } },
  status: 'REQUESTED',
  requestedAt: '2026-11-20T09:00:00.000Z',
  expiresAt: '2099-11-20T10:00:00.000Z',
  approvedAt: null,
  rejectedAt: null,
  cancelledAt: null,
  consumedAt: null,
  version: 1,
  authority: {
    approvingRoles: ['FINANCE_CONTROLLER'],
    approvingFunctions: ['fee_rule.modify'],
    minimumApprovals: 1,
    selfApprovalProhibited: true,
    minimumAssurance: 'MFA',
    approvalScope: 'fee_rule.modify',
    governed: true,
  },
  ...overrides,
});

const NOW = new Date('2026-11-21T12:00:00.000Z');

describe('evaluateApproval', () => {
  it('offers a live request raised by someone else to the checker', () => {
    const result = evaluateApproval(base(), NOW, 'checker');
    expect(result.state).toBe('PENDING_DECISION');
    expect(result.canDecide).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('refuses to offer the requester their own request (maker-checker separation)', () => {
    const result = evaluateApproval(base(), NOW, 'maker');
    expect(result.state).toBe('SELF_APPROVAL_BLOCKED');
    expect(result.canDecide).toBe(false);
    expect(result.blockedReason).toMatch(/Self-approval is prohibited/);
  });

  it.each([
    ['CONSUMED', 'APPLIED'],
    ['REJECTED', 'REJECTED'],
    ['CANCELLED', 'CANCELLED'],
    ['EXPIRED', 'STALE'],
    ['APPROVED', 'APPROVED_NOT_APPLIED'],
    ['EMERGENCY_ACTIVE', 'EMERGENCY_ACTIVE'],
    ['EMERGENCY_REVOKED', 'EMERGENCY_REVOKED'],
  ])('maps status %s to %s and never makes it decidable', (status, expected) => {
    const result = evaluateApproval(
      base({
        status,
        approvedBy: status === 'REQUESTED' ? null : 'checker',
        approvedAt:
          status === 'APPROVED' || status === 'CONSUMED' ? '2026-11-21T10:00:00.000Z' : null,
        rejectedAt: status === 'REJECTED' ? '2026-11-21T10:00:00.000Z' : null,
        cancelledAt: status === 'CANCELLED' ? '2026-11-21T10:00:00.000Z' : null,
        consumedAt: status === 'CONSUMED' ? '2026-11-21T10:05:00.000Z' : null,
      }),
      NOW,
      'checker',
    );
    expect(result.state).toBe(expected);
    expect(result.canDecide).toBe(false);
  });

  it('treats a request whose expiry has passed as stale even before the server flips the status', () => {
    const result = evaluateApproval(
      base({ expiresAt: '2026-11-21T11:59:00.000Z' }),
      NOW,
      'checker',
    );
    expect(result.state).toBe('STALE');
    expect(result.canDecide).toBe(false);
    expect(result.explanation).toMatch(/refuse both the decision and any execution/);
  });

  it('treats an approved request that expired before execution as stale, not applied', () => {
    const result = evaluateApproval(
      base({
        status: 'APPROVED',
        approvedBy: 'checker',
        approvedAt: '2026-11-20T10:00:00.000Z',
        expiresAt: '2026-11-20T10:30:00.000Z',
      }),
      NOW,
      'checker',
    );
    expect(result.state).toBe('STALE');
    expect(result.appliedAt).toBeNull();
  });

  it('names the applying workflow for an approved-but-unapplied request', () => {
    const result = evaluateApproval(
      base({ status: 'APPROVED', approvedBy: 'checker', approvedAt: '2026-11-21T10:00:00.000Z' }),
      NOW,
      'other-checker',
    );
    expect(result.state).toBe('APPROVED_NOT_APPLIED');
    expect(result.explanation).toMatch(/must execute the approved change/);
    expect(result.decidedBy).toBe('checker');
    expect(result.decidedAt).toBe('2026-11-21T10:00:00.000Z');
  });

  it('states that an applied request is already in effect and cannot be applied twice', () => {
    const result = evaluateApproval(
      base({
        status: 'CONSUMED',
        approvedBy: 'checker',
        approvedAt: '2026-11-21T10:00:00.000Z',
        consumedAt: '2026-11-21T10:05:00.000Z',
      }),
      NOW,
      'checker',
    );
    expect(result.state).toBe('APPLIED');
    expect(result.appliedAt).toBe('2026-11-21T10:05:00.000Z');
    expect(result.explanation).toMatch(/cannot apply it twice/);
  });

  it('does not silently treat an unrecognised status as pending', () => {
    const result = evaluateApproval(base({ status: 'SOMETHING_NEW' }), NOW, 'checker');
    expect(result.state).toBe('UNKNOWN');
    expect(result.canDecide).toBe(false);
  });
});

describe('describeRequiredAuthority', () => {
  it('reports the server authority projection as-is', () => {
    const authority = describeRequiredAuthority(base());
    expect(authority).toMatchObject({
      roles: ['FINANCE_CONTROLLER'],
      functions: ['fee_rule.modify'],
      assurance: 'MFA',
      minimumApprovals: 1,
      approvalScope: 'fee_rule.modify',
      resolved: true,
    });
    expect(authority.separation).toMatch(/different principals/);
  });

  it('admits when the server could not resolve a rule instead of guessing one', () => {
    const authority = describeRequiredAuthority(base({ authority: null }));
    expect(authority.resolved).toBe(false);
    expect(authority.roles).toEqual([]);
  });
});

describe('describeProposedChange / describeAffectedRecords', () => {
  it('renders scalar request details and the requester reason', () => {
    const rows = describeProposedChange(base());
    expect(rows).toContainEqual({ label: 'Fee Rule Id', value: 'fee-1' });
    expect(rows).toContainEqual({ label: 'New Amount Minor', value: '2500' });
    expect(rows).toContainEqual({
      label: 'Requester reason',
      value: 'Align transfer fee with the approved schedule',
    });
  });

  it('never prints a credential-shaped field value', () => {
    const rows = describeProposedChange(
      base({ policy: { requestDetails: { accountNumber: '0123456789' } } }),
    );
    expect(rows).toContainEqual({ label: 'Account Number', value: '—' });
  });

  it('summarises nested detail rather than flattening it into a misleading scalar', () => {
    const rows = describeProposedChange(
      base({ policy: { requestDetails: { window: { from: 'a', to: 'b' } } } }),
    );
    expect(rows[0]).toEqual({ label: 'Window', value: '{"from":"a","to":"b"}' });
  });
});

describe('describeDecisionHistory', () => {
  it('lists only the transitions that were actually recorded, in time order', () => {
    const history = describeDecisionHistory(
      base({
        status: 'CONSUMED',
        approvedBy: 'checker',
        approvedAt: '2026-11-21T10:00:00.000Z',
        consumedAt: '2026-11-21T10:05:00.000Z',
      }),
    );
    expect(history.map((entry) => entry.label)).toEqual(['Requested', 'Approved', 'Applied']);
    expect(history[1].actor).toBe('checker');
  });

  it('keeps a rejection distinct from an application', () => {
    const history = describeDecisionHistory(
      base({
        status: 'REJECTED',
        approvedBy: 'checker',
        rejectedAt: '2026-11-21T10:00:00.000Z',
      }),
    );
    expect(history.map((entry) => entry.label)).toEqual(['Requested', 'Rejected']);
  });
});

describe('formatInstant / describeExpiry', () => {
  it('formats instants as UTC and tolerates missing values', () => {
    expect(formatInstant('2026-11-21T10:00:00.000Z')).toBe('2026-11-21 10:00:00Z');
    expect(formatInstant(null)).toBe('—');
  });

  it('reports remaining life without authorising anything', () => {
    expect(describeExpiry(base({ expiresAt: '2026-11-21T12:30:00.000Z' }), NOW)).toBe('30m left');
    expect(describeExpiry(base({ expiresAt: '2026-11-21T11:00:00.000Z' }), NOW)).toBe('expired');
    expect(describeExpiry(base({ expiresAt: '2026-11-24T12:00:00.000Z' }), NOW)).toBe('3d left');
  });
});
