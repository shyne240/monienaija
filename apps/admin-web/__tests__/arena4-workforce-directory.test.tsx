import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { WorkforceDirectoryScreen } from '../src/screens/authenticated/WorkforceDirectoryScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const directory = {
  data: [
    {
      principalId: 'workforce-principal-a',
      principalType: 'WORKFORCE',
      accountStatus: 'ACTIVE',
      roles: [{ roleKey: 'SUPER_ADMIN', status: 'ACTIVE', readOnly: false }],
      readOnlyPrincipal: false,
      institutionScope: {
        mode: 'INSTITUTIONS',
        platformFunctionGranted: true,
        active: [
          {
            institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            institutionName: 'Example Bank',
          },
        ],
        revokedCount: 0,
      },
      activeSessionCount: 1,
      lastSeenAt: '2026-11-22T06:00:00Z',
      permissionCount: 12,
      privilegedPermissionCount: 4,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
  accessMode: 'READ_ONLY',
};

const detail = {
  principalId: 'workforce-principal-a',
  principalType: 'WORKFORCE',
  accountStatus: 'ACTIVE',
  roles: [{ roleKey: 'SUPER_ADMIN', status: 'ACTIVE', readOnly: false }],
  institutionScope: {
    mode: 'INSTITUTIONS',
    platformFunctionGranted: true,
    active: [
      { institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', institutionName: 'Example Bank' },
    ],
    revokedCount: 0,
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
      functionCode: 'audit.view',
      accessType: 'VIEW',
      domain: 'AUDIT',
      name: 'View audit record',
      sensitivity: 'READ',
    },
    {
      functionCode: 'workforce.role.assign',
      accessType: 'INITIATE',
      domain: 'WORKFORCE',
      name: 'Assign workforce role',
      sensitivity: 'PRIVILEGED',
    },
  ],
  administrativeAuthorizations: [
    {
      functionCode: 'workforce.role.assign',
      domain: 'WORKFORCE',
      name: 'Assign workforce role',
    },
  ],
  boundaries: {
    readOnly: true,
    note: 'Read-only projection. It cannot grant, revoke or elevate.',
  },
};

function session(scopes: string[], roles: string[] = ['ADMINISTRATOR']) {
  useAuthStore.setState({
    isAuthenticated: true,
    token: 's',
    sessionId: 's',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 's',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  session(['workforce.role.view']);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/workforce/directory?')) return Promise.resolve(directory);
    if (path.startsWith('/internal/workforce/directory/')) return Promise.resolve(detail);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

test('requires workforce.role.view and never issues a write request', () => {
  session(['notification.view_deliveries']);
  render(<WorkforceDirectoryScreen />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(ApiClient.get).not.toHaveBeenCalled();
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('lists workforce users with roles, institution scope and account status', async () => {
  render(<WorkforceDirectoryScreen />);
  expect(await screen.findByText('workforce-principal-a')).toBeTruthy();
  expect(screen.getByText('SUPER_ADMIN')).toBeTruthy();
  expect(screen.getByText('1 institution')).toBeTruthy();
  expect(screen.getByTestId('a4-workforce-readonly-notice').textContent).toContain('Read-only');
});

test('normalizes the role filter and sends it server-side', async () => {
  render(<WorkforceDirectoryScreen />);
  await screen.findByText('workforce-principal-a');
  fireEvent.change(screen.getByLabelText('Role key'), {
    target: { value: 'finance_auditor' },
  });
  fireEvent.change(screen.getByLabelText('Account status'), {
    target: { value: 'ACTIVE' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  const calls = (ApiClient.get as jest.Mock).mock.calls.map((call) => String(call[0]));
  expect(calls.some((path) => path.includes('roleKey=FINANCE_AUDITOR'))).toBe(true);
  expect(calls.some((path) => path.includes('status=ACTIVE'))).toBe(true);
});

test('detail shows effective permissions and the no-elevation boundary', async () => {
  render(<WorkforceDirectoryScreen />);
  await screen.findByText('workforce-principal-a');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));

  expect(await screen.findByText('Effective permissions (2)')).toBeTruthy();
  expect(screen.getAllByText(/workforce\.role\.assign/).length).toBeGreaterThan(0);
  expect(screen.getByText('Administrative authorizations')).toBeTruthy();
  expect(document.body.textContent).toContain('MFA');
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/workforce/directory/workforce-principal-a');
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(ApiClient.patch).not.toHaveBeenCalled();
});

test('an authorized operator hands the inspected identity to the governed role workspace', async () => {
  session(['workforce.role.view', 'workforce.role.assign_operational']);
  const onGovernAccess = jest.fn();
  render(<WorkforceDirectoryScreen onGovernAccess={onGovernAccess} />);
  await screen.findByText('workforce-principal-a');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  const govern = await screen.findByTestId('a4-govern-access');
  fireEvent.click(govern);
  expect(onGovernAccess).toHaveBeenCalledWith('workforce-principal-a');
  // The directory itself still performs no write: only the role route can change access.
  expect(ApiClient.post).not.toHaveBeenCalled();
  expect(ApiClient.patch).not.toHaveBeenCalled();
  expect(ApiClient.delete).not.toHaveBeenCalled();
});

test('a view-only operator sees the identity but is told governing needs a role function', async () => {
  render(<WorkforceDirectoryScreen onGovernAccess={jest.fn()} />);
  await screen.findByText('workforce-principal-a');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  await screen.findByText('Effective permissions (2)');
  expect(screen.queryByTestId('a4-govern-access')).toBeNull();
  expect(document.body.textContent).toContain(
    'changing access requires a role-assignment function',
  );
});
