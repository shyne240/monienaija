import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore, WorkforcePrincipal } from '../src/store/auth-store';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { AgentClassesScreen } from '../src/screens/authenticated/AgentClassesScreen';
import { parseCheckerHandoffInput } from '../src/screens/authenticated/AgentFundingPanel';
import { AgentUnifiedHistoryPanel } from '../src/components/AgentUnifiedHistoryPanel';

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

    // Policy-blocked buttons are visibly rendered & disabled with zero speculative backend calls;
    // Unified history is now live and enabled via GET /internal/agents/:id/transactions
    expect(
      (netView.getByRole('button', { name: 'Reclassify Agent (Policy blocked)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (netView.getByRole('button', { name: 'Clear PIN Lockout (Policy blocked)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (netView.getByRole('button', { name: 'Load unified stream' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Partial failure in wallet transfers still renders Cash-to-Cash history + error notice
    fireEvent.click(netView.getByRole('button', { name: 'Load Agent transactions' }));
    expect(await netView.findByText('C2C-SURVIVING-01')).toBeTruthy();
    expect(netView.getByText(/Wallet history temporarily unavailable/)).toBeTruthy();
    netView.unmount();
  });

  test('Part B: AgentUnifiedHistoryPanel integrates GET /internal/agents/:id/transactions with agent.view gating, pagination, type filtering, minor-unit rendering, and 403/error/empty handling', async () => {
    // 1. AGENT_NETWORK_MANAGER with agent.view (and WITHOUT transaction.view) can load, filter, and paginate unified history
    setWorkforceSession(['AGENT_NETWORK_MANAGER'], ['agent.view']);

    const unifiedCalls: string[] = [];
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: 'agent-uh-1',
              reference: 'AG-UH-01',
              status: 'ACTIVE',
              agentClassId: null,
              createdAt: '2026-10-27T08:00:00.000Z',
              updatedAt: '2026-10-27T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url === '/internal/agents/agent-uh-1/financial-position') {
        return Promise.resolve({
          agentId: 'agent-uh-1',
          currency: 'NGN',
          balanceMinor: '950000',
          walletExists: true,
          walletId: 'wallet-uh-1',
        });
      }
      if (url.startsWith('/internal/agents/agent-uh-1/transactions?')) {
        unifiedCalls.push(url);
        if (url.includes('type=AGENT_DEFUNDING')) {
          return Promise.resolve({
            items: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
          });
        }
        if (url.includes('type=CASH_TO_CASH_CLAIM')) {
          return Promise.resolve({
            items: [
              {
                id: 'tx-claim-1',
                type: 'CASH_TO_CASH_CLAIM',
                status: 'CLAIMED',
                amountMinor: '300000',
                currency: 'NGN',
                direction: 'CREDIT',
                createdAt: '2026-10-27T09:15:00.000Z',
                completedAt: '2026-10-27T09:15:03.000Z',
                reference: 'CASH_TO_CASH_CLAIM-001',
                narration: 'Agent cash payout float credit',
                feeMinor: '0',
                counterparty: {
                  ownerType: 'CUSTOMER',
                  display: 'Chinedu Okafor',
                  identifierMasked: '803***4567',
                },
                commission: null,
                failureCode: null,
                failureMessage: null,
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false },
          });
        }
        if (url.includes('page=2')) {
          return Promise.resolve({
            items: [
              {
                id: 'tx-fund-2',
                type: 'AGENT_FUNDING',
                status: 'FAILED',
                amountMinor: '1000000',
                currency: 'NGN',
                direction: 'CREDIT',
                createdAt: '2026-10-26T18:00:00.000Z',
                completedAt: null,
                reference: 'FUND-FAIL-002',
                narration: null,
                feeMinor: '0',
                counterparty: {
                  ownerType: 'WORKFORCE',
                  display: null,
                  identifierMasked: null,
                },
                commission: null,
                failureCode: 'LIMIT_EXCEEDED',
                failureMessage: 'Daily float funding cap reached',
              },
            ],
            pagination: { page: 2, limit: 20, total: 21, totalPages: 2, hasNextPage: false },
          });
        }
        return Promise.resolve({
          items: [
            {
              id: 'tx-c2c-1',
              type: 'CASH_TO_CASH',
              status: 'COMPLETED',
              amountMinor: '500000',
              currency: 'NGN',
              direction: 'DEBIT',
              createdAt: '2026-10-27T10:00:00.000Z',
              completedAt: '2026-10-27T10:00:01.000Z',
              reference: 'CASH_TO_CASH-000042',
              narration: 'Cash-to-Cash initiation',
              feeMinor: '10000',
              counterparty: {
                ownerType: 'BENEFICIARY',
                display: null,
                identifierMasked: '809***1122',
              },
              commission: {
                amountMinor: '2500',
                currency: 'NGN',
                status: 'POSTED',
              },
              failureCode: null,
              failureMessage: null,
            },
          ],
          pagination: { page: 1, limit: 20, total: 21, totalPages: 2, hasNextPage: true },
        });
      }
      return Promise.resolve([]);
    });

    const view = render(<AgentNetworkScreen />);
    expect(await view.findByText('AG-UH-01')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'View' }));
    await view.findByText('wallet-uh-1');

    // transaction.view section is hidden for role without transaction.view, while unified history is accessible via agent.view
    expect(view.queryByRole('button', { name: 'Load Agent transactions' })).toBeNull();
    expect(view.queryByTestId('agent-unified-history-dependency')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Load unified stream' }));
    expect(await view.findByText('CASH_TO_CASH-000042')).toBeTruthy();
    expect(unifiedCalls[0]).toBe('/internal/agents/agent-uh-1/transactions?page=1&limit=20');
    expect(view.getByText('NGN 5,000.00')).toBeTruthy();
    expect(view.getByText('Fee: NGN 100.00')).toBeTruthy();
    expect(view.getByText('Commission: NGN 25.00 (POSTED)')).toBeTruthy();
    expect(view.getByText('809***1122 · BENEFICIARY')).toBeTruthy();

    // Paginate to page 2 -> renders failureCode & failureMessage accurately, then Previous back to page 1
    fireEvent.click(
      within(view.getByTestId('agent-unified-history-pager')).getByRole('button', { name: 'Next' }),
    );
    expect(await view.findByText('FUND-FAIL-002')).toBeTruthy();
    expect(unifiedCalls).toContain('/internal/agents/agent-uh-1/transactions?page=2&limit=20');
    expect(view.getByText('LIMIT_EXCEEDED: Daily float funding cap reached')).toBeTruthy();

    fireEvent.click(
      within(view.getByTestId('agent-unified-history-pager')).getByRole('button', {
        name: 'Previous',
      }),
    );
    expect(await view.findByText('CASH_TO_CASH-000042')).toBeTruthy();

    // Filter by CASH_TO_CASH_CLAIM -> resets to page 1 with type=CASH_TO_CASH_CLAIM
    fireEvent.change(view.getByLabelText('Unified history service filter'), {
      target: { value: 'CASH_TO_CASH_CLAIM' },
    });
    expect(await view.findByText('CASH_TO_CASH_CLAIM-001')).toBeTruthy();
    expect(unifiedCalls).toContain(
      '/internal/agents/agent-uh-1/transactions?page=1&limit=20&type=CASH_TO_CASH_CLAIM',
    );
    expect(view.getByText('Chinedu Okafor · 803***4567 · CUSTOMER')).toBeTruthy();

    // Filter by AGENT_DEFUNDING -> renders empty state cleanly
    fireEvent.change(view.getByLabelText('Unified history service filter'), {
      target: { value: 'AGENT_DEFUNDING' },
    });
    expect(await view.findByTestId('agent-unified-history-empty')).toBeTruthy();
    view.unmount();

    // 2. Non-403 error then 403 Forbidden locks panel fail-closed without retrying
    jest.clearAllMocks();
    setWorkforceSession(['FINANCE_AUDITOR'], ['agent.view', 'transaction.view']);
    let txAttempt = 0;
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: 'agent-uh-403',
              reference: 'AG-UH-403',
              status: 'ACTIVE',
              agentClassId: null,
              createdAt: '2026-10-27T08:00:00.000Z',
              updatedAt: '2026-10-27T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url === '/internal/agents/agent-uh-403/financial-position') {
        return Promise.resolve({
          agentId: 'agent-uh-403',
          currency: 'NGN',
          balanceMinor: '0',
          walletExists: false,
          walletId: null,
        });
      }
      if (url.startsWith('/internal/agents/agent-uh-403/transactions?')) {
        txAttempt += 1;
        if (txAttempt === 1) {
          return Promise.reject(new Error('Temporary ledger timeout'));
        }
        const forbidden = new Error('Forbidden') as Error & { status: number };
        forbidden.status = 403;
        return Promise.reject(forbidden);
      }
      return Promise.resolve([]);
    });

    const errView = render(<AgentNetworkScreen />);
    expect(await errView.findByText('AG-UH-403')).toBeTruthy();
    fireEvent.click(errView.getByRole('button', { name: 'View' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith('/internal/agents/agent-uh-403/financial-position'),
    );

    fireEvent.click(errView.getByRole('button', { name: 'Load unified stream' }));
    expect(await errView.findByTestId('agent-unified-history-error')).toBeTruthy();
    expect(errView.getByText('Temporary ledger timeout')).toBeTruthy();

    fireEvent.click(errView.getByRole('button', { name: 'Load unified stream' }));
    expect(await errView.findByTestId('agent-unified-history-forbidden')).toBeTruthy();
    expect(txAttempt).toBe(2);
    expect(
      (errView.getByRole('button', { name: 'Load unified stream' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    errView.unmount();

    // 3. SUPPORT principal type is excluded from unified history per ARENA 3 route policy
    jest.clearAllMocks();
    setWorkforceSession(['CUSTOMER_SUPPORT_AGENT'], ['agent.view'], {
      type: 'SUPPORT' as WorkforcePrincipal['type'],
    });
    (ApiClient.get as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 'agent-support-1',
          reference: 'AG-SUP-01',
          status: 'ACTIVE',
          agentClassId: null,
          createdAt: '2026-10-27T08:00:00.000Z',
          updatedAt: '2026-10-27T08:00:00.000Z',
        },
      ],
      total: 1,
    });
    const supView = render(<AgentNetworkScreen />);
    expect(await supView.findByText('AG-SUP-01')).toBeTruthy();
    fireEvent.click(supView.getByRole('button', { name: 'View' }));
    expect(supView.queryByRole('button', { name: 'Load unified stream' })).toBeNull();
    supView.unmount();
  });
  // ARENA 3 final-integration bridge test: the panel must render the AUTHORITATIVE backend
  // projection shape (AgentTransactionHistoryService — identical on the workforce route
  // GET /internal/agents/:id/transactions and the Agent-self route; contract:
  // docs/ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md §1.3), where
  // counterparty is { type, beneficiaryPhone?, aggregatorId? } and commission is
  // { commissionMinor, payable, treatment } — NOT the panel-internal view model that the
  // fixtures above inject. The normalizer added in Sprint 3 integration maps the real
  // payload; this test feeds the exact shapes verified against real PostgreSQL responses
  // in test/v1-sprint3-agent-history-workforce.integration.spec.ts.
  test('Part B bridge: unified history panel renders the real backend counterparty/commission projection shapes', async () => {
    setWorkforceSession(['AGENT_NETWORK_MANAGER'], ['agent.view']);
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents/agent-bridge-1/transactions?')) {
        return Promise.resolve({
          items: [
            {
              id: 'journal-c2c-1',
              type: 'CASH_TO_CASH',
              status: 'UNCLAIMED',
              amountMinor: '8000',
              currency: 'NGN',
              direction: 'DEBIT',
              createdAt: '2026-10-27T10:00:00.000Z',
              completedAt: null,
              reference: 'S3-C2C-REF',
              narration: null,
              feeMinor: '0',
              counterparty: { type: 'CUSTOMER', beneficiaryPhone: '8039876543' },
              commission: { commissionMinor: '2500', payable: true, treatment: 'POSTED' },
              failureCode: null,
              failureMessage: null,
            },
            {
              id: 'journal-fund-1',
              type: 'AGENT_FUNDING',
              status: 'COMPLETED',
              amountMinor: '250000',
              currency: 'NGN',
              direction: 'CREDIT',
              createdAt: '2026-10-27T09:00:00.000Z',
              completedAt: '2026-10-27T09:00:00.000Z',
              reference: 'S3-FUND',
              narration: 'Sprint 3 agent funding',
              feeMinor: '0',
              counterparty: { type: 'WORKFORCE' },
              commission: null,
              failureCode: null,
              failureMessage: null,
            },
            {
              id: 'journal-claim-1',
              type: 'CASH_TO_CASH_CLAIM',
              status: 'COMPLETED',
              amountMinor: '8000',
              currency: 'NGN',
              direction: 'CREDIT',
              createdAt: '2026-10-27T08:00:00.000Z',
              completedAt: '2026-10-27T08:00:00.000Z',
              reference: 'S3-C2C-CLAIM',
              narration: 'Cash\u2192Cash cash payout',
              feeMinor: '0',
              counterparty: { type: 'CUSTOMER', beneficiaryPhone: '8039876543' },
              commission: { commissionMinor: '100', payable: true, treatment: null },
              failureCode: null,
              failureMessage: null,
            },
          ],
          pagination: { page: 1, limit: 20, total: 3, totalPages: 1, hasNextPage: false },
        });
      }
      return Promise.resolve([]);
    });

    const view = render(<AgentUnifiedHistoryPanel agentId="agent-bridge-1" canViewAgent />);
    fireEvent.click(view.getByRole('button', { name: 'Load unified stream' }));
    expect(await view.findByText('S3-C2C-REF')).toBeTruthy();
    // Masked beneficiary phone + backend ownerType surface (no raw phone, no undefined fields).
    expect(view.getAllByText('803***6543 \u00b7 CUSTOMER').length).toBeGreaterThanOrEqual(1);
    // Commission maps commissionMinor/treatment into the rendered minor-unit amount + status.
    expect(view.getByText(/Commission: NGN 25\.00 \(POSTED\)/)).toBeTruthy();
    // payable-without-treatment maps to an honest PAYABLE status, never 'undefined'.
    expect(view.getByText(/Commission: NGN 1\.00 \(PAYABLE\)/)).toBeTruthy();
    // WORKFORCE counterparty renders its owner type with no identifier.
    expect(view.getByText('WORKFORCE')).toBeTruthy();
    // Amounts render from string minor units; verbatim backend status/narration preserved.
    expect(view.getByText('NGN 2,500.00')).toBeTruthy();
    expect(view.getAllByText('UNCLAIMED').length).toBeGreaterThanOrEqual(1);
    expect(view.getByText('Cash\u2192Cash cash payout')).toBeTruthy();
    expect(view.queryByText(/undefined/)).toBeNull();
    view.unmount();
  });
});
