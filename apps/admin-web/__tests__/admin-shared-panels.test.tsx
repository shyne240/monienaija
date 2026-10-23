import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { CommercialRulesScreen } from '../src/screens/authenticated/CommercialRulesScreen';
import { CustomerDirectoryScreen } from '../src/screens/authenticated/CustomerDirectoryScreen';
import { SuperAdminRecoveryScreen } from '../src/screens/authenticated/SuperAdminRecoveryScreen';
import { SystemHealthScreen } from '../src/screens/authenticated/SystemHealthScreen';
import { WorkforceAdminScreen } from '../src/screens/authenticated/WorkforceAdminScreen';
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

describe('Admin Web shared-screen improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue([]);
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('Limit registry reads use the existing profile and rule endpoints and render structured rows', async () => {
    setPrincipal(['SUPER_ADMIN'], ['limit.view']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/limit-profiles') return Promise.resolve([{ code: 'AGENT_STANDARD', name: 'Agent Standard', kind: 'AGENT', status: 'ACTIVE', enabled: true }]);
      if (path === '/internal/limit-rules') return Promise.resolve({ data: [{ id: 'rule-1', limitProfileCode: 'AGENT_STANDARD', product: 'CASH_IN', currency: 'NGN', dimension: 'PER_DAY', limitValueMinor: '2500000', isActive: true }] });
      return Promise.resolve([]);
    });

    const view = render(<CommercialRulesScreen initialTab="limits" />);
    expect((await view.findAllByText('AGENT_STANDARD')).length).toBeGreaterThan(0);
    expect((await view.findAllByText('CASH_IN')).length).toBeGreaterThan(0);
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-profiles');
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-rules');
    expect(ApiClient.get).not.toHaveBeenCalledWith('/internal/limit-catalogue');
    expect(view.container.querySelector('pre')).toBeNull();
  });

  test('System Health renders structured metrics and notification deliveries, with an API-backed filter', async () => {
    setPrincipal(['SUPER_ADMIN'], ['metrics.view', 'diagnostics.view', 'outbox.view', 'notification.view_deliveries']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/metrics') return Promise.resolve({ generatedAt: '2026-10-23T10:00:00.000Z', metrics: { jobs_completed: '8' } });
      if (path === '/internal/diagnostics') return Promise.resolve({ status: 'PASS', database: { status: 'connected' }, pendingOutbox: 0 });
      if (path === '/internal/outbox') return Promise.resolve([{ id: 'outbox-1', eventType: 'customer.created', status: 'PENDING', attempts: 0, payload: { customerId: 'cust-1' } }]);
      if (path.startsWith('/internal/notifications/deliveries?')) return Promise.resolve({ data: [{ id: 'delivery-1', eventType: 'KYC_APPROVED', channel: 'SMS', recipientType: 'CUSTOMER', recipientId: 'cust-1', status: 'FAILED', attempts: 2, lastError: 'provider unavailable' }], total: 1, page: 1, limit: 20, hasNextPage: false });
      return Promise.resolve([]);
    });

    const view = render(<SystemHealthScreen />);
    expect(await view.findByText('jobs_completed')).toBeTruthy();
    expect((await view.findAllByText('customer.created')).length).toBeGreaterThan(0);
    expect((await view.findAllByText('KYC_APPROVED')).length).toBeGreaterThan(0);
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/notifications/deliveries?page=1&limit=20');
    expect(view.container.querySelector('pre')).toBeNull();

    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'FAILED' } });
    fireEvent.change(view.getByLabelText('Event type'), { target: { value: 'KYC_APPROVED' } });
    fireEvent.click(view.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/internal/notifications/deliveries?page=1&limit=20&status=FAILED&eventType=KYC_APPROVED');
    });
  });

  test('System Health route recognizes notification.view_deliveries as an existing read surface', () => {
    expect(canAccessAdminView('systemHealth', ['notification.view_deliveries'], ['FINANCE_AUDITOR'])).toBe(true);
    expect(canAccessAdminView('systemHealth', [], ['SUPER_ADMIN'])).toBe(false);
  });

  test('System Health does not request notification deliveries without notification.view_deliveries', async () => {
    setPrincipal(['FINANCE_AUDITOR'], ['metrics.view']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ generatedAt: '2026-10-23T10:00:00.000Z', metrics: {} });
    render(<SystemHealthScreen />);
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/metrics'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/notifications/deliveries'));
  });

  test('Workforce overview maps the current API shape and SUPPORT disable uses its guarded endpoint', async () => {
    setPrincipal(['ADMINISTRATOR'], ['workforce.dashboard.view', 'workforce.user.suspend']);
    (ApiClient.get as jest.Mock).mockResolvedValue({ activeWorkforceHeadcount: 7, roleDistribution: [{ roleKey: 'OPERATIONS', count: 3 }], activeSessionCount: 2 });

    const view = render(<WorkforceAdminScreen />);
    expect(await view.findByText('Active workforce headcount')).toBeTruthy();
    expect(view.getByText('7')).toBeTruthy();
    expect(view.getByText('2')).toBeTruthy();
    expect(view.getByText('OPERATIONS')).toBeTruthy();
    expect(view.container.querySelector('pre')).toBeNull();

    fireEvent.change(view.getByPlaceholderText('SUPPORT user ID'), { target: { value: 'support-user-42' } });
    fireEvent.change(view.getByPlaceholderText('Reason for disabling access'), { target: { value: 'Access no longer required' } });
    fireEvent.click(view.getByRole('button', { name: 'Disable SUPPORT User' }));
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/internal/admin/support/workforce-users/support-user-42/disable', { reason: 'Access no longer required' });
      expect(view.getByText('Support user support-user-42 disabled.')).toBeTruthy();
    });
  });

  test('Customer PII reads are lazy and displayed only for the exact granted function', async () => {
    setPrincipal(['COMPLIANCE'], ['customer.view', 'customer.view_identity_documents']);
    const customer = { id: 'cust-1', reference: 'MN-001', type: 'INDIVIDUAL', status: 'ACTIVE', actor: 'issuer:COMPLIANCE', createdAt: '2026-10-23T10:00:00.000Z' };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers') return Promise.resolve([customer]);
      if (path === '/customers/cust-1/identity-documents') return Promise.resolve([{ type: 'NIN', documentNumber: '12345678901', issuingCountry: 'NG' }]);
      return Promise.resolve([]);
    });

    const view = render(<CustomerDirectoryScreen />);
    fireEvent.click(await view.findByText('View & Service'));
    expect(await view.findByText('Identity Documents')).toBeTruthy();
    expect(view.queryByText('Addresses')).toBeNull();
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-1/identity-documents');

    fireEvent.click(view.getByRole('button', { name: 'Identity Documents' }));
    expect(await view.findByText('12345678901')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/customers/cust-1/identity-documents');
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-1/addresses');
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-1/contact-methods');
  });

  test('Customer PII sections remain absent without their dedicated catalogue functions', async () => {
    setPrincipal(['ADMINISTRATOR'], ['customer.view']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => path === '/customers'
      ? Promise.resolve([{ id: 'cust-2', reference: 'MN-002', type: 'INDIVIDUAL', status: 'ACTIVE', actor: 'issuer:ADMINISTRATOR', createdAt: '2026-10-23T10:00:00.000Z' }])
      : Promise.resolve([]));

    const view = render(<CustomerDirectoryScreen />);
    fireEvent.click(await view.findByText('View & Service'));
    expect(view.queryByText('Customer PII Records')).toBeNull();
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-2/addresses');
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-2/contact-methods');
    expect(ApiClient.get).not.toHaveBeenCalledWith('/customers/cust-2/identity-documents');
  });

  test('Super-Admin recovery displays named result fields instead of a raw JSON string', async () => {
    setPrincipal(['ADMINISTRATOR'], ['workforce.super_admin.recover']);
    (ApiClient.post as jest.Mock).mockResolvedValue({ recoveryReference: 'a2-recovery-123', operation: 'REVOKE_SUPER_ADMIN', targetPrincipalId: 'issuer:ceo', revokedSessionCount: 1, auditReference: 'audit-1' });

    const view = render(<SuperAdminRecoveryScreen />);
    fireEvent.change(view.getByPlaceholderText('Paste RS256-signed recovery statement…'), { target: { value: 'signed.statement.value' } });
    fireEvent.click(view.getByRole('button', { name: 'Execute Recovery' }));
    expect(await view.findByText('a2-recovery-123')).toBeTruthy();
    expect(view.container.querySelector('pre')).toBeNull();
  });
});
