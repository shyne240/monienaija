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

const MAKER_SCOPES = ['institution.view', 'institution.manage', 'institution.lifecycle.prepare'];
const CHECKER_SCOPES = [
  'institution.view',
  'institution.lifecycle.approve',
  'institution.attribution.view',
  'privileged:approve',
  'audit.search',
];

function mockRoutes(overrides: Record<string, unknown> = {}) {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    // Exact matches win, then the longest prefix. Without this an override for a specific
    // institution would be swallowed by the generic `/internal/institutions` list override.
    if (Object.prototype.hasOwnProperty.call(overrides, path))
      return Promise.resolve(overrides[path]);
    const prefixed = Object.entries(overrides)
      .filter(([prefix]) => path.startsWith(prefix))
      .sort((left, right) => right[0].length - left[0].length)[0];
    if (prefixed) return Promise.resolve(prefixed[1]);
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
    expect(canAccessAdminView('institutionWorkspace', ['institution.view'], ['OPERATIONS'])).toBe(
      false,
    );
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
    // The registration receipt (the mocked INSTITUTION is EVIDENCE_SUBMITTED) must name the
    // authority position AND the next step rather than a bare "created" claim.
    expect(await screen.findByText(/no financial authority yet/i)).toBeTruthy();
    // The receipt AND the refreshed directory row both carry the next step.
    expect(screen.getAllByText(/other than the requester must decide/i).length).toBeGreaterThan(0);
  });
});

describe('ARENA 4 institutional console — registration → evidence → approval', () => {
  test('a freshly registered institution is reported as holding no authority with a named next step', async () => {
    // The real backend returns REGISTERED with operationalAuthority=false for a registration.
    (ApiClient.post as jest.Mock).mockResolvedValue({
      ...INSTITUTION,
      reference: 'INST-003',
      status: 'REGISTERED',
      evidenceReference: null,
      operationalAuthority: false,
    });
    render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register institution' }));
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'INST-003' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'psp3' } });
    fireEvent.change(screen.getByLabelText('Legal name'), {
      target: { value: 'Third Example PSP' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    // Never "created successfully" — always "registered, no financial authority yet", plus what to
    // do next and who has to do it.
    expect(await screen.findByText(/no financial authority yet/i)).toBeTruthy();
    expect(screen.getAllByText(/Record regulatory evidence/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/principal other than the requester must decide/i).length,
    ).toBeGreaterThan(0);
  });

  test('each lifecycle status states its authority position and its exact next action', async () => {
    mockRoutes({
      '/internal/institutions': [
        {
          ...INSTITUTION,
          reference: 'INST-REG',
          status: 'REGISTERED',
          operationalAuthority: false,
        },
        {
          ...INSTITUTION,
          reference: 'INST-EV',
          status: 'EVIDENCE_SUBMITTED',
          operationalAuthority: false,
        },
        { ...INSTITUTION, reference: 'INST-OK', status: 'APPROVED', operationalAuthority: true },
      ],
    });
    render(<InstitutionDirectoryScreen onOpenInstitution={jest.fn()} />);
    await screen.findAllByText(/INST-REG/);

    expect(screen.getByTestId('inst-next-action-INST-REG').textContent).toMatch(
      /Record regulatory evidence/,
    );
    expect(screen.getByTestId('inst-next-action-INST-EV').textContent).toMatch(
      /other than the requester must decide/,
    );
    expect(screen.getByTestId('inst-next-action-INST-OK').textContent).toMatch(
      /Affiliations, enrolments and attribution/,
    );
    // Only the APPROVED row claims authority.
    expect(screen.getAllByText('Operational authority')).toHaveLength(1);
    expect(screen.getAllByText('No financial authority')).toHaveLength(2);
  });

  test('the workspace states status, authority and next action before offering any lifecycle form', async () => {
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    await screen.findByRole('heading', { name: 'Example MMO' });
    fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle & approvals' }));

    const guidance = await screen.findByTestId('institution-lifecycle-guidance');
    expect(guidance.textContent).toMatch(/Still no financial authority/i);
    expect(screen.getByTestId('institution-next-action').textContent).toMatch(
      /other than the requester must decide/,
    );
    expect(guidance.textContent).toMatch(/not held/i);
    // Maker-side guidance: self-approval is impossible, not merely discouraged.
    expect(guidance.textContent).toMatch(/can never be self-approved/i);
  });

  test('an authority flag that contradicts the lifecycle status is surfaced as a warning', async () => {
    // APPROVED without operationalAuthority is a contradictory record; the console must not
    // reassure the operator by quietly trusting either half.
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}`]: {
        ...INSTITUTION,
        status: 'APPROVED',
        operationalAuthority: false,
      },
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    await screen.findByRole('heading', { name: 'Example MMO' });
    fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle & approvals' }));
    expect(await screen.findByText(/Authority flag disagrees with status/i)).toBeTruthy();
    expect(screen.getByTestId('institution-lifecycle-guidance').textContent).toMatch(
      /investigate before acting/i,
    );
  });

  test('the checker sees the approval action only with the approving function, role and MFA', async () => {
    const pending = [
      {
        approvalId: APPROVAL_ID,
        actionType: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
        resourceType: 'FINANCIAL_INSTITUTION',
        resourceId: INSTITUTION_ID,
        status: 'REQUESTED',
        requesterPrincipalId: 'issuer:maker',
        approvedBy: null,
        reason: 'Promote to operational authority',
        approvalScope: 'privileged:approve',
        requiredAssurance: 'MFA',
        policy: {},
        requestedAt: '2026-11-02T10:00:00.000Z',
        expiresAt: '2026-11-02T11:00:00.000Z',
        approvedAt: null,
        awaitingChecker: true,
      },
    ];
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: pending,
    });

    // Maker: can request, must NOT see an approve control.
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: pending,
      [`/internal/institutions/${INSTITUTION_ID}`]: INSTITUTION,
    });
    const maker = render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    await screen.findByRole('heading', { name: 'Example MMO' });
    fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle & approvals' }));
    expect(await screen.findByText(/Institution lifecycle change/)).toBeTruthy();
    // The maker SEES the control but it is disabled with the reason — hiding it outright would
    // leave the requester wondering why nothing happens.
    const makerApprove = (await screen.findByRole('button', {
      name: /^Approve$/,
    })) as HTMLButtonElement;
    expect(makerApprove.disabled).toBe(true);
    expect(makerApprove.getAttribute('title')).toMatch(/different, MFA-authenticated principal/i);
    maker.unmount();

    // Checker: holds the approving function, the FINANCE_CONTROLLER role and MFA.
    setPrincipal({
      scopes: CHECKER_SCOPES,
      roles: ['FINANCE_CONTROLLER'],
      principalId: 'issuer:checker',
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({
      approvalId: APPROVAL_ID,
      status: 'APPROVED',
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    await screen.findByRole('heading', { name: 'Example MMO' });
    fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle & approvals' }));
    const approve = await screen.findByRole('button', { name: /^Approve$/ });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
        { comment: undefined },
      ),
    );
    expect(await screen.findByText(/Approval .* recorded/i)).toBeTruthy();
  });

  test('a PASSWORD-assurance checker is told approval needs MFA instead of being offered it', async () => {
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/pending-approvals`]: [
        {
          approvalId: APPROVAL_ID,
          actionType: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
          resourceType: 'FINANCIAL_INSTITUTION',
          resourceId: INSTITUTION_ID,
          status: 'REQUESTED',
          requesterPrincipalId: 'issuer:maker',
          approvedBy: null,
          reason: 'Promote to operational authority',
          approvalScope: 'privileged:approve',
          requiredAssurance: 'MFA',
          policy: {},
          requestedAt: '2026-11-02T10:00:00.000Z',
          expiresAt: '2026-11-02T11:00:00.000Z',
        },
      ],
    });
    setPrincipal({
      scopes: CHECKER_SCOPES,
      roles: ['FINANCE_CONTROLLER'],
      principalId: 'issuer:checker',
      assuranceLevel: 'PASSWORD',
    });
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    await screen.findByRole('heading', { name: 'Example MMO' });
    fireEvent.click(screen.getByRole('tab', { name: 'Lifecycle & approvals' }));
    expect(await screen.findByText(/MFA-authenticated session/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});

describe('ARENA 4 institutional console — workspace', () => {
  test('asks for an institution instead of guessing one', () => {
    render(<InstitutionWorkspaceScreen institutionId={undefined} onBackToDirectory={jest.fn()} />);
    expect(screen.getByText(/Select an institution from the directory/i)).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
  });

  test('shows the record, warns about absent authority and exposes no execution without approval', async () => {
    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    expect(await screen.findByRole('heading', { name: 'Example MMO' })).toBeTruthy();
    expect(screen.getByText(/This institution is not operationally approved/i)).toBeTruthy();
    expect(
      screen.getByText(/recorded evidence for verification, not a verified licence/i),
    ).toBeTruthy();
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
    (ApiClient.post as jest.Mock).mockResolvedValue({
      approved: true,
      approval: { status: 'APPROVED' },
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
    expect(screen.queryByRole('button', { name: /Request attribution/i })).toBeNull();
  });

  test('kyc tier-limit policy tab submits governed proposals and approves pending proposals', async () => {
    setPrincipal({
      scopes: ['institution.view', 'limit.view', 'limit.modify', 'privileged:approve'],
      roles: ['FINANCE_CONTROLLER'],
      principalId: 'issuer:checker',
    });
    mockRoutes({
      [`/internal/institutions/${INSTITUTION_ID}/kyc-tier-limit-policy/proposals`]: [
        {
          id: 'prop-1',
          version: 1,
          state: 'PENDING',
          reason: 'Initial tier mapping',
          proposedBy: 'issuer:maker',
          proposedAt: '2026-11-12T10:00:00.000Z',
        },
      ],
      [`/internal/institutions/${INSTITUTION_ID}/kyc-tier-limit-policy`]: {
        institutionId: INSTITUTION_ID,
        enforcementEnabled: true,
        current: null,
        history: [],
      },
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({ state: 'APPROVED' });

    render(
      <InstitutionWorkspaceScreen institutionId={INSTITUTION_ID} onBackToDirectory={jest.fn()} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'KYC tier-limit policy' }));
    expect(await screen.findByText(/Initial tier mapping/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tier policy reason'), {
      target: { value: 'Update institution tier limits' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Propose tier-limit policy' }));

    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/institutions/${INSTITUTION_ID}/kyc-tier-limit-policy/proposals`,
        expect.objectContaining({
          expectedVersion: 0,
          reason: 'Update institution tier limits',
        }),
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Approve proposal' }));
    await waitFor(() =>
      expect(ApiClient.post).toHaveBeenCalledWith(
        `/internal/institutions/${INSTITUTION_ID}/kyc-tier-limit-policy/proposals/prop-1/approve`,
        {},
      ),
    );
  });
});
