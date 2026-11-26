import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn(), post: jest.fn() } }));
const principal = (id: string, scopes = ['privileged:approve']) =>
  useAuthStore.setState({
    principal: {
      type: 'OPERATOR',
      principalId: id,
      sessionId: id,
      audience: 'workforce-admin',
      roles: ['FINANCE_CONTROLLER'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
beforeEach(() => {
  jest.resetAllMocks();
  principal('one');
});
test('a denied checker decision returned with HTTP success is not called approved', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({
    approved: false,
    reason: 'SELF_APPROVAL_FORBIDDEN',
    approval: { id: 'synthetic-id', status: 'REQUESTED' },
  });
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(await screen.findByText(/Decision not confirmed: SELF_APPROVAL_FORBIDDEN/)).toBeTruthy();
  expect(screen.queryByText(/Approval recorded/)).toBeNull();
});
test('a denied rejection is not confused with a recorded REJECTED decision', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({
    approved: false,
    reason: 'MFA_REQUIRED',
    approval: { id: 'synthetic-id', status: 'REQUESTED' },
  });
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(await screen.findByText(/Decision not confirmed: MFA_REQUIRED/)).toBeTruthy();
  expect(screen.queryByText('Approval decision recorded as rejected successfully.')).toBeNull();
});
test('late approval result is not presented to a different checker', async () => {
  let resolve!: (v: any) => void;
  const pending = new Promise<any>((r) => (resolve = r));
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  act(() => principal('two'));
  await act(async () => {
    resolve({
      approved: true,
      reason: 'APPROVED',
      approval: { id: 'synthetic-id', status: 'APPROVED' },
    });
    await pending;
  });
  expect(screen.queryByText(/Approval recorded/)).toBeNull();
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});
test('a new session for the same checker clears the prior decision draft', () => {
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  act(() =>
    useAuthStore.setState((state) => ({
      principal: { ...state.principal!, sessionId: 'new-session' },
    })),
  );
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});

test('reject review captures the decision and comment, traps focus and cancels without a write', () => {
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.change(screen.getByLabelText('Audit Comment / Verification Notes (Optional)'), {
    target: { value: 'reviewed' },
  });
  const trigger = screen.getByRole('button', { name: 'Reject Action' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Confirm rejection' });
  expect(dialog.textContent).toContain('synthetic-id');
  expect(dialog.textContent).toContain('reviewed');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm decision' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('review is single flight and focuses the matching receipt after success', async () => {
  let resolve!: (v: any) => void;
  const pending = new Promise<any>((r) => {
    resolve = r;
  });
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByRole('dialog'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  await act(async () => {
    resolve({
      approved: true,
      reason: 'APPROVED',
      approval: { id: 'synthetic-id', status: 'APPROVED' },
    });
    await pending;
  });
  expect(screen.getByRole('status').textContent).toContain('synthetic-id');
  expect(document.activeElement).toBe(screen.getByRole('status'));
});

test('a session change closes a pending review before submission', () => {
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  act(() => principal('two'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('read-only checker can inspect the workspace but cannot submit a decision, including after a session transition', () => {
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  act(() =>
    useAuthStore.setState((state) => ({
      principal: { ...state.principal!, readOnlyPrincipal: true },
    })),
  );
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  expect(
    (screen.getByRole('button', { name: 'Sign & Approve Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Reject Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('unconfirmed generic decisions lock that approval until an explicit external review acknowledgement', async () => {
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(
    await screen.findByText(/Decision outcome unconfirmed — re-check the record/),
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Sign & Approve Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Reject Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'other-id' },
  });
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  expect(
    (screen.getByRole('button', { name: 'Reject Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'I reviewed the approval and audit trail' }));
  expect(
    (screen.getByRole('button', { name: 'Reject Action' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

test('store session change clears generic approval draft even if principal session is unchanged', () => {
  useAuthStore.setState({ sessionId: 'old' });
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'synthetic-id' },
  });
  act(() => useAuthStore.setState({ sessionId: 'new' }));
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});

test('unconfirmed decisions remain guarded when a different ID is entered and warn on browser unload', async () => {
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  const report = jest.fn();
  render(<ApprovalsScreen onApprovalGuardChange={report} />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'id-one' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText(/Decision outcome unconfirmed — re-check the record/);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'id-two' },
  });
  expect(report).toHaveBeenLastCalledWith(true, false);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'id-one' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'I reviewed the approval and audit trail' }));
  expect(report).toHaveBeenLastCalledWith(true, false);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), { target: { value: '' } });
  expect(report).toHaveBeenLastCalledWith(false, false);
});

test('an unconfirmed funding decision blocks generic checker decisions in the same workspace', async () => {
  const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(true);
  principal('checker', ['privileged:approve', 'agent.fund']);
  const row = {
    id: 'request-one',
    approvalId: 'approval-one',
    direction: 'FUND',
    agentId: 'agent-one',
    aggregatorId: null,
    amountMinor: '100',
    currency: 'NGN',
    idempotencyKey: 'key-one',
    reference: 'ref',
    requestHash: 'hash',
    approvalFingerprint: 'fp',
    status: 'PENDING',
    approvalStatus: 'REQUESTED',
    approvalExpiresAt: '2026-11-01',
    approvalApprovedBy: null,
    reason: 'reason',
    actionType: 'AGENT_FUND',
    requesterPrincipalId: 'maker',
    checkerPrincipalId: null,
    journalId: null,
    policy: {},
  };
  (ApiClient.get as jest.Mock).mockResolvedValue([row]);
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Funding Agent ID'), { target: { value: 'agent-one' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load funding instructions' }));
  await screen.findByRole('button', { name: /request-one.*REQUESTED/ });
  fireEvent.click(
    screen.getByLabelText('I reviewed this Agent, amount, direction and business reason'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve funding instruction' }));
  expect(await screen.findByTestId('funding-review-lock')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: 'approval-one' },
  });
  expect(
    (screen.getByRole('button', { name: 'Sign & Approve Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  confirmation.mockRestore();
});

test('CommercialApprovalInbox displays proposed parameters and executes an APPROVED commercial change', async () => {
  principal('checker', ['privileged:approve', 'fee_rule.create']);
  (ApiClient.get as jest.Mock).mockResolvedValue({
    items: [
      {
        id: 'approval-fee-1',
        actionType: 'FEE_RULE_CREATE',
        resourceType: 'FEE_RULE',
        resourceId: null,
        requesterPrincipalId: 'maker',
        approvedBy: 'checker',
        reason: 'Standard wallet transfer fee',
        approvalScope: 'privileged:approve',
        policy: {
          requestDetails: {
            productCode: 'WALLET_TRANSFER',
            currency: 'NGN',
            flatFeeMinor: '100',
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            reason: 'Standard wallet transfer fee',
          },
        },
        status: 'APPROVED',
        requestedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
        approvedAt: '2026-01-01T01:00:00.000Z',
        rejectedAt: null,
        consumedAt: null,
        version: 2,
      },
    ],
    total: 1,
  });
  (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'rule-1' });

  render(<ApprovalsScreen />);
  expect(await screen.findByText(/APPROVED \(Awaiting execution\)/)).toBeTruthy();
  expect(screen.getByText(/productCode: WALLET_TRANSFER/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Execute approved change' }));
  expect(
    await screen.findByText(/Approved change approval-fee-1 executed and consumed/),
  ).toBeTruthy();
  expect(ApiClient.post).toHaveBeenCalledWith(
    '/internal/fee-rules/changes/approval-fee-1/execute-create',
    {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      flatFeeMinor: '100',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      reason: 'Standard wallet transfer fee',
    },
  );
});

/* ------------------------------------------------------------------------------------------
 * Arena B9 — approval evaluation inbox and authoritative re-read of an unconfirmed decision.
 * ---------------------------------------------------------------------------------------- */

const INBOX_ID = '00000000-0000-4000-8000-0000000000b9';

const pendingApproval = (overrides: Record<string, any> = {}) => ({
  id: INBOX_ID,
  actionType: 'LEDGER_JOURNAL_REVERSAL',
  resourceType: 'LEDGER_JOURNAL',
  resourceId: 'journal-42',
  customerId: null,
  requesterPrincipalId: 'maker-principal',
  approvedBy: null,
  reason: 'Duplicate posting confirmed by reconciliation',
  approvalScope: 'privileged:approve',
  requiredAssurance: 'MFA',
  policy: { requestDetails: { journalReference: 'JL-42', amountMinor: '150000' } },
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
    approvingFunctions: [],
    minimumApprovals: 1,
    selfApprovalProhibited: true,
    minimumAssurance: 'MFA',
    approvalScope: 'privileged:approve',
    governed: true,
  },
  ...overrides,
});

function mockApprovalReads(list: any[], detail: any, detailError?: unknown) {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/a2/workforce/approvals?'))
      return Promise.resolve({ items: list, total: list.length });
    if (path.startsWith('/internal/a2/workforce/approvals/'))
      return detailError ? Promise.reject(detailError) : Promise.resolve(detail);
    return Promise.resolve([]);
  });
}

test('the inbox shows the proposed change, affected records, required authority and applied state', async () => {
  mockApprovalReads([pendingApproval()], pendingApproval());
  render(<ApprovalsScreen />);
  expect(await screen.findByText('LEDGER_JOURNAL_REVERSAL')).toBeTruthy();
  expect(screen.getByText('Awaiting decision')).toBeTruthy();
  expect(screen.getByText('journal-42')).toBeTruthy();
  expect(screen.getByText(/FINANCE_CONTROLLER · MFA/)).toBeTruthy();
  expect(screen.getByText('No application recorded')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Full evaluation' }));
  expect(screen.getByText('Proposed change')).toBeTruthy();
  expect(screen.getByText('Journal Reference')).toBeTruthy();
  expect(screen.getByText('JL-42')).toBeTruthy();
  expect(screen.getByText(/Maker and checker must be different principals/)).toBeTruthy();
  expect(screen.getByText(/Frozen request recorded with its fingerprint and expiry/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Load into checker decision' }));
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe(
    INBOX_ID,
  );
});

test('a request raised by the signed-in principal cannot be loaded for a decision', async () => {
  mockApprovalReads(
    [pendingApproval({ requesterPrincipalId: 'one' })],
    pendingApproval({ requesterPrincipalId: 'one' }),
  );
  render(<ApprovalsScreen />);
  expect(await screen.findByText('Your own request')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Decision blocked' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Maker-checker separation forbids you from checking it/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Decision blocked' }));
  expect((screen.getByLabelText('Pending Approval ID (UUID)') as HTMLInputElement).value).toBe('');
});

test('stale, rejected, approved-not-applied and applied requests each say what happened', async () => {
  const stale = pendingApproval({
    id: '00000000-0000-4000-8000-0000000000c1',
    status: 'REQUESTED',
    expiresAt: '2020-01-01T00:00:00.000Z',
  });
  const rejected = pendingApproval({
    id: '00000000-0000-4000-8000-0000000000c2',
    status: 'REJECTED',
    approvedBy: 'checker-two',
    rejectedAt: '2026-11-21T09:00:00.000Z',
  });
  const approved = pendingApproval({
    id: '00000000-0000-4000-8000-0000000000c3',
    status: 'APPROVED',
    approvedBy: 'checker-two',
    approvedAt: '2026-11-21T09:00:00.000Z',
  });
  const applied = pendingApproval({
    id: '00000000-0000-4000-8000-0000000000c4',
    status: 'CONSUMED',
    approvedBy: 'checker-two',
    approvedAt: '2026-11-21T09:00:00.000Z',
    consumedAt: '2026-11-21T09:05:00.000Z',
  });
  mockApprovalReads([stale, rejected, approved, applied], stale);
  render(<ApprovalsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: /All visible/ }));
  expect(screen.getByText('Stale — expired')).toBeTruthy();
  expect(screen.getByText('Rejected')).toBeTruthy();
  expect(screen.getByText('Approved — not yet applied')).toBeTruthy();
  expect(screen.getByText('Approved — applied')).toBeTruthy();
  expect(screen.getByText(/already in effect/)).toBeTruthy();
  expect(screen.getByText(/not applied yet/)).toBeTruthy();
  expect(screen.getByText(/Yes — applied/)).toBeTruthy();
  const nonDecidable = screen.getAllByRole('button', { name: 'No decision possible' });
  expect(nonDecidable.length).toBeGreaterThan(0);
  for (const button of nonDecidable) expect((button as HTMLButtonElement).disabled).toBe(true);
});

test('an unreadable inbox is reported and never presented as an empty authoritative inbox', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/a2/workforce/approvals?'))
      return Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
    return Promise.resolve([]);
  });
  render(<ApprovalsScreen />);
  expect(await screen.findByText(/does not hold the required authorization function/)).toBeTruthy();
  expect(screen.queryByTestId('approval-inbox-empty')).toBeNull();
});

test("re-checking an unconfirmed decision releases the lock only when the server recorded this principal's decision", async () => {
  mockApprovalReads(
    [],
    pendingApproval({
      status: 'APPROVED',
      approvedBy: 'one',
      approvedAt: '2026-11-21T09:00:00.000Z',
    }),
  );
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: INBOX_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText(/Decision outcome unconfirmed — re-check the record/);
  fireEvent.click(screen.getByRole('button', { name: 'Re-check approval state' }));
  expect(await screen.findByText(/Approval recorded/)).toBeTruthy();
  expect(screen.queryByText(/Decision outcome unconfirmed — re-check the record/)).toBeNull();
  expect(ApiClient.get).toHaveBeenCalledWith(`/internal/a2/workforce/approvals/${INBOX_ID}`);
});

test('re-checking reports the actual server state and keeps the lock when the decision was not recorded', async () => {
  mockApprovalReads([], pendingApproval({ status: 'REQUESTED' }));
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: INBOX_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText(/Decision outcome unconfirmed — re-check the record/);
  fireEvent.click(screen.getByRole('button', { name: 'Re-check approval state' }));
  expect(await screen.findByTestId('approval-recheck-result')).toBeTruthy();
  expect(screen.getByTestId('approval-recheck-result').textContent).toContain('REQUESTED');
  expect(screen.getByTestId('approval-recheck-result').textContent).toContain(
    'Awaiting an independent checker decision',
  );
  expect(
    (screen.getByRole('button', { name: 'Reject Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

test("an approval outside this session's visibility is reported as unconfirmed, not as success or absence", async () => {
  mockApprovalReads([], null, Object.assign(new Error('Approval not found'), { status: 404 }));
  (ApiClient.post as jest.Mock).mockRejectedValue(new Error('network lost'));
  render(<ApprovalsScreen />);
  fireEvent.change(screen.getByLabelText('Pending Approval ID (UUID)'), {
    target: { value: INBOX_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign & Approve Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText(/Decision outcome unconfirmed — re-check the record/);
  fireEvent.click(screen.getByRole('button', { name: 'Re-check approval state' }));
  expect(await screen.findByText(/does not expose this approval to your session/)).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Sign & Approve Action' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
