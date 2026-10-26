import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { RoleAssignmentScreen } from '../src/screens/authenticated/RoleAssignmentScreen';
import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setPrincipal(roles: string[], scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: roles.includes('SUPER_ADMIN') ? 'PRIVILEGED' : 'OPERATOR',
      principalId: `issuer:${roles[0] ?? 'test'}`,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Admin Web operational role governance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.post as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    (ApiClient.delete as jest.Mock).mockResolvedValue({ status: 'REVOKED' });
  });

  test('ADMINISTRATOR can assign only one of the six existing operational roles through the guarded endpoint', async () => {
    setPrincipal(['ADMINISTRATOR'], ['workforce.role.assign_operational']);
    expect(canAccessAdminView('roleGovernance', ['workforce.role.assign_operational'], ['ADMINISTRATOR'])).toBe(true);
    expect(canAccessAdminView('roleGovernance', ['workforce.role.assign_operational'], ['FINANCE_AUDITOR'])).toBe(false);

    const view = render(<RoleAssignmentScreen />);
    expect(view.getByText('Operational Role Assignments')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Assign Finance Role' })).toBeNull();
    expect(view.getByRole('option', { name: 'OPERATIONS' })).toBeTruthy();
    expect(view.getByRole('option', { name: 'AGENT_NETWORK_MANAGER' })).toBeTruthy();
    expect(view.getByRole('option', { name: 'COMPLIANCE' })).toBeTruthy();
    expect(view.getByRole('option', { name: 'RISK_FRAUD' })).toBeTruthy();
    expect(view.getByRole('option', { name: 'CUSTOMER_SERVICE' })).toBeTruthy();
    expect(view.getByRole('option', { name: 'TREASURY' })).toBeTruthy();
    expect(view.queryByRole('option', { name: /FINANCE_|SUPER_ADMIN/ })).toBeNull();

    fireEvent.change(view.getByLabelText('Target Principal ID (e.g. issuer:subject)'), { target: { value: 'issuer:operator-27' } });
    fireEvent.change(view.getByLabelText('Select Role Entitlement'), { target: { value: 'COMPLIANCE' } });
    fireEvent.change(view.getByLabelText('Effective From'), { target: { value: '2026-10-23T10:00' } });
    fireEvent.change(view.getByLabelText('Effective To'), { target: { value: '2027-10-23T10:00' } });
    fireEvent.click(view.getByRole('button', { name: 'Commit Role Assignment' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/a2/workforce/roles', {
        targetPrincipalId: 'issuer:operator-27',
        roleKey: 'COMPLIANCE',
        effectiveFrom: new Date('2026-10-23T10:00').toISOString(),
        effectiveTo: new Date('2027-10-23T10:00').toISOString(),
      });
      expect(view.getByText('Operational role assigned successfully.')).toBeTruthy();
    });
  });

  test('ADMINISTRATOR revokes an operational role through the existing DELETE endpoint and sends no approval IDs', async () => {
    setPrincipal(['ADMINISTRATOR'], ['workforce.role.revoke_operational']);
    const view = render(<RoleAssignmentScreen />);
    expect(view.getByRole('button', { name: 'Revoke Operational Role' })).toBeTruthy();
    fireEvent.change(view.getByLabelText('Target Principal ID (e.g. issuer:subject)'), { target: { value: 'issuer:operator-28' } });
    fireEvent.change(view.getByLabelText('Select Role Entitlement'), { target: { value: 'TREASURY' } });
    fireEvent.change(view.getByLabelText('Effective From'), { target: { value: '2026-10-23T10:00' } });
    fireEvent.change(view.getByLabelText('Effective To'), { target: { value: '2027-10-23T10:00' } });
    fireEvent.click(view.getByRole('button', { name: 'Execute Revocation' }));

    await waitFor(() => {
      expect(ApiClient.delete).toHaveBeenCalledWith('/internal/a2/workforce/roles/issuer%3Aoperator-28/TREASURY', {
        body: {
          effectiveFrom: new Date('2026-10-23T10:00').toISOString(),
          effectiveTo: new Date('2027-10-23T10:00').toISOString(),
          approvalIds: [],
        },
      });
      expect(view.getByText('Operational role revoked successfully.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN finance role flow remains separate and retains its approval reference field', () => {
    setPrincipal(['SUPER_ADMIN'], ['workforce.role.assign']);
    const view = render(<RoleAssignmentScreen />);
    expect(view.getByText('Finance Role Assignments')).toBeTruthy();
    expect(view.getByLabelText('Related Maker-Checker Approval IDs (comma separated, when required)')).toBeTruthy();
    expect(view.queryByRole('option', { name: 'OPERATIONS' })).toBeNull();
  });
});
