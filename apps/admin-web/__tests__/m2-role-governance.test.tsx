import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RoleAssignmentScreen } from '../src/screens/authenticated/RoleAssignmentScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
const principal = (id: string, scopes: string[]) =>
  useAuthStore.setState({
    principal: {
      type: 'PRIVILEGED',
      principalId: id,
      sessionId: id,
      audience: 'workforce-admin',
      roles: ['SUPER_ADMIN'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
function fill() {
  fireEvent.change(screen.getByLabelText('Target Principal ID (e.g. issuer:subject)'), {
    target: { value: 'synthetic-target' },
  });
  fireEvent.change(screen.getByLabelText('Effective From'), {
    target: { value: '2026-10-23T10:00' },
  });
  fireEvent.change(screen.getByLabelText('Effective To'), {
    target: { value: '2027-10-23T10:00' },
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  principal('one', ['workforce.role.assign', 'workforce.role.assign_operational']);
});
test('role governance freezes action context while submitting and ignores completion after a principal change', async () => {
  let resolve!: (v: any) => void;
  const pending = new Promise<any>((r) => {
    resolve = r;
  });
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
  expect(
    (screen.getByRole('button', { name: 'Operational Roles' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  act(() => principal('two', ['workforce.role.assign', 'workforce.role.assign_operational']));
  await act(async () => {
    resolve({ status: 'ACTIVE' });
    await pending;
  });
  expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
  expect(
    (screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value,
  ).toBe('');
});
test('an inconsistent role receipt does not claim success', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'REVOKED' });
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
  expect(await screen.findByText(/outcome is unconfirmed/i)).toBeTruthy();
  expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
});
test('a status-only receipt cannot prove which role or principal changed', async () => {
  (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
  expect(await screen.findByText(/outcome is unconfirmed/i)).toBeTruthy();
  expect(screen.queryByText('Finance role assigned successfully.')).toBeNull();
});
test('role assignment requires MFA and clears draft when assurance changes', () => {
  render(<RoleAssignmentScreen />);
  fill();
  act(() =>
    useAuthStore.setState((state) => ({
      principal: { ...state.principal!, assuranceLevel: 'PASSWORD' },
    })),
  );
  expect(
    (screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value,
  ).toBe('');
  expect(
    (screen.getByRole('button', { name: 'Commit Role Assignment' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/MFA session assurance is required/)).toBeTruthy();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('review captures the role, principal and UTC window; Escape cancels and restores focus without a write', () => {
  render(<RoleAssignmentScreen />);
  fill();
  const trigger = screen.getByRole('button', { name: 'Commit Role Assignment' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Confirm role assignment' });
  expect(dialog.textContent).toContain('synthetic-target');
  expect(dialog.textContent).toContain('FINANCE_PREPARER');
  expect(dialog.textContent).toContain(new Date('2026-10-23T10:00').toISOString());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm role change' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('review freezes finance approvals and a session change dismisses the review', () => {
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.change(
    screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),
    { target: { value: 'approval-a, approval-b' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  expect(screen.getByRole('dialog').textContent).toContain('approval-a, approval-b');
  expect(
    (screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement)
      .disabled,
  ).toBe(true);
  act(() => principal('two', ['workforce.role.assign']));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('in-flight review is single flight and cannot be dismissed while executing', async () => {
  let resolve!: (v: any) => void;
  const pending = new Promise<any>((r) => {
    resolve = r;
  });
  (ApiClient.post as jest.Mock).mockReturnValue(pending);
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
  expect(document.activeElement).toBe(screen.getByRole('dialog'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve({
      assignmentReference: 'synthetic-reference',
      assignmentVersion: 1,
      status: 'ACTIVE',
      principalId: 'synthetic-target',
      roleKey: 'FINANCE_PREPARER',
      assignedBy: 'one',
      assignedAt: '2026-10-23T09:00:00Z',
      effectiveFrom: new Date('2026-10-23T10:00').toISOString(),
      effectiveTo: new Date('2027-10-23T10:00').toISOString(),
    });
    await pending;
  });
  expect(screen.getByText('Finance role assigned successfully.')).toBeTruthy();
  expect(screen.getByText(/Target:/).textContent).toContain('synthetic-target');
});

test('read-only principal cannot write despite privileged role and mutation scopes', () => {
  act(() =>
    useAuthStore.setState((state) => ({
      principal: { ...state.principal!, readOnlyPrincipal: true },
    })),
  );
  render(<RoleAssignmentScreen />);
  expect(screen.getByText(/session that is not read-only/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Commit Role Assignment' })).toBeNull();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('a mismatched assignment window locks all changes until independent role and audit review', async () => {
  const report = jest.fn();
  (ApiClient.post as jest.Mock).mockResolvedValue({
    assignmentReference: 'ref',
    assignmentVersion: 1,
    status: 'ACTIVE',
    principalId: 'synthetic-target',
    roleKey: 'FINANCE_PREPARER',
    assignedBy: 'one',
    assignedAt: '2026-10-23T09:00:00Z',
    effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: '2027-10-23T10:00:00Z',
  });
  render(<RoleAssignmentScreen onRoleGuardChange={report} />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
  await screen.findByText(/outcome is unconfirmed/);
  expect(screen.getByLabelText('Local role change draft').textContent).toContain(
    'OUTCOME UNCONFIRMED',
  );
  expect(screen.getByLabelText('Local role change draft').textContent).not.toContain(
    'NOT SUBMITTED',
  );
  expect(
    (screen.getByRole('button', { name: 'Commit Role Assignment' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Operational Roles' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/fresh read cannot exclude a late commit/)).toBeTruthy();
  expect(report).toHaveBeenLastCalledWith(true, false);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.submit(screen.getByRole('button', { name: 'Commit Role Assignment' }).closest('form')!);
  expect(ApiClient.post).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'I reviewed the role, approvals and audit history' }),
  );
  expect(
    (screen.getByRole('button', { name: 'Commit Role Assignment' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByLabelText('Target Principal ID (e.g. issuer:subject)') as HTMLInputElement).value,
  ).toBe('synthetic-target');
});

test('changing role domain protects entered approval identifiers', () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<RoleAssignmentScreen />);
  fireEvent.change(
    screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),
    { target: { value: 'approval-one' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Operational Roles' }));
  expect(
    screen.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),
  ).toHaveProperty('value', 'approval-one');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Operational Roles' }));
  expect(
    screen.queryByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)'),
  ).toBeNull();
  confirm.mockRestore();
});

test('a store session change clears the local role draft and pending review', () => {
  render(<RoleAssignmentScreen />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  act(() => useAuthStore.setState({ sessionId: 'different-session' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Target Principal ID (e.g. issuer:subject)')).toHaveProperty(
    'value',
    '',
  );
});

test('shell navigation protects a role governance draft', async () => {
  const { Layout } = await import('../src/screens/authenticated/Layout');
  useAuthStore.setState({ isAuthenticated: true });
  const view = render(<Layout />);
  fireEvent.click(view.getByTestId('nav-roleGovernance'));
  fill();
  fireEvent.click(view.getByTestId('nav-dashboard'));
  expect(view.getByRole('dialog', { name: 'Leave role change review?' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Keep working' }));
  expect(view.getByLabelText('Target Principal ID (e.g. issuer:subject)')).toHaveProperty(
    'value',
    'synthetic-target',
  );
  fireEvent.click(view.getByTestId('nav-dashboard'));
  fireEvent.click(view.getByRole('button', { name: 'Discard and leave' }));
  expect(view.queryByLabelText('Target Principal ID (e.g. issuer:subject)')).toBeNull();
});

test('local summary tracks the governed draft without implying a current assignment or writing', () => {
  render(<RoleAssignmentScreen />);
  const summary = screen.getByLabelText('Local role change draft');
  expect(summary.textContent).toContain('NOT SUBMITTED');
  expect(summary.textContent).toContain('Not entered');
  fill();
  expect(summary.textContent).toContain('synthetic-target');
  expect(summary.textContent).toContain('Entered · review UTC before sending');
  fireEvent.click(screen.getByRole('button', { name: 'Operational Roles' }));
  expect(summary.textContent).toContain('OPERATIONS');
  expect(summary.textContent).toContain('synthetic-target');
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(ApiClient.delete).not.toHaveBeenCalled();
});

/* ------------------------------------------------------------------------------------------
 * Arena B9 — an operator must see the target's current roles before preparing a change.
 * ---------------------------------------------------------------------------------------- */

const targetDetail = (roleStatus: 'ACTIVE' | 'REVOKED' | null, roleKey = 'OPERATIONS') => ({
  principalId: 'synthetic-target',
  principalType: 'WORKFORCE',
  accountStatus: roleStatus === 'ACTIVE' ? 'ACTIVE' : 'NO_CURRENT_GRANT',
  roles: roleStatus
    ? [{ roleKey, status: roleStatus, readOnly: roleKey === 'FINANCE_AUDITOR' }]
    : [],
  readOnlyPrincipal: false,
  institutionScope: {
    mode: 'INSTITUTIONS',
    platformFunctionGranted: false,
    active: [
      {
        institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        institutionName: 'Example Bank',
        code: 'EXB',
      },
    ],
    revokedCount: 1,
  },
  sessions: [
    {
      id: 'session-1',
      status: 'ACTIVE',
      assuranceLevel: 'MFA',
      audience: 'workforce-admin',
      lastSeenAt: '2026-11-22T06:00:00Z',
      expiresAt: '2026-11-22T06:15:00Z',
      revokedAt: null,
    },
  ],
  effectivePermissions: [
    {
      functionCode: 'customer.view',
      accessType: 'VIEW',
      domain: 'CUSTOMER',
      name: 'View customer',
      sensitivity: 'READ',
    },
  ],
  administrativeAuthorizations: [],
  boundaries: { readOnly: true, note: 'read-only projection' },
});

const fillWindow = () => {
  fireEvent.change(screen.getByLabelText('Effective From'), {
    target: { value: '2026-10-23T10:00' },
  });
  fireEvent.change(screen.getByLabelText('Effective To'), {
    target: { value: '2027-10-23T10:00' },
  });
};

test("a prefilled target's current roles, permissions and institution scope are read before a change", async () => {
  principal('admin-one', [
    'workforce.role.assign_operational',
    'workforce.role.revoke_operational',
    'workforce.role.view',
  ]);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    expect(path).toBe('/internal/workforce/directory/synthetic-target');
    return Promise.resolve(targetDetail(null));
  });
  render(<RoleAssignmentScreen initialTargetPrincipalId="synthetic-target" />);
  const identity = await screen.findByTestId('role-target-identity');
  expect(identity.textContent).toContain('No catalogue role assignment');
  expect(identity.textContent).toContain('1 total');
  expect(identity.textContent).toContain('Example Bank');
  expect(identity.textContent).toContain('1 revoked in history');
  expect(screen.getByText('Prefilled from the workforce directory.')).toBeTruthy();
  // Nothing is written by reading an identity.
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(ApiClient.delete).not.toHaveBeenCalled();
});

test('an identity that already holds the selected role blocks a duplicate assignment', async () => {
  principal('admin-one', ['workforce.role.assign_operational', 'workforce.role.view']);
  (ApiClient.get as jest.Mock).mockResolvedValue(targetDetail('ACTIVE'));
  render(<RoleAssignmentScreen initialTargetPrincipalId="synthetic-target" />);
  expect(await screen.findByTestId('role-target-identity')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(
    'already holds an active OPERATIONS assignment',
  );
  const submit = screen.getByRole('button', { name: 'Commit Role Assignment' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fillWindow();
  fireEvent.click(submit);
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('revoking a role the target does not hold is blocked with the reason stated', async () => {
  principal('admin-one', [
    'workforce.role.assign_operational',
    'workforce.role.revoke_operational',
    'workforce.role.view',
  ]);
  (ApiClient.get as jest.Mock).mockResolvedValue(targetDetail('REVOKED'));
  render(<RoleAssignmentScreen initialTargetPrincipalId="synthetic-target" />);
  expect(await screen.findByTestId('role-target-identity')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Operational Role' }));
  expect(screen.getByRole('alert').textContent).toContain('nothing to revoke');
  expect(
    (screen.getByRole('button', { name: 'Execute Revocation' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(ApiClient.delete).not.toHaveBeenCalled();
});

test('without workforce.role.view the form says the identity is unverified and still allows the governed request', async () => {
  principal('admin-one', ['workforce.role.assign_operational']);
  render(<RoleAssignmentScreen initialTargetPrincipalId="synthetic-target" />);
  const problem = await screen.findByTestId('role-target-identity-problem');
  expect(problem.textContent).toContain(
    'Identity lookup requires the workforce.role.view function',
  );
  expect(ApiClient.get).not.toHaveBeenCalled();
  fillWindow();
  fireEvent.click(screen.getByRole('button', { name: 'Commit Role Assignment' }));
  expect(screen.getByRole('dialog', { name: 'Confirm role assignment' })).toBeTruthy();
  expect(screen.getByRole('dialog').textContent).toContain('Not verified in this form');
});
