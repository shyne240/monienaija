import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';

import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { LimitAssignmentScreen } from '../src/screens/authenticated/LimitAssignmentScreen';
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

const AGENT_ID = '11111111-2222-4333-8444-555555555555';
const OUTLET_ID = '22222222-3333-4444-8555-666666666666';
const TERMINAL_ID = '33333333-4444-4555-8666-777777777777';
const LIMIT_ASSIGNMENT_ID = '44444444-5555-4666-8777-888888888888';

const activeAgent = {
  id: AGENT_ID,
  reference: 'AG-ORD-001',
  status: 'ACTIVE',
  agentClassId: 'class-ord-1',
  createdAt: '2026-10-26T08:00:00.000Z',
  updatedAt: '2026-10-26T08:00:00.000Z',
};

function setPrincipal(roles: string[], scopes: string[]) {
  act(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'test-token',
      sessionId: 'test-session',
      principal: {
        type: 'OPERATOR',
        principalId: `issuer:${roles[0] ?? 'operator'}`,
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

describe('Ordinary Agent V1 Admin Network, Onboarding, Outlets/Terminals, and Limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('reviews, approves, rejects (with required reason), and activates Ordinary Agent applications', async () => {
    setPrincipal(
      ['AGENT_NETWORK_MANAGER'],
      ['agent.view', 'agent.review_application', 'agent.activate'],
    );

    const submittedApp = {
      id: 'app-1',
      reference: 'APP-001',
      agentClassId: 'class-ord-1',
      status: 'SUBMITTED',
      applicantReference: 'APPLICANT-001',
      businessName: 'Wuse Market Kiosk',
      contactEmail: 'kiosk@example.ng',
      agentId: null,
      rejectionReason: null,
      createdAt: '2026-10-26T07:00:00.000Z',
    };
    const approvedApp = {
      ...submittedApp,
      id: 'app-2',
      reference: 'APP-002',
      businessName: 'Garki Corner Store',
      status: 'APPROVED',
    };

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [activeAgent], total: 1 });
      if (path === '/internal/agents/applications') return Promise.resolve([submittedApp, approvedApp]);
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: AGENT_ID, reference: 'AG-ORD-002', status: 'ACTIVE' });

    const view = render(<AgentNetworkScreen />);
    await view.findByText('AG-ORD-001');

    fireEvent.click(view.getByRole('button', { name: 'Load applications' }));
    expect(await view.findByText('Wuse Market Kiosk')).toBeTruthy();

    // Mark under review & Approve
    fireEvent.click(view.getByRole('button', { name: 'Mark under review' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/applications/app-1/review'),
    );
    fireEvent.click(view.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/applications/app-1/approve'),
    );

    // Reject button is disabled until reason is entered
    const rejectBtn = view.getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(rejectBtn.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Rejection reason for APP-001'), {
      target: { value: 'Incomplete CAC registration' },
    });
    expect(rejectBtn.disabled).toBe(false);
    fireEvent.click(rejectBtn);
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/agents/applications/app-1/reject', {
        reason: 'Incomplete CAC registration',
      }),
    );

    // Activate approved application
    fireEvent.click(view.getByRole('button', { name: 'Activate agent' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/admin/agents/applications/app-2/activate'),
    );
  });

  test('enforces lifecycle state-machine enablement, loads receiving number, and manages outlets, terminals, and limits', async () => {
    setPrincipal(
      ['AGENT_NETWORK_MANAGER'],
      [
        'agent.view',
        'agent.suspend',
        'agent.terminate',
        'agent.reactivate',
        'agent.activate',
        'agent.manage_outlets_terminals',
        'agent.assign_limit',
        'limit.view',
      ],
    );

    let currentAgent = { ...activeAgent };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [currentAgent], total: 1 });
      if (path === `/internal/agents/${AGENT_ID}/financial-position`) {
        return Promise.resolve({
          agentId: AGENT_ID,
          currency: 'NGN',
          balanceMinor: '123456789',
          availableBalanceMinor: '123456789',
          walletExists: true,
          walletId: 'wallet-ord-1',
          status: 'ACTIVE',
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/receiving-number`) {
        return Promise.resolve({
          agentId: AGENT_ID,
          receivingNumber: '8091234567',
          status: 'ACTIVE',
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/outlets`) {
        return Promise.resolve([
          {
            id: OUTLET_ID,
            agentId: AGENT_ID,
            reference: 'OUT-ABJ-01',
            code: 'OUT-ABJ-01',
            name: 'Garki Main Outlet',
            displayName: null,
            addressLine: null,
            city: 'Abuja',
            state: 'FCT',
            country: 'NG',
            status: 'ACTIVE',
          },
        ]);
      }
      if (path === `/internal/agents/${AGENT_ID}/terminals`) {
        return Promise.resolve([
          {
            id: TERMINAL_ID,
            agentId: AGENT_ID,
            outletId: OUTLET_ID,
            reference: 'TRM-ABJ-01',
            code: null,
            label: 'Counter POS 1',
            serialNumber: 'SN-9901',
            status: 'ACTIVE',
          },
        ]);
      }
      if (path === `/internal/limit-assignments/agent/${AGENT_ID}`) {
        return Promise.resolve({
          items: [
            {
              id: LIMIT_ASSIGNMENT_ID,
              limitProfileCode: 'AGENT_STANDARD',
              subjectType: 'AGENT',
              subjectId: AGENT_ID,
              isActive: true,
              version: 2,
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === `/internal/admin/agents/${AGENT_ID}/suspend`) {
        currentAgent = { ...currentAgent, status: 'SUSPENDED' };
        return Promise.resolve(currentAgent);
      }
      return Promise.resolve({});
    });
    (ApiClient.patch as jest.Mock).mockResolvedValue({});

    const view = render(<AgentNetworkScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'View' }));
    expect((await view.findAllByText('NGN 1,234,567.89')).length).toBeGreaterThan(0);

    // Receiving number lookup
    fireEvent.click(view.getByRole('button', { name: 'Load receiving number' }));
    expect(await view.findByText('8091234567')).toBeTruthy();

    // Outlets & terminals inspection + creation
    fireEvent.click(view.getByRole('button', { name: 'Load outlets & terminals' }));
    expect(await view.findByText(/Garki Main Outlet/)).toBeTruthy();
    expect(view.getByText(/TRM-ABJ-01/)).toBeTruthy();

    fireEvent.change(view.getByLabelText('Outlet reference'), { target: { value: 'OUT-ABJ-02' } });
    fireEvent.change(view.getByLabelText('Outlet name'), { target: { value: 'Maitama Desk' } });
    fireEvent.click(view.getByRole('button', { name: 'Create outlet' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/agents/${AGENT_ID}/outlets`, {
        reference: 'OUT-ABJ-02',
        name: 'Maitama Desk',
      }),
    );

    fireEvent.change(view.getByLabelText('Terminal reference'), { target: { value: 'TRM-ABJ-02' } });
    fireEvent.change(view.getByLabelText('Terminal label'), { target: { value: 'Counter POS 2' } });
    fireEvent.click(view.getByRole('button', { name: 'Create terminal' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/agents/${AGENT_ID}/terminals`, {
        reference: 'TRM-ABJ-02',
        outletId: OUTLET_ID,
        label: 'Counter POS 2',
      }),
    );

    // Agent limit assignment & toggle
    fireEvent.click(view.getByRole('button', { name: 'Load agent limits' }));
    expect(await view.findByText('AGENT_STANDARD')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Deactivate limit' }));
    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        `/internal/limit-assignments/${LIMIT_ASSIGNMENT_ID}`,
        { subjectType: 'AGENT', isActive: false, version: 2 },
      ),
    );

    // Lifecycle state-machine: on ACTIVE agent, Suspend & Terminate are enabled while Reactivate & Activate are disabled
    const lifecycleBar = view.getByLabelText('Granted agent lifecycle actions');
    expect((within(lifecycleBar).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(lifecycleBar).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(lifecycleBar).getByRole('button', { name: 'Activate' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(view.getByLabelText('Lifecycle reason'), { target: { value: 'Compliance audit hold' } });
    fireEvent.click(within(lifecycleBar).getByRole('button', { name: 'Suspend' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/admin/agents/${AGENT_ID}/suspend`, {
        reason: 'Compliance audit hold',
      }),
    );
    await waitFor(() =>
      expect((within(lifecycleBar).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect((within(lifecycleBar).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('LimitAssignmentScreen filters by AGENT subject and toggles active status with optimistic version', async () => {
    setPrincipal(['AGENT_NETWORK_MANAGER'], ['limit.view', 'agent.assign_limit']);
    (ApiClient.get as jest.Mock).mockResolvedValue({
      items: [
        {
          id: LIMIT_ASSIGNMENT_ID,
          subjectType: 'AGENT',
          subjectId: AGENT_ID,
          limitProfileCode: 'AGENT_STANDARD',
          isActive: true,
          version: 5,
          effectiveFrom: '2026-10-26T00:00:00.000Z',
        },
      ],
    });
    (ApiClient.patch as jest.Mock).mockResolvedValue({});

    const view = render(<LimitAssignmentScreen />);
    expect(await view.findByText(`AGENT: ${AGENT_ID}`)).toBeTruthy();

    fireEvent.change(view.getByLabelText('Assignment subject type'), { target: { value: 'AGENT' } });
    fireEvent.click(view.getByRole('button', { name: 'Filter assignments' }));
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments?subjectType=AGENT'),
    );

    fireEvent.click(view.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        `/internal/limit-assignments/${LIMIT_ASSIGNMENT_ID}`,
        { subjectType: 'AGENT', isActive: false, version: 5 },
      ),
    );
  });
});
