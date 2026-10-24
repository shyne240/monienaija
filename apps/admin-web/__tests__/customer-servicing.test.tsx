import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';

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
  id: 'batch1-app-customer-001',
  reference: 'mn-••••5678',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic App Customer',
  legalName: 'Synthetic App Customer Legal',
  createdAt: '2026-09-10T09:00:00.000Z',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
};

const dashboard = {
  templateKey: 'DEFAULT_FALLBACK',
  displayName: 'Synthetic Workforce Dashboard',
  description: '',
  isFallback: true,
  widgets: [],
};

function directoryResponse() {
  return {
    data: [customer],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function setPrincipal() {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'OPERATOR',
      principalId: 'issuer:batch1-test-operator',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes: [
        'customer.view',
        'customer.create',
        'customer.view_address',
        'customer.view_contact_methods',
        'customer.view_transactions',
        'customer.view_wallets',
        'customer.activate',
        'customer.suspend',
        'customer.close',
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
    if (path.startsWith('/internal/customers?')) return Promise.resolve(directoryResponse());
    return Promise.resolve({ data: [], items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });
}

async function openDirectory() {
  const view = render(<App />);
  fireEvent.click(view.getByRole('button', { name: /Customer & KYC Servicing/ }));
  await view.findByRole('heading', { name: 'Customer directory' });
  return view;
}

describe('Admin Web customer servicing (application-level)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    setPrincipal();
    mockAppReads();
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'batch1-draft-001', reference: 'mn-0000009876' });
  });

  test('opens the customer directory from the authenticated shell and renders scoped customer summaries', async () => {
    const view = await openDirectory();
    const row = await view.findByRole('row', { name: /Synthetic App Customer/ });

    expect(within(row).getByText('Synthetic App Customer')).toBeTruthy();
    expect(within(row).getByText(/Synthetic App Customer Legal/)).toBeTruthy();
    expect(within(row).getByText('mn-••••5678')).toBeTruthy();
    expect(within(row).getByText('+234*****4321')).toBeTruthy();
    expect(within(row).getByText('LEVEL_1')).toBeTruthy();
    expect(within(row).getByText('APPROVED')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/customers?page=1&limit=20');
    expect(view.queryByText('mn-0000000000')).toBeNull();
  });

  test('submits a manual customer through the app as DRAFT and shows only the masked reference', async () => {
    const view = await openDirectory();
    await view.findByText('Synthetic App Customer');
    fireEvent.click(view.getByRole('button', { name: 'New draft customer' }));
    fireEvent.change(view.getByLabelText('Customer reference'), {
      target: { value: 'mn-0000019876' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', {
        reference: 'mn-0000019876',
        type: 'INDIVIDUAL',
        status: 'DRAFT',
      });
      expect(view.getByRole('status').textContent).toContain('mn-••••9876');
    });
  });
});
