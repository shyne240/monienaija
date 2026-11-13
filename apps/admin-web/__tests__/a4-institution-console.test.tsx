import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';
import { InstitutionDirectoryScreen } from '../src/screens/authenticated/InstitutionDirectoryScreen';
import { InstitutionWorkspaceScreen } from '../src/screens/authenticated/InstitutionWorkspaceScreen';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const APPROVAL_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';

const INSTITUTION = {
  id: INSTITUTION_ID,
  reference: 'INST-001',
  code: 'MMO1',
  legalName: 'Example Mobile Money Ltd',
  displayName: 'Example MMO',
  institutionType: 'MMO',
  regulatorName: 'Central Regulator',
  licenceReference: 'LIC-REF-1',
  evidenceReference: 'EV-REF-1',
  evidenceDigest: null,
  status: 'EVIDENCE_SUBMITTED',
  statusReason: null,
  operationalAuthority: false,
  operationalApprovedAt: null,
  suspendedAt: null,
  closedAt: null,
  version: 2,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

function setPrincipal(options: {
  scopes: string[];
  roles?: string[];
  principalId?: string;
  assuranceLevel?: 'MFA' | 'PASSWORD';
}) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId: options.principalId ?? 'issuer:maker',
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles: options.roles ?? ['OPERATIONS'],
      scopes: options.scopes,
      customerAccess: 'NONE',
      assuranceLevel: options.assuranceLevel ?? 'MFA',
    },
  } as never);
}

const MAKER_SCOPES = [
  'institution.view',
  'institution.manage',
  'institution.lifecycle.prepare',
];
const CHECKER_SCOPES = [
  'institution.view',
  'institution.lifecycle.approve',
  'institution.attribution.view',
  'privileged:approve',
  'audit.search',
];

function mockRoutes(overrides: Record<string, unknown> = {}) {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    for (const [prefix, value] of Object.entries(overrides)) {
      if (path === prefix || path.startsWith(prefix)) return Promise.resolve(value);
    }
    if (path === '/internal/institutions') return Promise.resolve([INSTITUTION]);
    if (path === `/internal/institutions/${INSTITUTION_ID}`) return Promise.resolve(INSTITUTION);
    if (path === '/internal/institution-ledger/coverage') return Promise.resolve([]);
    if (path === '/internal/institutions/attribution-gaps/summary') return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  (global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
  window.confirm = jest.fn(() => true);
  mockRoutes();
  setPrincipal({ scopes: MAKER_SCOPES });
});

describe('ARENA 4 institutional console — navigation guard', () => {
  test('institution views require institution.view and the workspace requires an institution context', () => {
    expect(canAccessAdminView('institutions', ['institution.view'], ['OPERATIONS'])).toBe(true);
    expect(canAccessAdminView('institutions', [], ['OPERATIONS'])).toBe(false);
    expect(canAccessAdminView('institutions', ['customer.view'], ['OPERATIONS'])).toBe(false);
    expect(
      canAccessAdminView('institutionWorkspace', ['institution.view'], ['OPERATIONS'], {
        institutionId: INSTITUTION_ID,
      }),
    ).toBe(true);
    expect(
      canAccessAdminView('institutionWorkspace', ['institution.view'], ['OPERATIONS']),
    ).toBe(false);
  });
});

describe('ARENA 4 institutional console — directory', () => {
  test('lists institutions and states that evidence is not authorisation', async () => {
    render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    expect(await screen.findByText('Example MMO')).toBeTruthy();
    expect(screen.getByText('No financial authority')).toBeTruthy();
    expect(screen.getByText(/never proof of a valid licence/i)).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/institutions');
  });

  test('hides registration without institution.manage and shows it with the scope', async () => {
    setPrincipal({ scopes: ['institution.view'] });
    const readOnly = render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    expect(await screen.findByText('Example MMO')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register institution' })).toBeNull();
    readOnly.unmount();

    setPrincipal({ scopes: ['institution.view', 'institution.manage'] });
    render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register institution' }));
    const panel = screen.getByRole('heading', { name: 'Register institution' });
    expect(panel).toBeTruthy();
    expect(screen.getByLabelText('Licence reference (optional)')).toBeTruthy();
    expect(screen.getByText(/it never activates the institution/i)).toBeTruthy();
  });

  test('registration posts the administrative payload and does not claim authority', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ ...INSTITUTION, reference: 'INST-002' });
    render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register institution' }));
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'INST-002' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'mmo2' } });
    fireEvent.change(screen.getByLabelText('Legal name'), {
      target: { value: 'Second Example MMO' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/institutions', {
        reference: 'INST-002',
        code: 'MMO2',
        legalName: 'Second Example MMO',
        displayName: undefined,
        institutionType: 'MMO',
        regulatorName: undefined,
        licenceReference: undefined,
      }),
    );
    expect(await screen.findByText(/holds no financial authority until/i)).toBeTruthy();
  });
});

describe('ARENA 4 institutional console — workspace', () => {
  test('asks for an institution instead of guessing one', () => {
    render(
      <InstitutionWorkspaceScreen institutionId={undefined} onBackToDirectory={jest.fn()} />,
    );
    expect(screen.getByText(/Select an institution from the directory/i)).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
  });

  test('shows the record, warns about absent authority and exposes no execution without approval', async () => {
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    expect(await screen.findByRole('heading', { name: 'Example MMO' })).toBeTruthy();
    expect(screen.getByText(/This institution is not operationally approved/i)).toBeTruthy();
    expect(screen.getByText(/recorded evidence for verification, not a verified licence/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Execute approved change/i })).toBeNull();
  });

  test('a lifecycle request creates a governed approval and reports the checker requirement', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({
      approvalId: APPROVAL_ID,
      status: 'REQUESTED',
      actionFingerprint: 'f'.repeat(64),
      expiresAt: '2026-11-13T12:00:00.000Z',
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Lifecycle & approvals' }));
    const reason = await screen.findByLabelText('Reason');
    fireEvent.change(reason, { target: { value: 'Regulator confirmed the operational licence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request change' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/institutions/${INSTITUTION_ID}/lifecycle/request`,
        {
          targetStatus: 'APPROVED',
          reason: 'Regulator confirmed the operational licence.',
        },
      ),
    );
    expect(await screen.findByText(new RegExp(APPROVAL_ID))).toBeTruthy();
    expect(screen.getByText(/must be decided by a different principal/i)).toBeTruthy();
  });

  test('an open request cannot be approved by its own requester even with approval scopes', async () => {
    setPrincipal({
      scopes: [...CHECKER_SCOPES, 'institution.lifecycle.prepare'],
      roles: ['FINANCE_CONTROLLER'],
      principalId: 'issuer:self',
    });
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: [
        {
          approvalId: APPROVAL_ID,
          actionType: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
          resourceType: 'FINANCIAL_INSTITUTION',
          resourceId: INSTITUTION_ID,
          requesterPrincipalId: 'issuer:self',
          approvedBy: null,
          status: 'REQUESTED',
          reason: 'Regulator confirmed the operational licence.',
          requestedAt: '2026-11-12T10:00:00.000Z',
          expiresAt: '2026-11-12T11:00:00.000Z',
          approvedAt: null,
          awaitingChecker: true,
        },
      ],
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Lifecycle & approvals' }));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approve);
    expect(ApiClient.post).not.toHaveBeenCalledWith(
      `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
      expect.anything(),
    );
  });

  test('the approving function alone is not enough: the configured checker role is required', async () => {
    setPrincipal({
      scopes: CHECKER_SCOPES,
      roles: ['ADMINISTRATOR'],
      principalId: 'issuer:admin',
    });
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: [
        {
          approvalId: APPROVAL_ID,
          actionType: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
          resourceType: 'FINANCIAL_INSTITUTION',
          resourceId: INSTITUTION_ID,
          requesterPrincipalId: 'issuer:maker',
          approvedBy: null,
          status: 'REQUESTED',
          reason: 'Regulator confirmed the operational licence.',
          requestedAt: '2026-11-12T10:00:00.000Z',
          expiresAt: '2026-11-12T11:00:00.000Z',
          approvedAt: null,
          awaitingChecker: true,
        },
      ],
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Lifecycle & approvals' }));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('an independent MFA checker approves through the existing approval endpoint', async () => {
    setPrincipal({
      scopes: CHECKER_SCOPES,
      roles: ['FINANCE_CONTROLLER'],
      principalId: 'issuer:checker',
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ approved: true, approval: { status: 'APPROVED' } });
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: [
        {
          approvalId: APPROVAL_ID,
          actionType: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
          resourceType: 'FINANCIAL_INSTITUTION',
          resourceId: INSTITUTION_ID,
          requesterPrincipalId: 'issuer:maker',
          approvedBy: null,
          status: 'REQUESTED',
          reason: 'Regulator confirmed the operational licence.',
          requestedAt: '2026-11-12T10:00:00.000Z',
          expiresAt: '2026-11-12T11:00:00.000Z',
          approvedAt: null,
          awaitingChecker: true,
        },
      ],
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Lifecycle & approvals' }));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
        { comment: undefined },
      ),
    );
    expect(await screen.findByText(/Approval .* recorded/i)).toBeTruthy();
  });

  test('execution requires an approval id and a confirmation before the write', async () => {
    setPrincipal({ scopes: ['institution.view', 'institution.lifecycle.approve'] });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Lifecycle & approvals' }));
    const execute = await screen.findByRole('button', { name: /Execute approved change/i });
    fireEvent.click(execute);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(ApiClient.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Approval id'), { target: { value: APPROVAL_ID } });
    fireEvent.change(screen.getByLabelText('Reason (as approved)'), {
      target: { value: 'Regulator confirmed the operational licence.' },
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ ...INSTITUTION, status: 'APPROVED' });
    fireEvent.click(execute);

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/institutions/${INSTITUTION_ID}/lifecycle`,
        {
          approvalId: APPROVAL_ID,
          targetStatus: 'APPROVED',
          reason: 'Regulator confirmed the operational licence.',
        },
      ),
    );
    expect(await screen.findByText(/now APPROVED/i)).toBeTruthy();
  });

  test('accounts tab explains why posted ledger history cannot be attributed', async () => {
    setPrincipal({ scopes: ['institution.view', 'institution.attribution.view'] });
    mockRoutes({
      '/internal/institution-ledger/unattributed': [
        {
          entity: 'WALLET',
          entityId: WALLET_ID,
          ownerClass: 'CUSTOMER',
          ownerReference: 'CUS-001',
          currency: 'NGN',
          status: 'ACTIVE',
          ledgerAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ledgerLineCount: 4,
          balanceMinor: '250000',
        },
      ],
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Accounts & attribution' }));
    expect(await screen.findByText('Posted history — not attributable')).toBeTruthy();
    expect(screen.getByText(/no institutional attribution/i)).toBeTruthy();
    expect(screen.getByText(/never migrates a balance/i)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Request attribution/i }),
    ).toBeNull();
  });
});
