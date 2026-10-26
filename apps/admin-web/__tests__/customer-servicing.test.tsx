import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';

import App from '../src/App';
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

const dashboard = {
  templateKey: 'DEFAULT_FALLBACK',
  displayName: 'Synthetic Workforce Dashboard',
  description: '',
  isFallback: true,
  widgets: [],
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
  test('opens the directory from the authenticated application shell and preserves masked summaries', async () => {
    const view = render(<App />);
    fireEvent.click(view.getByRole('button', { name: /Customer & KYC Servicing/ }));
    await view.findByRole('heading', { name: 'Customer directory' });
    const row = await view.findByRole('row', { name: /Synthetic Directory Alpha/ });
    expect(within(row).getByText('mn-••••5678')).toBeTruthy();
    expect(within(row).getByText('+234*****4321')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/customers?page=1&limit=20');
  });

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
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(dashboard);
      return Promise.resolve(directoryResponse());
    });
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

  test('opens the complete registration wizard and creates a structured-name DRAFT without asking for a reference', async () => {
    const created = {
      id: 'cust-created',
      reference: 'mn-cus-0123456789abcdef01234567',
      type: 'INDIVIDUAL',
      status: 'DRAFT',
      kycLevel: 'NONE',
      kycStatus: 'NOT_STARTED',
      version: 1,
      createdAt: '2026-10-24T12:00:00.000Z',
      updatedAt: '2026-10-24T12:00:00.000Z',
      deletedAt: null,
    };
    (ApiClient.post as jest.Mock).mockImplementation((path: string) => {
      if (path === '/customers') return Promise.resolve(created);
      if (path.endsWith('/registration-profile')) return Promise.resolve({ displayName: 'Synthetic New Customer' });
      return Promise.resolve({});
    });

    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');
    fireEvent.click(view.getByRole('button', { name: 'New Customer' }));
    expect(await view.findByRole('heading', { name: 'Customer details' })).toBeTruthy();
    expect(view.queryByLabelText('Customer reference')).toBeNull();
    expect(view.queryByLabelText(/Display name/)).toBeNull();
    expect(view.queryByLabelText(/Legal name/)).toBeNull();
    expect((view.getByLabelText(/First name/) as HTMLInputElement).required).toBe(true);
    expect((view.getByLabelText(/Middle name/) as HTMLInputElement).required).toBe(false);
    expect((view.getByLabelText(/Last name/) as HTMLInputElement).required).toBe(true);

    fireEvent.change(view.getByLabelText(/First name/), { target: { value: 'Synthetic' } });
    fireEvent.change(view.getByLabelText(/Middle name/), { target: { value: 'New' } });
    fireEvent.change(view.getByLabelText(/Last name/), { target: { value: 'Customer' } });
    fireEvent.click(view.getByRole('button', { name: 'Create DRAFT & continue' }));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers', { type: 'INDIVIDUAL' });
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/cust-created/registration-profile', {
        firstName: 'Synthetic',
        middleName: 'New',
        lastName: 'Customer',
        dateOfBirth: undefined,
        nationality: 'NG',
      });
      expect(view.getByLabelText(/Primary phone number/)).toBeTruthy();
    });
  });

  test('hides draft creation when the principal lacks customer.create', async () => {
    setPrincipal(['customer.view']);
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');
    expect(view.queryByRole('button', { name: 'New Customer' })).toBeNull();
  });
});
