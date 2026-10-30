import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { AgentClassesScreen } from '../src/screens/authenticated/AgentClassesScreen';
import { AgentCredentialPanel } from '../src/screens/authenticated/AgentCredentialPanel';
import { CashToCashOperationsScreen } from '../src/screens/authenticated/CashToCashOperationsScreen';
import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const agentClass = {
  id: 'class-uuid',
  reference: 'AGENT-CLASS-TEST',
  code: 'AGENT_TEST',
  name: 'Agent Test Class',
  description: 'Synthetic class for an Admin Web test.',
  isActive: false,
  requirements: { policyRef: 'approved-policy-1' },
  requiredInformation: null,
  requiredDocumentCategories: null,
  applicableServices: ['CASH_TO_CASH'],
  applicableLimits: null,
  version: 3,
  createdAt: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:00:00.000Z',
};

const transfer = {
  id: 'transfer-uuid',
  agentId: 'agent-uuid',
  agentReference: 'AG-0001',
  beneficiaryPhoneMasked: '••••••0123',
  principalMinor: '123456',
  feeMinor: '0',
  vatMinor: '0',
  totalMinor: '123456',
  currency: 'NGN',
  status: 'CLAIMED',
  journalId: 'journal-init',
  reference: 'C2C-REF-001',
  claimantCustomerId: 'customer-uuid',
  claimJournalId: 'journal-claim',
  claimReference: 'CLAIM-REF-001',
  redemptionMethod: 'AGENT_CASH',
  claimedAt: '2026-10-26T10:10:00.000Z',
  expiresAt: '2026-10-27T10:00:00.000Z',
  expiredAt: null,
  createdAt: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:10:00.000Z',
};

function setPrincipal(scopes: string[]) {
  act(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'test-token',
      sessionId: 'test-session',
      principal: {
        type: 'OPERATOR',
        principalId: 'issuer:test-user',
        sessionId: 'test-session',
        audience: 'workforce-admin',
        roles: ['TEST_OPERATOR'],
        scopes,
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
  });
}

describe('Agent classes and Cash-to-Cash Admin Web integrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue(agentClass);
    (ApiClient.patch as jest.Mock).mockResolvedValue(agentClass);
  });

  test('Agent class manager lists and updates a class with its optimistic version', async () => {
    setPrincipal(['agent.view', 'agent.manage_classes']);
    (ApiClient.get as jest.Mock).mockResolvedValue([agentClass]);
    (ApiClient.patch as jest.Mock).mockResolvedValue({ ...agentClass, name: 'Updated Test Class', version: 4 });

    const view = render(<AgentClassesScreen />);
    expect(await view.findByText('AGENT-CLASS-TEST')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Review / edit' }));
    fireEvent.change(view.getByLabelText('Class name'), { target: { value: 'Updated Test Class' } });
    fireEvent.click(view.getByRole('button', { name: 'Save class' }));

    await waitFor(() => expect(ApiClient.patch).toHaveBeenCalledWith(
      '/internal/agents/classes/class-uuid',
      expect.objectContaining({
        name: 'Updated Test Class',
        expectedVersion: 3,
        applicableServices: ['CASH_TO_CASH'],
        applicableLimits: null,
      }),
    ));
  });

  test('new Agent classes are submitted inactive and do not invent service or limit configuration', async () => {
    setPrincipal(['agent.view', 'agent.manage_classes']);
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    const view = render(<AgentClassesScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'Create class' }));
    fireEvent.change(view.getByLabelText('Class name'), { target: { value: 'Unconfigured Agent Class' } });
    fireEvent.click(view.getByRole('button', { name: 'Create inactive class' }));

    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith(
      '/internal/agents/classes',
      expect.objectContaining({
        name: 'Unconfigured Agent Class',
        isActive: false,
        applicableServices: null,
        applicableLimits: null,
        requiredDocumentCategories: null,
      }),
    ));
    expect(ApiClient.post).toHaveBeenCalledTimes(1);
  });

  test('invalid class JSON is rejected before a write request', async () => {
    setPrincipal(['agent.view', 'agent.manage_classes']);
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    const view = render(<AgentClassesScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'Create class' }));
    fireEvent.change(view.getByLabelText('Class name'), { target: { value: 'Invalid JSON Class' } });
    fireEvent.change(view.getByLabelText('Applicable services JSON'), { target: { value: '[' } });
    fireEvent.click(view.getByRole('button', { name: 'Create inactive class' }));

    expect((await view.findByRole('alert')).textContent).toMatch(/Applicable services must contain valid JSON/i);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('Cash-to-Cash operations show paginated lifecycle and receipt data with masked phone', async () => {
    setPrincipal(['transaction.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ data: [transfer], total: 21, page: 1, limit: 20, totalPages: 2 });

    const view = render(<CashToCashOperationsScreen />);
    expect(await view.findByText('Cash-to-Cash Operations')).toBeTruthy();
    expect(view.getByText('••••••0123')).toBeTruthy();
    expect(view.getByText('NGN 1,234.56')).toBeTruthy();
    expect(view.queryByText('07000000123')).toBeNull();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/admin/cash-to-cash/transfers?page=1&limit=20');

    fireEvent.click(view.getByRole('button', { name: 'Inspect receipt' }));
    expect(view.getByLabelText('Cash-to-Cash receipt details').textContent).toContain('C2C-REF-001');
    expect(view.getByLabelText('Cash-to-Cash receipt details').textContent).toContain('journal-claim');
    expect(view.getByLabelText('Cash-to-Cash receipt details').textContent).toContain('AGENT_CASH');

    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/admin/cash-to-cash/transfers?page=2&limit=20'));
  });

  test('Cash-to-Cash filters are encoded and the route is hidden without transaction.view', async () => {
    setPrincipal(['transaction.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    const view = render(<CashToCashOperationsScreen />);
    await view.findByText('No Cash-to-Cash transfers match these filters.');
    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'CLAIMED' } });
    fireEvent.change(view.getByLabelText('Agent UUID'), { target: { value: 'agent-uuid' } });
    fireEvent.click(view.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith(
      '/internal/admin/cash-to-cash/transfers?page=1&limit=20&status=CLAIMED&agentId=agent-uuid',
    ));
    view.unmount();

    setPrincipal([]);
    const denied = render(<CashToCashOperationsScreen />);
    expect(denied.getByRole('alert').textContent).toContain('transaction.view');
  });

  test('credential issuance shows the one-time value in memory and reissue warns about session invalidation', async () => {
    setPrincipal(['agent.manage_credentials']);
    const issued = {
      agentId: 'agent-uuid',
      credentialId: 'credential-uuid',
      temporaryPassword: 'one-time-only-secret',
      rotationRequired: true,
      passwordExpiresAt: '2026-10-29T10:00:00.000Z',
      deliveryNotice: 'Temporary credential — deliver out-of-band.',
    };
    (ApiClient.post as jest.Mock).mockResolvedValue(issued);
    const view = render(<AgentCredentialPanel agentId="agent-uuid" agentStatus="ACTIVE" canManage />);

    fireEvent.click(view.getByRole('button', { name: 'Issue initial credential' }));
    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith('/internal/admin/agents/agent-uuid/credentials'));
    expect((await view.findByTestId('temporary-agent-password')).textContent).toContain('one-time-only-secret');
    fireEvent.click(view.getByRole('button', { name: 'Hide one-time value' }));
    expect(view.queryByTestId('temporary-agent-password')).toBeNull();

    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Reissue + invalidate sessions' }));
    await waitFor(() => expect(ApiClient.post).toHaveBeenCalledWith('/internal/admin/agents/agent-uuid/credentials/reissue'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('all sessions using it will be invalidated'));
    expect(await view.findByText(/previous credential and its active sessions were invalidated/i)).toBeTruthy();
    confirm.mockRestore();
  });

  test('credential controls disappear without agent.manage_credentials and when the Agent is inactive', () => {
    setPrincipal(['agent.view']);
    const denied = render(<AgentCredentialPanel agentId="agent-uuid" agentStatus="ACTIVE" canManage={false} />);
    expect(denied.container.textContent).toBe('');
    denied.unmount();

    setPrincipal(['agent.manage_credentials']);
    const inactive = render(<AgentCredentialPanel agentId="agent-uuid" agentStatus="SUSPENDED" canManage />);
    expect(inactive.getByText(/available only for an ACTIVE Agent/i)).toBeTruthy();
    expect(inactive.queryByRole('button', { name: 'Issue initial credential' })).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('navigation scopes are exact and do not infer authority from role labels', () => {
    expect(canAccessAdminView('agentClasses', ['agent.view'], ['FINANCE_AUDITOR'])).toBe(true);
    expect(canAccessAdminView('agentClasses', [], ['AGENT_NETWORK_MANAGER'])).toBe(false);
    expect(canAccessAdminView('cashToCashOps', ['transaction.view'], ['OPERATIONS'])).toBe(true);
    expect(canAccessAdminView('cashToCashOps', [], ['SUPER_ADMIN'])).toBe(false);
  });

  test('credential panel clears one-time secret when switching agents and handles 409 initial-already-exists cleanly', async () => {
    setPrincipal(['agent.manage_credentials']);
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({
      agentId: 'agent-1',
      credentialId: 'cred-1',
      temporaryPassword: 'secret-for-agent-1',
      rotationRequired: true,
      passwordExpiresAt: '2026-10-29T10:00:00.000Z',
      deliveryNotice: 'Deliver out-of-band.',
    });

    const view = render(<AgentCredentialPanel agentId="agent-1" agentStatus="ACTIVE" canManage />);
    fireEvent.click(view.getByRole('button', { name: 'Issue initial credential' }));
    expect((await view.findByTestId('temporary-agent-password')).textContent).toBe('secret-for-agent-1');

    // Switching selected agent must wipe the previous agent's one-time secret immediately
    view.rerender(<AgentCredentialPanel agentId="agent-2" agentStatus="ACTIVE" canManage />);
    expect(view.queryByTestId('temporary-agent-password')).toBeNull();

    // 409 Conflict when initial credential already exists gives clear reissue guidance
    const conflict = Object.assign(new Error('Initial credential already exists for this Agent'), { status: 409 });
    (ApiClient.post as jest.Mock).mockRejectedValueOnce(conflict);
    fireEvent.click(view.getByRole('button', { name: 'Issue initial credential' }));
    const alertText = (await view.findByRole('alert')).textContent ?? '';
    expect(alertText).toContain('Use "Reissue + invalidate sessions"');
    expect(alertText).not.toContain('The result may be uncertain');
  });

  test('Cash-to-Cash search from page 2 issues a single page-1 query and Reset clears filters', async () => {
    setPrincipal(['transaction.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({
      data: [transfer],
      total: 25,
      page: 1,
      limit: 20,
      totalPages: 2,
    });

    const view = render(<CashToCashOperationsScreen />);
    await view.findByText('••••••0123');
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith('/internal/admin/cash-to-cash/transfers?page=2&limit=20'),
    );

    (ApiClient.get as jest.Mock).mockClear();
    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'EXPIRED' } });
    fireEvent.click(view.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/internal/admin/cash-to-cash/transfers?page=1&limit=20&status=EXPIRED',
      ),
    );
    expect(ApiClient.get).toHaveBeenCalledTimes(1);

    (ApiClient.get as jest.Mock).mockClear();
    fireEvent.click(view.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith('/internal/admin/cash-to-cash/transfers?page=1&limit=20'),
    );
  });
});
