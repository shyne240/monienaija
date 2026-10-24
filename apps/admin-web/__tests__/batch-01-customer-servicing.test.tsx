import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { CustomerDirectoryScreen } from '../src/screens/authenticated/CustomerDirectoryScreen';
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
  id: 'cust-test-1',
  reference: 'mn-••••5678',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic Directory Alpha',
  legalName: 'Synthetic Directory Alpha Legal',
  createdAt: '2026-09-10T09:00:00.000Z',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
};

function directoryResponse(data = [customer], page = 1, hasNextPage = false) {
  return {
    data,
    total: hasNextPage ? 21 : data.length,
    page,
    limit: 20,
    totalPages: hasNextPage ? 2 : 1,
    hasNextPage,
    hasPreviousPage: page > 1,
  };
}

function setPrincipal(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'OPERATOR',
      principalId: 'issuer:test-operator',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Batch 1 customer directory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal([
      'customer.view',
      'customer.create',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_transactions',
      'customer.view_wallets',
      'customer.activate',
      'customer.suspend',
      'customer.close',
    ]);
    (ApiClient.get as jest.Mock).mockResolvedValue(directoryResponse());
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'cust-created', reference: 'mn-••••9876' });
  });

  test('uses the authorized, paginated workforce API and displays masked directory fields', async () => {
    const view = render(<CustomerDirectoryScreen />);

    expect(await view.findByText('Synthetic Directory Alpha')).toBeTruthy();
    expect(view.getByText('mn-••••5678')).toBeTruthy();
    expect(view.getByText('+234*****4321')).toBeTruthy();
    expect((view.getAllByText('ACTIVE')).length).toBeGreaterThan(0);
    expect((view.getAllByText('LEVEL_1')).length).toBeGreaterThan(0);
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/customers?page=1&limit=20');
    expect(view.queryByText('mn-0000000000')).toBeNull();
    expect(view.container.querySelector('pre')).toBeNull();
  });

  test('search, status/type/KYC filters and pagination are sent to the server', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('page=2')) return Promise.resolve(directoryResponse([customer], 2, false));
      return Promise.resolve(directoryResponse([customer], 1, true));
    });

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    fireEvent.change(view.getByRole('searchbox', { name: 'Search customers' }), {
      target: { value: 'Synthetic' },
    });
    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=Synthetic'));
    });

    fireEvent.change(view.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    fireEvent.change(view.getByLabelText('Type'), { target: { value: 'INDIVIDUAL' } });
    fireEvent.change(view.getByLabelText('KYC level'), { target: { value: 'LEVEL_1' } });
    fireEvent.change(view.getByLabelText('KYC status'), { target: { value: 'APPROVED' } });
    await waitFor(() => {
      const lastRequest = (ApiClient.get as jest.Mock).mock.calls.at(-1)?.[0] as string;
      expect(lastRequest).toContain('status=ACTIVE');
      expect(lastRequest).toContain('type=INDIVIDUAL');
      expect(lastRequest).toContain('kycLevel=LEVEL_1');
      expect(lastRequest).toContain('kycStatus=APPROVED');
    });

    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    });
  });

  test('manual creation asks for a reference and always submits a draft, never an active customer', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');
    fireEvent.click(view.getByRole('button', { name: 'New draft customer' }));
    fireEvent.change(view.getByLabelText('Customer reference'), { target: { value: 'mn-0000019876' } });
    fireEvent.click(view.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', {
        reference: 'mn-0000019876',
        type: 'INDIVIDUAL',
        status: 'DRAFT',
      });
      expect(view.getByText('Draft customer created. Reference: mn-••••9876')).toBeTruthy();
    });
  });

  test('hides draft creation when the principal lacks customer.create', async () => {
    setPrincipal(['customer.view']);
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');
    expect(view.queryByRole('button', { name: 'New draft customer' })).toBeNull();
  });
});
