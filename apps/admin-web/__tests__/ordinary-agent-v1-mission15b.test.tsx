import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';

import { ApiClient, ApiError } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { AgentClassesScreen } from '../src/screens/authenticated/AgentClassesScreen';
import { AgentCredentialPanel } from '../src/screens/authenticated/AgentCredentialPanel';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { CashToCashOperationsScreen } from '../src/screens/authenticated/CashToCashOperationsScreen';
import { Layout } from '../src/screens/authenticated/Layout';
import { LimitAssignmentScreen } from '../src/screens/authenticated/LimitAssignmentScreen';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    constructor(
      public override readonly message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiClient: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: MockApiError,
  };
});

const AGENT_ID = '11111111-2222-4333-8444-555555555555';
const CLASS_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OUTLET_ID = '22222222-3333-4444-8555-666666666666';
const TERMINAL_ID = '33333333-4444-4555-8666-777777777777';
const DRAFT_APP_ID = '44444444-5555-4666-8777-888888888888';

function setPrincipal(
  roles: string[],
  scopes: string[],
  type: 'OPERATOR' | 'PRIVILEGED' = 'OPERATOR',
) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'workforce-session-token',
    sessionId: 'session-mission-15b',
    error: null,
    principal: {
      type,
      principalId: 'operator-mission-15b',
      sessionId: 'session-mission-15b',
      roles,
      scopes,
      assuranceLevel: 'MFA',
      audience: 'workforce-admin',
      customerAccess: 'ANY',
    },
  });
}

describe('Mission 15B — Ordinary Agent V1 Admin Web Completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Priority 1: validates Agent onboarding form, creates/edits DRAFT, enforces class requirements, and submits into review queue', async () => {
    setPrincipal(
      ['AGENT_NETWORK_MANAGER'],
      ['agent.view', 'agent.review_application'],
    );

    const activeClass = {
      id: CLASS_ID,
      reference: 'CLS-ORD-STD',
      code: 'ORDINARY_STD',
      name: 'Ordinary Agent Standard',
      isActive: true,
      requiredInformation: ['bvn'],
      requiredDocumentCategories: ['UTILITY_BILL'],
    };

    let applicationsList: any[] = [];

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) {
        return Promise.resolve({ data: [], total: 0 });
      }
      if (path === '/internal/agents/classes') {
        return Promise.resolve([activeClass]);
      }
      if (path === '/internal/agents/applications') {
        return Promise.resolve(applicationsList);
      }
      if (path === `/internal/agents/applications/${DRAFT_APP_ID}`) {
        return Promise.resolve(applicationsList[0]);
      }
      return Promise.resolve([]);
    });

    (ApiClient.post as jest.Mock).mockImplementation((path: string, body?: any) => {
      if (path === '/agents/applications') {
        const created = {
          id: DRAFT_APP_ID,
          reference: 'APP-ORD-901',
          agentClassId: body.agentClassId,
          status: 'DRAFT',
          applicantReference: body.applicantReference,
          businessName: body.businessName ?? null,
          contactEmail: body.contactEmail ?? null,
          payload: body.payload ?? {},
          version: 1,
          agentId: null,
          rejectionReason: null,
          createdAt: '2026-10-30T09:00:00.000Z',
          applicantAccessToken: 'one-time-public-capability-never-stored',
        };
        applicationsList = [created];
        return Promise.resolve(created);
      }
      if (path === `/agents/applications/${DRAFT_APP_ID}/submit`) {
        applicationsList = [{ ...applicationsList[0], status: 'SUBMITTED', version: 3 }];
        return Promise.resolve(applicationsList[0]);
      }
      return Promise.resolve({});
    });

    (ApiClient.patch as jest.Mock).mockImplementation((path: string, body?: any) => {
      if (path === `/agents/applications/${DRAFT_APP_ID}`) {
        const updated = {
          ...applicationsList[0],
          businessName: body.businessName,
          contactEmail: body.contactEmail,
          payload: body.payload,
          version: 2,
        };
        applicationsList = [updated];
        return Promise.resolve(updated);
      }
      return Promise.resolve({});
    });

    const view = render(<AgentNetworkScreen />);
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledTimes(1));

    // Open New Agent Application form
    fireEvent.click(view.getByRole('button', { name: 'New Agent Application' }));
    expect(await view.findByLabelText('Application Agent class')).toBeTruthy();

    // Dynamic class requirement fields appear from selected AgentClass
    expect(view.getByLabelText('Required info: bvn')).toBeTruthy();
    expect(view.getByLabelText('Required evidence: UTILITY_BILL')).toBeTruthy();

    // Client-side validation rejects short applicantReference on Save draft
    fireEvent.change(view.getByLabelText('Applicant reference'), { target: { value: 'AB' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));
    expect((await view.findByRole('alert')).textContent).toMatch(/Applicant reference is required/i);
    expect(ApiClient.post).not.toHaveBeenCalled();

    // Save valid DRAFT first
    fireEvent.change(view.getByLabelText('Applicant reference'), { target: { value: 'AGT-WUSE-901' } });
    fireEvent.change(view.getByLabelText('Business name'), { target: { value: 'Wuse Cash Point' } });
    fireEvent.change(view.getByLabelText('Contact email'), { target: { value: 'desk@wusecash.ng' } });
    fireEvent.click(view.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/agents/applications', {
        applicantReference: 'AGT-WUSE-901',
        agentClassId: CLASS_ID,
        businessName: 'Wuse Cash Point',
        contactEmail: 'desk@wusecash.ng',
      }),
    );
    expect((await view.findByRole('status')).textContent).toContain('Draft application APP-ORD-901 saved');
    // Public capability token is never leaked into DOM
    expect(view.container.textContent).not.toContain('one-time-public-capability-never-stored');

    // Attempting full submission before completing required fields + class requirements is blocked
    fireEvent.click(view.getByRole('button', { name: 'Submit application' }));
    expect((await view.findByRole('alert')).textContent).toMatch(/Principal contact name is required/i);

    // Filter queue by DRAFT and reopen via Edit draft
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    fireEvent.change(view.getByLabelText('Filter applications by status'), {
      target: { value: 'DRAFT' },
    });
    expect(view.getByText('APP-ORD-901')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Edit draft' }));
    expect(await view.findByText(/Edit Draft Application — APP-ORD-901/i)).toBeTruthy();

    // Complete required applicant, address, primary evidence, and class-specific fields and submit
    fireEvent.change(view.getByLabelText('Principal contact name'), { target: { value: 'Amina Bello' } });
    fireEvent.change(view.getByLabelText('Contact phone'), { target: { value: '+2348030001122' } });
    fireEvent.change(view.getByLabelText('Operating address'), { target: { value: '14 Aminu Kano Crescent' } });
    fireEvent.change(view.getByLabelText('Operating city'), { target: { value: 'Abuja' } });
    fireEvent.change(view.getByLabelText('Operating state'), { target: { value: 'FCT' } });
    fireEvent.change(view.getByLabelText('Primary evidence reference'), { target: { value: 'NIN-VERIFIED-901' } });
    fireEvent.change(view.getByLabelText('Required info: bvn'), { target: { value: '22233344455' } });
    fireEvent.change(view.getByLabelText('Required evidence: UTILITY_BILL'), {
      target: { value: 'AEDC-2026-10-901' },
    });

    fireEvent.click(view.getByRole('button', { name: 'Submit application' }));

    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        `/agents/applications/${DRAFT_APP_ID}`,
        expect.objectContaining({
          agentClassId: CLASS_ID,
          businessName: 'Wuse Cash Point',
          contactEmail: 'desk@wusecash.ng',
          expectedVersion: 1,
          payload: expect.objectContaining({
            contactPersonName: 'Amina Bello',
            contactPhone: '+2348030001122',
            businessAddress: '14 Aminu Kano Crescent',
            city: 'Abuja',
            state: 'FCT',
            kycDocumentReference: 'NIN-VERIFIED-901',
            classInformation: { bvn: '22233344455' },
            documentEvidence: { UTILITY_BILL: 'AEDC-2026-10-901' },
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`/agents/applications/${DRAFT_APP_ID}/submit`),
    );

    // Switch filter back to SUBMITTED and confirm it entered the standard review workflow
    fireEvent.change(view.getByLabelText('Filter applications by status'), {
      target: { value: 'SUBMITTED' },
    });
    expect(await view.findByRole('button', { name: 'Mark under review' })).toBeTruthy();
  });

  test('Priority 2: creates full Outlet/Terminal metadata, handles Arena 1 PATCH boundary (404 vs 200), and revokes Agent sessions', async () => {
    setPrincipal(
      ['AGENT_NETWORK_MANAGER'],
      [
        'agent.view',
        'agent.suspend',
        'agent.manage_outlets_terminals',
        'agent.manage_credentials',
      ],
    );

    const activeAgent = {
      id: AGENT_ID,
      reference: 'AGT-GARKI-01',
      status: 'ACTIVE',
      agentClassId: CLASS_ID,
      createdAt: '2026-10-30T08:00:00.000Z',
      updatedAt: '2026-10-30T08:00:00.000Z',
    };

    const existingOutlet = {
      id: OUTLET_ID,
      agentId: AGENT_ID,
      reference: 'OUT-GRK-01',
      code: 'GRK01',
      name: 'Garki Main Kiosk',
      displayName: 'Garki Kiosk',
      addressLine: '12 Tafawa Balewa Way',
      city: 'Abuja',
      state: 'FCT',
      country: 'NG',
      status: 'ACTIVE',
      version: 2,
    };

    const existingTerminal = {
      id: TERMINAL_ID,
      agentId: AGENT_ID,
      outletId: OUTLET_ID,
      reference: 'TRM-GRK-01',
      code: 'POS01',
      label: 'Front Counter 1',
      serialNumber: 'SN-99001',
      status: 'ACTIVE',
      version: 1,
    };

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [activeAgent], total: 1 });
      if (path === `/internal/agents/${AGENT_ID}/financial-position`) {
        return Promise.resolve({
          agentId: AGENT_ID,
          currency: 'NGN',
          balanceMinor: '500000',
          walletExists: true,
          walletId: 'wal-1',
          status: 'ACTIVE',
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/outlets`) return Promise.resolve([existingOutlet]);
      if (path === `/internal/agents/${AGENT_ID}/terminals`) return Promise.resolve([existingTerminal]);
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});

    const view = render(<AgentNetworkScreen />);
    fireEvent.click(await view.findByRole('button', { name: 'View' }));
    fireEvent.click(await view.findByRole('button', { name: 'Load outlets & terminals' }));
    expect(await view.findByText(/12 Tafawa Balewa Way/)).toBeTruthy();

    // Create outlet with full CreateOutletDto fields (displayName, code, addressLine, city, state, country)
    fireEvent.change(view.getByLabelText('Outlet reference'), { target: { value: 'OUT-GRK-02' } });
    fireEvent.change(view.getByLabelText('Outlet name'), { target: { value: 'Area 11 Annex' } });
    fireEvent.change(view.getByLabelText('Outlet display name'), { target: { value: 'Area 11 Express' } });
    fireEvent.change(view.getByLabelText('Outlet code'), { target: { value: 'GRK02' } });
    fireEvent.change(view.getByLabelText('Outlet address line'), { target: { value: '5 Gimbiya Street' } });
    fireEvent.change(view.getByLabelText('Outlet city'), { target: { value: 'Abuja' } });
    fireEvent.change(view.getByLabelText('Outlet state'), { target: { value: 'FCT' } });
    fireEvent.change(view.getByLabelText('Outlet country'), { target: { value: 'NG' } });
    fireEvent.click(view.getByRole('button', { name: 'Create outlet' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(`/internal/agents/${AGENT_ID}/outlets`, {
        reference: 'OUT-GRK-02',
        code: 'GRK02',
        name: 'Area 11 Annex',
        displayName: 'Area 11 Express',
        addressLine: '5 Gimbiya Street',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
      }),
    );

    // Edit outlet metadata: first simulate pre-merge Arena 1 404 -> honest boundary banner, no fake success
    (ApiClient.patch as jest.Mock).mockRejectedValueOnce(new ApiError('Not Found', 404));
    fireEvent.click(view.getByRole('button', { name: 'Edit outlet' }));
    fireEvent.change(view.getByLabelText('Edit outlet address for OUT-GRK-01'), {
      target: { value: '18 Tafawa Balewa Way' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save outlet changes' }));
    expect((await view.findByTestId('outlet-edit-arena1-boundary')).textContent).toContain(
      'PATCH /internal/outlets/',
    );

    // Now simulate live Arena 1 200 response -> updates cleanly with expectedVersion
    (ApiClient.patch as jest.Mock).mockResolvedValueOnce({ ...existingOutlet, version: 3 });
    fireEvent.click(view.getByRole('button', { name: 'Save outlet changes' }));
    await waitFor(() =>
      // `code` is NOT editable via PATCH: UpdateOutletMetadataDto omits it and the global
      // ValidationPipe uses forbidNonWhitelisted, so including it returns 400 on every save.
      expect(ApiClient.patch).toHaveBeenCalledWith(`/internal/outlets/${OUTLET_ID}`, {
        name: 'Garki Main Kiosk',
        displayName: 'Garki Kiosk',
        addressLine: '18 Tafawa Balewa Way',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
        expectedVersion: 2,
      }),
    );
    expect((await view.findByRole('status')).textContent).toContain('Outlet OUT-GRK-01 metadata updated');

    // Edit terminal metadata -> verify live PATCH /internal/terminals/:terminalId
    (ApiClient.patch as jest.Mock).mockResolvedValueOnce({ ...existingTerminal, version: 2 });
    fireEvent.click(view.getByRole('button', { name: 'Edit terminal' }));
    fireEvent.change(view.getByLabelText('Edit terminal label for TRM-GRK-01'), {
      target: { value: 'VIP Counter POS' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Save terminal changes' }));
    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(`/internal/terminals/${TERMINAL_ID}`, {
        label: 'VIP Counter POS',
        serialNumber: 'SN-99001',
        expectedVersion: 1,
      }),
    );

    view.unmount();

    // AgentCredentialPanel: Invalidate active sessions works even on SUSPENDED Agent, handling 404 boundary & 200 live
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const credView = render(
      <AgentCredentialPanel agentId={AGENT_ID} agentStatus="SUSPENDED" canManage />,
    );
    expect(credView.queryByRole('button', { name: 'Issue initial credential' })).toBeNull();
    expect(credView.getByRole('button', { name: 'Invalidate active sessions' })).toBeTruthy();

    (ApiClient.post as jest.Mock).mockRejectedValueOnce(new ApiError('Not Found', 404));
    fireEvent.change(credView.getByLabelText('Session revocation reason'), {
      target: { value: 'Device lost at desk' },
    });
    fireEvent.click(credView.getByRole('button', { name: 'Invalidate active sessions' }));
    expect((await credView.findByTestId('agent-session-revoke-arena1-boundary')).textContent).toContain(
      `/internal/admin/agents/${AGENT_ID}/sessions/revoke`,
    );

    (ApiClient.post as jest.Mock).mockResolvedValueOnce({ agentId: AGENT_ID, revokedCount: 2 });
    fireEvent.click(credView.getByRole('button', { name: 'Invalidate active sessions' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/admin/agents/${AGENT_ID}/sessions/revoke`,
        { reason: 'Device lost at desk' },
      ),
    );
    expect((await credView.findByRole('status')).textContent).toContain(
      'Active Agent sessions invalidated (2 sessions revoked).',
    );
  });

  test('Priority 3: enforces canonical Agent Class services, blocks unknown legacy tokens, gates limit.view, and manages AGENT_CLASS limits', async () => {
    setPrincipal(
      ['SUPER_ADMIN'],
      ['agent.view', 'agent.manage_classes', 'limit.view', 'limit.modify'],
      'PRIVILEGED',
    );

    const legacyClass = {
      id: CLASS_ID,
      reference: 'CLS-LEGACY-01',
      code: 'LEGACY_01',
      name: 'Legacy Class',
      description: 'Migrated class',
      isActive: true,
      requirements: null,
      requiredInformation: null,
      requiredDocumentCategories: null,
      applicableServices: ['CASH_TO_WALLET', 'UNKNOWN_FREEFORM_SVC'],
      applicableLimits: null,
      version: 4,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    };

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/agents/classes') return Promise.resolve([legacyClass]);
      if (path === `/internal/limit-assignments/agent-class/${CLASS_ID}`) {
        return Promise.resolve([
          {
            id: 'cls-lim-1',
            subjectType: 'AGENT_CLASS',
            subjectId: CLASS_ID,
            limitProfileCode: 'AGENT_CLASS_STD',
            isActive: true,
            version: 2,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    (ApiClient.patch as jest.Mock).mockResolvedValue({
      ...legacyClass,
      applicableServices: ['CASH_IN', 'CASH_TO_CASH'],
      version: 5,
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});

    const classesView = render(<AgentClassesScreen />);
    fireEvent.click(await classesView.findByRole('button', { name: 'Review / edit' }));

    // Legacy CASH_TO_WALLET was mapped to canonical CASH_IN
    expect((classesView.getByLabelText('Service CASH_IN') as HTMLInputElement).checked).toBe(true);

    // Attempting to save without acknowledging discard of UNKNOWN_FREEFORM_SVC is blocked
    fireEvent.click(classesView.getByRole('button', { name: 'Save class' }));
    expect((await classesView.findByRole('alert')).textContent).toMatch(
      /non-canonical service configuration/i,
    );
    expect(ApiClient.patch).not.toHaveBeenCalled();

    // Acknowledge discard, add CASH_TO_CASH, and save canonical array
    fireEvent.click(classesView.getByLabelText('Discard non-canonical service tokens on save'));
    fireEvent.click(classesView.getByLabelText('Service CASH_TO_CASH'));
    fireEvent.click(classesView.getByRole('button', { name: 'Save class' }));

    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith(
        `/internal/agents/classes/${CLASS_ID}`,
        expect.objectContaining({
          applicableServices: ['CASH_IN', 'CASH_TO_CASH'],
          expectedVersion: 4,
        }),
      ),
    );

    // Load and manage AGENT_CLASS limit assignments directly inside AgentClassesScreen
    fireEvent.click(classesView.getByRole('button', { name: 'Load class limit assignments' }));
    expect(await classesView.findByText('AGENT_CLASS_STD')).toBeTruthy();

    fireEvent.change(classesView.getByLabelText('Class limit profile code'), {
      target: { value: 'agent_class_tier2' },
    });
    fireEvent.click(classesView.getByRole('button', { name: 'Assign class limit' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/limit-assignments', {
        subjectType: 'AGENT_CLASS',
        subjectId: CLASS_ID,
        limitProfileCode: 'AGENT_CLASS_TIER2',
      }),
    );
    classesView.unmount();

    // AgentNetworkScreen: agent.assign_limit WITHOUT limit.view never calls GET /internal/limit-assignments/agent/:id
    jest.clearAllMocks();
    setPrincipal(['AGENT_NETWORK_MANAGER'], ['agent.view', 'agent.assign_limit']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: AGENT_ID,
              reference: 'AGT-NOLIMVIEW',
              status: 'ACTIVE',
              agentClassId: CLASS_ID,
              createdAt: '2026-10-30T08:00:00.000Z',
              updatedAt: '2026-10-30T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      return Promise.resolve({
        agentId: AGENT_ID,
        currency: 'NGN',
        balanceMinor: '0',
        walletExists: false,
        walletId: null,
      });
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});

    const netView = render(<AgentNetworkScreen />);
    fireEvent.click(await netView.findByRole('button', { name: 'View' }));
    expect(await netView.findByTestId('agent-limits-view-required')).toBeTruthy();
    expect(netView.queryByRole('button', { name: 'Load agent limits' })).toBeNull();

    fireEvent.change(netView.getByLabelText('Agent limit profile code'), {
      target: { value: 'AGENT_STANDARD' },
    });
    fireEvent.click(netView.getByRole('button', { name: 'Assign limit profile' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/limit-assignments', {
        subjectType: 'AGENT',
        subjectId: AGENT_ID,
        limitProfileCode: 'AGENT_STANDARD',
      }),
    );
    expect(ApiClient.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/internal/limit-assignments'),
    );
    netView.unmount();

    // LimitAssignmentScreen: AGENT_CLASS assignment & toggle with limit.view + limit.modify
    jest.clearAllMocks();
    setPrincipal(['FINANCE_CONTROLLER'], ['limit.view', 'limit.modify']);
    (ApiClient.get as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'cls-assign-9',
          subjectType: 'AGENT_CLASS',
          subjectId: CLASS_ID,
          limitProfileCode: 'AGENT_CLASS_CAP',
          isActive: true,
          version: 3,
          effectiveFrom: '2026-10-30T00:00:00.000Z',
        },
      ],
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
    (ApiClient.patch as jest.Mock).mockResolvedValue({});

    const limitScreen = render(<LimitAssignmentScreen />);
    expect(await limitScreen.findByText(`AGENT_CLASS: ${CLASS_ID}`)).toBeTruthy();

    fireEvent.change(limitScreen.getByLabelText('Agent class UUID'), {
      target: { value: CLASS_ID },
    });
    fireEvent.change(limitScreen.getByLabelText('Agent class limit profile code'), {
      target: { value: 'agent_class_vip' },
    });
    fireEvent.click(limitScreen.getByRole('button', { name: 'Assign to class' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/limit-assignments', {
        limitProfileCode: 'AGENT_CLASS_VIP',
        subjectType: 'AGENT_CLASS',
        subjectId: CLASS_ID,
      }),
    );

    fireEvent.click(limitScreen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(ApiClient.patch).toHaveBeenCalledWith('/internal/limit-assignments/cls-assign-9', {
        subjectType: 'AGENT_CLASS',
        isActive: false,
        version: 3,
      }),
    );
  });

  test('Priority 4: connects Dashboard -> Agent Network -> Agent Support Tickets -> Back to Agent, updates Deposit/Withdrawal labels, and displays Cash-to-Cash expiry status', async () => {
    setPrincipal(
      ['SUPER_ADMIN'],
      [
        'agent.view',
        'agent.review_application',
        'customer.manage_support_case',
        'transaction.view',
      ],
      'PRIVILEGED',
    );

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({
          templateKey: 'agent-ops',
          displayName: 'Agent Operations Dashboard',
          isFallback: false,
          widgets: [
            {
              widgetKey: 'agent-lifecycle-summary',
              displayName: 'Agent Lifecycle Summary',
              description: 'Counts by Agent lifecycle status.',
              order: 1,
              authorized: true,
              fetchMode: 'widget',
            },
          ],
        });
      }
      if (path === '/internal/a2/workforce/dashboard/widgets/agent-lifecycle-summary') {
        return Promise.resolve({
          byStatus: [{ status: 'ACTIVE', count: 12 }],
          pendingApplicationCount: 3,
        });
      }
      if (path.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: AGENT_ID,
              reference: 'AGT-NAV-01',
              status: 'ACTIVE',
              agentClassId: CLASS_ID,
              createdAt: '2026-10-30T08:00:00.000Z',
              updatedAt: '2026-10-30T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/financial-position`) {
        return Promise.resolve({
          agentId: AGENT_ID,
          currency: 'NGN',
          balanceMinor: '250000',
          walletExists: true,
          walletId: 'wal-nav-1',
        });
      }
      if (path.startsWith('/internal/support/tickets')) {
        return Promise.resolve({ data: [], total: 0 });
      }
      return Promise.resolve([]);
    });

    const appShell = render(<Layout />);

    // Corrected Money Movement navigation labels (Deposits / Withdrawals instead of misleading C2W/W2C)
    const rail = appShell.getByTestId('desktop-nav');
    expect(within(rail).getByTestId('nav-cashIn').textContent).toBe(
      '💸 Transaction & Fee Ops — Deposits',
    );
    expect(within(rail).getByTestId('nav-cashOut').textContent).toBe(
      '💸 Transaction & Fee Ops — Withdrawals',
    );

    // Dashboard widget navigates directly to Agent Network Management
    fireEvent.click(await appShell.findByRole('button', { name: 'Open Agent Network →' }));
    expect(await appShell.findByText('AGT-NAV-01')).toBeTruthy();

    // Open Agent drawer -> jump to Agent-filtered Support Tickets -> return to Agent Network drawer
    fireEvent.click(appShell.getByRole('button', { name: 'View' }));
    fireEvent.click(await appShell.findByTestId('open-agent-support-tickets'));

    expect(await appShell.findByTestId('support-agent-filter-banner')).toBeTruthy();
    await waitFor(() =>
      expect(ApiClient.get).toHaveBeenCalledWith(
        `/internal/support/tickets?page=1&limit=20&agentId=${AGENT_ID}`,
      ),
    );

    fireEvent.click(appShell.getByRole('button', { name: 'Back to Agent Network' }));
    expect(await appShell.findByTestId('open-agent-support-tickets')).toBeTruthy();
    appShell.unmount();

    // CashToCashOperationsScreen: 404 shows honest Arena 1 boundary; 200 renders live expiry telemetry
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/admin/cash-to-cash/expiry-status') {
        return Promise.reject(new ApiError('Not Found', 404));
      }
      return Promise.resolve({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    const c2cView = render(<CashToCashOperationsScreen />);
    expect((await c2cView.findByTestId('c2c-expiry-arena1-boundary')).textContent).toContain(
      'GET /internal/admin/cash-to-cash/expiry-status',
    );

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/admin/cash-to-cash/expiry-status') {
        return Promise.resolve({
          workerEnabled: true,
          dueUnclaimedCount: 4,
          totalUnclaimedCount: 19,
          oldestDueExpiresAt: '2026-10-30T07:15:00.000Z',
          batchSize: 50,
          pollIntervalMs: 60000,
        });
      }
      return Promise.resolve({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    fireEvent.click(c2cView.getByRole('button', { name: 'Refresh expiry status' }));
    const liveCard = await c2cView.findByTestId('c2c-expiry-live-status');
    expect(liveCard.textContent).toContain('ENABLED');
    expect(liveCard.textContent).toContain('4');
    expect(liveCard.textContent).toContain('19');
    expect(liveCard.textContent).toContain('50');
  });

  test('surfaces real 409/403 API errors without masking them as Arena 1 boundaries, auto-loads onboarding queue from Dashboard, and preserves D5/D6 policy-disabled panels', async () => {
    setPrincipal(
      ['SUPER_ADMIN'],
      [
        'agent.view',
        'agent.review_application',
        'agent.manage_classes',
        'agent.manage_outlets_terminals',
        'agent.manage_credentials',
        'customer.manage_support_case',
      ],
      'PRIVILEGED',
    );

    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({
          templateKey: 'super-admin',
          displayName: 'Super Admin Dashboard',
          isFallback: false,
          widgets: [
            {
              widgetKey: 'agent-applications-queue',
              displayName: 'Agent Applications Queue',
              description: 'Submitted onboarding applications.',
              order: 1,
              authorized: true,
              fetchMode: 'direct',
              endpoint: '/internal/agents/applications',
            },
          ],
        });
      }
      if (path === '/internal/agents/applications') {
        return Promise.resolve([
          {
            id: DRAFT_APP_ID,
            reference: 'APP-QUEUE-77',
            agentClassId: CLASS_ID,
            status: 'DRAFT',
            applicantReference: 'AGT-Q-77',
            businessName: 'Queue Ventures',
            contactEmail: 'queue@example.com',
            version: 1,
            agentId: null,
            rejectionReason: null,
            createdAt: '2026-10-30T10:00:00.000Z',
          },
        ]);
      }
      if (path === '/internal/agents/classes') {
        return Promise.resolve([
          { id: CLASS_ID, code: 'ORDINARY_STD', name: 'Ordinary Standard', isActive: true },
        ]);
      }
      if (path.startsWith('/internal/agents?')) {
        return Promise.resolve({
          data: [
            {
              id: AGENT_ID,
              reference: 'AGT-POLICY-01',
              status: 'ACTIVE',
              agentClassId: CLASS_ID,
              createdAt: '2026-10-30T08:00:00.000Z',
              updatedAt: '2026-10-30T08:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/financial-position`) {
        return Promise.resolve({
          agentId: AGENT_ID,
          currency: 'NGN',
          balanceMinor: '0',
          walletExists: false,
          walletId: null,
        });
      }
      if (path === `/internal/agents/${AGENT_ID}/outlets`) {
        return Promise.resolve([
          {
            id: OUTLET_ID,
            agentId: AGENT_ID,
            reference: 'OUT-POL-01',
            code: null,
            name: 'Policy Desk',
            displayName: null,
            addressLine: null,
            city: null,
            state: null,
            country: 'NG',
            status: 'ACTIVE',
            version: 2,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const shell = render(<Layout />);
    fireEvent.click(await shell.findByRole('button', { name: 'Open Onboarding Queue →' }));
    // Navigating from agent-applications-queue auto-loads the onboarding applications table
    expect(await shell.findByText('APP-QUEUE-77')).toBeTruthy();

    // 409 Conflict on draft creation surfaces real ApiError alert
    (ApiClient.post as jest.Mock).mockRejectedValueOnce(
      new ApiError('Applicant reference AGT-DUP-01 already exists', 409, 'CONFLICT'),
    );
    fireEvent.click(shell.getByRole('button', { name: 'New Agent Application' }));
    expect(await shell.findByLabelText('Application Agent class')).toBeTruthy();
    fireEvent.change(shell.getByLabelText('Applicant reference'), {
      target: { value: 'AGT-DUP-01' },
    });
    fireEvent.click(shell.getByRole('button', { name: 'Save draft' }));
    expect((await shell.findByRole('alert')).textContent).toContain(
      'Applicant reference AGT-DUP-01 already exists',
    );

    // Open Agent drawer: verify D5 (reclassification) and D6 (PIN unlock) remain policy-blocked
    fireEvent.click(shell.getByRole('button', { name: 'View' }));
    expect(
      (
        (await shell.findByRole('button', {
          name: 'Reclassify Agent (Policy blocked)',
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        shell.getByRole('button', {
          name: 'Clear PIN Lockout (Policy blocked)',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // 409 version conflict on Arena 1 outlet PATCH rethrows into error alert rather than boundary note
    const outletsSection = shell.getByLabelText('Agent outlets and terminals');
    fireEvent.click(within(outletsSection).getByRole('button', { name: 'Load outlets & terminals' }));
    fireEvent.click(await within(outletsSection).findByRole('button', { name: 'Edit outlet' }));
    (ApiClient.patch as jest.Mock).mockRejectedValueOnce(
      new ApiError('Outlet version conflict (expected 2, actual 3)', 409, 'CONFLICT'),
    );
    fireEvent.click(within(outletsSection).getByRole('button', { name: 'Save outlet changes' }));
    expect((await within(outletsSection).findByRole('alert')).textContent).toContain(
      'Outlet version conflict',
    );
    expect(shell.queryByTestId('outlet-edit-arena1-boundary')).toBeNull();
  });
});
