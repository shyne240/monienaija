import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { ApprovalsScreen } from '../src/screens/authenticated/ApprovalsScreen';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { AgentClassesScreen } from '../src/screens/authenticated/AgentClassesScreen';
import { CashToCashOperationsScreen } from '../src/screens/authenticated/CashToCashOperationsScreen';
import { ReconciliationObservabilityScreen } from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import { SupportTicketsScreen } from '../src/screens/authenticated/SupportTicketsScreen';
import { PendingFundingApprovalsQueue } from '../src/components/PendingFundingApprovalsQueue';
import { AgentTransactionPinSupportPanel } from '../src/components/AgentTransactionPinSupportPanel';
import { AgentUnifiedHistoryPanel } from '../src/components/AgentUnifiedHistoryPanel';
import { AgentClassAssignmentPanel } from '../src/components/AgentClassAssignmentPanel';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setPrincipal(roles: string[], scopes: string[], principalId = 'operator-1') {
  act(() => {
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
        roles,
        scopes,
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });
}

describe('Sprint 2 Ordinary Agent V1 Admin Web Operational Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('Finance Controller accesses live Global Funding Inbox and Maker handoff token inside ApprovalsScreen without requiring agent.view', async () => {
    setPrincipal(['FINANCE_CONTROLLER'], ['privileged:approve', 'agent.fund', 'agent.defund'], 'checker-fc-1');
    const pendingReq = {
      id: 'fund-req-1',
      approvalId: 'approval-fc-1',
      direction: 'FUND',
      agentId: 'agent-fc-1',
      aggregatorId: null,
      amountMinor: '500000',
      currency: 'NGN',
      idempotencyKey: 'idem-fc-1',
      reference: 'FUND-FC-1',
      requestHash: 'hash-1',
      approvalFingerprint: 'fp-1',
      status: 'PENDING',
      approvalStatus: 'REQUESTED',
      approvalExpiresAt: '2026-10-27T10:00:00.000Z',
      approvalApprovedBy: null,
      reason: 'Float top-up Abuja outlet',
      actionType: 'AGENT_FUND',
      requesterPrincipalId: 'maker-anm-1',
      checkerPrincipalId: null,
      journalId: null,
      policy: {},
    };
    let currentState = pendingReq;
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents/funding-requests?')) {
        return Promise.resolve({
          items: currentState.status === 'PENDING' ? [currentState] : [],
          page: 1,
          limit: 20,
          total: currentState.status === 'PENDING' ? 1 : 0,
        });
      }
      if (url.startsWith('/internal/agents/agent-fc-1/funding-requests')) {
        return Promise.resolve([currentState]);
      }
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/approve')) {
        currentState = {
          ...currentState,
          approvalStatus: 'APPROVED',
          approvalApprovedBy: 'checker-fc-1',
          checkerPrincipalId: 'checker-fc-1',
        } as any;
        return Promise.resolve({ reason: 'APPROVED' });
      }
      if (url.endsWith('/execute')) {
        currentState = {
          ...currentState,
          status: 'EXECUTED',
          approvalStatus: 'CONSUMED',
          approvalApprovedBy: 'checker-fc-1',
          checkerPrincipalId: 'checker-fc-1',
          journalId: 'journal-fc-99',
        } as any;
        return Promise.resolve({ status: 'COMPLETED', journalId: 'journal-fc-99' });
      }
      return Promise.resolve({});
    });

    const view = render(<ApprovalsScreen />);
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/internal/agents/funding-requests?page=1&limit=20&status=PENDING',
      ),
    );
    expect(await view.findByText('Float top-up Abuja outlet')).toBeTruthy();

    fireEvent.change(view.getByLabelText('Checker handoff token'), {
      target: { value: JSON.stringify({ agentId: 'agent-fc-1', idempotencyKey: 'idem-fc-1' }) },
    });
    fireEvent.click(view.getByRole('button', { name: /Apply handoff & load/i }));

    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/internal/agents/agent-fc-1/funding-requests?idempotencyKey=idem-fc-1',
      ),
    );
    expect(await view.findByText('Business reason: Float top-up Abuja outlet')).toBeTruthy();

    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Approve funding instruction' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/a2/workforce/approvals/approval-fc-1/approve',
        expect.any(Object),
      ),
    );

    await view.findByRole('button', { name: 'Execute approved instruction' });
    fireEvent.click(view.getByLabelText('I reviewed this Agent, amount, direction and business reason'));
    fireEvent.click(view.getByRole('button', { name: 'Execute approved instruction' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/internal/agents/funding-requests/fund-req-1/execute',
        {},
      ),
    );
  });

  test('Isolated PendingFundingApprovalsQueue filters actionable items and dispatches selection when loadQueue is provided', async () => {
    const onSelect = jest.fn();
    const loadQueue = jest.fn().mockResolvedValue([
      {
        id: 'req-a',
        approvalId: 'app-a',
        agentId: 'agent-a',
        agentReference: 'AG-001',
        direction: 'FUND',
        amountMinor: '250000',
        currency: 'NGN',
        idempotencyKey: 'idem-a',
        status: 'PENDING',
        approvalStatus: 'REQUESTED',
        reason: 'Morning float',
        requesterPrincipalId: 'maker-1',
      },
      {
        id: 'req-b',
        approvalId: 'app-b',
        agentId: 'agent-b',
        agentReference: 'AG-002',
        direction: 'DEFUND',
        amountMinor: '100000',
        currency: 'NGN',
        idempotencyKey: 'idem-b',
        status: 'PENDING',
        approvalStatus: 'APPROVED',
        reason: 'EOD sweep',
        requesterPrincipalId: 'maker-1',
      },
    ]);

    const view = render(
      <PendingFundingApprovalsQueue
        canReviewFunding
        loadQueue={loadQueue}
        onSelectRequest={onSelect}
      />,
    );
    expect(await view.findByText('AG-001')).toBeTruthy();
    expect(view.getByText('AG-002')).toBeTruthy();

    fireEvent.change(view.getByLabelText('Funding inbox direction filter'), {
      target: { value: 'DEFUND' },
    });
    await waitFor(() => expect(view.queryByText('AG-001')).toBeNull());
    fireEvent.click(view.getByRole('button', { name: 'Review in Checker' }));
    expect(onSelect).toHaveBeenCalledWith('agent-b', 'idem-b', {
      agentId: 'agent-b',
      idempotencyKey: 'idem-b',
      requestId: 'req-b',
      approvalId: 'app-b',
    });
  });

  test('AgentNetworkScreen inspects application detail, resolves class & limit catalogs, and loads wallet + Cash-to-Cash activity on demand', async () => {
    setPrincipal(
      ['SUPER_ADMIN'],
      [
        'agent.view',
        'agent.review_application',
        'agent.assign_limit',
        'limit.view',
        'transaction.view',
        'customer.manage_support_case',
      ],
    );
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: 'agent-100',
              reference: 'AG-100',
              status: 'ACTIVE',
              agentClassId: 'cls-100',
              createdAt: '2026-10-26T08:00:00.000Z',
              updatedAt: '2026-10-26T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url === '/internal/agents/applications') {
        return Promise.resolve([
          {
            id: 'app-100',
            reference: 'APP-100',
            agentClassId: 'cls-100',
            status: 'SUBMITTED',
            applicantReference: 'APPLICANT-100',
            businessName: 'Wuse Market Kiosk',
            contactEmail: 'kiosk@example.ng',
            agentId: null,
            rejectionReason: null,
            createdAt: '2026-10-26T07:00:00.000Z',
          },
        ]);
      }
      if (url === '/internal/agents/applications/app-100') {
        return Promise.resolve({
          id: 'app-100',
          reference: 'APP-100',
          agentClassId: 'cls-100',
          status: 'SUBMITTED',
          applicantReference: 'APPLICANT-100',
          businessName: 'Wuse Market Kiosk',
          contactEmail: 'kiosk@example.ng',
          payload: { cacNumber: 'RC-998877', state: 'FCT' },
          version: 2,
          agentId: null,
          rejectionReason: null,
          createdAt: '2026-10-26T07:00:00.000Z',
        });
      }
      if (url === '/internal/agents/agent-100/financial-position') {
        return Promise.resolve({
          agentId: 'agent-100',
          currency: 'NGN',
          balanceMinor: '750000',
          availableBalanceMinor: '750000',
          walletExists: true,
          walletId: 'wallet-100',
          status: 'ACTIVE',
        });
      }
      if (url === '/internal/agents/classes') {
        return Promise.resolve([
          { id: 'cls-100', code: 'ORD_T1', name: 'Ordinary Tier 1', isActive: true },
        ]);
      }
      if (url === '/internal/limit-assignments/agent/agent-100') {
        return Promise.resolve([]);
      }
      if (url === '/internal/limit-profiles') {
        return Promise.resolve([{ code: 'AGENT_ORDINARY_T1', name: 'Ordinary Tier 1 Profile', isActive: true }]);
      }
      if (url === '/internal/admin/cash-to-cash/transfers?page=1&limit=10&agentId=agent-100') {
        return Promise.resolve({
          data: [
            {
              id: 'c2c-100',
              beneficiaryPhoneMasked: '801***5678',
              principalMinor: '200000',
              currency: 'NGN',
              status: 'CLAIMED',
              redemptionMethod: 'AGENT_CASH',
              reference: 'C2C-REF-100',
              createdAt: '2026-10-26T09:00:00.000Z',
            },
          ],
        });
      }
      if (url === '/wallets/wallet-100/transactions?page=1&limit=10') {
        return Promise.resolve({
          items: [
            {
              id: 'wtx-100',
              direction: 'DEBIT',
              amountMinor: '50000',
              currency: 'NGN',
              status: 'COMPLETED',
              reference: 'WTX-REF-100',
              createdAt: '2026-10-26T09:10:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    const view = render(<AgentNetworkScreen />);
    expect(await view.findByText('AG-100')).toBeTruthy();
    // Initial mount only fetched /internal/agents?page=1&limit=20
    expect(ApiClient.get).toHaveBeenCalledTimes(1);

    // Inspect onboarding application detail via GET /internal/agents/applications/:id
    fireEvent.click(view.getByRole('button', { name: 'Load applications' }));
    expect(await view.findByText('APP-100')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Inspect details' }));
    expect((await view.findByTestId('inspected-agent-application')).textContent).toContain('RC-998877');

    // Open Agent drawer -> resolve class catalog -> load limit catalog -> load wallet & C2C transactions
    fireEvent.click(view.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/agents/agent-100/financial-position'));

    fireEvent.click(view.getByRole('button', { name: 'Resolve class name' }));
    expect((await view.findAllByText(/Ordinary Tier 1 \(ORD_T1\)/)).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(view.getByRole('button', { name: 'Load agent limits' }));
    await view.findByText(/No direct limit assignments/i);
    fireEvent.click(view.getByRole('button', { name: 'Load limit catalog' }));
    expect(await view.findByLabelText('Select catalog limit profile')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Load Agent transactions' }));
    expect(await view.findByText('WTX-REF-100')).toBeTruthy();
    expect(view.getByText('C2C-REF-100')).toBeTruthy();
    expect(view.getByTestId('agent-unified-history-dependency').textContent).toContain('/internal/agents/:id/transactions');
    expect(view.getByTestId('agent-pin-support-dependency').textContent).toContain('transaction-pin');
  });

  test('AgentClassesScreen surfaces read-only governance note & service summary; isolated AgentClassAssignmentPanel & AgentUnifiedHistoryPanel work with contracts', async () => {
    setPrincipal(['AGENT_NETWORK_MANAGER'], ['agent.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue([
      {
        id: 'cls-1',
        reference: 'CLS-ORD-1',
        code: 'ORD_1',
        name: 'Ordinary Agent Class',
        description: null,
        isActive: true,
        requirements: null,
        requiredInformation: null,
        requiredDocumentCategories: null,
        applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH'],
        applicableLimits: null,
        version: 1,
        createdAt: '2026-10-26T00:00:00.000Z',
        updatedAt: '2026-10-26T00:00:00.000Z',
      },
    ]);

    const classesView = render(<AgentClassesScreen />);
    expect(await classesView.findByText('Configured (CASH_IN, CASH_OUT, CASH_TO_CASH)')).toBeTruthy();
    expect(classesView.getByTestId('agent-classes-readonly-governance').textContent).toContain('agent.manage_classes');
    classesView.unmount();

    const onReclassify = jest.fn().mockResolvedValue(undefined);
    const reclassView = render(
      <AgentClassAssignmentPanel
        agentId="agent-1"
        currentClassId="cls-1"
        availableClasses={[
          { id: 'cls-1', code: 'ORD_1', name: 'Ordinary 1', isActive: true },
          { id: 'cls-2', code: 'ORD_2', name: 'Ordinary 2', isActive: true },
        ]}
        canManageClasses
        onReclassify={onReclassify}
      />,
    );
    fireEvent.change(reclassView.getByLabelText('Target Agent class'), { target: { value: 'cls-2' } });
    fireEvent.change(reclassView.getByLabelText('Class change reason'), { target: { value: 'Upgraded KYC tier' } });
    fireEvent.click(reclassView.getByRole('button', { name: 'Reclassify Agent' }));
    await waitFor(() => expect(onReclassify).toHaveBeenCalledWith('agent-1', 'cls-2', 'Upgraded KYC tier'));
    reclassView.unmount();

    const loadTransactions = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'uh-1',
          type: 'CASH_IN',
          status: 'COMPLETED',
          direction: 'DEBIT',
          amountMinor: '150000',
          currency: 'NGN',
          reference: 'CASHIN-001',
          createdAt: '2026-10-26T10:00:00.000Z',
        },
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1, hasNextPage: false },
    });
    const historyView = render(
      <AgentUnifiedHistoryPanel
        agentId="agent-1"
        canViewTransactions
        loadTransactions={loadTransactions}
      />,
    );
    fireEvent.click(historyView.getByRole('button', { name: 'Load unified stream' }));
    expect(await historyView.findByText('CASHIN-001')).toBeTruthy();
  });

  test('CashToCashOperationsScreen inspects double-entry initiation and claim journals when ledger.view is granted', async () => {
    setPrincipal(['FINANCE_AUDITOR'], ['transaction.view', 'ledger.view']);
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/admin/cash-to-cash/transfers')) {
        return Promise.resolve({
          data: [
            {
              id: 'c2c-tx-1',
              agentId: 'agent-1',
              agentReference: 'AG-001',
              beneficiaryPhoneMasked: '803***9999',
              principalMinor: '400000',
              feeMinor: '5000',
              vatMinor: '375',
              totalMinor: '405375',
              currency: 'NGN',
              status: 'CLAIMED',
              journalId: 'jrn-init-1',
              reference: 'C2C-INIT-1',
              claimantCustomerId: 'cust-1',
              claimJournalId: 'jrn-claim-1',
              claimReference: 'C2C-CLAIM-1',
              redemptionMethod: 'AGENT_CASH',
              claimedAt: '2026-10-26T10:05:00.000Z',
              expiresAt: '2026-10-29T10:00:00.000Z',
              expiredAt: null,
              createdAt: '2026-10-26T10:00:00.000Z',
              updatedAt: '2026-10-26T10:05:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }
      if (url === '/ledger/journals/jrn-claim-1') {
        return Promise.resolve({
          id: 'jrn-claim-1',
          status: 'POSTED',
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            { id: 'l1', accountId: 'acc-unclaimed', direction: 'DEBIT', amountMinor: '400000' },
            { id: 'l2', accountId: 'acc-agent-float', direction: 'CREDIT', amountMinor: '400000' },
          ],
        });
      }
      return Promise.resolve({});
    });

    const view = render(<CashToCashOperationsScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'Inspect receipt' }));
    fireEvent.click(view.getByRole('button', { name: 'Inspect claim journal' }));

    const journalCard = await view.findByTestId('c2c-inspected-journal');
    expect(journalCard.textContent).toContain('BALANCED');
    expect(journalCard.textContent).toContain('acc-agent-float');
  });

  test('ReconciliationObservabilityScreen loads Finance Verification and Account Activity from real backend routes', async () => {
    setPrincipal(['FINANCE_AUDITOR'], ['reconciliation.view']);
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/reconciliation/finance') {
        return Promise.resolve({
          generatedAt: '2026-10-26T11:00:00.000Z',
          trialBalance: { generatedAt: '2026-10-26T11:00:00.000Z', balanced: true, dimensions: [], rows: [] },
          totalAssets: [{ accountType: 'ASSET', currency: 'NGN', accountingUnit: 'HOUSE', totalBalanceMinor: '1000000' }],
          totalLiabilities: [{ accountType: 'LIABILITY', currency: 'NGN', accountingUnit: 'HOUSE', totalBalanceMinor: '1000000' }],
          journalIntegrity: {
            generatedAt: '2026-10-26T11:00:00.000Z',
            totalJournals: 42,
            invalidJournals: 0,
            totalLines: 84,
            orphanLines: 0,
            balanced: true,
          },
          balanceConservation: [],
          accountActivity: [],
        });
      }
      if (url === '/internal/reconciliation/accounts/acc-uuid-1/activity') {
        return Promise.resolve([
          {
            accountId: 'acc-uuid-1',
            accountCode: '2100-AGENT-FLOAT',
            accountName: 'Agent Float Liability',
            accountType: 'LIABILITY',
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            entryCount: 12,
            totalDebitsMinor: '200000',
            totalCreditsMinor: '950000',
            balanceMinor: '750000',
            firstActivityAt: '2026-10-25T08:00:00.000Z',
            lastActivityAt: '2026-10-26T10:30:00.000Z',
          },
        ]);
      }
      return Promise.resolve({});
    });

    const view = render(<ReconciliationObservabilityScreen />);
    fireEvent.click(view.getByRole('button', { name: /Finance Verification & Activity/i }));
    const summary = await view.findByTestId('finance-verification-summary');
    expect(summary.textContent).toContain('42');
    expect(summary.textContent).toContain('BALANCED');

    fireEvent.change(view.getByLabelText('Ledger Account UUID'), { target: { value: 'acc-uuid-1' } });
    fireEvent.click(view.getByRole('button', { name: 'Load Account Activity' }));
    const activityTable = await view.findByTestId('account-activity-table');
    expect(activityTable.textContent).toContain('2100-AGENT-FLOAT');
  });

  test('SupportTicketsScreen filters by agentId, records internal operator notes, and renders Agent PIN support workflow', async () => {
    setPrincipal(['CUSTOMER_SERVICE'], ['customer.manage_support_case']);
    const pinTicket = {
      id: 'ticket-pin-1',
      reference: 'SUP-PIN-01',
      category: 'PIN',
      status: 'OPEN',
      priority: 'HIGH',
      subject: 'Transaction PIN locked after 5 attempts',
      agentId: 'agent-locked-1',
      customerId: null,
      assignedTo: null,
      createdAt: '2026-10-26T10:00:00.000Z',
      updatedAt: '2026-10-26T10:00:00.000Z',
      version: 1,
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/support/tickets?')) {
        return Promise.resolve({ items: [pinTicket], pagination: { total: 1 } });
      }
      if (url === '/internal/support/tickets/ticket-pin-1') {
        return Promise.resolve(pinTicket);
      }
      if (url === '/internal/support/tickets/ticket-pin-1/messages') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});

    const view = render(<SupportTicketsScreen />);
    expect(await view.findByText('SUP-PIN-01')).toBeTruthy();

    fireEvent.change(view.getByLabelText('Filter by Agent ID'), { target: { value: 'agent-locked-1' } });
    fireEvent.click(view.getByRole('button', { name: 'Filter Agent' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/internal/support/tickets?page=1&limit=20&agentId=agent-locked-1',
      ),
    );

    fireEvent.click(view.getByRole('button', { name: 'View' }));
    expect(await view.findByTestId('agent-pin-support-dependency')).toBeTruthy();

    // Internal note submission
    fireEvent.change(view.getByPlaceholderText('Add customer-visible message…'), {
      target: { value: 'Verified Agent outlet ID & callback.' },
    });
    fireEvent.click(view.getByLabelText('Internal operator note'));
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/support/tickets/ticket-pin-1/messages', {
        body: 'Verified Agent outlet ID & callback.',
        isInternal: true,
      }),
    );
    view.unmount();

    // Isolated AgentTransactionPinSupportPanel unlock contract test
    const loadPinStatus = jest
      .fn()
      .mockResolvedValueOnce({
        agentId: 'agent-locked-1',
        status: 'LOCKED',
        pinVersion: 2,
        lockReason: '5 failed attempts',
      })
      .mockResolvedValueOnce({
        agentId: 'agent-locked-1',
        status: 'ACTIVE',
        pinVersion: 2,
      });
    const onUnlockPin = jest.fn().mockResolvedValue(undefined);
    const pinView = render(
      <AgentTransactionPinSupportPanel
        agentId="agent-locked-1"
        canManageSupport
        loadPinStatus={loadPinStatus}
        onUnlockPin={onUnlockPin}
      />,
    );
    fireEvent.click(pinView.getByRole('button', { name: 'Inspect PIN state' }));
    expect((await pinView.findByTestId('agent-pin-support-state')).textContent).toContain('LOCKED');
    fireEvent.change(pinView.getByLabelText('PIN unlock audit reason'), {
      target: { value: 'Verified KYC on SUP-PIN-01' },
    });
    fireEvent.click(pinView.getByRole('button', { name: 'Clear PIN Lockout' }));
    await waitFor(() =>
      expect(onUnlockPin).toHaveBeenCalledWith('agent-locked-1', 'Verified KYC on SUP-PIN-01'),
    );
    expect((await pinView.findByTestId('agent-pin-support-state')).textContent).toContain('ACTIVE');
  });
});
