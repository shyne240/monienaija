import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { Customer360Workspace, type DirectoryCustomer } from '../src/screens/authenticated/Customer360Workspace';
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

const customer: DirectoryCustomer = {
  id: 'cust-360-test',
  reference: 'mn-••••4321',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic Customer 360',
  legalName: 'Synthetic Customer 360 Legal',
  createdAt: '2026-09-12T12:00:00.000Z',
};

const fullPhone = '+2340000004321';
const fullEmail = 'synthetic.customer@example.test';

function setPrincipal(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'PRIVILEGED',
      principalId: 'issuer:test-super-admin',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['SUPER_ADMIN'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

function mockCustomerReads() {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
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
    if (path.includes('/transactions?')) {
      return Promise.resolve({
        items: [{
          id: 'txn-1',
          type: 'WALLET_TRANSFER',
          status: 'COMPLETED',
          amountMinor: '350050',
          currency: 'NGN',
          direction: 'OUTGOING',
          createdAt: '2026-10-01T10:00:00.000Z',
          counterparty: { receivingNumber: '+2340000001234' },
        }],
        pagination: { page: 1, limit: 5, total: 1 },
      });
    }
    if (path.endsWith('/wallets')) {
      return Promise.resolve({ data: [{ id: 'wallet-1', customerId: customer.id, currency: 'NGN', status: 'ACTIVE' }] });
    }
    if (path.endsWith('/wallets/wallet-1/balance')) {
      return Promise.resolve({ walletId: 'wallet-1', customerId: customer.id, currency: 'NGN', balanceMinor: '350050', status: 'ACTIVE' });
    }
    if (path.endsWith('/profile')) {
      return Promise.resolve({ displayName: customer.displayName, legalName: customer.legalName, dateOfBirth: '1990-06-12', nationality: 'NG' });
    }
    if (path.endsWith('/identity-documents')) return Promise.resolve([]);
    if (path.endsWith('/addresses')) {
      return Promise.resolve([{ id: 'address-1', type: 'RESIDENTIAL', lineOne: '1 Synthetic Road', city: 'Abuja', state: 'FCT', country: 'NG', isPrimary: true }]);
    }
    if (path.endsWith('/contact-methods')) {
      return Promise.resolve([
        { id: 'contact-1', type: 'PHONE', value: fullPhone, isPrimary: true, verifiedAt: '2026-09-10T12:00:00.000Z' },
        { id: 'contact-2', type: 'EMAIL', value: fullEmail, isPrimary: false, verifiedAt: null },
      ]);
    }
    return Promise.resolve({ data: [], items: [] });
  });
}

describe('Batch 1 Customer 360° workspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal([
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_transactions',
      'customer.view_wallets',
      'customer.activate',
      'customer.suspend',
      'customer.close',
      'kyc.view',
      'customer.view_identity_documents',
    ]);
    mockCustomerReads();
  });

  test('shows ledger-backed balances, masked phone, readiness, eligibility and recent transactions', async () => {
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={jest.fn()} />,
    );

    expect(await view.findByRole('heading', { name: 'Synthetic Customer 360' })).toBeTruthy();
    expect(await view.findByText('Ready')).toBeTruthy();
    expect((await view.findAllByText('ELIGIBLE')).length).toBe(2);
    expect((await view.findAllByText('₦3,500.50')).length).toBe(2);
    expect(await view.findByText('+234*****4321')).toBeTruthy();
    expect(await view.findByText('WALLET TRANSFER')).toBeTruthy();
    expect(await view.findByText(/••••••1234/)).toBeTruthy();
    expect(view.queryByText('+2340000001234')).toBeNull();
    expect(view.queryByText(fullPhone)).toBeNull();
    expect(view.queryByText(fullEmail)).toBeNull();
    expect(view.container.querySelector('pre')).toBeNull();
    expect(ApiClient.get).toHaveBeenCalledWith(`/internal/customers/${customer.id}/wallets/wallet-1/balance`);
    expect(ApiClient.get).toHaveBeenCalledWith(`/internal/customers/${customer.id}/transactions?page=1&limit=5`);
    expect(ApiClient.get).not.toHaveBeenCalledWith(`/customers/${customer.id}/identity-documents`);
    expect(view.queryByRole('button', { name: /Provision Wallet|Submit KYC Assessment|Identity Documents/i })).toBeNull();
  });

  test('loads authorized personal/contact/address APIs lazily and masks contact values until explicitly shown', async () => {
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={jest.fn()} />,
    );
    await view.findByRole('heading', { name: 'Synthetic Customer 360' });
    expect(ApiClient.get).not.toHaveBeenCalledWith(`/customers/${customer.id}/contact-methods`);

    fireEvent.click(view.getByRole('tab', { name: 'Personal information & contact' }));
    expect(await view.findByText('1 Synthetic Road')).toBeTruthy();
    expect(view.getByText('••••••4321')).toBeTruthy();
    expect(view.getByText('s•••@example.test')).toBeTruthy();
    expect(view.queryByText(fullPhone)).toBeNull();
    expect(view.queryByText(fullEmail)).toBeNull();
    expect(ApiClient.get).toHaveBeenCalledWith(`/customers/${customer.id}/profile`);
    expect(ApiClient.get).toHaveBeenCalledWith(`/customers/${customer.id}/addresses`);
    expect(ApiClient.get).toHaveBeenCalledWith(`/customers/${customer.id}/contact-methods`);

    fireEvent.click(view.getByRole('button', { name: 'Show values' }));
    expect(await view.findByText(fullPhone)).toBeTruthy();
    expect(await view.findByText(fullEmail)).toBeTruthy();
  });

  test('omits contact/address APIs and shows restricted empty states for a principal without their functions', async () => {
    setPrincipal(['customer.view']);
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={jest.fn()} />,
    );
    await view.findByRole('heading', { name: 'Synthetic Customer 360' });
    fireEvent.click(view.getByRole('tab', { name: 'Personal information & contact' }));
    expect(await view.findByText('Contact details are restricted to authorized contact-method viewers.')).toBeTruthy();
    expect(await view.findByText('Address details are restricted to authorized address viewers.')).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalledWith(`/customers/${customer.id}/addresses`);
    expect(ApiClient.get).not.toHaveBeenCalledWith(`/customers/${customer.id}/contact-methods`);
    expect(ApiClient.get).not.toHaveBeenCalledWith(`/customers/${customer.id}/identity-documents`);
  });

  test('shows explicit not-recorded states when profile, contacts and addresses are absent', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('/profile')) return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
      if (path.endsWith('/addresses') || path.endsWith('/contact-methods') || path.endsWith('/identity-documents')) return Promise.resolve([]);
      if (path.endsWith('/onboarding-readiness')) return Promise.resolve({ status: 'NOT_READY', onboardingStatus: null, missing: [] });
      if (path.endsWith('/eligibility')) return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
      if (path.endsWith('/phone-verification')) return Promise.resolve({ phones: [], activationGate: { verifiedPrimaryPhone: false } });
      return Promise.resolve({ items: [], data: [] });
    });
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={jest.fn()} />,
    );
    await view.findByRole('heading', { name: 'Synthetic Customer 360' });
    fireEvent.click(view.getByRole('tab', { name: 'Personal information & contact' }));
    expect(await view.findByText('No profile is recorded yet.')).toBeTruthy();
    expect(view.getByText('No phone number or email is recorded.')).toBeTruthy();
    expect(view.getByText('No address is recorded.')).toBeTruthy();
  });

  test('lifecycle changes require confirmation and use the authenticated principal context', async () => {
    const onCustomerUpdated = jest.fn();
    (ApiClient.patch as jest.Mock).mockResolvedValue({ ...customer, status: 'SUSPENDED' });
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={onCustomerUpdated} />,
    );
    await view.findByRole('heading', { name: 'Synthetic Customer 360' });
    fireEvent.click(view.getByRole('button', { name: 'Suspend' }));
    expect(view.getByRole('dialog')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Confirm change' }));

    await waitFor(() => {
      expect(ApiClient.patch).toHaveBeenCalledWith(`/customers/${customer.id}`, {
        status: 'SUSPENDED',
      });
      expect(onCustomerUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUSPENDED' }));
    });
  });

  test('the transaction deep link carries the selected customer context without a UUID form', async () => {
    const onNavigate = jest.fn();
    const view = render(
      <Customer360Workspace customer={customer} onBack={jest.fn()} onCustomerUpdated={jest.fn()} onNavigate={onNavigate} />,
    );
    await view.findByRole('heading', { name: 'Synthetic Customer 360' });
    fireEvent.click(view.getByRole('button', { name: 'Open transaction workspace →' }));
    expect(onNavigate).toHaveBeenCalledWith('transfers', customer.id);
    expect(view.queryByPlaceholderText(/customer id|uuid/i)).toBeNull();
  });
});
