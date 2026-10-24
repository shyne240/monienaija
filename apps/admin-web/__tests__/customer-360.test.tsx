import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import App from '../src/App';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const customer = {
  id: 'batch1-app-customer-360',
  reference: 'mn-••••4321',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic App Customer 360',
  legalName: 'Synthetic App Customer 360 Legal',
  createdAt: '2026-09-12T12:00:00.000Z',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
};

const dashboard = {
  templateKey: 'DEFAULT_FALLBACK',
  displayName: 'Synthetic Workforce Dashboard',
  description: '',
  isFallback: true,
  widgets: [],
};

function setPrincipal() {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'PRIVILEGED',
      principalId: 'issuer:batch1-test-super-admin',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['SUPER_ADMIN'],
      scopes: [
        'customer.view',
        'customer.view_transactions',
        'customer.view_wallets',
        'transaction.view',
      ],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

function mockAppReads() {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(dashboard);
    if (path.startsWith('/internal/customers?')) {
      return Promise.resolve({
        data: [customer], total: 1, page: 1, limit: 20, totalPages: 1,
        hasNextPage: false, hasPreviousPage: false,
      });
    }
    if (path.endsWith('/phone-verification')) {
      return Promise.resolve({
        customerId: customer.id,
        customerStatus: 'ACTIVE',
        phones: [{ isPrimary: true, maskedValue: '+234*****4321', verifiedAt: '2026-09-10T12:00:00.000Z' }],
        activationGate: { verifiedPrimaryPhone: true },
      });
    }
    if (path.endsWith('/onboarding-readiness')) {
      return Promise.resolve({ status: 'READY', onboardingStatus: 'COMPLETED', missing: [] });
    }
    if (path.endsWith('/eligibility')) {
      return Promise.resolve({ status: 'ELIGIBLE', statusChangedAt: '2026-09-10T12:00:00.000Z' });
    }
    if (path.endsWith('/wallets')) return Promise.resolve({ data: [] });
    if (path.includes('/transactions?')) {
      return Promise.resolve({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
      });
    }
    return Promise.resolve({ data: [], items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });
}

describe('Customer 360° deep links preserve customer context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    setPrincipal();
    mockAppReads();
  });

  test('opens the customer-scoped transaction history from Customer 360 without asking for a UUID', async () => {
    const view = render(<App />);
    fireEvent.click(view.getByRole('button', { name: /Customer & KYC Servicing/ }));
    fireEvent.click(await view.findByRole('button', { name: /Open Customer 360° for Synthetic App Customer 360/ }));

    expect(await view.findByRole('heading', { name: 'Synthetic App Customer 360' })).toBeTruthy();
    fireEvent.click(await view.findByRole('button', { name: 'Open transaction workspace →' }));

    expect(await view.findByRole('heading', { name: 'Customer Transaction History' })).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith(
      `/internal/customers/${customer.id}/transactions?page=1&limit=20`,
    );
    expect(view.queryByPlaceholderText(/customer id|uuid/i)).toBeNull();
  });
});
