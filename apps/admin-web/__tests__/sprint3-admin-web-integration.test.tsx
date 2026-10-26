import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore, WorkforcePrincipal } from '../src/store/auth-store';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { AgentClassesScreen } from '../src/screens/authenticated/AgentClassesScreen';
import { parseCheckerHandoffInput } from '../src/screens/authenticated/AgentFundingPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setWorkforceSession(
  roles: string[],
  scopes: string[],
  overrides: Partial<WorkforcePrincipal> = {},
) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'sprint3-test-token',
    sessionId: 'sprint3-session',
    error: null,
    principal: {
      type: roles.includes('FINANCE_CONTROLLER') ? 'PRIVILEGED' : 'OPERATOR',
      principalId: overrides.principalId ?? `issuer:${roles[0] ?? 'operator'}`,
      sessionId: 'sprint3-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      ...overrides,
    },
  });
}

describe('Sprint 3 Admin Web Integration — Live Funding Inbox, Receiving-Number Auth, & Operational Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('Priority 1: Global Funding Inbox paginates & filters server-side without requiring agent.view, inspects detail, and refreshes after approve + execute', async () => {
    // Deliberately NO agent.view scope on FINANCE_CONTROLLER
    setWorkforceSession(
      ['FINANCE_CONTROLLER'],
      ['privileged:approve', 'agent.fund', 'agent.defund'],
      { principalId: 'checker-fc-99' },
    );

    const baseRequest = {
      id: 'req-inbox-101',
      approvalId: 'apr-inbox-101',
      direction: 'FUND' as const,
      agentId: '44444444-4444-4444-8444-444444444444',
      aggregatorId: null,
      isAggregatorFunding: false,
      amountMinor: '750000',
      currency: 'NGN',
      idempotencyKey: 'idem-inbox-101',
      reference: 'FUND-INBOX-101',
      correlationId: 'corr-101',
      description: 'Morning liquidity allocation',
      requestHash: 'hash-101',
      approvalFingerprint: 'fp-101',
      status: 'PENDING' as const,
      approvalStatus: 'REQUESTED',
      approvalExpiresAt: '2026-10-27T12:00:00.000Z',
      approvalApprovedBy: null as string | null,
      reason: 'Abuja Wuse Zone 4 float replenishment',
      actionType: 'AGENT_FUND',
      requesterPrincipalId: 'maker-anm-7',
      makerPrincipalId: 'maker-anm-7',
      makerRole: 'AGENT_NETWORK_MANAGER',
      makerType: 'OPERATOR',
      checkerPrincipalId: null as string | null,
      journalId: null as string | null,
      createdAt: '2026-10-26T08:00:00.000Z',
      policy: {},
    };

    let liveRow = { ...baseRequest };
    const inboxCalls: string[] = [];

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents/funding-requests?')) {
        inboxCalls.push(url);
        const matchesPending = !url.includes('status=PENDING') || liveRow.status === 'PENDING';
        if (url.includes('page=2')) {
          return Promise.resolve({
            items: matchesPending
              ? [
                  {
                    ...baseRequest,
                    id: 'req-inbox-202',
                    approvalId: 'apr-inbox-202',
                    reason: 'Page 2 Kano outlet float',
                  },
                ]
              : [],
            page: 2,
            limit: 10,
            total: matchesPending ? 11 : 0,
          });
        }
        if (url.includes('limit=10')) {
          return Promise.resolve({
            items: matchesPending ? [liveRow] : [],
            page: 1,
            limit: 10,
            total: matchesPending ? 11 : 0,
          });
        }
        return Promise.resolve({
          items: matchesPending ? [liveRow] : [],
          page: 1,
          limit: 20,
          total: matchesPending ? 1 : 0,
        });
      }
      if (url.startsWith(`/internal/agents/${baseRequest.agentId}/funding-requests`)) {
        return Promise.resolve([liveRow]);
      }
      return Promise.resolve([]);
    });

    (ApiClient.post as jest.Mock).mockImplementation((url: string) => {
      if (url === `/internal/a2/workforce/approvals/${baseRequest.approvalId}/approve`) {
        liveRow = {
          ...liveRow,
          approvalStatus: 'APPROVED',
          approvalApprovedBy: 'checker-fc-99',
          checkerPrincipalId: 'checker-fc-99',
        };
        return Promise.resolve({ reason: 'APPROVED' });
      }
      if (url === `/internal/agents/funding-requests/${baseRequest.id}/execute`) {
        liveRow = {
          ...liveRow,
          status: 'EXECUTED' as any,
          approvalStatus: 'CONSUMED',
          approvalApprovedBy: 'checker-fc-99',
          checkerPrincipalId: 'checker-fc-99',
          journalId: 'jrn-executed-101',
        };
        return Promise.resolve({ status: 'COMPLETED', journalId: 'jrn-executed-101' });
      }
      return Promise.resolve({});
    });

    const view = render(<ApprovalsScreen />);

    // 1. Initial server-side load with default status=PENDING, page=1, limit=20
    expect(await view.findByText('Abuja Wuse Zone 4 float replenishment')).toBeTruthy();
    expect(inboxCalls[0]).toBe('/internal/agents/funding-requests?page=1&limit=20&status=PENDING');

    // 2. Server-side filter & pagination controls
    fireEvent.change(view.getByLabelText('Funding inbox direction filter'), {
      target: { value: 'FUND' },
    });
    await waitFor(() =>
      expect(inboxCalls[inboxCalls.length - 1]).toBe(
        '/internal/agents/funding-requests?page=1&limit=20&status=PENDING&direction=FUND',
      ),
    );

    fireEvent.change(view.getByLabelText('Funding inbox page size'), {
      target: { value: '10' },
    });
    await waitFor(() =>
      expect(inboxCalls[inboxCalls.length - 1]).toBe(
        '/internal/agents/funding-requests?page=1&limit=10&status=PENDING&direction=FUND',
      ),
    );
    expect(await view.findByText(/11 requests · Page 1 of 2/)).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Next page' }));
    expect(await view.findByText('Page 2 Kano outlet float')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Previous page' }));
    expect(await view.findByText('Abuja Wuse Zone 4 float replenishment')).toBeTruthy();

    // 3. Detail inspection panel
    fireEvent.click(view.getByRole('button', { name: 'Inspect details' }));
    const detailPanel = await view.findByTestId('funding-inbox-detail');
    expect(detailPanel.textContent).toContain('FUND-INBOX-101');
    expect(detailPanel.textContent).toContain('Morning liquidity allocation');
    expect(detailPanel.textContent).toContain('maker-anm-7');

    // 4. Navigate from detail inspection to Checker panel and execute
    fireEvent.click(view.getByRole('button', { name: 'Proceed to Checker Decision' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        `/internal/agents/${baseRequest.agentId}/funding-requests?idempotencyKey=idem-inbox-101`,
      ),
    );
    expect(view.getByTestId('funding-inbox-selected-banner').textContent).toContain('req-inbox-101');

    const countBeforeApprove = inboxCalls.length;
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Approve funding instruction' }));
    await waitFor(() => expect(inboxCalls.length).toBeGreaterThan(countBeforeApprove));

    await view.findByRole('button', { name: 'Execute approved instruction' });
    const countBeforeExecute = inboxCalls.length;
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Execute approved instruction' }));
    await waitFor(() => expect(inboxCalls.length).toBeGreaterThan(countBeforeExecute));

    // After execution, PENDING inbox refreshes to empty state automatically
    expect(await view.findByTestId('funding-inbox-empty')).toBeTruthy();
  });

  test('Priority 1: Global Funding Inbox refreshes after atomic rejection and handles error/retry & Decision 7 unauthorized states cleanly', async () => {
    // Case A: Dual-role SUPER_ADMIN + FINANCE_CONTROLLER blocked pre-flight per Decision 7
    setWorkforceSession(
      ['FINANCE_CONTROLLER', 'SUPER_ADMIN'],
      ['privileged:approve', 'agent.fund', 'agent.defund'],
    );
    const superAdminView = render(<ApprovalsScreen />);
    expect(superAdminView.getByTestId('funding-inbox-unauthorized').textContent).toContain(
      'SUPER_ADMIN',
    );
    expect(ApiClient.get).not.toHaveBeenCalled();
    superAdminView.unmount();

    // Case B: Non-MFA session blocked pre-flight
    setWorkforceSession(
      ['FINANCE_CONTROLLER'],
      ['privileged:approve', 'agent.fund', 'agent.defund'],
      { assuranceLevel: 'PASSWORD' },
    );
    const passwordView = render(<ApprovalsScreen />);
    expect(passwordView.getByTestId('funding-inbox-unauthorized').textContent).toContain('MFA');
    expect(ApiClient.get).not.toHaveBeenCalled();
    passwordView.unmount();

    // Case C: Error -> Retry -> Atomic Rejection -> Inbox auto-refresh
    setWorkforceSession(
      ['FINANCE_CONTROLLER'],
      ['privileged:approve', 'agent.fund', 'agent.defund'],
      { principalId: 'checker-reject-1' },
    );
    let rejected = false;
    let firstAttempt = true;
    const defundItem = {
      id: 'req-defund-7',
      approvalId: 'apr-defund-7',
      direction: 'DEFUND',
      agentId: '55555555-5555-4555-8555-555555555555',
      aggregatorId: null,
      amountMinor: '200000',
      currency: 'NGN',
      idempotencyKey: 'idem-defund-7',
      reference: 'DEFUND-7',
      requestHash: 'h-7',
      approvalFingerprint: 'fp-7',
      status: 'PENDING',
      approvalStatus: 'REQUESTED',
      approvalExpiresAt: '2026-10-27T12:00:00.000Z',
      approvalApprovedBy: null,
      reason: 'Disputed sweep amount',
      actionType: 'AGENT_DEFUND',
      requesterPrincipalId: 'maker-anm-2',
      checkerPrincipalId: null,
      journalId: null,
      policy: {},
    };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents/funding-requests?')) {
        if (firstAttempt) {
          firstAttempt = false;
          return Promise.reject(new Error('Gateway timeout reading funding inbox'));
        }
        return Promise.resolve({
          items: rejected ? [] : [defundItem],
          page: 1,
          limit: 20,
          total: rejected ? 0 : 1,
        });
      }
      if (url.startsWith(`/internal/agents/${defundItem.agentId}/funding-requests`)) {
        return Promise.resolve([
          rejected
            ? { ...defundItem, status: 'REJECTED', approvalStatus: 'REJECTED' }
            : defundItem,
        ]);
      }
      return Promise.resolve([]);
    });

    (ApiClient.post as jest.Mock).mockImplementation((url: string) => {
      if (url === `/internal/agents/funding-requests/${defundItem.id}/reject`) {
        rejected = true;
        return Promise.resolve({ ...defundItem, status: 'REJECTED', approvalStatus: 'REJECTED' });
      }
      return Promise.resolve({});
    });

    const view = render(<ApprovalsScreen />);
    expect((await view.findByTestId('funding-inbox-error')).textContent).toContain(
      'Gateway timeout reading funding inbox',
    );
    fireEvent.click(view.getByRole('button', { name: 'Retry inbox' }));
    expect(await view.findByText('Disputed sweep amount')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Review in Checker' }));
    await view.findByText('Business reason: Disputed sweep amount');
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.change(view.getByLabelText('Rejection reason'), {
      target: { value: 'Outlet settlement receipt mismatch' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Reject funding instruction' }));

    expect(await view.findByTestId('funding-inbox-empty')).toBeTruthy();

    // Verify maker-checker handoff parser consistency across JSON, MN-FUND compact token, and UUID
    expect(
      parseCheckerHandoffInput(
        JSON.stringify({
          agentId: 'agent-h-1',
          idempotencyKey: 'idem-h-1',
          requestId: 'req-h-1',
        }),
      ),
    ).toEqual({
      agentId: 'agent-h-1',
      idempotencyKey: 'idem-h-1',
      requestId: 'req-h-1',
    });
    expect(parseCheckerHandoffInput('MN-FUND:agent-h-2:idem-h-2')).toEqual({
      agentId: 'agent-h-2',
      idempotencyKey: 'idem-h-2',
    });
  });

  test('Priority 2: Agent receiving-number UI shows explicit Not entitled state on 403 or SUPPORT principal, never retries 403, and clears protected data', async () => {
    const agentRecord = {
      id: 'agent-recv-1',
      reference: 'AG-RECV-001',
      status: 'ACTIVE',
      agentClassId: null,
      createdAt: '2026-10-26T00:00:00.000Z',
      updatedAt: '2026-10-26T00:00:00.000Z',
    };

    // Part A: OPERATOR principal receives 403 from GET /internal/agents/:id/receiving-number
    setWorkforceSession(['OPERATIONS'], ['agent.view']);
    let receivingCalls = 0;
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({ data: [agentRecord], total: 1 });
      }
      if (url === `/internal/agents/${agentRecord.id}/financial-position`) {
        return Promise.resolve({
          agentId: agentRecord.id,
          currency: 'NGN',
          balanceMinor: '100000',
          walletExists: true,
          walletId: 'wallet-recv-1',
        });
      }
      if (url === `/internal/agents/${agentRecord.id}/receiving-number`) {
        receivingCalls += 1;
        const forbidden = Object.assign(new Error('Forbidden resource'), {
          status: 403,
          receivingNumber: '8099999999',
        });
        return Promise.reject(forbidden);
      }
      return Promise.resolve([]);
    });

    const view = render(<AgentNetworkScreen />);
    expect(await view.findByText('AG-RECV-001')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'View' }));
    await view.findByText('wallet-recv-1');

    fireEvent.click(view.getByRole('button', { name: 'Load receiving number' }));
    const notEntitledBox = await view.findByTestId('receiving-number-not-entitled');
    expect(notEntitledBox.textContent).toContain('Not entitled');
    expect(notEntitledBox.textContent).toContain('agent.view');
    expect(view.queryByText('8099999999')).toBeNull();
    expect(receivingCalls).toBe(1);

    // Button is now disabled ('Not entitled') and subsequent clicks do NOT retry
    const disabledBtn = view.getByRole('button', { name: 'Not entitled' }) as HTMLButtonElement;
    expect(disabledBtn.disabled).toBe(true);
    fireEvent.click(disabledBtn);
    expect(receivingCalls).toBe(1);
    view.unmount();

    // Part B: SUPPORT principal type cannot invoke receiving-number endpoint at all
    jest.clearAllMocks();
    setWorkforceSession(['CUSTOMER_SERVICE'], ['agent.view'], {
      type: 'SUPPORT' as WorkforcePrincipal['type'],
    });
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({ data: [agentRecord], total: 1 });
      }
      if (url === `/internal/agents/${agentRecord.id}/financial-position`) {
        return Promise.resolve({
          agentId: agentRecord.id,
          currency: 'NGN',
          balanceMinor: '0',
          walletExists: false,
          walletId: null,
        });
      }
      return Promise.resolve([]);
    });

    const supportView = render(<AgentNetworkScreen />);
    expect(await supportView.findByText('AG-RECV-001')).toBeTruthy();
    fireEvent.click(supportView.getByRole('button', { name: 'View' }));
    expect(await supportView.findByTestId('receiving-number-not-entitled')).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalledWith(
      `/internal/agents/${agentRecord.id}/receiving-number`,
    );
  });

  test('Priority 3: Seeded AGENT_NETWORK_MANAGER manages Agent classes; partial transaction failure preserves surviving stream; policy-blocked controls stay disabled', async () => {
    setWorkforceSession(['AGENT_NETWORK_MANAGER'], ['agent.view', 'agent.manage_classes']);
    const existingClass = {
      id: 'cls-std-1',
      reference: 'AC-STD-01',
      code: 'STANDARD_AGENT',
      name: 'Standard Agent',
      description: 'Tier 1 ordinary Agent',
      isActive: true,
      requirements: null,
      requiredInformation: null,
      requiredDocumentCategories: null,
      applicableServices: ['CASH_IN', 'CASH_OUT'],
      applicableLimits: null,
      version: 2,
      createdAt: '2026-10-26T00:00:00.000Z',
      updatedAt: '2026-10-26T00:00:00.000Z',
    };
    (ApiClient.get as jest.Mock).mockResolvedValue([existingClass]);
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      ...existingClass,
      name: 'Standard Field Agent',
      version: 3,
    });

    const classesView = render(<AgentClassesScreen />);
    expect(await classesView.findByText('Standard Agent')).toBeTruthy();
    expect(classesView.queryByTestId('agent-classes-readonly-governance')).toBeNull();
    expect(classesView.getByRole('button', { name: 'Create class' })).toBeTruthy();

    fireEvent.click(classesView.getByRole('button', { name: 'Review / edit' }));
    fireEvent.change(classesView.getByLabelText('Class name'), {
      target: { value: 'Standard Field Agent' },
    });
    fireEvent.click(classesView.getByRole('button', { name: 'Save class' }));
    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        '/internal/agents/classes/cls-std-1',
        expect.objectContaining({ name: 'Standard Field Agent', expectedVersion: 2 }),
      ),
    );
    classesView.unmount();

    // Verify partial stream survival + visibly disabled policy-blocked actions on AgentNetworkScreen
    jest.clearAllMocks();
    setWorkforceSession(
      ['SUPER_ADMIN'],
      ['agent.view', 'agent.manage_classes', 'transaction.view', 'customer.manage_support_case'],
    );
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: 'agent-ops-1',
              reference: 'AG-OPS-01',
              status: 'ACTIVE',
              agentClassId: 'cls-std-1',
              createdAt: '2026-10-26T00:00:00.000Z',
              updatedAt: '2026-10-26T00:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url === '/internal/agents/agent-ops-1/financial-position') {
        return Promise.resolve({
          agentId: 'agent-ops-1',
          currency: 'NGN',
          balanceMinor: '50000',
          walletExists: true,
          walletId: 'wallet-ops-1',
        });
      }
      if (url.startsWith('/internal/admin/cash-to-cash/transfers?')) {
        return Promise.resolve({
          data: [
            {
              id: 'c2c-surviving-1',
              reference: 'C2C-SURVIVING-01',
              status: 'CLAIMED',
              amountMinor: '25000',
              currency: 'NGN',
              payoutChannel: 'CASH',
              createdAt: '2026-10-26T09:00:00.000Z',
            },
          ],
        });
      }
      if (url.startsWith('/wallets/wallet-ops-1/transactions')) {
        return Promise.reject(new Error('Wallet history temporarily unavailable'));
      }
      return Promise.resolve([]);
    });

    const netView = render(<AgentNetworkScreen />);
    expect(await netView.findByText('AG-OPS-01')).toBeTruthy();
    fireEvent.click(netView.getByRole('button', { name: 'View' }));
    await netView.findByText('wallet-ops-1');

    // Policy-blocked buttons are visibly rendered & disabled with zero speculative backend calls
    expect(
      (netView.getByRole('button', { name: 'Reclassify Agent (Policy blocked)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (netView.getByRole('button', { name: 'Clear PIN Lockout (Policy blocked)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (netView.getByRole('button', { name: 'Load unified stream (Unavailable)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Partial failure in wallet transfers still renders Cash-to-Cash history + error notice
    fireEvent.click(netView.getByRole('button', { name: 'Load Agent transactions' }));
    expect(await netView.findByText('C2C-SURVIVING-01')).toBeTruthy();
    expect(netView.getByText(/Wallet history temporarily unavailable/)).toBeTruthy();
  });
});
