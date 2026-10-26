import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { AgentFundingPanel } from '../src/screens/authenticated/AgentFundingPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const REQUEST_ID = 'request-1';
const APPROVAL_ID = 'approval-1';
const IDEMPOTENCY_KEY = 'funding-idempotency-1';
const JOURNAL_ID = 'journal-1';

function fundingRequest(approvalStatus: string, status = 'PENDING') {
  return {
    id: REQUEST_ID,
    approvalId: APPROVAL_ID,
    direction: 'FUND',
    agentId: 'agent-1',
    aggregatorId: null,
    amountMinor: '12500',
    currency: 'NGN',
    idempotencyKey: IDEMPOTENCY_KEY,
    reference: 'FUND-001',
    requestHash: 'request-hash',
    approvalFingerprint: 'approval-fingerprint',
    status,
    approvalStatus,
    approvalExpiresAt: '2026-10-26T10:00:00.000Z',
    approvalApprovedBy: ['APPROVED', 'CONSUMED'].includes(approvalStatus) ? 'checker-1' : null,
    reason: 'Liquidity allocation',
    actionType: 'AGENT_FUND',
    requesterPrincipalId: 'maker-1',
    checkerPrincipalId: ['APPROVED', 'CONSUMED'].includes(approvalStatus) ? 'checker-1' : null,
    journalId: approvalStatus === 'CONSUMED' ? JOURNAL_ID : null,
    policy: { requestDetails: { reason: 'Liquidity allocation' } },
  };
}

function setPrincipal(role: 'AGENT_NETWORK_MANAGER' | 'FINANCE_CONTROLLER', principalId: string, scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles: [role],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Agent funding maker-checker panel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({});
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => IDEMPOTENCY_KEY,
    });
  });

  test('maker persists an idempotency key before requesting independent approval', async () => {
    setPrincipal('AGENT_NETWORK_MANAGER', 'maker-1', ['agent.fund', 'agent.defund']);
    (ApiClient.post as jest.Mock).mockResolvedValue(fundingRequest('REQUESTED'));
    const view = render(<AgentFundingPanel agentId="agent-1" />);

    fireEvent.change(view.getByLabelText('Funding amount in kobo'), { target: { value: '12500' } });
    fireEvent.change(view.getByLabelText('Funding reason'), { target: { value: 'Liquidity allocation' } });
    fireEvent.click(view.getByRole('button', { name: 'Request independent approval' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/agent-1/fund-request', {
        amountMinor: '12500',
        currency: 'NGN',
        idempotencyKey: IDEMPOTENCY_KEY,
        reason: 'Liquidity allocation',
      });
      expect(view.getByRole('status').textContent).toContain('Await an independent checker');
    });
    const saved = JSON.parse(localStorage.getItem('monienaija.agent-funding.v1:maker-1:agent-1') ?? 'null');
    expect(saved.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(saved.amountMinor).toBe('12500');
  });

  test('checker requires a review, executes only the approved request, and recovers the same journal after uncertainty', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([fundingRequest('REQUESTED')])
      .mockResolvedValueOnce([fundingRequest('APPROVED')])
      .mockResolvedValueOnce([fundingRequest('CONSUMED', 'EXECUTED')])
      .mockResolvedValueOnce([fundingRequest('CONSUMED', 'EXECUTED')]);
    let executionCount = 0;
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/approve')) return Promise.resolve({ reason: 'APPROVED' });
      if (path.endsWith('/execute')) {
        executionCount += 1;
        return Promise.resolve({ status: executionCount === 1 ? 'COMPLETED' : 'REPLAYED', journalId: JOURNAL_ID });
      }
      return Promise.resolve({});
    });

    const view = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button', { name: 'Load funding instructions' }));
    const pendingRow = await view.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*REQUESTED`) });
    fireEvent.click(pendingRow);
    await view.findByText('Business reason: Liquidity allocation');
    const review = view.getByLabelText('I reviewed this Agent, amount, direction and business reason');
    expect((view.getByRole('button', { name: 'Approve funding instruction' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(review);
    fireEvent.click(view.getByRole('button', { name: 'Approve funding instruction' }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith(
      `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
      { comment: 'Reviewed Agent, amount, direction and business reason in funding workflow' },
    ));
    await view.findByRole('button', { name: 'Execute approved instruction' });
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Execute approved instruction' }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith(
      `/internal/agents/funding-requests/${REQUEST_ID}/execute`,
      {},
    ));
    await view.findByRole('button', { name: 'Recover posted result' });
    expect(view.getByText(`Journal reference: ${JOURNAL_ID}`)).toBeTruthy();
    const recoveryReview = view.getByLabelText('I reviewed this Agent, amount, direction and business reason');
    await waitFor(() => expect((recoveryReview as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(recoveryReview);
    await waitFor(() =>
      expect((view.getByRole('button', { name: 'Recover posted result' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(view.getByRole('button', { name: 'Recover posted result' }));

    await waitFor(() => {
      expect(executionCount).toBe(2);
      expect(view.getByRole('status').textContent).toContain(`REPLAYED: journal ${JOURNAL_ID}`);
    });
  });

  test('checker rejects through the atomic funding-request route with a required reason', async () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-2', ['agent.fund']);
    const rejected = fundingRequest('REJECTED', 'REJECTED');
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce([fundingRequest('REQUESTED')])
      .mockResolvedValueOnce([rejected]);
    (ApiClient.post as jest.Mock).mockImplementation((path: string) =>
      path === `/internal/agents/funding-requests/${REQUEST_ID}/reject`
        ? Promise.resolve(rejected)
        : Promise.resolve({}),
    );

    const view = render(<AgentFundingPanel agentId="agent-1" />);
    fireEvent.click(view.getByRole('button', { name: 'Load funding instructions' }));
    fireEvent.click(await view.findByRole('button', { name: new RegExp(`${REQUEST_ID}.*REQUESTED`) }));
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));

    const reject = view.getByRole('button', { name: 'Reject funding instruction' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Funding rejection reason'), {
      target: { value: 'Duplicate funding instruction' },
    });
    fireEvent.click(reject);

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/agents/funding-requests/${REQUEST_ID}/reject`,
        { reason: 'Duplicate funding instruction' },
      ),
    );
    expect(ApiClient.post).not.toHaveBeenCalledWith(
      `/internal/a2/workforce/approvals/${APPROVAL_ID}/reject`,
      expect.anything(),
    );
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('Decision confirmed: REJECTED'));
  });

  test('non-entitled roles and non-MFA sessions do not see funding actions', () => {
    setPrincipal('FINANCE_CONTROLLER', 'checker-2', ['ledger.view']);
    const denied = render(<AgentFundingPanel agentId="agent-1" />);
    expect(denied.queryByLabelText('Agent funding workflow')).toBeNull();
    denied.unmount();

    setPrincipal('FINANCE_CONTROLLER', 'checker-1', ['agent.fund']);
    useAuthStore.setState((state) => ({ ...state, principal: state.principal ? { ...state.principal, assuranceLevel: 'PASSWORD' } : null }));
    const noMfa = render(<AgentFundingPanel agentId="agent-1" />);
    expect(noMfa.getByRole('alert').textContent).toMatch(/MFA/i);
    expect((noMfa.getByRole('button', { name: 'Load funding instructions' }) as HTMLButtonElement).disabled).toBe(true);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});
